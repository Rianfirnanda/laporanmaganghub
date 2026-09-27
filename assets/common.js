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

function hariKe(config, dateStr) {
  return daysBetween(config.tanggalMulai, dateStr) + 1;
}

function mingguKe(config, dateStr) {
  return Math.floor(daysBetween(config.tanggalMulai, dateStr) / 7) + 1;
}

function rentangMinggu(config, minggu) {
  const start = new Date(parseDate(config.tanggalMulai).getTime() + (minggu - 1) * 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start, end };
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
