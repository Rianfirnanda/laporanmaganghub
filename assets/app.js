// Halaman publik: dokumentasi kegiatan per hari, galeri foto, dan rekap mingguan.

const $ = id => document.getElementById(id);
const VIEWS = ['harian', 'galeri', 'rekap'];
let CONFIG = null;
let ENTRIES = [];
let HARIAN = {};
let RINGKASAN = null;  // data/ringkasan.json: ringkasan AI untuk dasbor   // data/harian.json: status kehadiran + laporan harian per tanggal
let view = 'harian';
let lbPhotos = [];
let lbIndex = 0;

async function init() {
  try {
    [CONFIG, ENTRIES, HARIAN, RINGKASAN] = await Promise.all([
      fetchJSON('data/config.json'),
      fetchJSON('data/kegiatan.json'),
      fetchJSON('data/harian.json').catch(() => ({})),
      fetchJSON('data/ringkasan.json').catch(() => null)
    ]);
  } catch (e) {
    $('view-harian').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  ENTRIES = (Array.isArray(ENTRIES) ? ENTRIES : []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.tanggal));
  if (!HARIAN || typeof HARIAN !== 'object' || Array.isArray(HARIAN)) HARIAN = {};
  for (const d of Object.keys(HARIAN)) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !HARIAN[d]) delete HARIAN[d];
  renderProfile();
  renderSidebar();
  renderBanner();
  renderFooter();
  fillWeekFilter();
  fillDateFilter();
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
  const ikon = safePath(CONFIG.ikonSitus);
  if (ikon) {
    $('favicon').href = ikon;
    document.querySelectorAll('.brand-mark').forEach(m => setBrandImage(m, ikon));
  }
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

// Ringkasan AI (dibuat di panel admin setiap kegiatan disimpan).
function renderBanner() {
  const r = RINGKASAN && typeof RINGKASAN === 'object' ? RINGKASAN : null;
  if (!r || !r.mingguIni) { $('aiCard').hidden = true; return; }
  $('aiTitle').textContent = r.minggu ? `Ringkasan AI · Minggu ke-${r.minggu}` : 'Ringkasan AI';
  $('aiUpdated').textContent = r.diperbarui ? `diperbarui ${formatTanggal(toDateStr(new Date(r.diperbarui)), false)}` : '';
  $('aiText').textContent = r.mingguIni;
  const hl = Array.isArray(r.sorotan) ? r.sorotan.filter(Boolean).slice(0, 4) : [];
  $('aiHighlights').innerHTML = hl.map(h => `<li>${esc(h)}</li>`).join('');
  $('aiHighlights').hidden = !hl.length;
  $('aiMore').textContent = r.keseluruhan || '';
  $('aiMoreWrap').hidden = !r.keseluruhan;
  $('aiCard').hidden = false;
}

function renderSidebar() {
  const logo = safePath(CONFIG.logoInstansi);
  if (logo) {
    const img = document.createElement('img');
    img.src = logo;
    img.alt = `Logo ${CONFIG.instansi}`;
    $('orgLogo').replaceChildren(img);
    $('orgLogo').classList.add('has-img');
  } else {
    $('orgLogo').textContent = inisialInstansi(CONFIG.instansi);
  }
  $('orgName').textContent = CONFIG.instansi || '';
  $('orgRole').textContent = CONFIG.posisi || '';
  $('orgProgram').textContent = CONFIG.program || '';
  $('orgProgram').hidden = !CONFIG.program;
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
  const sakit = Object.keys(HARIAN).filter(d => statusOf(d) === 'Sakit').length;
  const izin = Object.keys(HARIAN).filter(d => statusOf(d) === 'Izin').length;
  $('updated').textContent = (latest ? `Kegiatan terakhir: ${formatTanggal(latest)}` : 'Belum ada kegiatan.') +
    (sakit || izin ? ` · Sakit ${sakit} hari · Izin ${izin} hari` : '');
}

