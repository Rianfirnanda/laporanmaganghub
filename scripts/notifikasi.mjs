// Kirim notifikasi push ke perangkat yang terdaftar di data/notifikasi.json.
// Dipanggil GitHub Actions:
//   node scripts/notifikasi.mjs --dari-push          (workflow notifikasi.yml, tiap push)
//   node scripts/notifikasi.mjs --berkas pesan.json  (robot laporan AI)
//   node scripts/notifikasi.mjs --kategori ai --judul "…" --isi "…" [--url admin.html]
// Butuh secret VAPID_PRIVATE_KEY (dibuat di panel admin → Keamanan → Notifikasi push).
import fs from 'node:fs';
import { kunciVapid, bukaLangganan, kirimPush } from './webpush.mjs';

const FILE = 'data/notifikasi.json';
const KATEGORI = ['ai', 'data', 'sistem'];
const read = (path, fallback) => {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
};
const potong = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const baris1 = m => String(m || '').split('\n')[0].trim();

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const config = read('data/config.json', {});
const repo = String(process.env.GITHUB_REPOSITORY || '').toLowerCase();
if (repo && config.repo && String(config.repo).toLowerCase() !== repo) {
  console.log('Lewati: repo salinan yang belum diatur ("Mulai baru" di panel admin).');
  process.exit(0);
}
const rahasia = (process.env.VAPID_PRIVATE_KEY || '').trim();
if (!rahasia) { console.log('Lewati: secret VAPID_PRIVATE_KEY belum diatur.'); process.exit(0); }
let kunci;
try { kunci = kunciVapid(rahasia); } catch (e) { console.log(`Lewati: ${e.message}`); process.exit(0); }
const publik = config.notifikasi && config.notifikasi.vapidPublik;
if (publik !== kunci.publik) {
  console.log('Lewati: VAPID_PRIVATE_KEY tidak cocok dengan kunci publik di config.json. Salin ulang kunci dari panel admin.');
  process.exit(0);
}

const data = read(FILE, {});
const langganan = Array.isArray(data.langganan) ? data.langganan : [];
if (!langganan.length) { console.log('Belum ada perangkat yang berlangganan.'); process.exit(0); }

// ---------- Susun pesan ----------
// Tiap pesan: { kategori, judul, isi, url, tag, perangkat? (hanya ke satu perangkat) }
function dariPush() {
  const ev = read(process.env.GITHUB_EVENT_PATH || '', {});
  const commits = Array.isArray(ev.commits) ? ev.commits : [];
  const grup = { data: [], sistem: [], perangkat: [] };
  const pesan = [];
  for (const c of commits) {
    const msg = baris1(c.message);
    const files = [...(c.added || []), ...(c.modified || []), ...(c.removed || [])];
    const tes = msg.match(/^Tes notifikasi ([\w-]{8,40})$/);
    if (tes) {
      pesan.push({ kategori: 'tes', perangkat: tes[1], judul: '🔔 Tes notifikasi berhasil', isi: 'Perangkat ini akan menerima notifikasi laporan magang.', url: 'admin.html', tag: 'tes' });
      continue;
    }
    if (/^Ubah pilihan notifikasi/.test(msg)) continue;
    if (files.length && files.every(f => f === FILE)) grup.perangkat.push(msg);
    else if (files.length && files.every(f => f.startsWith('data/') || f.startsWith('uploads/'))) grup.data.push(msg);
    else grup.sistem.push(msg);
  }
  const ringkas = list => potong(list.slice(-3).reverse().join(' · ') + (list.length > 3 ? ` (+${list.length - 3} lainnya)` : ''), 220);
  if (grup.data.length) pesan.push({ kategori: 'data', judul: '📝 Laporan magang diperbarui', isi: ringkas(grup.data), url: './', tag: 'data' });
  if (grup.perangkat.length) pesan.push({ kategori: 'sistem', judul: '🔐 Perangkat notifikasi berubah', isi: ringkas(grup.perangkat), url: 'admin.html', tag: 'perangkat' });
  if (grup.sistem.length) pesan.push({ kategori: 'sistem', judul: '⚙️ Website diperbarui', isi: ringkas(grup.sistem), url: 'admin.html', tag: 'sistem' });
  return pesan;
}

let pesan;
if (args.includes('--dari-push')) pesan = dariPush();
else if (arg('berkas')) pesan = [].concat(read(arg('berkas'), []));
else pesan = [{ kategori: arg('kategori') || 'sistem', judul: arg('judul') || 'Laporan Magang', isi: arg('isi') || '', url: arg('url') || 'admin.html', tag: arg('kategori') }];
pesan = pesan.filter(p => p && p.judul && (KATEGORI.includes(p.kategori) || p.kategori === 'tes'));
if (!pesan.length) { console.log('Tidak ada yang perlu diberitahukan.'); process.exit(0); }

// ---------- Kirim ----------
const owner = repo.split('/')[0];
const nama = repo.split('/')[1];
const subjek = owner ? `https://${owner}.github.io/${nama && nama !== `${owner}.github.io` ? `${nama}/` : ''}` : 'mailto:noreply@example.com';
const hapus = new Set();
let terkirim = 0;
for (const item of langganan) {
  if (!item || !item.id || !item.enc) continue;
  let sub;
  try { sub = bukaLangganan(item.enc, kunci); } catch { console.log(`  ${item.id}: tidak bisa dibuka (kunci VAPID sudah diganti?), dihapus.`); hapus.add(item.id); continue; }
  const kat = item.kategori || {};
  for (const p of pesan) {
    if (p.kategori === 'tes' ? p.perangkat !== item.id : kat[p.kategori] === false) continue;
    const payload = { judul: potong(p.judul, 80), isi: potong(p.isi, 240), url: p.url || './', tag: p.tag || p.kategori, waktu: Date.now() };
    try {
      const status = await kirimPush(sub, payload, kunci, subjek, { urgensi: p.kategori === 'tes' || p.kategori === 'ai' ? 'high' : 'normal' });
      if (status === 404 || status === 410) { hapus.add(item.id); console.log(`  ${item.id}: langganan kedaluwarsa (${status}), dihapus.`); break; }
      if (status >= 400) console.log(`  ${item.id}: layanan push menolak (${status}).`);
      else terkirim++;
    } catch (e) {
      console.log(`  ${item.id}: gagal mengirim (${e.message}).`);
    }
  }
}
console.log(`${terkirim} notifikasi terkirim ke ${langganan.length - hapus.size} perangkat.`);
if (hapus.size && !args.includes('--tanpa-bersih')) {
  data.langganan = langganan.filter(x => !hapus.has(x && x.id));
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
}
