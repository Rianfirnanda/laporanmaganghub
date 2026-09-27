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
  aturHariLibur(CONFIG.hariLibur);
  aturZona(CONFIG.zonaWaktu);
  renderCopyNote();
  renderProfile();
  renderSidebar();
  renderKpis();
  renderBanner();
  renderFooter();
  startFooterClock();
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
  $('instansi').textContent = [CONFIG.divisi, CONFIG.instansi].filter(Boolean).join(' · ');

  // Progres program sama dengan dasbor MagangHub (hari kalender), ditambah
  // hitungan hari kerja (Senin–Jumat) yang dipakai untuk rekap dan laporan.
  const today = wibParts(new Date()).tanggal;
  const total = daysBetween(CONFIG.tanggalMulai, CONFIG.tanggalSelesai) + 1;
  const now = Math.min(Math.max(daysBetween(CONFIG.tanggalMulai, today) + 1, 0), total);
  const totalKerja = totalHariKerja(CONFIG);
  const nowKerja = Math.min(Math.max(hariKe(CONFIG, today), 0), totalKerja);
  const pct = Math.round((now / total) * 100);
  const circ = 2 * Math.PI * 27;
  $('ringFg').style.strokeDasharray = circ;
  $('ringFg').style.strokeDashoffset = circ * (1 - pct / 100);
  $('ringText').textContent = `${pct}%`;
  $('progressLabel').textContent = now > 0 ? `Hari ke-${now} dari ${total}` : 'Belum dimulai';
  $('progressSub').textContent = now >= total
    ? 'Program magang selesai'
    : now > 0 ? `Sisa ${total - now} hari · Minggu ke-${mingguKe(CONFIG, today)}` : `Mulai ${formatTanggal(CONFIG.tanggalMulai, false)}`;
  $('progressWork').textContent = now > 0
    ? `Hari kerja ke-${nowKerja} dari ${totalKerja} · sisa ${totalKerja - nowKerja} hari kerja`
    : `${totalKerja} hari kerja (Senin–Jumat)`;
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
  $('orgRole').textContent = [CONFIG.posisi, CONFIG.divisi].filter(Boolean).join(' · ');
  $('orgProgram').textContent = CONFIG.program || '';
  $('orgProgram').hidden = !CONFIG.program;
  const m = CONFIG.mentor || {};
  $('mentorBox').hidden = !m.nama;
  $('mentorLogo').textContent = inisial(m.nama);
  $('mentorName').textContent = m.nama || '';
  $('mentorRole').textContent = m.jabatan || '';
  const total = totalHariKerja(CONFIG);
  $('periode').innerHTML = [
    ['Mulai', formatTanggal(CONFIG.tanggalMulai, false)],
    ['Selesai', formatTanggal(CONFIG.tanggalSelesai, false)],
    ['Durasi', `${daysBetween(CONFIG.tanggalMulai, CONFIG.tanggalSelesai) + 1} hari · ${total} hari kerja`],
    ['Jumlah minggu', `${mingguKe(CONFIG, CONFIG.tanggalSelesai)} minggu`],
    ['Hari kerja', HARI_LIBUR.size ? 'Senin – Jumat, di luar libur nasional' : 'Senin – Jumat']
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

  const today = wibParts(new Date()).tanggal;
  const next = [...HARI_LIBUR].filter(([d]) => d >= today && !isAkhirPekan(d) && d <= CONFIG.tanggalSelesai).sort(([a], [b]) => a.localeCompare(b))[0];
  $('nextLibur').hidden = !next;
  if (next) $('nextLibur').textContent = `Libur berikutnya: ${formatTanggal(next[0])} · ${next[1].nama}`;
  const latest = ENTRIES.reduce((m, e) => (`${e.tanggal} ${e.jam || ''}` > m ? `${e.tanggal} ${e.jam || ''}` : m), '');
  const stamp = ENTRIES.map(e => e.dicatat).filter(Boolean).sort().pop();
  $('updated').textContent = stamp ? `Terakhir diperbarui ${formatWaktuWib(new Date(stamp))}`
    : latest ? `Kegiatan terakhir: ${formatTanggal(latest.slice(0, 10))}` : 'Belum ada kegiatan.';
}

