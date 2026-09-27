// Halaman publik: dokumentasi kegiatan per hari, galeri foto, dan rekap mingguan.

const $ = id => document.getElementById(id);
const VIEWS = ['harian', 'galeri', 'rekap'];
let CONFIG = null;
let ENTRIES = [];
let view = 'harian';
let lbPhotos = [];
let lbIndex = 0;

async function init() {
  try {
    [CONFIG, ENTRIES] = await Promise.all([
      fetchJSON('data/config.json'),
      fetchJSON('data/kegiatan.json')
    ]);
  } catch (e) {
    $('view-harian').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  ENTRIES = (Array.isArray(ENTRIES) ? ENTRIES : []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.tanggal));
  renderProfile();
  renderSidebar();
  renderBanner();
  renderFooter();
  fillWeekFilter();
  bindUI();
  setView(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'harian', false);
}

// ---------- Profil & hero ----------
function avatarNode(cfg, className = '') {
  const foto = safePath(cfg.fotoProfil);
  if (foto) {
    const img = document.createElement('img');
    img.src = foto;
    img.alt = `Foto ${cfg.nama}`;
    return img;
  }
  const span = document.createElement('span');
  span.className = className;
  span.textContent = inisial(cfg.nama);
  return span;
}

function renderProfile() {
  applyTheme(CONFIG.warnaTema);
  document.title = CONFIG.judulSitus || `Laporan Magang · ${CONFIG.nama}`;
  $('avatar').replaceChildren(avatarNode(CONFIG));
  $('navAvatar').replaceChildren(avatarNode(CONFIG));
  $('nama').textContent = CONFIG.nama;
  $('posisi').textContent = CONFIG.posisi || '';
  $('posisi').hidden = !CONFIG.posisi;
  $('instansi').textContent = CONFIG.instansi || '';

  const total = daysBetween(CONFIG.tanggalMulai, CONFIG.tanggalSelesai) + 1;
  const now = Math.min(Math.max(hariKe(CONFIG, todayStr()), 0), total);
  const pct = Math.round((now / total) * 100);
  const circ = 2 * Math.PI * 27;
  $('ringFg').style.strokeDasharray = circ;
  $('ringFg').style.strokeDashoffset = circ * (1 - pct / 100);
  $('ringText').textContent = `${pct}%`;
  $('progressLabel').textContent = now > 0 ? `Hari ke-${now} dari ${total}` : 'Belum dimulai';
  $('progressSub').textContent = now >= total
    ? 'Program magang selesai'
    : now > 0 ? `Sisa ${total - now} hari · Minggu ke-${mingguKe(CONFIG, todayStr())}` : `Mulai ${formatTanggal(CONFIG.tanggalMulai, false)}`;
  $('progress').hidden = false;
}

function renderBanner() {
  const today = todayStr();
  const w = mingguKe(CONFIG, today);
  const latest = ENTRIES.reduce((m, e) => (e.tanggal > m ? e.tanggal : m), '');
  let title;
  if (today < CONFIG.tanggalMulai) title = `Magang dimulai ${formatTanggal(CONFIG.tanggalMulai, false)}.`;
  else if (today > CONFIG.tanggalSelesai) title = 'Program magang telah selesai. Terima kasih!';
  else {
    const n = ENTRIES.filter(e => mingguKe(CONFIG, e.tanggal) === w).length;
    title = `Minggu ke-${w} sedang berjalan · ${n} kegiatan tercatat minggu ini.`;
  }
  $('bannerTitle').textContent = title;
  $('bannerText').textContent = latest
    ? `Terakhir diperbarui ${formatTanggal(latest)}. ${CONFIG.program || ''}`
    : (CONFIG.program || 'Dokumentasi kegiatan harian selama program magang.');
}