function inisialInstansi(nama) {
  const words = String(nama || '').split(/\s+/).filter(w => w && !/^(BPS|Badan|Pusat|Statistik|Kabupaten|Kab\.?|Kota|Provinsi|Dinas)$/i.test(w));
  return inisial(words.join(' ') || nama);
}

const DEFAULT_PORTOFOLIO = 'https://rianfirnanda.vercel.app';

function setBrandImage(el, src) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  el.replaceChildren(img);
  el.classList.add('has-img');
}

function renderFooter() {
  const f = CONFIG.footer || {};
  const periode = `${formatTanggal(CONFIG.tanggalMulai, false)} – ${formatTanggal(CONFIG.tanggalSelesai, false)}`;
  const porto = safeUrl(CONFIG.portofolio ?? DEFAULT_PORTOFOLIO);
  let html = `<div class="footer-col footer-about">
    <a class="brand brand-light" href="./"><span class="brand-mark">${icon('file')}</span><span class="brand-text">Laporan<b>magang</b></span></a>
    <p>${esc(CONFIG.nama)}<br>${esc(CONFIG.posisi)} · ${esc(CONFIG.instansi)}<br>${periode}</p>
    ${porto ? `<a class="btn btn-sm footer-porto" href="${esc(porto)}" target="_blank" rel="noopener">${icon('user')} Lihat portofolio saya</a>` : ''}
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
  const ikon = safePath(CONFIG.ikonSitus);
  if (ikon) setBrandImage($('footerGrid').querySelector('.brand-mark'), ikon);
  $('portoLink').hidden = !porto;
  if (porto) {
    $('portoLink').href = porto;
    $('portoLink').textContent = `Dibuat oleh ${CONFIG.nama} · ${porto.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗`;
  }
  $('footerText').textContent = f.teks || `© ${new Date().getFullYear()} ${CONFIG.nama} · ${CONFIG.instansi}`;
  $('adminLink').hidden = !CONFIG.tampilkanLinkAdmin;
}

// ---------- Filter & tampilan ----------
function fillWeekFilter() {
  const weeks = [...new Set(allDates().map(d => mingguKe(CONFIG, d)))].sort((a, b) => b - a);
  $('filterMinggu').innerHTML = '<option value="">Semua minggu</option>' + weeks.map(w => {
    const { start, end } = rentangMinggu(CONFIG, w);
    return `<option value="${w}">Minggu ke-${w} (${formatPendek(start)} – ${formatPendek(end)})</option>`;
  }).join('');
  const params = new URLSearchParams(location.search);
  if (params.get('minggu')) $('filterMinggu').value = params.get('minggu');
}

// Pilihan tanggal hanya berisi hari yang punya kegiatan (dan ikut filter minggu).
// Dipakai sebagai pengganti input tanggal bawaan yang tampil kosong di HP.
function fillDateFilter() {
  const w = $('filterMinggu').value;
  const current = $('filterTanggal').value;
  const dates = allDates().filter(d => !w || mingguKe(CONFIG, d) === Number(w)).sort().reverse();
  $('filterTanggal').innerHTML = '<option value="">Semua tanggal</option>' + dates.map(d => {
    const dt = parseDate(d);
    return `<option value="${d}">${HARI[dt.getDay()]}, ${formatPendek(dt)}</option>`;
  }).join('');
  $('filterTanggal').value = dates.includes(current) ? current : '';
}

function bindUI() {
  $('filterMinggu').addEventListener('input', () => { fillDateFilter(); render(); });
  ['filterTanggal', 'filterCari'].forEach(id => $(id).addEventListener('input', render));
  $('btnReset').addEventListener('click', () => {
    $('filterMinggu').value = '';
    fillDateFilter();
    $('filterTanggal').value = '';
    $('filterCari').value = '';
    render();
  });
  document.addEventListener('click', ev => {
    const v = ev.target.closest('[data-view]');
    if (v) { ev.preventDefault(); setView(v.dataset.view); closeMenu(); }
    const wk = ev.target.closest('[data-week]');
    if (wk) {
      $('filterMinggu').value = wk.dataset.week;
      fillDateFilter();
      $('filterTanggal').value = '';
      setView('harian');
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


function statusOf(date) {
  const st = HARIAN[date] && HARIAN[date].status;
  return ['Sakit', 'Izin'].includes(st) ? st : 'Hadir';
}

function hasReport(date) {
  const r = HARIAN[date];
  return Boolean(r && (r.ringkasan || r.pembelajaran || r.kendala));
}

// Tanggal tidak hadir (Sakit/Izin) yang lolos filter; muncul walau tanpa kegiatan.
function absentDates() {
  const w = $('filterMinggu').value;
  const t = $('filterTanggal').value;
  if ($('filterCari').value.trim()) return [];
  return Object.keys(HARIAN).filter(d => statusOf(d) !== 'Hadir' &&
    (!w || mingguKe(CONFIG, d) === Number(w)) && (!t || d === t));
}

function allDates() {
  return [...new Set([...ENTRIES.map(e => e.tanggal), ...Object.keys(HARIAN).filter(d => statusOf(d) !== 'Hadir')])];
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

  const week = $('filterMinggu').value;
  document.querySelectorAll('[data-laporan]').forEach(a => {
    a.href = `laporan.html?mode=${a.dataset.laporan}${week ? `&minggu=${week}` : ''}`;
  });

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

function groupByWeek(list, extraDates = []) {
  const byDate = new Map();
  for (const d of extraDates) byDate.set(d, []);
  for (const e of list) {
    if (!byDate.has(e.tanggal)) byDate.set(e.tanggal, []);
    byDate.get(e.tanggal).push(e);
  }
  const weeks = new Map();
  for (const d of [...byDate.keys()].sort().reverse()) {
    const w = mingguKe(CONFIG, d);
    if (!weeks.has(w)) weeks.set(w, new Map());
    weeks.get(w).set(d, byDate.get(d));
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
  const absent = absentDates();
  if (!list.length && !absent.length) { $('view-harian').innerHTML = noMatch(); return; }
  let html = '';
  for (const [w, days] of groupByWeek(list, absent)) {
    html += `<div class="week-label"><span>Minggu ke-${w}</span><small>${weekLabel(w)}</small></div>`;
    for (const [tgl, items] of days) {
      html += `<article class="card day">
        <header class="card-header day-head">
          <span class="head-icon">${icon('calendar')}</span>
          <div class="head-text">
            <h3>${formatTanggal(tgl)}</h3>
            <span>Hari ke-${hariKe(CONFIG, tgl)} · Minggu ke-${w}</span>
          </div>
          <div class="day-actions">
            ${statusOf(tgl) !== 'Hadir' ? `<span class="pill pill-${statusOf(tgl).toLowerCase()}">${statusOf(tgl)}</span>`
              : `<span class="pill pill-green">${items.length} kegiatan</span>`}
            ${hasReport(tgl) ? `<button class="btn btn-light btn-sm" type="button" data-report="${tgl}">${icon('file')} Laporan harian</button>` : ''}
          </div>
        </header>
        ${items.length ? `<ol class="steps">${items.map(renderStep).join('')}</ol>`
          : `<p class="absent">Tidak masuk (${statusOf(tgl).toLowerCase()})${HARIAN[tgl].keterangan ? `: ${esc(HARIAN[tgl].keterangan)}` : ''}.</p>`}
      </article>`;
    }
  }
  $('view-harian').innerHTML = html;
}

function renderStep(e) {
  const sesi = ['Pagi', 'Siang', 'Sore'].includes(e.sesi) ? e.sesi : sesiDariJam(e.jam);
  // Ringkas: maksimal 3 foto tampil, sisanya jadi "+n" (semua tetap bisa dibuka di lightbox).
  const all = (e.foto || []).map(safePath).filter(Boolean);
  const idx = all.map(src => addPhoto(src, e));
  const photos = all.slice(0, 3).map((src, i) =>
    `<button class="photo" data-lb="${idx[i]}" type="button"><img src="${esc(src)}" alt="${esc(e.judul)}" loading="lazy">${i === 2 && all.length > 3 ? `<span class="photo-more">+${all.length - 3}</span>` : ''}</button>`).join('');
  return `<li class="step">
    <span class="step-dot">${icon('check')}</span>
    <div class="step-body">
      <div class="step-meta">
        <span class="time">${esc(e.jam || '')}</span>
        <span class="sesi sesi-${sesi.toLowerCase()}">${sesi}</span>
        ${e.lokasi ? `<span class="lokasi">${icon('pin')}${esc(e.lokasi)}</span>` : ''}
      </div>
      <h4>${esc(e.judul)}</h4>
      ${e.keterangan ? `<p class="ket" title="Ketuk untuk membaca selengkapnya">${esc(e.keterangan)}</p>` : ''}
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
  const absent = absentDates();
  if (!list.length && !absent.length) { $('view-rekap').innerHTML = noMatch(); return; }
  let html = '';
  for (const [w, days] of groupByWeek(list, absent)) {
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
          <span>${statusOf(tgl) !== 'Hadir' ? `<span class="pill pill-${statusOf(tgl).toLowerCase()}">${statusOf(tgl)}</span> ` : ''}${items.map(e => esc(e.judul)).join(' · ')}</span>
        </li>`).join('')}</ul>
        <div class="actions">
          <button class="btn btn-primary btn-sm" type="button" data-week="${w}">${icon('eye')} Lihat detail</button>
          <a class="btn btn-outline btn-sm" href="laporan.html?minggu=${w}&amp;mode=dokumen">${icon('file')} Laporan mingguan</a>
          <a class="btn btn-outline btn-sm" href="laporan.html?minggu=${w}&amp;mode=slide">${icon('image')} Slide mingguan</a>
        </div>
      </div>
    </article>`;
  }
  $('view-rekap').innerHTML = html;
}

document.addEventListener('click', ev => {
  const k = ev.target.closest('.ket');
  if (k) k.classList.toggle('open');
});

// ---------- Laporan harian (modal) ----------
function openReport(date) {
  const r = HARIAN[date] || {};
  const parts = [['Ringkasan kegiatan', r.ringkasan], ['Pembelajaran yang didapat', r.pembelajaran], ['Kendala yang dihadapi', r.kendala]];
  $('reportTitle').textContent = `Laporan harian · ${formatTanggal(date)}`;
  $('reportSub').textContent = `Status: ${statusOf(date)}${r.keterangan ? ` (${r.keterangan})` : ''}`;
  $('reportBody').innerHTML = parts.map(([title, text], i) => `<section>
    <div class="report-head"><h4>${title}</h4><button class="btn btn-link btn-sm" type="button" data-copy-report="${i}">Salin</button></div>
    <p id="reportPart${i}">${esc(text || '-')}</p>
  </section>`).join('');
  $('reportModal').hidden = false;
}
function closeReport() { $('reportModal').hidden = true; }

document.addEventListener('click', async ev => {
  const open = ev.target.closest('[data-report]');
  if (open) return openReport(open.dataset.report);
  const copy = ev.target.closest('[data-copy-report]');
  if (copy) {
    try {
      await navigator.clipboard.writeText($(`reportPart${copy.dataset.copyReport}`).textContent);
      copy.textContent = 'Tersalin ✓';
      setTimeout(() => { copy.textContent = 'Salin'; }, 1500);
    } catch { /* clipboard tidak tersedia */ }
  }
  if (ev.target.id === 'reportModal' || ev.target.closest('#reportClose')) closeReport();
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('reportModal').hidden) closeReport(); });

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