// Hari kerja (Senin–Jumat) sejak mulai magang sampai hari ini.
function hariKerja(until) {
  return hitungHariKerja(CONFIG.tanggalMulai, until < CONFIG.tanggalSelesai ? until : CONFIG.tanggalSelesai);
}

// Kegiatan yang dihitung: hanya pada hari kerja (Senin–Jumat).
function dihitung(list) {
  return list.filter(e => isHariKerja(e.tanggal));
}

function renderKpis() {
  const today = wibParts(new Date()).tanggal;
  const KERJA = dihitung(ENTRIES);
  const hariIni = KERJA.filter(e => e.tanggal === today).length;
  const hari = new Set(KERJA.map(e => e.tanggal)).size;
  const foto = KERJA.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
  const sync = KERJA.reduce((n, e) => n + (e.foto || []).filter(safePath).filter(f => inDrive(e, f)).length, 0);
  const kerja = hariKerja(today);
  const libur = Object.keys(HARIAN).filter(isHariKerja);
  const sakit = libur.filter(d => statusOf(d) === 'Sakit').length;
  const izin = libur.filter(d => statusOf(d) === 'Izin').length;
  const hadir = new Set(KERJA.map(e => e.tanggal).filter(d => statusOf(d) === 'Hadir')).size;
  const pct = kerja ? Math.min(100, Math.round(hari / kerja * 100)) : 0;
  const kpi = (ic, value, label, sub, cls = '') => `<div class="kpi ${cls}">
    <span class="kpi-icon">${icon(ic)}</span>
    <div><strong>${value}</strong><span class="kpi-label">${label}</span><small>${sub}</small></div>
  </div>`;
  $('kpis').innerHTML = [
    kpi('grid', KERJA.length, 'Kegiatan', !isHariKerja(today) ? `${esc(labelBukanHariKerja(today))} · tidak dihitung` : hariIni ? `<b class="ok">+${hariIni} hari ini</b>` : 'Hari ini belum ada'),
    kpi('calendar', hari, 'Hari terdokumentasi', kerja
      ? `${Math.min(hari, kerja)} dari ${kerja} hari kerja terisi (${pct}%)${hari >= kerja ? ' · lengkap' : ''}`
      : 'Belum dimulai'),
    kpi('image', foto, 'Foto dokumentasi', foto ? `${sync === foto ? 'Semua' : `${sync} dari ${foto}`} di Google Drive` : 'Belum ada foto'),
    kpi('badge', hadir, 'Hari hadir', sakit || izin ? `Sakit ${sakit} · Izin ${izin}` : 'Tanpa sakit/izin')
  ].join('');
}

function inisialInstansi(nama) {
  const words = String(nama || '').split(/\s+/).filter(w => w && !/^(BPS|Badan|Pusat|Statistik|Kabupaten|Kab\.?|Kota|Provinsi|Dinas)$/i.test(w));
  return inisial(words.join(' ') || nama);
}

