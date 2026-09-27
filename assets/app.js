// Halaman publik: menampilkan dokumentasi kegiatan per minggu dan per hari.

const $ = id => document.getElementById(id);
let CONFIG = null;
let ENTRIES = [];
let lbPhotos = [];
let lbIndex = 0;

async function init() {
  try {
    [CONFIG, ENTRIES] = await Promise.all([
      fetchJSON('data/config.json'),
      fetchJSON('data/kegiatan.json')
    ]);
  } catch (e) {
    $('timeline').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  renderProfile();
  renderStats();
  fillWeekFilter();
  bindFilters();
  render();
}

function renderProfile() {
  document.title = `Laporan Magang · ${CONFIG.nama}`;
  $('avatar').textContent = inisial(CONFIG.nama);
  $('nama').textContent = CONFIG.nama;
  $('posisi').textContent = CONFIG.posisi;
  $('instansi').textContent = CONFIG.instansi;
  $('program').textContent = CONFIG.program || '';
  $('footerText').textContent = `${CONFIG.instansi} · ${formatTanggal(CONFIG.tanggalMulai, false)} – ${formatTanggal(CONFIG.tanggalSelesai, false)}`;

  const total = daysBetween(CONFIG.tanggalMulai, CONFIG.tanggalSelesai) + 1;
  const now = Math.min(Math.max(hariKe(CONFIG, todayStr()), 0), total);
  const pct = Math.round((now / total) * 100);
  const circ = 2 * Math.PI * 27;
  $('ringFg').style.strokeDasharray = circ;
  $('ringFg').style.strokeDashoffset = circ * (1 - pct / 100);
  $('ringText').textContent = `${pct}%`;
  $('progressLabel').textContent = now > 0 ? `Hari ke-${now} dari ${total}` : 'Belum dimulai';
  $('progressSub').textContent = now > 0 ? `Sisa ${total - now} hari · Minggu ke-${mingguKe(CONFIG, todayStr())}` : `Mulai ${formatTanggal(CONFIG.tanggalMulai, false)}`;
  $('progress').hidden = false;
}

function renderStats() {
  const hari = new Set(ENTRIES.map(e => e.tanggal)).size;
  const foto = ENTRIES.reduce((n, e) => n + (e.foto || []).length, 0);
  const minggu = new Set(ENTRIES.map(e => mingguKe(CONFIG, e.tanggal))).size;
  const items = [
    ['Kegiatan tercatat', ENTRIES.length],
    ['Hari terdokumentasi', hari],
    ['Foto kegiatan', foto],
    ['Minggu berjalan', minggu]
  ];
  $('stats').innerHTML = items.map(([l, v]) =>
    `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${l}</span></div>`).join('');
}

function fillWeekFilter() {
  const weeks = [...new Set(ENTRIES.map(e => mingguKe(CONFIG, e.tanggal)))].sort((a, b) => b - a);
  $('filterMinggu').innerHTML = '<option value="">Semua minggu</option>' + weeks.map(w => {
    const { start, end } = rentangMinggu(CONFIG, w);
    return `<option value="${w}">Minggu ke-${w} (${formatPendek(start)} – ${formatPendek(end)})</option>`;
  }).join('');
  const params = new URLSearchParams(location.search);
  if (params.get('minggu')) $('filterMinggu').value = params.get('minggu');
}

function bindFilters() {
  ['filterMinggu', 'filterTanggal', 'filterCari'].forEach(id => $(id).addEventListener('input', render));
  $('btnReset').addEventListener('click', () => {
    $('filterMinggu').value = '';
    $('filterTanggal').value = '';
    $('filterCari').value = '';
    render();
  });
  $('btnPrint').addEventListener('click', () => window.print());
}

function filtered() {
  const w = $('filterMinggu').value;
  const t = $('filterTanggal').value;
  const q = $('filterCari').value.trim().toLowerCase();
  return ENTRIES.filter(e =>
    (!w || mingguKe(CONFIG, e.tanggal) === Number(w)) &&
    (!t || e.tanggal === t) &&
    (!q || `${e.judul} ${e.keterangan} ${e.lokasi || ''}`.toLowerCase().includes(q)));
}

function render() {
  const list = sortEntries(filtered());
  const url = new URL(location.href);
  $('filterMinggu').value ? url.searchParams.set('minggu', $('filterMinggu').value) : url.searchParams.delete('minggu');
  history.replaceState(null, '', url);

  if (!list.length) {
    $('timeline').innerHTML = `<p class="empty">${ENTRIES.length ? 'Tidak ada kegiatan yang cocok dengan filter.' : 'Belum ada kegiatan yang didokumentasikan. Tambahkan lewat panel admin.'}</p>`;
    return;
  }

  // Kelompokkan: minggu -> tanggal -> kegiatan
  const weeks = new Map();
  for (const e of list) {
    const w = mingguKe(CONFIG, e.tanggal);
    if (!weeks.has(w)) weeks.set(w, new Map());
    const days = weeks.get(w);
    if (!days.has(e.tanggal)) days.set(e.tanggal, []);
    days.get(e.tanggal).push(e);
  }

  lbPhotos = [];
  let html = '';
  for (const [w, days] of weeks) {
    const { start, end } = rentangMinggu(CONFIG, w);
    const count = [...days.values()].reduce((n, d) => n + d.length, 0);
    html += `<section class="week">
      <header class="week-head">
        <h2>Minggu ke-${w}</h2>
        <span>${formatPendek(start)} – ${formatPendek(end)} ${end.getFullYear()} · ${count} kegiatan · ${days.size} hari</span>
      </header>`;
    for (const [tgl, items] of days) {
      html += `<article class="day">
        <header class="day-head">
          <h3>${formatTanggal(tgl)}</h3>
          <span class="day-badge">Hari ke-${hariKe(CONFIG, tgl)}</span>
        </header>
        <ol class="entries">${items.map(renderEntry).join('')}</ol>
      </article>`;
    }
    html += '</section>';
  }
  $('timeline').innerHTML = html;
}

function renderEntry(e) {
  const sesi = e.sesi || sesiDariJam(e.jam);
  const photos = (e.foto || []).map(src => {
    const i = lbPhotos.push({ src, cap: `${e.judul} · ${formatTanggal(e.tanggal)}${e.jam ? ' · ' + e.jam : ''}` }) - 1;
    return `<button class="photo" data-lb="${i}" type="button"><img src="${esc(src)}" alt="${esc(e.judul)}" loading="lazy"></button>`;
  }).join('');
  return `<li class="entry">
    <div class="entry-time">
      <span class="time">${esc(e.jam || '')}</span>
      <span class="sesi sesi-${sesi.toLowerCase()}">${sesi}</span>
    </div>
    <div class="entry-body">
      <h4>${esc(e.judul)}</h4>
      ${e.lokasi ? `<p class="lokasi">📍 ${esc(e.lokasi)}</p>` : ''}
      ${e.keterangan ? `<p class="ket">${esc(e.keterangan)}</p>` : ''}
      ${photos ? `<div class="photos">${photos}</div>` : ''}
    </div>
  </li>`;
}

// Lightbox
function openLb(i) {
  lbIndex = (i + lbPhotos.length) % lbPhotos.length;
  const p = lbPhotos[lbIndex];
  $('lbImg').src = p.src;
  $('lbCap').textContent = `${p.cap}  (${lbIndex + 1}/${lbPhotos.length})`;
  $('lightbox').hidden = false;
}
function closeLb() { $('lightbox').hidden = true; $('lbImg').src = ''; }

document.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-lb]');
  if (btn) openLb(Number(btn.dataset.lb));
});
$('lbClose').onclick = closeLb;
$('lbPrev').onclick = () => openLb(lbIndex - 1);
$('lbNext').onclick = () => openLb(lbIndex + 1);
$('lightbox').addEventListener('click', ev => { if (ev.target.id === 'lightbox') closeLb(); });
document.addEventListener('keydown', ev => {
  if ($('lightbox').hidden) return;
  if (ev.key === 'Escape') closeLb();
  if (ev.key === 'ArrowLeft') openLb(lbIndex - 1);
  if (ev.key === 'ArrowRight') openLb(lbIndex + 1);
});

init();
