// Fungsi bersama untuk halaman publik dan panel admin.

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAY_MS = 86400000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// "2026-09-27" -> Date lokal jam 00:00 (hindari geser zona waktu).
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

function formatTanggal(str, withDay = true) {
  const d = parseDate(str);
  const t = `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
  return withDay ? `${HARI[d.getDay()]}, ${t}` : t;
}

function formatPendek(date) {
  return `${date.getDate()} ${BULAN_PENDEK[date.getMonth()]}`;
}

// ---------- Hari kerja (Senin–Jumat, di luar libur nasional) ----------
// Magang dihitung per hari kerja: Sabtu/Minggu serta libur nasional dan cuti
// bersama (config.hariLibur, diatur di panel admin) tidak masuk hitungan hari,
// statistik, maupun laporan mingguan.
const HARI_LIBUR = new Map();   // "YYYY-MM-DD" -> { nama, jenis: 'libur' | 'cuti' }

function aturHariLibur(list) {
  HARI_LIBUR.clear();
  (Array.isArray(list) ? list : []).forEach(h => {
    if (h && /^\d{4}-\d{2}-\d{2}$/.test(h.tanggal)) {
      HARI_LIBUR.set(h.tanggal, { nama: String(h.nama || 'Libur nasional').slice(0, 80), jenis: h.jenis === 'cuti' ? 'cuti' : 'libur' });
    }
  });
}

function infoLibur(dateStr) {
  return HARI_LIBUR.get(dateStr) || null;
}

function isAkhirPekan(dateStr) {
  const d = parseDate(dateStr).getDay();
  return d === 0 || d === 6;
}

function isHariKerja(dateStr) {
  return !isAkhirPekan(dateStr) && !HARI_LIBUR.has(dateStr);
}

// Label untuk hari yang tidak dihitung, mis. "Akhir pekan" / "Libur: Hari Raya Natal".
function labelBukanHariKerja(dateStr) {
  const l = infoLibur(dateStr);
  if (l && !isAkhirPekan(dateStr)) return `${l.jenis === 'cuti' ? 'Cuti bersama' : 'Libur nasional'}: ${l.nama.replace(/^cuti bersama\s*/i, '')}`;
  return 'Akhir pekan';
}

// Senin pada minggu kalender tanggal itu.
function seninDari(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Jumlah hari kerja dari a sampai b (inklusif): Senin–Jumat dikurangi libur.
function hitungHariKerja(a, b) {
  if (b < a) return 0;
  let libur = 0;
  HARI_LIBUR.forEach((_, d) => { if (d >= a && d <= b && !isAkhirPekan(d)) libur++; });
  return hitungSeninJumat(a, b) - libur;
}

function hitungSeninJumat(a, b) {
  if (b < a) return 0;
  const days = daysBetween(a, b) + 1;
  const full = Math.floor(days / 7);
  let n = full * 5;
  const start = parseDate(a).getDay();
  for (let i = 0; i < days % 7; i++) {
    const wd = (start + full * 7 + i) % 7;
    if (wd >= 1 && wd <= 5) n++;
  }
  return n;
}

// Hari kerja ke-berapa (akhir pekan ikut nomor hari Jumat sebelumnya).
function hariKe(config, dateStr) {
  return hitungHariKerja(config.tanggalMulai, dateStr);
}

function totalHariKerja(config) {
  return hitungHariKerja(config.tanggalMulai, config.tanggalSelesai);
}

// Minggu kalender (Senin–Jumat) sejak minggu tanggal mulai.
function mingguKe(config, dateStr) {
  return Math.round((seninDari(dateStr) - seninDari(config.tanggalMulai)) / (7 * DAY_MS)) + 1;
}

// Senin sampai Jumat minggu itu, dibatasi tanggal mulai/selesai magang.
function rentangMinggu(config, minggu) {
  const start = seninDari(config.tanggalMulai);
  start.setDate(start.getDate() + (minggu - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 4);
  const mulai = parseDate(config.tanggalMulai);
  const selesai = config.tanggalSelesai ? parseDate(config.tanggalSelesai) : null;
  return { start: start < mulai ? mulai : start, end: selesai && end > selesai ? selesai : end };
}

function sesiDariJam(jam) {
  const h = parseInt((jam || '08').split(':')[0], 10);
  if (h < 11) return 'Pagi';
  if (h < 15) return 'Siang';
  return 'Sore';
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) =>
    b.tanggal.localeCompare(a.tanggal) || (a.jam || '').localeCompare(b.jam || ''));
}

async function fetchJSON(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Gagal memuat ${url} (${res.status})`);
  return res.json();
}