// Situs hasil "Use this template"/fork masih berisi data pemilik lama sampai
// pemilik baru menekan "Mulai baru" di panel admin. Beri tahu pengunjung.
function renderCopyNote() {
  const host = location.hostname.toLowerCase();
  const pemilik = String(CONFIG.repo || '').split('/')[0].toLowerCase();
  const salinan = host.endsWith('.github.io') && pemilik && host.split('.')[0] !== pemilik;
  $('copyNote').hidden = !salinan;
}

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
  const porto = safeUrl(CONFIG.portofolio || '');
  let html = `<div class="footer-col footer-about">
    <a class="brand" href="./"><span class="brand-mark">${icon('file')}</span><span class="brand-text">Laporan<b>magang</b></span></a>
    <p class="footer-lead">Dokumentasi kegiatan harian <b>${esc(CONFIG.nama)}</b>${CONFIG.posisi ? `, ${esc(CONFIG.posisi)}` : ''}${CONFIG.divisi ? ` (${esc(CONFIG.divisi)})` : ''}${CONFIG.instansi ? ` di ${esc(CONFIG.instansi)}` : ''}.</p>
    <p class="footer-period">${icon('calendar')} ${periode}</p>
    ${porto ? `<a class="btn btn-sm footer-porto" href="${esc(porto)}" target="_blank" rel="noopener">${icon('user')} Portofolio saya</a>` : ''}
  </div>
  <div class="footer-col">
    <h4>Jelajahi</h4>
    <ul>
      <li><a href="#harian" data-view="harian">${icon('grid')} Kegiatan harian</a></li>
      <li><a href="#galeri" data-view="galeri">${icon('image')} Galeri foto</a></li>
      <li><a href="#rekap" data-view="rekap">${icon('history')} Rekap mingguan</a></li>
      <li><a href="laporan.html?mode=dokumen" data-laporan="dokumen">${icon('file')} Laporan mingguan (A4)</a></li>
      <li><a href="laporan.html?mode=slide" data-laporan="slide">${icon('printer')} Slide mingguan</a></li>
    </ul>
  </div>`;
  html += (f.bagian || []).filter(b => b.judul || b.isi).map(b => `<div class="footer-col">
    ${b.judul ? `<h4>${esc(b.judul)}</h4>` : ''}
    ${b.isi ? `<p>${esc(b.isi)}</p>` : ''}
  </div>`).join('');
  const links = (f.tautan || []).map(l => ({ label: l.label, url: safeUrl(l.url) })).filter(l => l.url);
  if (links.length) {
    html += `<div class="footer-col"><h4>${esc(f.judulTautan || 'Tautan')}</h4><ul>${links.map(l =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon('link')} ${esc(l.label || l.url)}</a></li>`).join('')}</ul></div>`;
  }
  $('footerGrid').innerHTML = html;
  const ikon = safePath(CONFIG.ikonSitus);
  if (ikon) setBrandImage($('footerGrid').querySelector('.brand-mark'), ikon);
  // Baris kredit: diatur di panel (Profil → Footer). Konfigurasi lama tanpa
  // "kredit" tetap memakai tautan portofolio seperti sebelumnya.
  const k = f.kredit && typeof f.kredit === 'object' ? f.kredit : {};
  const kUrl = safeUrl(k.url !== undefined ? k.url : porto);
  const kTeks = String(k.teks || `Dibuat oleh ${CONFIG.nama}`);
  const kTampil = k.tampil !== undefined ? k.tampil !== false : Boolean(kUrl);
  const credit = $('portoLink');
  credit.hidden = !kTampil;
  if (kTampil) {
    const host = kUrl.replace(/^(https?:\/\/|mailto:|tel:)/i, '').replace(/\/$/, '');
    credit.textContent = kUrl ? `${kTeks} · ${host} ↗` : kTeks;
    if (kUrl) credit.href = kUrl; else credit.removeAttribute('href');
  }
  $('footerText').textContent = f.teks || [`© ${new Date().getFullYear()} ${CONFIG.nama}`, CONFIG.instansi].filter(Boolean).join(' · ');
  $('adminLink').hidden = !CONFIG.tampilkanLinkAdmin;
}

// Jam server di footer, berdetak setiap detik.
function startFooterClock() {
  const tick = () => {
    $('footerTime').textContent = formatWaktuWib(serverNow(), false);
    $('footerDate').textContent = formatTanggal(wibParts().tanggal);
    $('footerSrc').textContent = serverSynced ? 'waktu server' : 'jam perangkat';
  };
  tick();
  setInterval(tick, 1000);
  syncServerTime().then(tick);
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
  $('filterTanggal').addEventListener('input', render);
  let cariTimer = 0;
  $('filterCari').addEventListener('input', () => { clearTimeout(cariTimer); cariTimer = setTimeout(render, 180); });
  $('filterCari').addEventListener('keydown', ev => { if (ev.key === 'Escape') { $('filterCari').value = ''; render(); } });
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
  const active = Boolean(week || $('filterTanggal').value || $('filterCari').value.trim());
  $('btnReset').hidden = !active;
  const nFoto = list.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
  $('resultInfo').textContent = active
    ? `${list.length} dari ${ENTRIES.length} kegiatan · ${nFoto} foto`
    : `${dihitung(ENTRIES).length} kegiatan · ${new Set(dihitung(ENTRIES).map(e => e.tanggal)).size} hari kerja · ${nFoto} foto`;
  const wk = Number(week) || (allDates().length ? mingguKe(CONFIG, allDates().sort().pop()) : 0);
  $('reportNote').textContent = wk
    ? `Minggu ke-${wk} (${weekLabel(wk)}). Pilih minggu lain lewat filter.`
    : 'Unduh laporan resmi (A4) atau slide presentasi mingguan.';
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

// Thumbnail 480 px (bila ada) untuk tampilan kecil; lightbox tetap memakai foto penuh.
function thumbOf(e, src) {
  return safePath(e.fotoKecil && typeof e.fotoKecil === 'object' ? e.fotoKecil[src] : '') || src;
}

function inDrive(e, src) {
  return Boolean(e.fotoDrive && typeof e.fotoDrive === 'object' && e.fotoDrive[src]);
}

// Penanda kecil di pojok foto: tersimpan juga di Google Drive atau belum.
function driveChip(e, src) {
  const ok = inDrive(e, src);
  return `<span class="drive-chip ${ok ? 'ok' : 'no'}" title="${ok ? 'Tersinkron ke Google Drive' : 'Belum tersinkron ke Google Drive'}">${icon(ok ? 'cloudCheck' : 'cloudOff')}<span class="sr-only">${ok ? 'Tersinkron ke Google Drive' : 'Belum di Google Drive'}</span></span>`;
}

function addPhoto(src, e) {
  const drive = inDrive(e, src) ? ' · ✓ tersinkron ke Google Drive' : ' · belum tersinkron ke Google Drive';
  return lbPhotos.push({ src, cap: `${e.judul} · ${formatTanggal(e.tanggal)}${e.jam ? ' · ' + e.jam : ''}${drive}` }) - 1;
}

// ---------- Kegiatan harian ----------
function renderHarian(list) {
  const absent = absentDates();
  if (!list.length && !absent.length) { $('view-harian').innerHTML = noMatch(); return; }
  let html = '';
  for (const [w, days] of groupByWeek(list, absent)) {
    const nWeek = [...days].filter(([d]) => isHariKerja(d)).reduce((n, [, x]) => n + x.length, 0);
    html += `<div class="week-label"><span>Minggu ke-${w}</span><small>${weekLabel(w)} · ${nWeek} kegiatan</small></div>`;
    for (const [tgl, items] of days) {
      const nFoto = items.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
      html += `<article class="card day">
        <header class="card-header day-head">
          <span class="head-icon">${icon('calendar')}</span>
          <div class="head-text">
            <h3>${formatTanggal(tgl)}</h3>
            <span>${isHariKerja(tgl) ? `Hari kerja ke-${hariKe(CONFIG, tgl)}` : `${esc(labelBukanHariKerja(tgl))} · tidak dihitung`}${items.length ? ` · ${items.length} kegiatan · ${nFoto} foto` : ''}</span>
          </div>
          <div class="day-actions">
            ${statusOf(tgl) !== 'Hadir' ? `<span class="pill pill-${statusOf(tgl).toLowerCase()}">${statusOf(tgl)}</span>`
              : `<span class="pill pill-green">${icon('check')} Hadir</span>`}
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
    `<button class="photo" data-lb="${idx[i]}" type="button"><img src="${esc(thumbOf(e, src))}" alt="${esc(e.judul)}" loading="lazy" decoding="async">${i === 2 && all.length > 3 ? `<span class="photo-more">+${all.length - 3}</span>` : driveChip(e, src)}</button>`).join('');
  return `<li class="step">
    <span class="step-dot">${icon('check')}</span>
    <div class="step-body">
      <div class="step-meta">
        <span class="time">${esc(e.jam || '')}</span>
        <span class="sesi sesi-${sesi.toLowerCase()}">${sesi}</span>
        ${lokasiHtml(e)}
      </div>
      <h4>${esc(e.judul)}</h4>
      ${e.keterangan ? `<p class="ket" title="Ketuk untuk membaca selengkapnya">${esc(e.keterangan)}</p>` : ''}
      ${photos ? `<div class="photos">${photos}</div>` : ''}
      ${metaHtml(e, all)}
    </div>
  </li>`;
}

