// Notifikasi push (Web Push + VAPID), bagian dari panel admin.
//
// - Kunci VAPID dibuat di browser. Kunci publik disimpan di data/config.json;
//   kunci rahasia hanya ditampilkan sekali untuk disalin ke secret GitHub
//   Actions VAPID_PRIVATE_KEY (tidak pernah disimpan di repo maupun perangkat).
// - Langganan tiap perangkat disimpan di data/notifikasi.json dalam bentuk
//   terenkripsi ke kunci publik VAPID (ECDH P-256 + HKDF + AES-256-GCM), jadi
//   hanya workflow yang memegang secret yang bisa membacanya.
// - Pengiriman dilakukan scripts/notifikasi.mjs di GitHub Actions.
const NOTIF_PATH = 'data/notifikasi.json';
const NOTIF_LOCAL = scoped('laporanmagang.notif');
const VAPID_RE = /^[A-Za-z0-9_-]{87}$/;
const NOTIF_KAT = { ai: 'nAi', data: 'nData', sistem: 'nSistem' };
let notifData = { langganan: [] };
let notifSub = null;       // PushSubscription perangkat ini (bila ada)
let rahasiaBaru = '';      // kunci rahasia VAPID yang baru dibuat, hanya di memori

const b64u = u8 => toB64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(t + '='.repeat((4 - t.length % 4) % 4));
};

function notifDidukung() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function vapidPublik() {
  const k = CFG && CFG.notifikasi && CFG.notifikasi.vapidPublik;
  return VAPID_RE.test(k || '') ? k : '';
}

function notifLokal() {
  try { return JSON.parse(localStorage.getItem(NOTIF_LOCAL)) || {}; } catch { return {}; }
}

function simpanNotifLokal(v) {
  try { localStorage.setItem(NOTIF_LOCAL, JSON.stringify(v)); } catch { /* abaikan */ }
}

function labelPerangkat() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Perangkat';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /OPR\//.test(ua) ? 'Opera' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

function entriIni() {
  const id = notifLokal().id;
  return id ? notifData.langganan.find(x => x.id === id) : null;
}

function aktifDiSini() {
  return Boolean(notifSub && entriIni() && Notification.permission === 'granted');
}

async function daftarSw() {
  await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

// Enkripsi langganan ke kunci publik VAPID (dibuka oleh scripts/webpush.mjs).
async function enkripsiLangganan(json, vapid) {
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.importKey('raw', fromB64u(vapid), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epk, info: te.encode('laporanmagang-langganan') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const isi = JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(isi)));
  return { epk: b64u(epk), iv: b64u(iv), data: b64u(data) };
}

function bacaKategori() {
  return Object.fromEntries(Object.entries(NOTIF_KAT).map(([k, id]) => [k, $(id).checked]));
}

// Ubah daftar langganan di repo lewat satu commit, berdasarkan isi terbaru.
async function ubahLangganan(pesan, fn) {
  let latest;
  await commit(pesan, async base => {
    latest = await readRepoJSON(NOTIF_PATH, base, {});
    if (!latest || typeof latest !== 'object' || Array.isArray(latest)) latest = {};
    latest.langganan = fn(Array.isArray(latest.langganan) ? latest.langganan.filter(x => x && x.id) : []);
    return [{ path: NOTIF_PATH, content: JSON.stringify(latest, null, 2) + '\n' }];
  });
  notifData = latest;
}

async function initNotifikasi() {
  try {
    const d = await readRepoJSON(NOTIF_PATH, S.branch, {});
    notifData = { ...(d && typeof d === 'object' && !Array.isArray(d) ? d : {}) };
    if (!Array.isArray(notifData.langganan)) notifData.langganan = [];
  } catch {
    notifData = { langganan: [] };
  }
  notifSub = null;
  if (notifDidukung() && vapidPublik()) {
    try {
      const reg = await daftarSw();
      notifSub = await reg.pushManager.getSubscription();
      // Langganan dari kunci VAPID lama tidak berlaku lagi.
      const key = notifSub && notifSub.options && notifSub.options.applicationServerKey;
      if (key && b64u(new Uint8Array(key)) !== vapidPublik()) { await notifSub.unsubscribe(); notifSub = null; }
      // Browser bisa memperbarui endpoint diam-diam: perbarui salinan di repo.
      const lokal = notifLokal();
      const ent = entriIni();
      if (notifSub && ent && lokal.endpoint && lokal.endpoint !== notifSub.endpoint) {
        const enc = await enkripsiLangganan(notifSub.toJSON(), vapidPublik());
        await ubahLangganan(`Ubah pilihan notifikasi (langganan diperbarui): ${ent.perangkat}`,
          list => list.map(x => (x.id === ent.id ? { ...x, enc, diperbarui: new Date().toISOString() } : x)));
        simpanNotifLokal({ ...lokal, endpoint: notifSub.endpoint });
      }
    } catch { /* service worker ditolak browser: tampilkan status saja */ }
  }
  renderNotif();
}

