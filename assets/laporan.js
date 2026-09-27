// Laporan mingguan siap cetak, dibuat otomatis dari data website:
// - mode "dokumen": laporan A4 (kop, identitas, ringkasan, rincian harian, tanda tangan)
// - mode "slide"  : presentasi 16:9 (judul, ringkasan, satu slide per hari, penutup)
// Keduanya dicetak lewat dialog cetak browser (bisa disimpan sebagai PDF).

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let MODE = params.get('mode') === 'slide' ? 'slide' : 'dokumen';
let CONFIG = {};
let ENTRIES = [];
let HARIAN = {};
let MINGGUAN = {};   // ringkasan AI per minggu (data/ringkasan.json)
let WEEK = 0;

async function init() {
  try {
    let ringkasan;
    [CONFIG, ENTRIES, HARIAN, ringkasan] = await Promise.all([
      fetchJSON('data/config.json'),
      fetchJSON('data/kegiatan.json'),
      fetchJSON('data/harian.json').catch(() => ({})),
      fetchJSON('data/ringkasan.json').catch(() => null)
    ]);
    MINGGUAN = (ringkasan && typeof ringkasan.mingguan === 'object' && ringkasan.mingguan) || {};
  } catch (e) {
    $('out').innerHTML = `<p class="loading">${esc(e.message)}</p>`;
    return;
  }
  ENTRIES = (Array.isArray(ENTRIES) ? ENTRIES : []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.tanggal));
  if (!HARIAN || typeof HARIAN !== 'object' || Array.isArray(HARIAN)) HARIAN = {};
  aturHariLibur(CONFIG.hariLibur);
  aturZona(CONFIG.zonaWaktu);
  applyTheme(CONFIG.warnaTema);
  const ikon = safePath(CONFIG.ikonSitus);
  if (ikon) $('favicon').href = ikon;

  const weeks = [...new Set(allDates().filter(isHariKerja).map(d => mingguKe(CONFIG, d)))].sort((a, b) => b - a);
  const asked = Number(params.get('minggu'));
  WEEK = weeks.includes(asked) ? asked : (weeks[0] || mingguKe(CONFIG, todayStr()));
  $('week').innerHTML = (weeks.length ? weeks : [WEEK]).map(w => {
    const { start, end } = rentangMinggu(CONFIG, w);
    return `<option value="${w}">Minggu ke-${w} (${formatPendek(start)} – ${formatPendek(end)})</option>`;
  }).join('');
  $('week').value = String(WEEK);

  $('week').addEventListener('change', () => { WEEK = Number($('week').value); render(); });
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { MODE = b.dataset.mode; render(); }));
  $('btnPrint').addEventListener('click', () => window.print());
  render();
}

// ---------- Data ----------
function statusOf(date) {
  const st = HARIAN[date] && HARIAN[date].status;
  return ['Sakit', 'Izin'].includes(st) ? st : 'Hadir';
}

function allDates() {
  return [...new Set([...ENTRIES.map(e => e.tanggal),
    ...Object.keys(HARIAN).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && HARIAN[d] && statusOf(d) !== 'Hadir')])];
}

// Laporan mingguan hanya memuat hari kerja (Senin–Jumat).
function weekDays(w) {
  return allDates().filter(d => mingguKe(CONFIG, d) === w && isHariKerja(d)).sort().map(d => ({
    date: d,
    status: statusOf(d),
    rep: HARIAN[d] || {},
    items: ENTRIES.filter(e => e.tanggal === d).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''))
  }));
}

function photosOf(items, max) {
  const out = [];
  for (const e of items) for (const p of (e.foto || []).map(safePath).filter(Boolean)) {
    if (out.length < max) out.push({ src: p, cap: e.judul });
  }
  return out;
}

// Tempat tanda tangan: isian "Kota tanda tangan" di panel admin, atau diambil
// dari nama instansi ("BPS Kabupaten Bengkulu Tengah" -> "Bengkulu Tengah").
function tempat() {
  if (CONFIG.kotaTtd) return String(CONFIG.kotaTtd);
  const s = String(CONFIG.instansi || '');
  const m = s.match(/(?:Kabupaten|Kab\.|Kota|Provinsi)\s+(.+)$/i);
  return m ? m[1] : s;
}