function inisial(nama) {
  return (nama || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

// ---------- Validasi data (pertahanan terhadap isi yang tidak diharapkan) ----------

// Hanya izinkan tautan http(s), email, dan telepon (tolak "javascript:" dsb.).
function safeUrl(url) {
  const s = String(url || '').trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) ? s : '';
}

// Foto harus berada di folder uploads/ repository ini.
function safePath(path) {
  const s = String(path || '');
  return /^uploads\/[A-Za-z0-9._/-]+$/.test(s) && !s.includes('..') ? s : '';
}

function safeColor(color, fallback = '#1d4ed8') {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback;
}

function applyTheme(color) {
  document.documentElement.style.setProperty('--accent', safeColor(color));
}

// ---------- Pembaruan otomatis ----------
// GitHub Pages menyuruh browser menyimpan halaman ±10 menit, sehingga setelah
// website diperbarui HP bisa masih memakai versi lama. Setiap halaman membaca
// version.json (tanpa cache); bila berbeda dengan versi yang sedang berjalan,
// halaman dimuat ulang dengan alamat baru agar pasti mengambil versi terbaru.
const APP_VERSION = (() => {
  try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch { return ''; }
})();

async function cekVersiBaru() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const v = String((await res.json()).v || '');
    return v && APP_VERSION && v !== APP_VERSION ? v : '';
  } catch { return ''; }
}

function muatVersiBaru(v) {
  const key = `laporanmagang.versi.${v}`;
  try {
    if (sessionStorage.getItem(key)) return false;   // cegah muat ulang berulang
    sessionStorage.setItem(key, '1');
  } catch { /* tanpa sessionStorage: tetap coba sekali */ }
  const url = new URL(location.href);
  url.searchParams.set('versi', v);
  location.replace(url.href);
  return true;
}

function bannerVersiBaru(v) {
  if (document.getElementById('updateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBar';
  bar.className = 'update-bar';
  bar.innerHTML = '<span>Versi baru website tersedia.</span><button type="button" class="btn btn-primary btn-sm">Perbarui</button>';
  bar.querySelector('button').addEventListener('click', () => {
    try { sessionStorage.removeItem(`laporanmagang.versi.${v}`); } catch { /* abaikan */ }
    muatVersiBaru(v);
  });
  document.body.appendChild(bar);
}

async function periksaPembaruan() {
  const v = await cekVersiBaru();
  if (!v) return;
  // Panel admin bisa menahan pembaruan selama ada isian yang belum disimpan.
  const tahan = typeof window.adaIsianBelumDisimpan === 'function' && window.adaIsianBelumDisimpan();
  if (tahan || !muatVersiBaru(v)) bannerVersiBaru(v);
}

(function mulaiPembaruanOtomatis() {
  // Hapus penanda ?versi= dari alamat setelah halaman baru termuat.
  const url = new URL(location.href);
  if (url.searchParams.has('versi')) {
    url.searchParams.delete('versi');
    history.replaceState(history.state, '', url.href);
  }
  periksaPembaruan();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) periksaPembaruan(); });
  setInterval(periksaPembaruan, 5 * 60 * 1000);
})();

// ---------- Waktu server (WIB/WITA/WIT) ----------
// Jam HP/laptop bisa salah atau diubah, jadi waktu diambil dari header "Date"
// server GitHub Pages lalu dipakai sebagai selisih terhadap jam perangkat.
// Zona waktu mengikuti pengaturan "zonaWaktu" di data/config.json.
const ZONA_WAKTU = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };
let ZONA = 'Asia/Jakarta';
let ZONA_LABEL = 'WIB';

function aturZona(tz) {
  ZONA = Object.hasOwn(ZONA_WAKTU, tz) ? tz : 'Asia/Jakarta';
  ZONA_LABEL = ZONA_WAKTU[ZONA];
}
let serverOffset = 0;
let serverSynced = false;

async function syncServerTime() {
  try {
    const t0 = Date.now();
    const res = await fetch(`data/config.json?waktu=${t0}`, { method: 'HEAD', cache: 'no-store' });
    const t1 = Date.now();
    const date = Date.parse(res.headers.get('Date') || '');
    if (!Number.isFinite(date)) return false;
    // Header Date dibulatkan ke detik; ambil titik tengah perjalanan permintaan.
    serverOffset = date + 500 - (t0 + t1) / 2;
    serverSynced = true;
  } catch { /* offline: pakai jam perangkat */ }
  return serverSynced;
}

function serverNow() {
  return new Date(Date.now() + serverOffset);
}

// Bagian tanggal/jam dalam zona waktu magang, apa pun zona waktu perangkat.
function wibParts(date = serverNow()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { tanggal: `${p.year}-${p.month}-${p.day}`, jam: `${p.hour}:${p.minute}`, detik: p.second };
}

// "Sabtu, 27 September 2026 · 15.35.12 WIB"
function formatWaktuWib(date, withDate = true) {
  const w = wibParts(date);
  const jam = `${w.jam.replace(':', '.')}.${w.detik} ${ZONA_LABEL}`;
  return withDate ? `${formatTanggal(w.tanggal)} · ${jam}` : jam;
}

// ---------- Ikon (garis, gaya Lucide) ----------
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-.5a2 2 0 0 1 2-2h1.5A4.5 4.5 0 0 0 22 13 11 10 0 0 0 12 2z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  locate: '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  badge: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudCheck: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 13 2 2 4-4"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 9.7 5.04"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
};

function icon(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Sisipkan sprite sekali; elemen <svg><use href="#i-..."> di HTML ikut memakainya.
(function injectIconSprite() {
  const symbols = Object.entries(ICONS).map(([n, p]) =>
    `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</symbol>`).join('');
  document.body.insertAdjacentHTML('afterbegin', `<svg class="icon-sprite" width="0" height="0" aria-hidden="true">${symbols}</svg>`);
})();