function renderNotif() {
  const ok = notifDidukung();
  const vapid = vapidPublik();
  const salinan = typeof repoSalinan === 'function' && repoSalinan();
  const list = notifData.langganan || [];
  const ent = entriIni();
  const aktif = aktifDiSini();
  $('notifUnsupported').hidden = ok;
  $('notifKeyInfo').textContent = vapid
    ? `Kunci aktif (…${vapid.slice(-8)}). Pastikan secret VAPID_PRIVATE_KEY sudah ada di GitHub. Membuat ulang kunci mengharuskan semua perangkat mengaktifkan ulang.`
    : 'Belum ada kunci. Buat sekali, lalu simpan kunci rahasianya sebagai secret GitHub Actions.';
  $('btnNotifKey').textContent = vapid ? 'Buat ulang kunci' : 'Buat kunci notifikasi';
  $('btnNotifKey').className = `btn btn-sm ${vapid ? 'btn-link' : 'btn-primary'}`;
  $('btnNotifKey').disabled = salinan;
  $('notifSecretBox').hidden = !rahasiaBaru;
  if (rahasiaBaru) {
    $('notifSecret').value = rahasiaBaru;
    $('notifSecretLink').href = `https://github.com/${encodeURIComponent(S.owner)}/${encodeURIComponent(S.repo)}/settings/secrets/actions/new`;
  }
  $('notifDeviceBox').hidden = !vapid || !ok || salinan;
  if (ent) for (const [k, id] of Object.entries(NOTIF_KAT)) $(id).checked = !ent.kategori || ent.kategori[k] !== false;
  $('btnNotifOn').hidden = aktif;
  $('btnNotifPref').hidden = !aktif;
  $('btnNotifTest').hidden = !aktif;
  $('btnNotifOff').hidden = !aktif;
  $('notifCount').textContent = list.length;
  $('notifList').innerHTML = list.length ? list.map(x => `<div class="device-row">
      <div>${esc(x.perangkat || 'Perangkat')} ${ent && x.id === ent.id ? '<b class="this">· perangkat ini</b>' : ''}
        <small>Didaftarkan ${esc(x.dibuat ? formatTanggal(toDateStr(new Date(x.dibuat)), false) : '-')} · ${esc(Object.entries(x.kategori || {}).filter(([, v]) => v).map(([k]) => ({ ai: 'AI', data: 'data', sistem: 'sistem' }[k] || k)).join(', ') || 'semua')}</small></div>
      <button class="btn btn-light btn-sm" type="button" data-hapus-notif="${esc(x.id)}">Hapus</button>
    </div>`).join('') : '<p class="empty">Belum ada perangkat.</p>';
  let status;
  if (salinan) status = 'Selesaikan "Mulai baru" dulu';
  else if (!ok) status = 'Browser ini belum mendukung';
  else if (!vapid) status = 'Belum diatur';
  else if (Notification.permission === 'denied') status = 'Izin notifikasi diblokir di browser ini';
  else if (aktif) status = `✅ Aktif di perangkat ini · ${list.length} perangkat`;
  else status = `${list.length} perangkat terdaftar · belum aktif di perangkat ini`;
  $('notifStatus').textContent = status;
}

$('btnNotifKey').addEventListener('click', () => {
  const ada = vapidPublik();
  if (ada && !confirm('Buat kunci baru? Semua perangkat yang terdaftar dihapus dan harus mengaktifkan notifikasi lagi, dan secret VAPID_PRIVATE_KEY di GitHub harus diganti.')) return;
  withBusy($('btnNotifKey'), async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const publik = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    msg('notifMsg', 'Menyimpan kunci publik…');
    let cfg;
    await commit('Atur kunci notifikasi push', async base => {
      cfg = await readRepoJSON(CONFIG_PATH, base, {});
      cfg.notifikasi = { vapidPublik: publik, dibuat: new Date().toISOString() };
      const changes = [{ path: CONFIG_PATH, content: JSON.stringify(cfg, null, 2) + '\n' }];
      if (ada) changes.push({ path: NOTIF_PATH, content: JSON.stringify({ langganan: [] }, null, 2) + '\n' });
      return changes;
    });
    CFG = { ...CFG, notifikasi: cfg.notifikasi };
    if (ada) notifData = { langganan: [] };
    if (notifSub) { await notifSub.unsubscribe().catch(() => {}); notifSub = null; }
    rahasiaBaru = jwk.d;
    renderNotif();
    $('notifSecretBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Kunci dibuat. Salin kunci rahasia ke secret GitHub VAPID_PRIVATE_KEY.');
  }, 'notifMsg');
});

$('btnNotifCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('notifSecret').value);
    toast('Kunci rahasia disalin.');
  } catch {
    $('notifSecret').select();
    toast('Salin manual: tekan lama pada kotak kunci.', true);
  }
});

