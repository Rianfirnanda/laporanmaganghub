// Indikator kualitas jaringan di navbar panel admin.
// Mengukur waktu respons (ping) ke server website setiap 10 detik selama
// halaman terlihat, lalu menampilkannya sebagai 4 batang sinyal.
(function () {
  const el = document.getElementById('netStatus');
  if (!el) return;
  const INTERVAL = 10000;
  const TIMEOUT = 8000;
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
      const res = await fetch(`version.json?ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
      if (!res.ok && res.status !== 405) throw new Error(String(res.status));
      samples.push(Math.round(performance.now() - t0));
      if (samples.length > 3) samples.shift();
      // Median beberapa pengukuran terakhir agar tidak melompat-lompat.
      const ms = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      const lv = LEVELS.find(l => ms <= l.max);
      tampil({ ...lv, ms });
    } catch {
      samples.length = 0;
      tampil({ bars: 0, cls: 'off', label: 'Server tidak terjangkau', short: 'Putus', ms: null });
    } finally {
      clearTimeout(stop);
      running = false;
    }
  }

  function jadwal() {
    clearInterval(timer);
    if (document.hidden) return;
    ukur();
    timer = setInterval(ukur, INTERVAL);
  }

  el.addEventListener('click', async () => {
    samples.length = 0;
    await ukur();
    if (last && typeof toast === 'function') {
      const detail = [last.ms != null ? `Ping ${last.ms} ms` : '', koneksi()].filter(Boolean).join(' · ');
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