function logoHtml(cls) {
  const logo = safePath(CONFIG.logoInstansi);
  return logo ? `<img class="${cls}" src="${esc(logo)}" alt="">` : '';
}

function stats(days) {
  return {
    hadir: days.filter(d => d.status === 'Hadir').length,
    sakit: days.filter(d => d.status === 'Sakit').length,
    izin: days.filter(d => d.status === 'Izin').length,
    kegiatan: days.reduce((n, d) => n + d.items.length, 0),
    foto: days.reduce((n, d) => n + d.items.reduce((m, e) => m + (e.foto || []).filter(safePath).length, 0), 0)
  };
}

// Libur nasional/cuti bersama pada hari kerja minggu ini (tidak dihitung).
function liburNote() {
  const { start, end } = rentangMinggu(CONFIG, WEEK);
  const a = toDateStr(start), b = toDateStr(end);
  const list = [...HARI_LIBUR].filter(([d]) => d >= a && d <= b && !isAkhirPekan(d)).sort(([x], [y]) => x.localeCompare(y));
  return list.length
    ? `<p class="doc-libur">Hari libur minggu ini (tidak dihitung sebagai hari kerja): ${list.map(([d, h]) => `${esc(formatTanggal(d))} – ${esc(h.nama)}`).join('; ')}.</p>`
    : '';
}

function para(text) {
  return esc(text || '').replace(/\n+/g, '<br>');
}

// ---------- Render ----------
function render() {
  document.body.className = `mode-${MODE}`;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === MODE));
  const url = new URL(location.href);
  url.searchParams.set('minggu', WEEK);
  url.searchParams.set('mode', MODE);
  history.replaceState(null, '', url);

  const days = weekDays(WEEK);
  const { start, end } = rentangMinggu(CONFIG, WEEK);
  const range = `${start.getDate()} ${BULAN[start.getMonth()]} – ${end.getDate()} ${BULAN[end.getMonth()]} ${end.getFullYear()}`;
  document.title = `${MODE === 'slide' ? 'Slide' : 'Laporan'} Minggu ke-${WEEK} · ${CONFIG.nama || 'Magang'}`;
  $('hint').textContent = MODE === 'slide'
    ? 'Di dialog cetak: pilih "Simpan sebagai PDF", Tata letak Lanskap, Margin Tidak ada, dan centang Grafis latar belakang.'
    : 'Di dialog cetak: pilih "Simpan sebagai PDF" atau printer, ukuran kertas A4, dan centang Grafis latar belakang.';
  $('printLabel').textContent = MODE === 'slide' ? 'Cetak slide / PDF' : 'Cetak laporan / PDF';

  if (!days.length) {
    $('out').innerHTML = `<p class="loading">Belum ada kegiatan pada Minggu ke-${WEEK}.</p>`;
    return;
  }
  $('out').innerHTML = MODE === 'slide' ? renderSlides(days, range) : renderDokumen(days, range);
}

