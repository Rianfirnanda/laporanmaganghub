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
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'
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
