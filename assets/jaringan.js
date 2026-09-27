// Indikator kualitas jaringan di navbar panel admin (realtime).
// Setiap 2 detik selama halaman terlihat, browser mengirim permintaan kecil
// (HEAD, tanpa isi) ke server website lalu mencatat waktu bolak-baliknya (ping).
// Angka ms = pengukuran terbaru; jumlah batang = median 3 pengukuran terakhir
// agar warna tidak berkedip karena satu lonjakan.
(function () {
  const el = document.getElementById('netStatus');
  if (!el) return;
  const INTERVAL = 2000;
  const TIMEOUT = 5000;
  const SIMPAN = 10;                 // riwayat untuk rata-rata/jitter
  const URL_PING = 'version.json?ping';   // URL tetap: dilayani langsung dari server CDN terdekat
  const samples = [];
  let timer = 0;
  let last = null;       // { ms, level, label, waktu }
  let running = false;

  const LEVELS = [
    { max: 150, bars: 4, cls: 'good', label: 'Sangat baik' },
    { max: 400, bars: 3, cls: 'good', label: 'Baik' },
    { max: 1000, bars: 2, cls: 'fair', label: 'Lambat' },
    { max: Infinity, bars: 1, cls: 'poor', label: 'Buruk' }
  ];

  function koneksi() {
    const c = navigator.connection;
    if (!c) return '';
    const parts = [];
    if (c.effectiveType) parts.push(c.effectiveType.toUpperCase());
    if (c.downlink) parts.push(`±${c.downlink} Mbps`);
    if (c.saveData) parts.push('hemat data');
    return parts.join(' · ');
  }

  function tampil(state) {
    last = { ...state, waktu: new Date() };
    el.dataset.bars = String(state.bars);
    el.className = `net-status net-${state.cls}`;
    el.querySelector('.net-ms').textContent = state.ms != null ? `${state.ms} ms` : state.short;
    const info = [`Jaringan: ${state.label}`, state.ms != null ? `ping ${state.ms} ms` : '', state.cls === 'off' ? '' : koneksi()].filter(Boolean).join(' · ');
    el.title = `${info}. Ketuk untuk mengukur ulang.`;
    el.setAttribute('aria-label', info);
  }

  // Waktu murni di jaringan (kirim permintaan sampai byte pertama balasan) dari
  // Resource Timing; tanpa antrean browser. Bila tidak tersedia, pakai stopwatch.
  function waktuJaringan() {
    try {
      const e = performance.getEntriesByType('resource').filter(x => x.name.endsWith(URL_PING)).pop();
      performance.clearResourceTimings();   // cegah buffer penuh (±250 entri)
      return e && e.requestStart > 0 && e.responseStart >= e.requestStart ? e.responseStart - e.requestStart : null;
    } catch { return null; }
  }

  function statistik() {
    if (!samples.length) return '';
    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    const jitter = samples.length > 1
      ? Math.round(samples.slice(1).reduce((n, v, i) => n + Math.abs(v - samples[i]), 0) / (samples.length - 1)) : 0;
    return `rata-rata ${avg} ms, min ${Math.min(...samples)}, maks ${Math.max(...samples)}, jitter ${jitter} ms dari ${samples.length} pengukuran`;
  }

  async function ukur() {
    if (running) return;
    if (!navigator.onLine) {
      samples.length = 0;
      tampil({ bars: 0, cls: 'off', label: 'Offline, tidak ada koneksi internet', short: 'Offline', ms: null });
      return;
    }
    running = true;
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), TIMEOUT);
    const t0 = performance.now();
    try {
      const res = await fetch(URL_PING, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
      if (!res.ok && res.status !== 405) throw new Error(String(res.status));
      const ms = Math.max(1, Math.round(waktuJaringan() ?? performance.now() - t0));
      samples.push(ms);
      if (samples.length > SIMPAN) samples.shift();
      const tiga = samples.slice(-3).sort((a, b) => a - b);
      const lv = LEVELS.find(l => tiga[Math.floor(tiga.length / 2)] <= l.max);
      tampil({ ...lv, ms });
    } catch {
      samples.length = 0;
      tampil({ bars: 0, cls: 'off', label: 'Server tidak terjangkau', short: 'Putus', ms: null });
    } finally {
      clearTimeout(stop);
      running = false;
    }
  }

  // Pengukuran berikutnya dimulai 2 detik setelah yang sebelumnya selesai,
  // jadi di jaringan lambat permintaan tidak menumpuk.
  async function putaran() {
    clearTimeout(timer);
    if (document.hidden) return;
    await ukur();
    if (!document.hidden) timer = setTimeout(putaran, INTERVAL);
  }

  function jadwal() {
    clearTimeout(timer);
    if (!document.hidden) putaran();
  }

  el.addEventListener('click', async () => {
    await ukur();
    if (last && typeof toast === 'function') {
      const detail = [last.ms != null ? `ping ${last.ms} ms` : '', statistik(), koneksi()].filter(Boolean).join(' · ');
      const saran = last.cls === 'off' ? ' Simpan setelah koneksi kembali.'
        : last.cls === 'poor' || last.cls === 'fair' ? ' Unggah foto mungkin lambat; tunggu sampai selesai sebelum menutup halaman.' : '';
      toast(`Jaringan ${last.label.toLowerCase()}${detail ? ` (${detail})` : ''}.${saran}`, last.cls === 'off' || last.cls === 'poor');
    }
  });
  window.addEventListener('online', jadwal);
  window.addEventListener('offline', () => { ukur(); });
  document.addEventListener('visibilitychange', jadwal);
  if (navigator.connection && navigator.connection.addEventListener) {
    navigator.connection.addEventListener('change', () => { samples.length = 0; ukur(); });
  }
  jadwal();
})();