function renderDokumen(days, range) {
  const s = stats(days);
  const m = CONFIG.mentor || {};
  const lastDate = days[days.length - 1].date;
  const rows = [
    ['Nama', CONFIG.nama], ['Posisi', CONFIG.posisi], ['Divisi / unit kerja', CONFIG.divisi], ['Instansi', CONFIG.instansi],
    ['Program', CONFIG.program], ['Mentor pembimbing', m.nama ? `${m.nama}${m.jabatan ? `, ${m.jabatan}` : ''}` : ''],
    ['Periode', `Minggu ke-${WEEK} · ${range}`]
  ].filter(([, v]) => v);

  const dayHtml = days.map(d => {
    const r = d.rep;
    const photos = photosOf(d.items, 4);
    return `<section class="doc-day">
      <h3>${esc(formatTanggal(d.date))} <small>Hari kerja ke-${hariKe(CONFIG, d.date)}</small>
        ${d.status !== 'Hadir' ? `<span class="tag tag-${d.status.toLowerCase()}">${d.status}</span>` : ''}</h3>
      ${d.items.length ? `<table class="doc-table">
        <thead><tr><th class="c-jam">Jam</th><th>Kegiatan</th><th>Keterangan</th></tr></thead>
        <tbody>${d.items.map(e => `<tr>
          <td class="c-jam">${esc(e.jam || '')}</td>
          <td><b>${esc(e.judul)}</b>${e.lokasi ? `<br><span class="muted">${esc(e.lokasi)}</span>` : ''}</td>
          <td>${para(e.keterangan)}</td>
        </tr>`).join('')}</tbody>
      </table>` : `<p class="muted">Tidak masuk (${d.status.toLowerCase()})${r.keterangan ? `: ${esc(r.keterangan)}` : ''}.</p>`}
      ${r.ringkasan || r.pembelajaran || r.kendala ? `<dl class="doc-report">
        ${r.ringkasan ? `<dt>Ringkasan</dt><dd>${para(r.ringkasan)}</dd>` : ''}
        ${r.pembelajaran && r.pembelajaran !== '-' ? `<dt>Pembelajaran</dt><dd>${para(r.pembelajaran)}</dd>` : ''}
        ${r.kendala && r.kendala !== '-' ? `<dt>Kendala</dt><dd>${para(r.kendala)}</dd>` : ''}
      </dl>` : ''}
      ${photos.length ? `<div class="doc-photos">${photos.map(p => `<figure><img src="${esc(p.src)}" alt=""><figcaption>${esc(p.cap)}</figcaption></figure>`).join('')}</div>` : ''}
    </section>`;
  }).join('');

  return `<article class="doc">
    <header class="doc-kop">
      ${logoHtml('doc-logo')}
      <div>
        <p class="doc-org">${esc(CONFIG.instansi || '')}</p>
        <h1>LAPORAN MINGGUAN KEGIATAN MAGANG</h1>
        <p class="doc-sub">Minggu ke-${WEEK} · ${esc(range)}</p>
      </div>
    </header>

    <table class="doc-id">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>

    <h2>A. Ringkasan minggu ini</h2>
    ${MINGGUAN[WEEK] ? `<p class="doc-summary">${para(MINGGUAN[WEEK])}</p>` : ''}
    <ul class="doc-stats">
      <li><b>${s.hadir}</b> hari hadir</li>
      <li><b>${s.kegiatan}</b> kegiatan</li>
      <li><b>${s.foto}</b> foto dokumentasi</li>
      ${s.sakit ? `<li><b>${s.sakit}</b> hari sakit</li>` : ''}
      ${s.izin ? `<li><b>${s.izin}</b> hari izin</li>` : ''}
    </ul>
    ${liburNote()}

    <h2>B. Rincian kegiatan harian</h2>
    ${dayHtml}

    <div class="doc-sign">
      <div>
        <p>Mengetahui,<br>Mentor Pembimbing</p>
        <p class="sign-name">${esc(m.nama || '(.............................)')}</p>
        ${m.jabatan ? `<p class="muted">${esc(m.jabatan)}</p>` : ''}
      </div>
      <div>
        <p>${esc(tempat())}, ${esc(formatTanggal(lastDate, false))}<br>Peserta Magang</p>
        <p class="sign-name">${esc(CONFIG.nama || '')}</p>
        ${CONFIG.posisi ? `<p class="muted">${esc(CONFIG.posisi)}</p>` : ''}
      </div>
    </div>
  </article>`;
}

function slideFooter(n, total) {
  return `<footer class="sl-foot"><span>${esc(CONFIG.nama || '')} · ${esc(CONFIG.instansi || '')}</span><span>Minggu ke-${WEEK} · ${n}/${total}</span></footer>`;
}