function lokasiHtml(e) {
  const k = e.koordinat;
  const ok = k && Number.isFinite(k.lat) && Number.isFinite(k.lng) && Math.abs(k.lat) <= 90 && Math.abs(k.lng) <= 180;
  const text = esc(e.lokasi || (ok ? `${k.lat.toFixed(5)}, ${k.lng.toFixed(5)}` : ''));
  if (!text) return '';
  return ok
    ? `<a class="lokasi" href="https://www.google.com/maps?q=${k.lat},${k.lng}" target="_blank" rel="noopener noreferrer" title="Buka titik GPS di Google Maps">${icon('pin')}${text}</a>`
    : `<span class="lokasi">${icon('pin')}${text}</span>`;
}

// Baris keterangan: waktu pencatatan dari server dan status Google Drive foto.
function metaHtml(e, photos) {
  const parts = [];
  const t = e.dicatat && new Date(e.dicatat);
  if (t && !Number.isNaN(t.getTime())) {
    const w = wibParts(t);
    const hari = w.tanggal === e.tanggal ? '' : `${formatTanggal(w.tanggal, false)}, `;
    parts.push(`<span title="Waktu diambil dari server, bukan dari jam HP">${icon('clock')} Dicatat ${hari}${w.jam.replace(':', '.')}.${w.detik} ${ZONA_LABEL} · waktu server${e.koordinat ? ' · lokasi GPS' : ''}</span>`);
  }
  if (photos.length) {
    const n = photos.filter(src => inDrive(e, src)).length;
    const cls = n === photos.length ? 'ok' : n ? 'part' : 'no';
    const text = n === photos.length ? `${n === 1 ? 'Foto' : `${n} foto`} tersinkron ke Google Drive`
      : n ? `${n} dari ${photos.length} foto tersinkron ke Google Drive` : 'Foto belum tersinkron ke Google Drive';
    parts.push(`<span class="drive-status ${cls}">${icon(n ? 'cloudCheck' : 'cloudOff')} ${text}</span>`);
  }
  return parts.length ? `<p class="dicatat">${parts.join('')}</p>` : '';
}

