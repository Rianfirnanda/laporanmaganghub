// Service worker khusus notifikasi push. Tidak menyimpan cache apa pun, jadi
// pembaruan website tetap langsung terlihat (lihat assets/common.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(self.clients.claim()));

// Hanya halaman di situs ini yang boleh dibuka dari notifikasi.
function urlAman(u) {
  const scope = self.registration.scope;
  try {
    const url = new URL(u || './', scope);
    return url.href.startsWith(scope) ? url.href : scope;
  } catch {
    return scope;
  }
}

self.addEventListener('push', ev => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = { isi: ev.data ? ev.data.text() : '' }; }
  const tag = typeof d.tag === 'string' ? d.tag.slice(0, 40) : '';
  ev.waitUntil(self.registration.showNotification(String(d.judul || 'Laporan Magang').slice(0, 80), {
    body: String(d.isi || '').slice(0, 300),
    icon: 'assets/app-icon-192.png',
    badge: 'assets/badge-96.png',
    lang: 'id',
    tag: tag || undefined,
    renotify: Boolean(tag),
    timestamp: Number(d.waktu) || Date.now(),
    data: { url: urlAman(d.url) }
  }));
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const url = urlAman(ev.notification.data && ev.notification.data.url);
  ev.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find(w => w.url === url) || wins.find(w => w.url.startsWith(self.registration.scope));
    if (same) {
      if (same.url !== url && 'navigate' in same) await same.navigate(url).catch(() => {});
      return same.focus();
    }
    return self.clients.openWindow(url);
  })());
});
