// Mode terang/gelap. Dimuat di <head> (sebelum halaman tampil) agar tidak berkedip.
// Pilihan pengguna disimpan per perangkat; tanpa pilihan, ikut pengaturan sistem.
(function () {
  const KEY = 'laporanmagang.theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  function current() {
    return saved() || (media && media.matches ? 'dark' : 'light');
  }
  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
      b.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  apply(current());
  if (media && media.addEventListener) media.addEventListener('change', () => { if (!saved()) apply(current()); });

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-theme-toggle]');
    if (!b) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* abaikan */ }
    apply(next);
  });
  document.addEventListener('DOMContentLoaded', () => apply(root.dataset.theme));
})();
