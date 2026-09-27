// Robot GitHub Actions: menulis laporan harian AI untuk hari yang kegiatannya
// baru/berubah, lalu memperbarui ringkasan dasbor. Memakai assets/ai.js yang
// sama dengan panel admin. Kunci API diambil dari Secrets repositori:
//   GEMINI_API_KEY (Google AI Studio) dan/atau GROQ_API_KEY (console.groq.com).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ai = require('../assets/ai.js');

const keys = { gemini: (process.env.GEMINI_API_KEY || '').trim(), groq: (process.env.GROQ_API_KEY || '').trim() };
if (!keys.gemini && !keys.groq) {
  console.log('Lewati: secret GEMINI_API_KEY atau GROQ_API_KEY belum diatur di repositori.');
  process.exit(0);
}

const read = (path, fallback) => {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
};
const write = (path, data) => fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');

const config = read('data/config.json', {});
// Repo salinan (template/fork) yang belum dikosongkan lewat "Mulai baru" masih
// berisi data pemilik lama: jangan habiskan kuota AI untuk itu.
const repo = String(process.env.GITHUB_REPOSITORY || '').toLowerCase();
if (repo && config.repo && String(config.repo).toLowerCase() !== repo) {
  console.log(`Lewati: data milik ${config.repo}. Buka panel admin → "Mulai baru" dulu.`);
  process.exit(0);
}
const entries = (read('data/kegiatan.json', []) || []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.tanggal));
let harian = read('data/harian.json', {});
if (!harian || typeof harian !== 'object' || Array.isArray(harian)) harian = {};

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const label = d => {
  const [y, m, day] = d.split('-').map(Number);
  return `${HARI[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}, ${day} ${BULAN[m - 1]} ${y}`;
};
const ZONA = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'].includes(config.zonaWaktu) ? config.zonaWaktu : 'Asia/Jakarta';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());

const recent = [...new Set(entries.map(e => e.tanggal))].filter(d => d <= today).sort().slice(-7);
const todo = recent.filter(d => ai.perluLaporanAi(entries, harian, d, config.hariLibur)).sort().reverse().slice(0, 5);
if (!todo.length) {
  console.log('Semua laporan harian sudah terbaru.');
  process.exit(0);
}

const log = t => console.log(`  ${t}`);
for (const date of todo) {
  const rec = harian[date] || {};
  console.log(`Menulis laporan ${date}…`);
  const prompt = ai.buildHarianPrompt({ config, entries, harian, date, status: rec.status || 'Hadir', ket: rec.keterangan || '', tanggalLabel: label(date) });
  const res = await ai.aiGenerate({ keys, system: ai.AI_SYSTEM, prompt, schema: ai.HARIAN_SCHEMA, temperature: 0.9, onStatus: log });
  harian[date] = {
    ...rec,
    status: rec.status || 'Hadir',
    ...ai.cleanHarian(res.data),
    auto: true,
    sumber: ai.sumberHarian(entries, date),
    model: `${res.provider} · ${res.model} (robot)`,
    diperbarui: new Date().toISOString()
  };
  log(`selesai dengan ${res.provider} · ${res.model}`);
}
write('data/harian.json', Object.fromEntries(Object.entries(harian).sort(([a], [b]) => b.localeCompare(a))));

try {
  const built = ai.buildSummaryPrompt({ config, entries, harian });
  if (built) {
    const res = await ai.aiGenerate({ keys, system: ai.SUMMARY_SYSTEM, prompt: built.prompt, schema: ai.SUMMARY_SCHEMA, temperature: 0.8, onStatus: log });
    const old = read('data/ringkasan.json', {}) || {};
    const summary = { diperbarui: new Date().toISOString(), minggu: built.minggu, ...ai.cleanSummary(res.data) };
    write('data/ringkasan.json', { ...summary, mingguan: { ...(old.mingguan || {}), [built.minggu]: summary.mingguIni } });
    console.log('Ringkasan dasbor diperbarui.');
  }
} catch (e) {
  console.log(`Ringkasan dasbor dilewati: ${e.message}`);
}