function renderSlides(days, range) {
  const s = stats(days);
  const total = days.length + 3;
  const foto = safePath(CONFIG.fotoProfil);
  const slides = [];

  slides.push(`<section class="slide sl-title">
    <div class="sl-title-top">${logoHtml('sl-logo')}<span>${esc(CONFIG.instansi || '')}</span></div>
    <div class="sl-title-main">
      <p class="sl-kicker">Laporan Mingguan Magang</p>
      <h1>Minggu ke-${WEEK}</h1>
      <p class="sl-range">${esc(range)}</p>
    </div>
    <div class="sl-title-who">
      ${foto ? `<img src="${esc(foto)}" alt="">` : ''}
      <div><b>${esc(CONFIG.nama || '')}</b><span>${esc(CONFIG.posisi || '')}</span></div>
    </div>
  </section>`);

  slides.push(`<section class="slide">
    <h2>Ringkasan minggu ini</h2>
    ${MINGGUAN[WEEK] ? `<p class="sl-summary">${esc(MINGGUAN[WEEK])}</p>` : ''}
    <div class="sl-stats">
      <div><b>${s.hadir}</b><span>hari hadir</span></div>
      <div><b>${s.kegiatan}</b><span>kegiatan</span></div>
      <div><b>${s.foto}</b><span>foto</span></div>
      ${s.sakit || s.izin ? `<div><b>${s.sakit + s.izin}</b><span>sakit / izin</span></div>` : ''}
    </div>
    <ol class="sl-agenda">${days.map(d => `<li><b>${esc(HARI[parseDate(d.date).getDay()])}, ${esc(formatPendek(parseDate(d.date)))}</b>
      <span>${d.items.length ? d.items.slice(0, 3).map(e => esc(e.judul)).join(' · ') + (d.items.length > 3 ? ' …' : '') : esc(d.status)}</span></li>`).join('')}</ol>
    ${slideFooter(2, total)}
  </section>`);

  days.forEach((d, i) => {
    const photos = photosOf(d.items, 3);
    const r = d.rep;
    slides.push(`<section class="slide sl-day${photos.length ? '' : ' no-photo'}">
      <h2>${esc(formatTanggal(d.date))} ${d.status !== 'Hadir' ? `<span class="tag tag-${d.status.toLowerCase()}">${d.status}</span>` : ''}</h2>
      <div class="sl-day-body">
        <div class="sl-day-text">
          ${d.items.length ? `<ul class="sl-list">${d.items.slice(0, 6).map(e => `<li><span class="sl-time">${esc(e.jam || '')}</span>${esc(e.judul)}</li>`).join('')}
            ${d.items.length > 6 ? `<li class="muted">dan ${d.items.length - 6} kegiatan lainnya</li>` : ''}</ul>`
            : `<p class="sl-absent">Tidak masuk (${esc(d.status.toLowerCase())})${r.keterangan ? `: ${esc(r.keterangan)}` : ''}.</p>`}
          ${r.pembelajaran && r.pembelajaran !== '-' ? `<blockquote><b>Pembelajaran</b>${para(r.pembelajaran)}</blockquote>` : ''}
        </div>
        ${photos.length ? `<div class="sl-photos n${photos.length}">${photos.map(p => `<img src="${esc(p.src)}" alt="${esc(p.cap)}">`).join('')}</div>` : ''}
      </div>
      ${slideFooter(i + 3, total)}
    </section>`);
  });

  const lessons = days.filter(d => d.rep.pembelajaran && d.rep.pembelajaran !== '-');
  const obstacles = days.filter(d => d.rep.kendala && d.rep.kendala !== '-');
  slides.push(`<section class="slide sl-close">
    <h2>Pembelajaran &amp; kendala</h2>
    <div class="sl-two">
      <div><h3>Yang dipelajari</h3>${lessons.length ? `<ul>${lessons.map(d => `<li><b>${esc(HARI[parseDate(d.date).getDay()])}:</b> ${esc(firstSentence(d.rep.pembelajaran))}</li>`).join('')}</ul>`
        : '<p class="muted">Belum ada laporan harian yang berisi pembelajaran.</p>'}</div>
      <div><h3>Kendala</h3>${obstacles.length ? `<ul>${obstacles.map(d => `<li><b>${esc(HARI[parseDate(d.date).getDay()])}:</b> ${esc(firstSentence(d.rep.kendala))}</li>`).join('')}</ul>`
        : '<p class="muted">Belum ada laporan harian yang berisi kendala.</p>'}</div>
    </div>
    <p class="sl-thanks">Terima kasih</p>
    ${slideFooter(total, total)}
  </section>`);

  return `<div class="deck">${slides.join('')}</div>`;
}

function firstSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  const s = m ? m[0] : t;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

init();