$('btnNotifSecretDone').addEventListener('click', () => {
  if (!confirm('Kunci rahasia sudah disimpan sebagai secret VAPID_PRIVATE_KEY? Setelah ditutup, kunci tidak bisa ditampilkan lagi.')) return;
  rahasiaBaru = '';
  $('notifSecret').value = '';
  renderNotif();
});

$('btnNotifOn').addEventListener('click', () => {
  const vapid = vapidPublik();
  if (!vapid) return;
  withBusy($('btnNotifOn'), async () => {
    // Harus langsung dari ketukan pengguna.
    const izin = await Notification.requestPermission();
    if (izin !== 'granted') throw new Error('Izin notifikasi ditolak. Izinkan notifikasi untuk situs ini di pengaturan browser, lalu coba lagi.');
    msg('notifMsg', 'Mendaftarkan perangkat…');
    const reg = await daftarSw();
    let sub = await reg.pushManager.getSubscription();
    const key = sub && sub.options && sub.options.applicationServerKey;
    if (sub && (!key || b64u(new Uint8Array(key)) !== vapid)) { await sub.unsubscribe(); sub = null; }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(vapid) });
    const enc = await enkripsiLangganan(sub.toJSON(), vapid);
    const lokal = notifLokal();
    const id = lokal.id || b64u(crypto.getRandomValues(new Uint8Array(12)));
    const label = labelPerangkat();
    const now = new Date().toISOString();
    msg('notifMsg', 'Menyimpan ke GitHub…');
    await ubahLangganan(`Aktifkan notifikasi: ${label}`, list => {
      const lama = list.find(x => x.id === id);
      const entri = { id, perangkat: label, dibuat: (lama && lama.dibuat) || now, diperbarui: now, kategori: bacaKategori(), enc };
      return lama ? list.map(x => (x.id === id ? entri : x)) : [...list, entri];
    });
    simpanNotifLokal({ id, endpoint: sub.endpoint });
    notifSub = sub;
    renderNotif();
    reg.showNotification('🔔 Notifikasi aktif', { body: 'Perangkat ini akan menerima kabar laporan magang.', icon: 'assets/app-icon-192.png', badge: 'assets/badge-96.png', tag: 'aktif' }).catch(() => {});
    toast('Notifikasi aktif di perangkat ini. Pastikan secret VAPID_PRIVATE_KEY sudah diatur di GitHub.');
  }, 'notifMsg');
});

$('btnNotifPref').addEventListener('click', () => {
  const ent = entriIni();
  if (!ent) return;
  withBusy($('btnNotifPref'), async () => {
    const kategori = bacaKategori();
    await ubahLangganan(`Ubah pilihan notifikasi: ${ent.perangkat}`, list => list.map(x => (x.id === ent.id ? { ...x, kategori } : x)));
    renderNotif();
    toast('Pilihan notifikasi tersimpan.');
  }, 'notifMsg');
});

$('btnNotifTest').addEventListener('click', () => {
  const ent = entriIni();
  if (!ent) return;
  withBusy($('btnNotifTest'), async () => {
    await ubahLangganan(`Tes notifikasi ${ent.id}`, list => list.map(x => (x.id === ent.id ? { ...x, uji: new Date().toISOString() } : x)));
    toast('Tes dikirim lewat GitHub Actions. Notifikasi muncul dalam ±30–90 detik.');
  }, 'notifMsg');
});

async function hapusPerangkat(id) {
  const x = notifData.langganan.find(e => e.id === id);
  if (!x) return;
  const ini = x.id === notifLokal().id;
  await ubahLangganan(`Nonaktifkan notifikasi: ${x.perangkat || 'perangkat'}`, list => list.filter(e => e.id !== id));
  if (ini) {
    if (notifSub) await notifSub.unsubscribe().catch(() => {});
    notifSub = null;
    try { localStorage.removeItem(NOTIF_LOCAL); } catch { /* abaikan */ }
  }
  renderNotif();
  toast(ini ? 'Notifikasi dinonaktifkan di perangkat ini.' : 'Perangkat dihapus dari daftar notifikasi.');
}

$('btnNotifOff').addEventListener('click', () => {
  const ent = entriIni();
  if (ent && confirm('Nonaktifkan notifikasi di perangkat ini?')) withBusy($('btnNotifOff'), () => hapusPerangkat(ent.id), 'notifMsg');
});

$('notifList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-hapus-notif]');
  if (b && confirm('Hapus perangkat ini dari daftar notifikasi?')) withBusy(b, () => hapusPerangkat(b.dataset.hapusNotif));
});

// Dipanggil admin.js saat panel dikunci.
function notifKunci() {
  rahasiaBaru = '';
  $('notifSecret').value = '';
  $('notifSecretBox').hidden = true;
}