// ---------- Galeri ----------
function renderGaleri(list) {
  const items = [];
  for (const e of list) {
    for (const src of (e.foto || []).map(safePath).filter(Boolean)) {
      items.push(`<button class="gallery-item" data-lb="${addPhoto(src, e)}" type="button">
        <img src="${esc(thumbOf(e, src))}" alt="${esc(e.judul)}" loading="lazy" decoding="async">${driveChip(e, src)}
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
    // Hanya Senin–Jumat yang dihitung; kegiatan akhir pekan tetap tercantum.
    const kerjaDays = [...days].filter(([d]) => isHariKerja(d));
    const all = kerjaDays.map(([, x]) => x).flat();
    const foto = all.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
    const { start, end } = rentangMinggu(CONFIG, w);
    const jatah = hitungHariKerja(toDateStr(start), toDateStr(end));
    html += `<article class="card week-card">
      <header class="card-header">
        <span class="head-icon">${icon('history')}</span>
        <div class="head-text"><h3>Minggu ke-${w}</h3><span>${weekLabel(w)}</span></div>
      </header>
      <div class="card-body">
        <div class="pills">
          <span class="pill">${kerjaDays.length} dari ${jatah} hari kerja</span>
          <span class="pill">${all.length} kegiatan</span>
          <span class="pill">${foto} foto</span>
        </div>
        <ul class="recap-list">${[...days].map(([tgl, items]) => `<li>
          <strong>${esc(formatTanggal(tgl))}</strong>
          <span>${!isHariKerja(tgl) ? `<span class="pill">${esc(labelBukanHariKerja(tgl))} · tidak dihitung</span> ` : ''}${statusOf(tgl) !== 'Hadir' ? `<span class="pill pill-${statusOf(tgl).toLowerCase()}">${statusOf(tgl)}</span> ` : ''}${items.map(e => esc(e.judul)).join(' · ')}</span>
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
  const parts = [['Uraian Aktivitas', r.ringkasan], ['Pembelajaran yang Diperoleh', r.pembelajaran], ['Kendala yang Dialami', r.kendala]];
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