function renderSidebar() {
  $('orgLogo').textContent = inisialInstansi(CONFIG.instansi);
  $('orgName').textContent = CONFIG.instansi || '';
  $('orgRole').textContent = CONFIG.posisi || '';
  const m = CONFIG.mentor || {};
  $('mentorBox').hidden = !m.nama;
  $('mentorLogo').textContent = inisial(m.nama);
  $('mentorName').textContent = m.nama || '';
  $('mentorRole').textContent = m.jabatan || '';
  const total = daysBetween(CONFIG.tanggalMulai, CONFIG.tanggalSelesai) + 1;
  $('periode').innerHTML = [
    ['Mulai', formatTanggal(CONFIG.tanggalMulai, false)],
    ['Selesai', formatTanggal(CONFIG.tanggalSelesai, false)],
    ['Durasi', `${total} hari · ${Math.ceil(total / 7)} minggu`]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

  const hari = new Set(ENTRIES.map(e => e.tanggal)).size;
  const foto = ENTRIES.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
  const minggu = new Set(ENTRIES.map(e => mingguKe(CONFIG, e.tanggal))).size;
  $('stats').innerHTML = [
    ['grid', ENTRIES.length, 'Kegiatan'],
    ['calendar', hari, 'Hari'],
    ['image', foto, 'Foto'],
    ['history', minggu, 'Minggu']
  ].map(([ic, v, l]) => `<div class="mini-stat">${icon(ic)}<strong>${v}</strong><span>${l}</span></div>`).join('');
  const latest = ENTRIES.reduce((m, e) => (e.tanggal > m ? e.tanggal : m), '');
  $('updated').textContent = latest ? `Kegiatan terakhir: ${formatTanggal(latest)}` : 'Belum ada kegiatan.';
}

function inisialInstansi(nama) {
  const words = String(nama || '').split(/\s+/).filter(w => w && !/^(BPS|Badan|Pusat|Statistik|Kabupaten|Kab\.?|Kota|Provinsi|Dinas)$/i.test(w));
  return inisial(words.join(' ') || nama);
}

function renderFooter() {
  const f = CONFIG.footer || {};
  const periode = `${formatTanggal(CONFIG.tanggalMulai, false)} – ${formatTanggal(CONFIG.tanggalSelesai, false)}`;
  let html = `<div class="footer-col footer-about">
    <a class="brand brand-light" href="./"><span class="brand-mark">${icon('file')}</span><span class="brand-text">Laporan<b>magang</b></span></a>
    <p>${esc(CONFIG.nama)}<br>${esc(CONFIG.posisi)} · ${esc(CONFIG.instansi)}<br>${periode}</p>
  </div>`;
  html += (f.bagian || []).filter(b => b.judul || b.isi).map(b => `<div class="footer-col">
    ${b.judul ? `<h4>${esc(b.judul)}</h4>` : ''}
    ${b.isi ? `<p>${esc(b.isi)}</p>` : ''}
  </div>`).join('');
  const links = (f.tautan || []).map(l => ({ label: l.label, url: safeUrl(l.url) })).filter(l => l.url);
  if (links.length) {
    html += `<div class="footer-col"><h4>${esc(f.judulTautan || 'Tautan')}</h4><ul>${links.map(l =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></li>`).join('')}</ul></div>`;
  }
  $('footerGrid').innerHTML = html;
  $('footerText').textContent = f.teks || `© ${new Date().getFullYear()} ${CONFIG.nama} · ${CONFIG.instansi}`;
  $('adminLink').hidden = !CONFIG.tampilkanLinkAdmin;
}

// ---------- Filter & tampilan ----------
function fillWeekFilter() {
  const weeks = [...new Set(ENTRIES.map(e => mingguKe(CONFIG, e.tanggal)))].sort((a, b) => b - a);
  $('filterMinggu').innerHTML = '<option value="">Semua minggu</option>' + weeks.map(w => {
    const { start, end } = rentangMinggu(CONFIG, w);
    return `<option value="${w}">Minggu ke-${w} (${formatPendek(start)} – ${formatPendek(end)})</option>`;
  }).join('');
  const params = new URLSearchParams(location.search);
  if (params.get('minggu')) $('filterMinggu').value = params.get('minggu');
}

function bindUI() {
  ['filterMinggu', 'filterTanggal', 'filterCari'].forEach(id => $(id).addEventListener('input', render));
  $('btnReset').addEventListener('click', () => {
    $('filterMinggu').value = '';
    $('filterTanggal').value = '';
    $('filterCari').value = '';
    render();
  });
  document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', printReport));
  document.addEventListener('click', ev => {
    const v = ev.target.closest('[data-view]');
    if (v) { ev.preventDefault(); setView(v.dataset.view); closeMenu(); }
    const wk = ev.target.closest('[data-week]');
    if (wk) {
      $('filterMinggu').value = wk.dataset.week;
      $('filterTanggal').value = '';
      if (wk.dataset.action === 'print') { setView('harian'); printReport(); } else setView('harian');
    }
    if (ev.target.closest('.nav-menu a[href="#tentang"]')) closeMenu();
  });
  $('navToggle').addEventListener('click', () => {
    const open = !document.body.classList.contains('menu-open');
    document.body.classList.toggle('menu-open', open);
    $('navToggle').setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (VIEWS.includes(h) && h !== view) setView(h, false);
  });
}

function closeMenu() {
  document.body.classList.remove('menu-open');
  $('navToggle').setAttribute('aria-expanded', 'false');
}

function setView(v, scroll = true) {
  view = v;
  document.querySelectorAll('.tabbar-item').forEach(t => {
    t.classList.toggle('active', t.dataset.view === v);
    t.setAttribute('aria-selected', String(t.dataset.view === v));
  });
  document.querySelectorAll('.nav-menu [data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  VIEWS.forEach(x => { $(`view-${x}`).hidden = x !== v; });
  render();
  if (scroll && window.scrollY > document.querySelector('.tabbar').offsetTop) {
    document.querySelector('.tabbar').scrollIntoView({ behavior: 'smooth' });
  }
}

function printReport() {
  closeMenu();
  if (view !== 'harian') setView('harian', false);
  setTimeout(() => window.print(), 50);
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
  const url = new URL(location.href);
  $('filterMinggu').value ? url.searchParams.set('minggu', $('filterMinggu').value) : url.searchParams.delete('minggu');
  url.hash = view === 'harian' ? '' : view;
  history.replaceState(null, '', url);

  const list = sortEntries(filtered());
  lbPhotos = [];
  if (view === 'harian') renderHarian(list);
  if (view === 'galeri') renderGaleri(list);
  if (view === 'rekap') renderRekap(list);
}

function emptyState(text) {
  return `<div class="card empty-card">${icon('file')}<p>${text}</p></div>`;
}

function noMatch() {
  return emptyState(ENTRIES.length ? 'Tidak ada kegiatan yang cocok dengan filter.' : 'Belum ada kegiatan yang didokumentasikan.');
}

function groupByWeek(list) {
  const weeks = new Map();
  for (const e of list) {
    const w = mingguKe(CONFIG, e.tanggal);
    if (!weeks.has(w)) weeks.set(w, new Map());
    const days = weeks.get(w);
    if (!days.has(e.tanggal)) days.set(e.tanggal, []);
    days.get(e.tanggal).push(e);
  }
  return weeks;
}

function weekLabel(w) {
  const { start, end } = rentangMinggu(CONFIG, w);
  return `${formatPendek(start)} – ${formatPendek(end)} ${end.getFullYear()}`;
}

function addPhoto(src, e) {
  return lbPhotos.push({ src, cap: `${e.judul} · ${formatTanggal(e.tanggal)}${e.jam ? ' · ' + e.jam : ''}` }) - 1;
}

// ---------- Kegiatan harian ----------
function renderHarian(list) {
  if (!list.length) { $('view-harian').innerHTML = noMatch(); return; }
  let html = '';
  for (const [w, days] of groupByWeek(list)) {
    html += `<div class="week-label"><span>Minggu ke-${w}</span><small>${weekLabel(w)}</small></div>`;
    for (const [tgl, items] of days) {
      html += `<article class="card day">
        <header class="card-header day-head">
          <span class="head-icon">${icon('calendar')}</span>
          <div class="head-text">
            <h3>${formatTanggal(tgl)}</h3>
            <span>Hari ke-${hariKe(CONFIG, tgl)} · Minggu ke-${w}</span>
          </div>
          <span class="pill pill-green">${items.length} kegiatan</span>
        </header>
        <ol class="steps">${items.map(renderStep).join('')}</ol>
      </article>`;
    }
  }
  $('view-harian').innerHTML = html;
}

function renderStep(e) {
  const sesi = ['Pagi', 'Siang', 'Sore'].includes(e.sesi) ? e.sesi : sesiDariJam(e.jam);
  const photos = (e.foto || []).map(safePath).filter(Boolean).map(src =>
    `<button class="photo" data-lb="${addPhoto(src, e)}" type="button"><img src="${esc(src)}" alt="${esc(e.judul)}" loading="lazy"></button>`).join('');
  return `<li class="step">
    <span class="step-dot">${icon('check')}</span>
    <div class="step-body">
      <div class="step-meta">
        <span class="time">${esc(e.jam || '')}</span>
        <span class="sesi sesi-${sesi.toLowerCase()}">${sesi}</span>
        ${e.lokasi ? `<span class="lokasi">${icon('pin')}${esc(e.lokasi)}</span>` : ''}
      </div>
      <h4>${esc(e.judul)}</h4>
      ${e.keterangan ? `<p class="ket">${esc(e.keterangan)}</p>` : ''}
      ${photos ? `<div class="photos">${photos}</div>` : ''}
    </div>
  </li>`;
}

// ---------- Galeri ----------
function renderGaleri(list) {
  const items = [];
  for (const e of list) {
    for (const src of (e.foto || []).map(safePath).filter(Boolean)) {
      items.push(`<button class="gallery-item" data-lb="${addPhoto(src, e)}" type="button">
        <img src="${esc(src)}" alt="${esc(e.judul)}" loading="lazy">
        <span class="gallery-cap"><small>${esc(formatTanggal(e.tanggal, false))}</small>${esc(e.judul)}</span>
      </button>`);
    }
  }
  $('view-galeri').innerHTML = items.length
    ? `<div class="card"><div class="card-header"><h3>Galeri Foto</h3><span class="pill">${items.length} foto</span></div><div class="card-body"><div class="gallery">${items.join('')}</div></div></div>`
    : (list.length ? emptyState('Belum ada foto pada kegiatan yang dipilih.') : noMatch());
}

// ---------- Rekap mingguan ----------
function renderRekap(list) {
  if (!list.length) { $('view-rekap').innerHTML = noMatch(); return; }
  let html = '';
  for (const [w, days] of groupByWeek(list)) {
    const all = [...days.values()].flat();
    const foto = all.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
    html += `<article class="card week-card">
      <header class="card-header">
        <span class="head-icon">${icon('history')}</span>
        <div class="head-text"><h3>Minggu ke-${w}</h3><span>${weekLabel(w)}</span></div>
      </header>
      <div class="card-body">
        <div class="pills">
          <span class="pill">${days.size} hari</span>
          <span class="pill">${all.length} kegiatan</span>
          <span class="pill">${foto} foto</span>
        </div>
        <ul class="recap-list">${[...days].map(([tgl, items]) => `<li>
          <strong>${esc(formatTanggal(tgl))}</strong>
          <span>${items.map(e => esc(e.judul)).join(' · ')}</span>
        </li>`).join('')}</ul>
        <div class="actions">
          <button class="btn btn-primary btn-sm" type="button" data-week="${w}">${icon('eye')} Lihat detail</button>
          <button class="btn btn-outline btn-sm" type="button" data-week="${w}" data-action="print">${icon('printer')} Cetak minggu ini</button>
        </div>
      </div>
    </article>`;
  }
  $('view-rekap').innerHTML = html;
}

// ---------- Lightbox ----------
function openLb(i) {
  lbIndex = (i + lbPhotos.length) % lbPhotos.length;
  const p = lbPhotos[lbIndex];
  $('lbImg').src = p.src;
  $('lbCap').textContent = `${p.cap}  (${lbIndex + 1}/${lbPhotos.length})`;
  $('lightbox').hidden = false;
}
function closeLb() { $('lightbox').hidden = true; $('lbImg').removeAttribute('src'); }

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
