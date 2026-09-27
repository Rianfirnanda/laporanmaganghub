// Panel admin: mengelola kegiatan, profil, dan tampilan website langsung ke
// repository lewat GitHub API (satu commit per penyimpanan).
//
// Keamanan:
// - Token GitHub dienkripsi (AES-GCM, kunci dari kata sandi via PBKDF2) sebelum
//   disimpan di localStorage. Token asli hanya ada di memori selama panel terbuka.
// - Panel dikunci lewat tombol Kunci atau saat dimuat ulang, dan tidak mau tampil di dalam frame.

// Tolak dibuka di dalam <iframe> (mencegah clickjacking).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error('Panel admin tidak boleh dibuka di dalam frame.');
}

const $ = id => document.getElementById(id);
// Satu akun GitHub bisa punya beberapa situs laporan di origin yang sama
// (akun.github.io/repo-a dan /repo-b), jadi data perangkat diberi nama repo.
const SCOPE = (() => {
  const first = location.pathname.split('/').filter(Boolean)[0] || '';
  return first && !/\.html?$/i.test(first) ? first.toLowerCase() : '';
})();
const scoped = name => (SCOPE ? `${name}@${SCOPE}` : name);
const STORE_KEY = scoped('laporanmagang.v2');
const LEGACY_KEY = 'laporanmagang.settings';
migrateScope();
const DATA_PATH = 'data/kegiatan.json';
const CONFIG_PATH = 'data/config.json';
const PBKDF2_ITERATIONS = 310000;
const UPLOAD_CONCURRENCY = 3;
const DEPLOY_POLL_MS = 4000;
const DEPLOY_TIMEOUT_MS = 5 * 60000;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

let S = { owner: '', repo: '', branch: 'main' };
let TOKEN = '';            // hanya di memori
let entries = [];
let CFG = null;
let busy = 0;

// ================= Penyimpanan terenkripsi =================
const te = new TextEncoder();
const td = new TextDecoder();
const toB64 = u8 => btoa(String.fromCharCode(...u8));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(token)));
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(data), iter: PBKDF2_ITERATIONS };
}

async function decryptToken(enc, password) {
  try {
    const key = await deriveKey(password, fromB64(enc.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.data));
    return td.decode(plain);
  } catch {
    throw new Error('Kata sandi salah.');
  }
}

// Versi lama memakai nama kunci tanpa nama repo: pindahkan sekali bila memang
// milik repo situs ini.
function migrateScope() {
  if (!SCOPE) return;
  try {
    if (localStorage.getItem(STORE_KEY)) return;
    const old = JSON.parse(localStorage.getItem('laporanmagang.v2'));
    if (!old || String(old.repo || '').toLowerCase() !== SCOPE) return;
    for (const name of ['laporanmagang.v2', 'laporanmagang.sesi', 'laporanmagang.drive', 'laporanmagang.drivetoken', 'laporanmagang.skrip.baru']) {
      for (const st of [localStorage, sessionStorage]) {
        const v = st.getItem(name);
        if (v !== null) { st.setItem(scoped(name), v); st.removeItem(name); }
      }
    }
  } catch { /* penyimpanan diblokir: abaikan */ }
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}

function writeStore(obj) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  } catch {
    throw new Error('Browser menolak penyimpanan lokal (mode privat?). Token tidak bisa diingat.');
  }
}

function clearStore() {
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* abaikan */ }
  clearSession();
}

// Versi lama menyimpan token tanpa enkripsi: ambil sekali lalu hapus.
function takeLegacy() {
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY));
    localStorage.removeItem(LEGACY_KEY);
    return old && old.token ? old : null;
  } catch { return null; }
}

// ---------- Sesi: tetap masuk saat halaman dimuat ulang ----------
// Token yang sudah dibuka dienkripsi dengan kunci perangkat (AES-GCM, tidak bisa
// diekspor, disimpan di IndexedDB). Hasilnya di sessionStorage (hilang saat tab
// ditutup) atau localStorage 30 hari bila "Tetap masuk" dicentang.
const SESSION_KEY = scoped('laporanmagang.sesi');
const REMEMBER_DAYS = 30;
let rememberMe = false;

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('laporanmagang', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deviceKey() {
  const db = await openIdb();
  const get = () => new Promise((resolve, reject) => {
    const r = db.transaction('keys').objectStore('keys').get('device');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  let key = await get();
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(key, 'device');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  return key;
}

async function saveSession() {
  if (!TOKEN) return;
  try {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = JSON.stringify({ token: TOKEN, ai: AI_KEY, groq: GROQ_KEY, skrip: SCRIPT_KEY, exp: rememberMe ? Date.now() + REMEMBER_DAYS * 86400000 : 0 });
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(body)));
    const blob = JSON.stringify({ iv: toB64(iv), data: toB64(data) });
    clearSession();
    (rememberMe ? localStorage : sessionStorage).setItem(SESSION_KEY, blob);
  } catch { /* browser tanpa IndexedDB/penyimpanan: tetap jalan, hanya perlu login ulang */ }
}

async function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    rememberMe = !sessionStorage.getItem(SESSION_KEY);
    const { iv, data } = JSON.parse(raw);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await deviceKey(), fromB64(data));
    const sess = JSON.parse(td.decode(plain));
    if (sess.exp && sess.exp < Date.now()) { clearSession(); return null; }
    return sess;
  } catch {
    clearSession();
    return null;
  }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
}

function guessRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return {};
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = first && !first.endsWith('.html') ? first : `${owner}.github.io`;
  return { owner, repo };
}

// ================= GitHub API =================
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  if (!TOKEN) throw new Error('Panel terkunci.');
  const res = await fetch(`https://api.github.com/repos/${S.owner}/${S.repo}${path}`, {
    method,
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* abaikan */ }
    if (res.status === 401) msg = 'Token tidak valid atau sudah kedaluwarsa. Buat token baru lalu hubungkan ulang.';
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

async function readRepoJSON(path, ref, fallback) {
  try {
    return JSON.parse(await gh(`/contents/${path}?ref=${encodeURIComponent(ref)}`, { raw: true }));
  } catch (e) {
    if (e.status === 404) return fallback;
    throw e;
  }
}

async function uploadBlob(base64) {
  return (await gh('/git/blobs', { method: 'POST', body: { content: base64, encoding: 'base64' } })).sha;
}

// Satu commit berisi semua perubahan. buildChanges(baseSha) mengembalikan daftar
// { path, sha } (file biner), { path, content } (teks), atau { path, delete: true }.
async function commit(message, buildChanges) {
  const branch = encodeURIComponent(S.branch);
  const ref = await gh(`/git/ref/heads/${branch}`);
  const baseSha = ref.object.sha;
  const [baseCommit, changes] = await Promise.all([gh(`/git/commits/${baseSha}`), buildChanges(baseSha)]);
  const tree = changes.map(c => {
    const item = { path: c.path, mode: '100644', type: 'blob' };
    if (c.delete) item.sha = null;
    else if (c.sha) item.sha = c.sha;
    else item.content = c.content;
    return item;
  });
  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
  const created = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [baseSha] } });
  await gh(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: created.sha } });
  changes.filter(c => c.content !== undefined).forEach(c => watchDeploy(c.path, c.content));
}

// Jalankan fn untuk tiap item, paling banyak `limit` sekaligus; urutan hasil tetap.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function rawUrl(path) {
  const p = safePath(path);
  return p ? `https://raw.githubusercontent.com/${S.owner}/${S.repo}/${S.branch}/${p}` : '';
}

// ================= Masuk / kunci =================
function show(id) {
  ['authSetup', 'authUnlock', 'app'].forEach(x => { $(x).hidden = x !== id; });
  $('btnLock').hidden = id !== 'app';
  $('tabbar').hidden = id !== 'app';
  $('fabCam').hidden = id !== 'app' || !['kegiatan', 'harian'].some(t => !document.querySelector(`.panel[data-panel="${t}"]`).hidden);
  renderHero(id === 'app');
}

// Hero menampilkan identitas pemilik setelah panel terbuka.
function renderHero(open) {
  const box = $('heroAvatar');
  const foto = open && rawUrl(CFG && CFG.fotoProfil);
  if (foto) {
    const img = document.createElement('img');
    img.src = foto;
    img.alt = '';
    box.replaceChildren(img);
  } else if (open && CFG && CFG.nama) {
    box.textContent = inisial(CFG.nama);
  } else {
    box.innerHTML = icon('lock');
  }
  $('heroTitle').textContent = open && CFG && CFG.nama ? CFG.nama : 'Panel Admin';
  const ikon = open && rawUrl(CFG && CFG.ikonSitus);
  const mark = document.querySelector('.navbar .brand-mark');
  if (ikon) {
    const img = document.createElement('img');
    img.src = ikon;
    img.alt = '';
    mark.replaceChildren(img);
    mark.classList.add('has-img');
  } else {
    mark.innerHTML = icon('file');
    mark.classList.remove('has-img');
  }
  $('heroBadge').textContent = open ? 'Panel Admin' : 'Laporan Magang';
  $('heroSub').textContent = open ? `${S.owner}/${S.repo} · branch ${S.branch}` : 'Kelola dokumentasi kegiatan harian';
}

function showSetup(note) {
  const g = S.owner ? { ...S } : { branch: 'main', ...guessRepo() };
  $('sOwner').value = g.owner || '';
  $('sRepo').value = g.repo || '';
  $('sBranch').value = g.branch || 'main';
  // Isian otomatis halaman pembuatan token (diabaikan GitHub bila tidak didukung).
  const q = new URLSearchParams({ name: `Laporan Magang ${g.repo || ''}`.trim(), description: 'Panel admin laporan magang', contents: 'write' });
  if (g.owner) q.set('target_name', g.owner);
  $('tokenLink').href = `https://github.com/settings/personal-access-tokens/new?${q}`;
  $('sPass').value = '';
  $('sPass2').value = '';
  if (note) $('setupNote').textContent = note;
  show('authSetup');
}

function showUnlock() {
  $('unlockRepo').textContent = `${S.owner}/${S.repo} · branch ${S.branch}`;
  $('uPass').value = '';
  show('authUnlock');
  $('uPass').focus({ preventScroll: true });
}

async function verifyConnection() {
  const repo = await gh('');
  if (!repo.permissions || !repo.permissions.push) {
    throw new Error('Token tidak punya izin menulis ke repository ini.');
  }
  return repo;
}

$('formSetup').addEventListener('submit', async ev => {
  ev.preventDefault();
  const owner = $('sOwner').value.trim();
  const repo = $('sRepo').value.trim();
  const branch = $('sBranch').value.trim() || 'main';
  const token = $('sToken').value.trim();
  const pass = $('sPass').value;
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo) || !BRANCH_RE.test(branch)) return toast('Username, repo, atau branch tidak valid.', true);
  if (pass.length < 8) return toast('Kata sandi minimal 8 karakter.', true);
  if (pass !== $('sPass2').value) return toast('Ulangan kata sandi tidak sama.', true);

  await withBusy($('btnSetup'), async () => {
    S = { owner, repo, branch };
    TOKEN = token;
    try {
      await verifyConnection();
    } catch (e) {
      TOKEN = '';
      throw e;
    }
    writeStore({ ...S, enc: await encryptToken(token, pass) });
    $('sToken').value = '';
    $('sPass').value = '';
    $('sPass2').value = '';
    rememberMe = false;
    saveSession();
    await enterApp();
    if (token.startsWith('ghp_')) toast('Terhubung. Disarankan memakai token fine-grained (github_pat_…) yang hanya untuk repo ini.', true);
    else toast('Terhubung. Token tersimpan terenkripsi di perangkat ini.');
  });
});

let failCount = 0;
let lockedUntil = 0;
$('formUnlock').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (Date.now() < lockedUntil) {
    return toast(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((lockedUntil - Date.now()) / 1000)} detik.`, true);
  }
  const stored = readStore();
  if (!stored) return showSetup();
  await withBusy($('btnUnlock'), async () => {
    try {
      TOKEN = await decryptToken(stored.enc, $('uPass').value);
    } catch (e) {
      failCount++;
      if (failCount >= 5) { lockedUntil = Date.now() + 30000 * (failCount - 4); }
      throw e;
    }
    failCount = 0;
    AI_KEY = stored.aiEnc ? await decryptToken(stored.aiEnc, $('uPass').value).catch(() => '') : '';
    GROQ_KEY = stored.groqEnc ? await decryptToken(stored.groqEnc, $('uPass').value).catch(() => '') : '';
    SCRIPT_KEY = stored.scriptEnc ? await decryptToken(stored.scriptEnc, $('uPass').value).catch(() => '') : '';
    $('uPass').value = '';
    rememberMe = $('uRemember').checked;
    saveSession();
    await enterApp();
  });
});

$('btnForgot').addEventListener('click', () => {
  if (!confirm('Kata sandi tidak bisa dipulihkan. Hapus token tersimpan dan hubungkan ulang dengan token GitHub?')) return;
  clearStore();
  showSetup('Masukkan token GitHub (boleh token yang sama) dan buat kata sandi baru.');
});

async function enterApp() {
  show('app');
  renderSecurity();
  renderDrive();
  if (driveCfg.clientId) loadDriveToken();   // izin Google dari sesi sebelumnya (±1 jam)
  if (driveReady()) loadGis().catch(() => {});
  resetForm();
  renderAi();
  refreshAiModels();
  if (!$('hTanggal').value) $('hTanggal').value = wibParts().tanggal;
  startServerClock();
  handleShortcut();
  await Promise.all([loadEntries(), loadConfig(), loadHarian()]);
  renderHarianForm();
  catchUpAi();
  if (typeof initNotifikasi === 'function') initNotifikasi();
}

// Pintasan dari ikon aplikasi di layar utama HP (manifest.webmanifest).
function handleShortcut() {
  const url = new URL(location.href);
  const aksi = url.searchParams.get('aksi');
  if (!aksi) return;
  url.searchParams.delete('aksi');
  history.replaceState(null, '', url);
  if (aksi === 'harian') return openTab('harian');
  openTab('kegiatan');
  if (aksi === 'kamera') {
    $('quickCam').classList.add('pulse');
    $('cardForm').scrollIntoView({ block: 'start' });
    toast('Ketuk "Ambil foto" untuk membuka kamera. Lokasi dan waktu server diisi otomatis.');
  }
}

function lock(reason) {
  clearSession();
  if (typeof notifKunci === 'function') notifKunci();
  TOKEN = '';
  AI_KEY = '';
  GROQ_KEY = '';
  SCRIPT_KEY = '';
  harian = {};
  clearDriveToken();
  entries = [];
  CFG = null;
  $('entryList').innerHTML = '<p class="empty">Memuat…</p>';
  if (readStore()) showUnlock(); else showSetup();
  resetForm();
  resetImageSlots();
  if (reason) toast(reason);
}

$('btnLock').addEventListener('click', () => {
  if (busy) return toast('Tunggu proses penyimpanan selesai.', true);
  lock('Panel dikunci.');
});

// ================= Tab =================
function openTab(name) {
  document.querySelectorAll('#tabbar [data-tab]').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', String(t.dataset.tab === name));
  });
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  $('fabCam').hidden = !['kegiatan', 'harian'].includes(name);
  if (name === 'harian') {
    renderHarianEntries();
    if (!gps && !gpsPromise) autoLocate();
    catchUpAi();
  }
  if (name === 'keamanan') {
    loadStorage();
    if (typeof renderNotif === 'function') renderNotif();
  }
}

$('tabbar').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-tab]');
  if (btn) openTab(btn.dataset.tab);
});

// ================= Foto =================
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Tidak bisa membaca foto ${file.name}`)); };
    img.src = url;
  });
}

// Foto HP bisa 12–50 MP. createImageBitmap mendekode di luar thread utama dan
// lebih hemat memori daripada <img>; bila gagal, jatuh ke <img>.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* coba cara lain */ }
  }
  return loadImage(file);
}

function unreadableMessage(file) {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    return `Foto ${file.name} berformat HEIC yang belum didukung browser. Di pengaturan kamera, pilih format JPG / "Paling kompatibel".`;
  }
  return `Foto ${file.name} tidak bisa dibaca. Mungkin belum selesai diunduh dari Google Foto/cloud atau file rusak. Coba pilih ulang.`;
}

// Perkecil ke JPEG (maks. 1600 px). Diulang sekali bila HP sedang kehabisan memori.
async function shrinkPhoto(file, { maxSide = 1600, quality = 0.82 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let src = null;
    const canvas = document.createElement('canvas');
    try {
      src = await decodeImage(file);
      const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
      if (!sw || !sh) throw new Error('kosong');
      const scale = Math.min(1, maxSide / Math.max(sw, sh));
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (!blob) throw new Error('gagal');
      return blob;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    } finally {
      if (src && src.close) src.close();
      canvas.width = canvas.height = 0;   // lepaskan memori canvas segera
    }
  }
  throw new Error(unreadableMessage(file));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(new Error('Gagal membaca foto.'));
    r.readAsDataURL(blob);
  });
}

// Kompres ulang lewat canvas: ukuran kecil dan metadata EXIF (termasuk lokasi GPS) ikut terbuang.
async function imageToBase64(file, { maxSide = 1600, square = false, quality = 0.82, png = false } = {}) {
  const img = await loadImage(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  if (!png) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const dataUrl = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

// ================= Kegiatan =================
let editingId = null;
let newPhotos = [];       // { file, url, blob, state: 'proses'|'ok'|'gagal', error, prep }
let prepQueue = Promise.resolve();   // foto diperkecil satu per satu agar HP tidak kehabisan memori
let keptPhotos = [];      // foto lama yang dipertahankan saat edit
let removedPhotos = [];   // foto lama yang dihapus saat edit

async function loadEntries() {
  try {
    const data = await readRepoJSON(DATA_PATH, S.branch, []);
    entries = Array.isArray(data) ? data : [];
    renderList();
  } catch (e) {
    $('entryList').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

// Setiap foto langsung diperkecil begitu dipilih (bukan saat disimpan), dan
// pratinjaunya memakai versi kecil itu. Foto yang gagal dibaca ditandai dan
// dilewati saat menyimpan, tidak membatalkan seluruh kegiatan.
function addFiles(files) {
  for (const file of files) {
    if (file.type && !file.type.startsWith('image/')) continue;
    const item = { file, url: '', blob: null, state: 'proses', error: '' };
    item.prep = prepQueue = prepQueue.then(async () => {
      if (!newPhotos.includes(item)) return;          // sudah dibatalkan
      try {
        item.blob = await shrinkPhoto(file);
        // Thumbnail kecil untuk dasbor (lebih ringan dimuat di HP).
        item.thumb = await shrinkPhoto(item.blob, { maxSide: 480, quality: 0.72 }).catch(() => null);
        item.url = URL.createObjectURL(item.blob);
        item.state = 'ok';
      } catch (e) {
        item.state = 'gagal';
        item.error = e.message;
        toast(e.message, true);
      }
      renderPreviews();
    });
    newPhotos.push(item);
  }
  renderPreviews();
}

function renderPreviews() {
  const kept = keptPhotos.map((p, i) =>
    `<div class="preview"><img src="${esc(rawUrl(p))}" alt="" loading="lazy"><button type="button" data-kept="${i}" title="Hapus foto">${icon('x')}</button></div>`);
  const fresh = newPhotos.map((p, i) => {
    const body = p.state === 'ok' ? `<img src="${esc(p.url)}" alt="">`
      : p.state === 'gagal' ? `<span class="preview-state bad" title="${esc(p.error)}">${icon('alert')}<small>Tidak terbaca</small></span>`
        : `<span class="preview-state">${icon('loader', 'spin')}<small>Memproses…</small></span>`;
    return `<div class="preview new${p.state === 'gagal' ? ' failed' : ''}">${body}<button type="button" data-new="${i}" title="Batal">${icon('x')}</button></div>`;
  });
  $('previews').innerHTML = kept.concat(fresh).join('');
}

$('previews').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.kept !== undefined) {
    removedPhotos.push(keptPhotos.splice(Number(b.dataset.kept), 1)[0]);
  } else {
    const [p] = newPhotos.splice(Number(b.dataset.new), 1);
    if (p && p.url) URL.revokeObjectURL(p.url);
  }
  renderPreviews();
});

$('fFoto').addEventListener('change', ev => { addFiles(ev.target.files); ev.target.value = ''; });
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, ev => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, ev => { ev.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', ev => addFiles(ev.dataTransfer.files));

function resetForm() {
  editingId = null;
  newPhotos.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
  newPhotos = []; keptPhotos = []; removedPhotos = [];
  $('formEntry').reset();
  timeTouched = false;
  fillFormTime();
  lokasiAuto = true;
  gps = null;
  $('gpsMsg').textContent = '';
  if (appVisible()) autoLocate();
  $('formTitle').textContent = 'Tambah kegiatan';
  $('btnCancelEdit').hidden = true;
  $('btnSave').textContent = 'Simpan kegiatan';
  renderPreviews();
  renderList();
}

function startEdit(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  resetForm();
  editingId = id;
  $('fTanggal').value = e.tanggal;
  $('fJam').value = e.jam || '';
  $('fSesi').value = ['Pagi', 'Siang', 'Sore'].includes(e.sesi) ? e.sesi : sesiDariJam(e.jam);
  $('fJudul').value = e.judul || '';
  $('fLokasi').value = e.lokasi || '';
  lokasiAuto = false;
  gps = e.koordinat && Number.isFinite(e.koordinat.lat) ? { ...e.koordinat } : null;
  $('gpsMsg').textContent = gps ? gpsLabel(gps) : '';
  $('fKet').value = e.keterangan || '';
  keptPhotos = (e.foto || []).filter(safePath);
  $('formTitle').textContent = 'Edit kegiatan';
  $('btnCancelEdit').hidden = false;
  $('btnSave').textContent = 'Simpan perubahan';
  renderPreviews();
  renderList();
  $('cardForm').scrollIntoView({ behavior: 'smooth' });
}

$('fJam').addEventListener('change', () => { $('fSesi').value = sesiDariJam($('fJam').value); });
['fTanggal', 'fJam'].forEach(id => $(id).addEventListener('input', () => { timeTouched = true; }));
$('fLokasi').addEventListener('input', () => { lokasiAuto = false; });

// ================= Waktu server =================
let timeTouched = false;   // tanggal/jam diubah manual: jangan ditimpa jam server
let clockTimer = null;

function appVisible() { return !$('app').hidden; }

function fillFormTime() {
  if (editingId || timeTouched) return;
  const w = wibParts();
  $('fTanggal').value = w.tanggal;
  $('fJam').value = w.jam;
  $('fSesi').value = sesiDariJam(w.jam);
}

function renderClock() {
  document.querySelectorAll('.sc-time').forEach(el => { el.textContent = formatWaktuWib(serverNow(), false); });
  $('scNote').textContent = serverSynced ? `${formatTanggal(wibParts().tanggal)} · waktu server` : 'Jam perangkat (server tidak terjangkau)';
  $('serverClock').classList.toggle('unsynced', !serverSynced);
}

function startServerClock() {
  if (clockTimer) return;
  renderClock();
  clockTimer = setInterval(() => {
    renderClock();
    // Ganti menit di formulir baru selama belum diubah manual.
    if (!editingId && !timeTouched && $('fJam').value !== wibParts().jam) fillFormTime();
  }, 1000);
  const sync = () => syncServerTime().then(() => { renderClock(); fillFormTime(); });
  sync();
  setInterval(sync, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}

// ================= Lokasi GPS =================
let gps = null;           // { lat, lng, akurasi } posisi terakhir untuk kegiatan ini
let lokasiAuto = true;    // kolom lokasi masih boleh diisi otomatis
let gpsPromise = null;
const geoCache = [];      // { lat, lng, nama } agar tidak memanggil layanan peta berulang

function gpsLabel(g) {
  return `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}${g.akurasi ? ` · akurasi ±${Math.round(g.akurasi)} m` : ''}`;
}

function distanceM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function placeName(d) {
  const a = d.address || {};
  const parts = [
    d.name || a.amenity || a.office || a.building || a.shop || a.tourism,
    a.road,
    a.village || a.suburb || a.neighbourhood || a.hamlet || a.city_district,
    a.county || a.city || a.town || a.municipality || a.state_district
  ].map(x => String(x || '').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ').slice(0, 160);
}

async function reverseGeocode(lat, lng) {
  const hit = geoCache.find(c => distanceM(c, { lat, lng }) < 40);
  if (hit) return hit.nama;
  let nama = '';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=id`,
      { referrerPolicy: 'origin', credentials: 'omit' });
    if (r.ok) nama = placeName(await r.json());
  } catch { /* coba layanan cadangan */ }
  if (!nama) {
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`, { credentials: 'omit' });
      if (r.ok) {
        const d = await r.json();
        nama = [...new Set([d.locality, d.city, d.principalSubdivision].filter(Boolean))].join(', ');
      }
    } catch { /* tanpa nama tempat */ }
  }
  if (nama) geoCache.push({ lat, lng, nama });
  return nama;
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Perangkat ini tidak mendukung GPS.'));
    navigator.geolocation.getCurrentPosition(resolve, e => reject(new Error(
      e.code === 1 ? 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini di pengaturan browser.'
        : e.code === 3 ? 'GPS terlalu lama merespons. Coba di tempat terbuka lalu tekan tombol GPS lagi.'
        : 'Lokasi tidak bisa ditentukan. Pastikan GPS/lokasi HP menyala.')),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}

// Ambil koordinat, lalu nama tempatnya. Kolom lokasi hanya diisi bila belum diketik sendiri.
function locate() {
  if (gpsPromise) return gpsPromise;
  $('btnGps').classList.add('loading');
  $('gpsMsg').textContent = 'Mencari lokasi GPS…';
  gpsPromise = (async () => {
    const pos = await currentPosition();
    gps = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), akurasi: Math.round(pos.coords.accuracy || 0) };
    $('gpsMsg').textContent = gpsLabel(gps);
    $('hLok').textContent = `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
    const nama = await reverseGeocode(gps.lat, gps.lng);
    gps.nama = nama;
    $('hLok').textContent = `${nama || 'Lokasi GPS'} · ±${gps.akurasi || '?'} m`;
    if (lokasiAuto) {
      $('fLokasi').value = nama || `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
      lokasiAuto = true;
    }
    return gps;
  })().catch(e => { $('gpsMsg').textContent = e.message; $('hLok').textContent = e.message; throw e; })
    .finally(() => { $('btnGps').classList.remove('loading'); gpsPromise = null; });
  return gpsPromise;
}

// Otomatis saat formulir baru dibuka; diam bila izin lokasi pernah ditolak.
async function autoLocate() {
  try {
    const st = navigator.permissions && await navigator.permissions.query({ name: 'geolocation' });
    if (st && st.state === 'denied') { $('gpsMsg').textContent = 'Izin lokasi ditolak; lokasi bisa diketik manual.'; return; }
  } catch { /* browser tanpa Permissions API */ }
  locate().catch(() => {});
}

$('btnGps').addEventListener('click', () => {
  lokasiAuto = true;
  locate().then(() => toast('Lokasi GPS diperbarui.')).catch(e => toast(e.message, true));
});

// ================= Pasang sebagai aplikasi =================
// Setelah dipasang, tekan lama ikon "Laporan Magang" untuk pintasan Kamera/Laporan.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', ev => {
  ev.preventDefault();
  installPrompt = ev;
  $('btnInstall').hidden = false;
});
$('btnInstall').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({}));
  installPrompt = null;
  $('btnInstall').hidden = true;
  if (outcome === 'accepted') toast('Terpasang. Tekan lama ikon Laporan Magang untuk pintasan "Kamera".');
});
window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; });

// ================= Kamera =================
// Cap di bagian bawah foto: waktu server (WIB), nama tempat, dan koordinat GPS.
async function stampPhoto(file, waktu, pos) {
  const img = await decodeImage(file);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.min(1, 2560 / Math.max(iw, ih));
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) img.close();
  const fs = Math.max(14, Math.round(Math.min(w, h) / 30));
  const lines = [
    formatWaktuWib(waktu) + (serverSynced ? '' : ' (jam perangkat)'),
    pos && pos.nama ? pos.nama : $('fLokasi').value.trim(),
    pos ? `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}${pos.akurasi ? `  ±${pos.akurasi} m` : ''}` : ''
  ].filter(Boolean);
  const pad = Math.round(fs * 0.8), lh = Math.round(fs * 1.35);
  const band = pad * 2 + lh * lines.length;
  const grad = ctx.createLinearGradient(0, h - band * 1.4, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.3, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - band * 1.4, w, band * 1.4);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = fs / 4;
  lines.forEach((t, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${i === 0 ? fs : Math.round(fs * 0.85)}px "Plus Jakarta Sans", system-ui, sans-serif`;
    let text = t;
    while (ctx.measureText(text).width > w - pad * 2 && text.length > 4) text = text.slice(0, -2);
    if (text !== t) text = text.slice(0, -1) + '…';
    ctx.fillText(text, pad, h - band + pad + i * lh);
  });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  const w2 = wibParts(waktu);
  return new File([blob], `IMG_${w2.tanggal.replaceAll('-', '')}_${w2.jam.replace(':', '')}${w2.detik}.jpg`, { type: 'image/jpeg' });
}

async function addCameraPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const waktu = serverNow();            // saat foto diterima dari kamera
  if (!timeTouched && !editingId) fillFormTime();
  if (!$('fStamp').checked) return addFiles([file]);
  msg('saveMsg', 'Menambahkan cap waktu & lokasi…');
  let pos = gps;
  if (!pos) {
    try { pos = await Promise.race([locate(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]); } catch { pos = gps; }
  }
  try {
    addFiles([await stampPhoto(file, waktu, pos)]);
  } catch {
    addFiles([file]);
  }
  msg('saveMsg', '');
  $('previews').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.querySelectorAll('input[type="file"][capture]').forEach(inp => inp.addEventListener('change', ev => {
  $('quickCam').classList.remove('pulse');
  const [file] = ev.target.files;
  ev.target.value = '';
  if (document.querySelector('.panel[data-panel="kegiatan"]').hidden) openTab('kegiatan');
  addCameraPhoto(file).catch(e => toast(e.message, true));
}));
$('btnCancelEdit').addEventListener('click', resetForm);

$('formEntry').addEventListener('submit', async ev => {
  ev.preventDefault();
  // Harus dipanggil langsung di dalam klik agar jendela login Google tidak diblokir.
  const driveItems = driveReady() ? newPhotos.filter(p => p.state !== 'gagal') : [];
  const photosForDrive = driveItems.map(p => p.file);
  const drivePromise = photosForDrive.length ? driveAuth() : null;
  if (drivePromise) drivePromise.catch(() => {});
  await withBusy($('btnSave'), async () => {
    const tanggal = $('fTanggal').value;
    const id = editingId || `${tanggal.replaceAll('-', '')}-${Date.now().toString(36)}`;
    const [y, m, d] = tanggal.split('-');
    const stamp = Date.now().toString(36);
    let done = 0;
    // Salin foto asli ke Drive bersamaan dengan unggah ke GitHub, agar status
    // sinkronnya ikut tersimpan di kegiatan dalam satu commit.
    const driveInfo = { tanggal, jam: $('fJam').value, judul: $('fJudul').value.trim() };
    const driveJob = drivePromise
      ? drivePromise.then(() => copyToDrive(photosForDrive, driveInfo)).catch(error => ({ ids: [], error }))
      : null;
    if (newPhotos.some(p => p.state === 'proses')) msg('saveMsg', 'Menyiapkan foto…');
    await Promise.all(newPhotos.map(p => p.prep));
    const ready = newPhotos.filter(p => p.state === 'ok');
    const skipped = newPhotos.filter(p => p.state !== 'ok');
    if (ready.length) msg('saveMsg', `Mengunggah foto 0/${ready.length}…`);
    const results = await mapLimit(ready, UPLOAD_CONCURRENCY, async (p, i) => {
      const sha = await uploadBlob(await blobToBase64(p.blob));
      const thumbSha = p.thumb ? await uploadBlob(await blobToBase64(p.thumb)).catch(() => null) : null;
      msg('saveMsg', `Mengunggah foto ${++done}/${ready.length}…`);
      p.path = `uploads/${y}/${m}/${d}/${id}-${stamp}${i}.jpg`;
      return { path: p.path, sha, thumbPath: thumbSha ? p.path.replace(/\.jpg$/, '-t.jpg') : '', thumbSha };
    });
    const uploaded = results.map(c => c.path);
    const prevEntry = entries.find(x => x.id === id);
    const oldThumbs = (prevEntry && prevEntry.fotoKecil) || {};
    const fileChanges = [
      ...results.map(({ path, sha }) => ({ path, sha })),
      ...results.filter(c => c.thumbSha).map(c => ({ path: c.thumbPath, sha: c.thumbSha })),
      ...removedPhotos.map(path => ({ path, delete: true })),
      ...removedPhotos.map(path => safePath(oldThumbs[path])).filter(Boolean).map(path => ({ path, delete: true }))
    ];
    // Thumbnail per foto: { "uploads/…jpg": "uploads/…-t.jpg" }.
    const fotoKecil = {};
    keptPhotos.forEach(f => { if (safePath(oldThumbs[f])) fotoKecil[f] = oldThumbs[f]; });
    results.forEach(c => { if (c.thumbPath) fotoKecil[c.path] = c.thumbPath; });

    const data = {
      id,
      tanggal,
      jam: $('fJam').value,
      sesi: $('fSesi').value,
      judul: $('fJudul').value.trim(),
      lokasi: $('fLokasi').value.trim(),
      keterangan: $('fKet').value.trim(),
      foto: [...keptPhotos, ...uploaded]
    };
    if (!data.lokasi) delete data.lokasi;
    if (gps) data.koordinat = { lat: gps.lat, lng: gps.lng, ...(gps.akurasi ? { akurasi: gps.akurasi } : {}) };
    // Waktu pencatatan dari server (tidak bisa diatur dari jam HP); dipertahankan saat edit.
    const prev = entries.find(x => x.id === id);
    if (prev && prev.dicatat) data.dicatat = prev.dicatat;
    else if (!prev && serverSynced) data.dicatat = serverNow().toISOString();
    // Status Google Drive per foto: { "uploads/…jpg": "<id file Drive>" }.
    const driveRes = driveJob ? await driveJob : null;
    const fotoDrive = {};
    const oldDrive = (prev && prev.fotoDrive) || {};
    keptPhotos.forEach(f => { if (oldDrive[f]) fotoDrive[f] = oldDrive[f]; });
    if (Object.keys(fotoKecil).length) data.fotoKecil = fotoKecil;
    if (driveRes) driveItems.forEach((p, i) => { if (p.path && driveRes.ids[i]) fotoDrive[p.path] = driveRes.ids[i]; });
    if (Object.keys(fotoDrive).length) data.fotoDrive = fotoDrive;

    msg('saveMsg', 'Menyimpan ke GitHub…');
    const isEdit = Boolean(editingId);
    let latest;
    await commit(`${isEdit ? 'Edit' : 'Tambah'} kegiatan ${tanggal}: ${data.judul}`, async base => {
      latest = await readRepoJSON(DATA_PATH, base, []);
      const idx = latest.findIndex(x => x.id === id);
      if (idx >= 0) latest[idx] = data; else latest.push(data);
      return [...fileChanges, { path: DATA_PATH, content: JSON.stringify(sortEntries(latest), null, 2) + '\n' }];
    });
    entries = latest;
    let driveMsg = '';
    if (driveRes) {
      const ok = driveRes.ids.filter(Boolean).length;
      if (ok === photosForDrive.length) driveMsg = ' Foto juga tersalin ke Google Drive.';
      else {
        toast(`Tersimpan di GitHub, tetapi ${photosForDrive.length - ok} foto gagal disalin ke Google Drive${driveRes.error ? `: ${driveRes.error.message}` : ''}. Gunakan "Sinkronkan foto ke Drive" di tab Keamanan.`, true);
        driveMsg = null;
      }
    }
    const skipMsg = skipped.length ? ` ${skipped.length} foto dilewati karena tidak bisa dibaca.` : '';
    if (driveMsg !== null) toast(`${isEdit ? 'Perubahan' : 'Kegiatan'} tersimpan.${driveMsg}${skipMsg} Menunggu website diperbarui…`, Boolean(skipped.length));
    resetForm();
    renderList();
    autoAi(tanggal);
  }, 'saveMsg');
});

async function deleteEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !confirm(`Hapus kegiatan "${e.judul}" (${formatTanggal(e.tanggal)}) beserta fotonya?`)) return;
  await withBusy(null, async () => {
    msg('saveMsg', 'Menghapus…');
    let latest;
    await commit(`Hapus kegiatan ${e.tanggal}: ${e.judul}`, async base => {
      latest = await readRepoJSON(DATA_PATH, base, []);
      const target = latest.find(x => x.id === id);
      const photos = target ? [...(target.foto || []), ...Object.values(target.fotoKecil || {})].filter(safePath) : [];
      latest = latest.filter(x => x.id !== id);
      return [
        ...photos.map(path => ({ path, delete: true })),
        { path: DATA_PATH, content: JSON.stringify(sortEntries(latest), null, 2) + '\n' }
      ];
    });
    entries = latest;
    if (editingId === id) resetForm();
    toast('Kegiatan dihapus.');
    renderList();
  }, 'saveMsg');
}

function renderList() {
  renderDriveSync();
  renderThumbInfo();
  renderHarianEntries();
  const q = $('listCari').value.trim().toLowerCase();
  const list = sortEntries(entries).filter(e => !q || `${e.judul} ${e.keterangan} ${e.tanggal}`.toLowerCase().includes(q));
  const hari = new Set(entries.map(e => e.tanggal)).size;
  $('listCount').textContent = `${entries.length} kegiatan · ${hari} hari`;
  if (!list.length) {
    $('entryList').innerHTML = `<p class="empty">${entries.length ? 'Tidak ada yang cocok.' : 'Belum ada kegiatan.'}</p>`;
    return;
  }
  let lastDate = '';
  $('entryList').innerHTML = list.map(e => {
    const head = e.tanggal !== lastDate ? `<h3 class="list-date">${esc(formatTanggal(e.tanggal))}</h3>` : '';
    lastDate = e.tanggal;
    const f0 = (e.foto || [])[0];
    const first = rawUrl((e.fotoKecil && e.fotoKecil[f0]) || f0);
    const thumb = first ? `<img src="${esc(first)}" alt="" loading="lazy">` : `<div class="no-thumb">${icon('image')}</div>`;
    const sesi = ['Pagi', 'Siang', 'Sore'].includes(e.sesi) ? e.sesi : sesiDariJam(e.jam);
    return `${head}<div class="list-item${e.id === editingId ? ' editing' : ''}">
      ${thumb}
      <div class="list-info">
        <strong>${esc(e.judul)}</strong>
        <span><span class="sesi sesi-${sesi.toLowerCase()}">${sesi}</span> ${esc(e.jam || '')} · ${(e.foto || []).length} foto</span>
      </div>
      <div class="list-actions">
        <button class="icon-btn" type="button" data-edit="${esc(e.id)}" title="Edit">${icon('edit')}</button>
        <button class="icon-btn danger" type="button" data-del="${esc(e.id)}" title="Hapus">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

$('entryList').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.edit) startEdit(b.dataset.edit);
  if (b.dataset.del) deleteEntry(b.dataset.del);
});
$('listCari').addEventListener('input', renderList);

// ================= Profil & tampilan =================
// Gambar yang bisa diganti dari tab Profil & Tampilan. Tiap slot punya
// kolom di config.json, elemen pratinjau, dan cara pengolahan gambarnya.
const IMAGE_SLOTS = {
  fotoProfil: { label: 'foto profil', box: 'cfgAvatar', input: 'cfgFoto', remove: 'cfgFotoHapus', dir: 'profil/foto', ext: 'jpg',
    opts: { maxSide: 480, square: true, quality: 0.88 }, fallback: () => inisial($('cNama').value) },
  ikonSitus: { label: 'ikon website', box: 'cfgIkon', input: 'cfgIkonFile', remove: 'cfgIkonHapus', dir: 'brand/ikon', ext: 'png',
    opts: { maxSide: 256, square: true, png: true }, fallback: () => icon('file') },
  logoInstansi: { label: 'logo instansi', box: 'cfgLogo', input: 'cfgLogoFile', remove: 'cfgLogoHapus', dir: 'brand/logo', ext: 'png',
    opts: { maxSide: 256, png: true }, fallback: () => esc(inisial($('cInstansi').value)) }
};
const imageState = {};   // key -> { newFile, newUrl, remove }

function resetImageSlots() {
  for (const key of Object.keys(IMAGE_SLOTS)) {
    if (imageState[key] && imageState[key].newUrl) URL.revokeObjectURL(imageState[key].newUrl);
    imageState[key] = { newFile: null, newUrl: '', remove: false };
  }
}
resetImageSlots();

function renderImageSlot(key) {
  const slot = IMAGE_SLOTS[key];
  const st = imageState[key];
  const src = st.newUrl || (!st.remove && rawUrl(CFG && CFG[key]));
  const box = $(slot.box);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    box.replaceChildren(img);
  } else {
    box.innerHTML = slot.fallback();
  }
  $(slot.remove).hidden = !src;
}

function renderImageSlots() { Object.keys(IMAGE_SLOTS).forEach(renderImageSlot); }

for (const [key, slot] of Object.entries(IMAGE_SLOTS)) {
  $(slot.input).addEventListener('change', ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    if (imageState[key].newUrl) URL.revokeObjectURL(imageState[key].newUrl);
    imageState[key] = { newFile: file, newUrl: URL.createObjectURL(file), remove: false };
    renderImageSlot(key);
  });
  $(slot.remove).addEventListener('click', () => {
    if (imageState[key].newUrl) URL.revokeObjectURL(imageState[key].newUrl);
    imageState[key] = { newFile: null, newUrl: '', remove: true };
    renderImageSlot(key);
  });
}

async function loadConfig() {
  try {
    CFG = await readRepoJSON(CONFIG_PATH, S.branch, {});
    if (!CFG || typeof CFG !== 'object' || Array.isArray(CFG)) CFG = {};
    aturHariLibur(CFG.hariLibur);
    aturZona(CFG.zonaWaktu);
    adoptSharedDrive();
    renderScript();
    renderDrive();
    fillConfigForm();
    renderHero(true);
    renderStart();
  } catch (e) {
    toast(`Gagal memuat pengaturan: ${e.message}`, true);
  }
}

function fillConfigForm() {
  const c = CFG || {};
  const f = c.footer || {};
  $('cNama').value = c.nama || '';
  $('cPosisi').value = c.posisi || '';
  $('cDivisi').value = c.divisi || '';
  $('cKotaTtd').value = c.kotaTtd || '';
  $('cZona').value = ZONA_WAKTU[c.zonaWaktu] ? c.zonaWaktu : 'Asia/Jakarta';
  $('cInstansi').value = c.instansi || '';
  $('cProgram').value = c.program || '';
  $('cMulai').value = c.tanggalMulai || '';
  $('cSelesai').value = c.tanggalSelesai || '';
  $('cMentorNama').value = (c.mentor && c.mentor.nama) || '';
  $('cMentorJabatan').value = (c.mentor && c.mentor.jabatan) || '';
  $('cJudul').value = c.judulSitus || '';
  $('cWarna').value = safeColor(c.warnaTema);
  applyTheme(c.warnaTema);
  $('cWarnaText').textContent = $('cWarna').value;
  $('cAdminLink').checked = Boolean(c.tampilkanLinkAdmin);
  $('cFooterTeks').value = f.teks || '';
  const k = f.kredit || {};
  $('cKreditTampil').checked = k.tampil !== undefined ? k.tampil !== false : Boolean(c.portofolio);
  $('cKreditTeks').value = k.teks || '';
  $('cKreditUrl').value = k.url !== undefined ? k.url : (c.portofolio || '');
  renderKreditPreview();
  $('cJudulTautan').value = f.judulTautan || '';
  $('cSections').replaceChildren();
  (f.bagian || []).forEach(b => addRow('cSections', 'tplSection', { '.r-judul': b.judul, '.r-isi': b.isi }));
  $('cLinks').replaceChildren();
  (f.tautan || []).forEach(l => addRow('cLinks', 'tplLink', { '.r-label': l.label, '.r-url': l.url }));
  $('cPortofolio').value = c.portofolio || '';
  $('cLibur').replaceChildren();
  (Array.isArray(c.hariLibur) ? c.hariLibur : []).forEach(h => addRow('cLibur', 'tplLibur', { '.r-tanggal': h.tanggal, '.r-nama': h.nama, '.r-jenis': h.jenis === 'cuti' ? 'cuti' : 'libur' }));
  renderLiburInfo();
  resetImageSlots();
  renderImageSlots();
}

function addRow(listId, tplId, values = {}) {
  const row = $(tplId).content.firstElementChild.cloneNode(true);
  for (const [sel, val] of Object.entries(values)) row.querySelector(sel).value = val || '';
  $(listId).appendChild(row);
  return row;
}

// ---------- Hari libur nasional & cuti bersama ----------
// SKB 3 Menteri: libur nasional & cuti bersama 2026 (Menag 1497/2025) dan
// 2027 (Menag 1205/2026) yang jatuh di masa magang umumnya (Sep 2026–Mar 2027).
const LIBUR_SKB = [
  ['2026-12-24', 'Cuti bersama Hari Raya Natal', 'cuti'],
  ['2026-12-25', 'Hari Raya Natal', 'libur'],
  ['2027-01-01', 'Tahun Baru 2027 Masehi', 'libur'],
  ['2027-01-05', 'Isra Mikraj Nabi Muhammad SAW', 'libur'],
  ['2027-02-05', 'Cuti bersama Tahun Baru Imlek', 'cuti'],
  ['2027-02-06', 'Tahun Baru Imlek 2578 Kongzili', 'libur'],
  ['2027-03-08', 'Hari Suci Nyepi Tahun Baru Saka 1949', 'libur'],
  ['2027-03-09', 'Cuti bersama Idulfitri 1448 H', 'cuti'],
  ['2027-03-10', 'Idulfitri 1448 H', 'libur'],
  ['2027-03-11', 'Idulfitri 1448 H', 'libur'],
  ['2027-03-12', 'Cuti bersama Idulfitri 1448 H', 'cuti'],
  ['2027-03-15', 'Cuti bersama Idulfitri 1448 H', 'cuti']
];

function readLiburForm() {
  const seen = new Set();
  return [...$('cLibur').querySelectorAll('.repeat-row')].map(r => ({
    tanggal: r.querySelector('.r-tanggal').value,
    nama: r.querySelector('.r-nama').value.trim(),
    jenis: r.querySelector('.r-jenis').value === 'cuti' ? 'cuti' : 'libur'
  })).filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.tanggal) && !seen.has(h.tanggal) && seen.add(h.tanggal))
    .map(h => ({ ...h, nama: h.nama || (h.jenis === 'cuti' ? 'Cuti bersama' : 'Libur nasional') }))
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

function renderLiburInfo() {
  const list = readLiburForm();
  const mulai = $('cMulai').value, selesai = $('cSelesai').value;
  const kerja = list.filter(h => !isAkhirPekan(h.tanggal) && (!mulai || h.tanggal >= mulai) && (!selesai || h.tanggal <= selesai)).length;
  $('liburInfo').textContent = list.length
    ? `${list.length} tanggal · ${kerja} jatuh di hari kerja masa magang`
    : 'Belum ada tanggal libur';
}

$('btnAddLibur').addEventListener('click', () => { addRow('cLibur', 'tplLibur').querySelector('input').focus(); renderLiburInfo(); });
$('btnIsiLibur').addEventListener('click', () => {
  const ada = new Set(readLiburForm().map(h => h.tanggal));
  const mulai = $('cMulai').value || '0000', selesai = $('cSelesai').value || '9999';
  let n = 0;
  LIBUR_SKB.filter(([t]) => t >= mulai && t <= selesai && !ada.has(t)).forEach(([t, nama, jenis]) => {
    addRow('cLibur', 'tplLibur', { '.r-tanggal': t, '.r-nama': nama, '.r-jenis': jenis });
    n++;
  });
  const rows = [...$('cLibur').children].sort((a, b) => a.querySelector('.r-tanggal').value.localeCompare(b.querySelector('.r-tanggal').value));
  $('cLibur').append(...rows);
  renderLiburInfo();
  toast(n ? `${n} tanggal libur ditambahkan. Klik "Simpan pengaturan" untuk menerapkan.` : 'Semua tanggal SKB untuk masa magang sudah ada.');
});
$('cLibur').addEventListener('input', renderLiburInfo);
['cMulai', 'cSelesai'].forEach(id => $(id).addEventListener('change', renderLiburInfo));
$('cLibur').addEventListener('change', renderLiburInfo);

['cSections', 'cLinks', 'cLibur'].forEach(id => $(id).addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  const row = b.closest('.repeat-row');
  if (b.hasAttribute('data-remove')) { row.remove(); renderLiburInfo(); }
  if (b.dataset.move === '-1' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  if (b.dataset.move === '1' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
}));
$('btnAddSection').addEventListener('click', () => addRow('cSections', 'tplSection').querySelector('input').focus());
$('btnAddLink').addEventListener('click', () => addRow('cLinks', 'tplLink').querySelector('input').focus());
// Pratinjau warna langsung di panel; pilihan cepat sesuai palet umum.
const SWATCHES = ['#1d4ed8', '#0f766e', '#15803d', '#7c3aed', '#be123c', '#c2410c', '#0f172a'];
$('swatches').innerHTML = SWATCHES.map(c =>
  `<button type="button" class="swatch swatch-${c.slice(1)}" data-color="${c}" title="${c}"></button>`).join('');
$('swatches').addEventListener('click', ev => {
  const b = ev.target.closest('[data-color]');
  if (!b) return;
  $('cWarna').value = b.dataset.color;
  $('cWarna').dispatchEvent(new Event('input'));
});
$('cWarna').addEventListener('input', () => {
  $('cWarnaText').textContent = $('cWarna').value;
  applyTheme($('cWarna').value);
});
$('cNama').addEventListener('input', () => renderImageSlot('fotoProfil'));
$('cInstansi').addEventListener('input', () => renderImageSlot('logoInstansi'));
$('btnResetConfig').addEventListener('click', fillConfigForm);

// Baris kredit di bagian paling bawah website ("Dibuat oleh … · tautan ↗").
function normalUrl(url) {
  const u = String(url || '').trim();
  return u && !/^(https?:\/\/|mailto:)/i.test(u) ? `https://${u}` : u;
}

// Alamat web (https/http dengan nama domain) atau email yang benar-benar bisa dibuka.
function alamatValid(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.pathname);
    return /^https?:$/.test(u.protocol) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname);
  } catch { return false; }
}

function readKredit() {
  const url = normalUrl($('cKreditUrl').value);
  if (url && !alamatValid(url)) throw new Error('Tautan kredit tidak valid. Gunakan alamat https://…');
  return { tampil: $('cKreditTampil').checked, teks: $('cKreditTeks').value.trim(), url };
}

function renderKreditPreview() {
  const on = $('cKreditTampil').checked;
  $('kreditFields').hidden = !on;
  const teks = $('cKreditTeks').value.trim() || `Dibuat oleh ${$('cNama').value.trim() || 'Nama Anda'}`;
  const url = normalUrl($('cKreditUrl').value);
  const host = url.replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
  $('kreditPreview').textContent = on ? `Pratinjau: ${teks}${host ? ` · ${host} ↗` : ''}` : 'Baris kredit disembunyikan.';
}
['cKreditTampil', 'cKreditTeks', 'cKreditUrl', 'cNama'].forEach(id => $(id).addEventListener('input', renderKreditPreview));
$('cKreditTampil').addEventListener('change', renderKreditPreview);

function readConfigForm() {
  const bagian = [...$('cSections').querySelectorAll('.repeat-row')]
    .map(r => ({ judul: r.querySelector('.r-judul').value.trim(), isi: r.querySelector('.r-isi').value.trim() }))
    .filter(b => b.judul || b.isi);
  const tautan = [];
  for (const r of $('cLinks').querySelectorAll('.repeat-row')) {
    const label = r.querySelector('.r-label').value.trim();
    const url = r.querySelector('.r-url').value.trim();
    if (!label && !url) continue;
    if (!safeUrl(url)) throw new Error(`Tautan "${label || url}" tidak valid. Gunakan awalan https://, mailto:, atau tel:.`);
    tautan.push({ label, url });
  }
  const cfg = {
    ...(CFG || {}),
    nama: $('cNama').value.trim(),
    repo: `${S.owner}/${S.repo}`,
    posisi: $('cPosisi').value.trim(),
    divisi: $('cDivisi').value.trim(),
    instansi: $('cInstansi').value.trim(),
    kotaTtd: $('cKotaTtd').value.trim(),
    zonaWaktu: ZONA_WAKTU[$('cZona').value] ? $('cZona').value : 'Asia/Jakarta',
    program: $('cProgram').value.trim(),
    tanggalMulai: $('cMulai').value,
    tanggalSelesai: $('cSelesai').value,
    mentor: { nama: $('cMentorNama').value.trim(), jabatan: $('cMentorJabatan').value.trim() },
    judulSitus: $('cJudul').value.trim(),
    warnaTema: safeColor($('cWarna').value),
    tampilkanLinkAdmin: $('cAdminLink').checked,
    portofolio: $('cPortofolio').value.trim(),
    hariLibur: readLiburForm(),
    footer: {
      teks: $('cFooterTeks').value.trim(),
      kredit: readKredit(),
      judulTautan: $('cJudulTautan').value.trim(),
      bagian,
      tautan
    }
  };
  if (cfg.portofolio && !/^https?:\/\//i.test(cfg.portofolio)) cfg.portofolio = `https://${cfg.portofolio}`;
  if (cfg.portofolio && !safeUrl(cfg.portofolio)) throw new Error('Alamat portofolio tidak valid.');
  if (!cfg.nama) throw new Error('Nama wajib diisi.');
  if (!cfg.tanggalMulai || !cfg.tanggalSelesai || cfg.tanggalSelesai < cfg.tanggalMulai) {
    throw new Error('Tanggal selesai harus sama atau setelah tanggal mulai.');
  }
  return cfg;
}

$('formConfig').addEventListener('submit', async ev => {
  ev.preventDefault();
  await withBusy($('btnSaveConfig'), async () => {
    const cfg = readConfigForm();
    const stamp = Date.now().toString(36);
    const changes = (await Promise.all(Object.entries(IMAGE_SLOTS).map(async ([key, slot]) => {
      const old = safePath(CFG && CFG[key]);
      const st = imageState[key];
      cfg[key] = old;
      if (st.newFile) {
        msg('configMsg', `Memproses ${slot.label}…`);
        const sha = await uploadBlob(await imageToBase64(st.newFile, slot.opts));
        cfg[key] = `uploads/${slot.dir}-${stamp}.${slot.ext}`;
        return old ? [{ path: cfg[key], sha }, { path: old, delete: true }] : [{ path: cfg[key], sha }];
      }
      if (st.remove) {
        cfg[key] = '';
        return old ? [{ path: old, delete: true }] : [];
      }
      return [];
    }))).flat();
    changes.push({ path: CONFIG_PATH, content: JSON.stringify(cfg, null, 2) + '\n' });

    msg('configMsg', 'Menyimpan ke GitHub…');
    await commit('Perbarui profil dan tampilan website', async () => changes);
    CFG = cfg;
    aturHariLibur(CFG.hariLibur);
    aturZona(CFG.zonaWaktu);
    fillConfigForm();
    renderHero(true);
    toast('Pengaturan tersimpan. Menunggu website diperbarui…');
  }, 'configMsg');
});

// ================= Keamanan =================
function renderSecurity() {
  const stored = readStore();
  const rows = [
    ['Repository', `${S.owner}/${S.repo} (branch ${S.branch})`],
    ['Jenis token', TOKEN.startsWith('github_pat_') ? '✅ Fine-grained' : '⚠️ Classic, sebaiknya diganti fine-grained'],
    ['Penyimpanan token', stored ? '✅ Terenkripsi AES-256 dengan kata sandi panel' : '—'],
    ['Sesi', rememberMe ? `Tetap masuk ${REMEMBER_DAYS} hari di perangkat ini (tekan Kunci untuk keluar)` : 'Tetap masuk sampai tab ditutup atau tombol Kunci ditekan']
  ];
  $('secInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

$('formPass').addEventListener('submit', async ev => {
  ev.preventDefault();
  const stored = readStore();
  if (!stored) return;
  if ($('pNew').value.length < 8) return toast('Kata sandi baru minimal 8 karakter.', true);
  if ($('pNew').value !== $('pNew2').value) return toast('Ulangan kata sandi baru tidak sama.', true);
  await withBusy(ev.submitter, async () => {
    const token = await decryptToken(stored.enc, $('pOld').value);
    const next = { ...stored, enc: await encryptToken(token, $('pNew').value) };
    if (stored.aiEnc) next.aiEnc = await encryptToken(await decryptToken(stored.aiEnc, $('pOld').value), $('pNew').value);
    if (stored.groqEnc) next.groqEnc = await encryptToken(await decryptToken(stored.groqEnc, $('pOld').value), $('pNew').value);
    if (stored.scriptEnc) next.scriptEnc = await encryptToken(await decryptToken(stored.scriptEnc, $('pOld').value), $('pNew').value);
    writeStore(next);
    $('formPass').reset();
    toast('Kata sandi panel diganti.');
  });
});

$('btnForget').addEventListener('click', () => {
  if (!confirm('Hapus token dari perangkat ini? Anda perlu memasukkan token lagi untuk memakai panel.')) return;
  clearStore();
  S = { owner: S.owner, repo: S.repo, branch: S.branch };
  lock();
  toast('Token dihapus dari perangkat ini.');
});

// ================= Status penerbitan website =================
// GitHub Pages butuh ±30–60 detik untuk menerbitkan commit baru. Panel memantau
// file data di website ini sampai isinya sama dengan yang baru disimpan.
const pendingDeploy = new Map();   // path -> isi yang diharapkan
let deployTimer = null;
let deployStarted = 0;
let deployHideTimer = null;
let deployTick = null;

function watchDeploy(path, content) {
  pendingDeploy.set(path, content);
  deployStarted = Date.now();
  setDeployStatus('pending');
  clearTimeout(deployTimer);
  deployTimer = setTimeout(checkDeploy, DEPLOY_POLL_MS);
}

async function checkDeploy() {
  for (const [path, content] of pendingDeploy) {
    try {
      const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok && (await res.text()) === content) pendingDeploy.delete(path);
    } catch { /* coba lagi di putaran berikutnya */ }
  }
  if (!pendingDeploy.size) {
    setDeployStatus('done');
    toast('✅ Website sudah diperbarui.');
  } else if (Date.now() - deployStarted > DEPLOY_TIMEOUT_MS) {
    pendingDeploy.clear();
    setDeployStatus('slow');
  } else {
    setDeployStatus('pending');
    deployTimer = setTimeout(checkDeploy, DEPLOY_POLL_MS);
  }
}

function setDeployStatus(state) {
  const el = $('deployStatus');
  const secs = Math.round((Date.now() - deployStarted) / 1000);
  const [ic, cls, text, title] = {
    pending: ['loader', 'spin', `Memperbarui website… ${secs} dtk`, 'GitHub Pages sedang menerbitkan perubahan'],
    done: ['check', '', `Website diperbarui (${secs} dtk)`, 'Buka website'],
    slow: ['alert', '', 'Website belum berubah', 'Sudah lebih dari 5 menit. Cek tab Actions di repository GitHub Anda.']
  }[state];
  el.className = `deploy-status ${state}`;
  el.title = title;
  el.innerHTML = `${icon(ic, cls)}<span>${esc(text)}</span>`;
  el.hidden = false;
  clearTimeout(deployHideTimer);
  if (state === 'pending' && !deployTick) deployTick = setInterval(() => setDeployStatus('pending'), 1000);
  if (state !== 'pending') { clearInterval(deployTick); deployTick = null; }
  if (state === 'done') deployHideTimer = setTimeout(() => { el.hidden = true; }, 15000);
}

// ================= Laporan harian (isian daftar hadir monev) =================
// Setiap sore monev MagangHub meminta tiga isian: ringkasan kegiatan,
// pembelajaran, dan kendala. Gemini menyusunnya dari catatan kegiatan hari
// itu; hasilnya bisa diedit, disalin, dan disimpan ke data/harian.json.
const HARIAN_PATH = 'data/harian.json';
const STATUS_HADIR = ['Hadir', 'Sakit', 'Izin'];
let harian = {};
let AI_KEY = '';    // kunci Gemini, hanya di memori; tersimpan terenkripsi sebagai stored.aiEnc
let GROQ_KEY = '';  // kunci Groq (cadangan), tersimpan terenkripsi sebagai stored.groqEnc
const lastAi = {};  // hasil AI terakhir per tanggal (untuk menandai laporan "auto")
let aiModels = [];  // model Gemini yang tersedia untuk kunci ini

function hasAi() { return Boolean(AI_KEY || GROQ_KEY); }

async function loadHarian() {
  try {
    const data = await readRepoJSON(HARIAN_PATH, S.branch, {});
    harian = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (e) {
    harian = {};
    toast(`Gagal memuat laporan harian: ${e.message}`, true);
  }
  renderHarianList();
}

function dayEntries(date) {
  return entries.filter(e => e.tanggal === date).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
}

function renderHarianForm() {
  const date = $('hTanggal').value;
  const rec = harian[date] || {};
  $('hStatus').value = STATUS_HADIR.includes(rec.status) ? rec.status : 'Hadir';
  $('hKet').value = rec.keterangan || '';
  $('hRingkasan').value = rec.ringkasan || '';
  $('hPembelajaran').value = rec.pembelajaran || '';
  $('hKendala').value = rec.kendala || '';
  toggleKet();
  renderHarianEntries();
  document.querySelectorAll('#harianList [data-date]').forEach(b => b.classList.toggle('editing', b.dataset.date === date));
}

// Hanya daftar kegiatan; isian laporan yang belum disimpan tidak disentuh.
function renderHarianEntries() {
  const items = dayEntries($('hTanggal').value);
  $('hEntries').innerHTML = items.length
    ? items.map(e => `<li><b>${esc(e.jam || '')}</b> ${esc(e.judul)}</li>`).join('')
    : '<li class="muted">Belum ada kegiatan tercatat pada tanggal ini.</li>';
}

function toggleKet() {
  $('hKetWrap').hidden = $('hStatus').value === 'Hadir';
}

function renderHarianList() {
  const dates = Object.keys(harian).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && harian[d] && typeof harian[d] === 'object').sort().reverse();
  $('harianCount').textContent = `${dates.length} hari tersimpan`;
  $('harianList').innerHTML = dates.length ? dates.map(d => {
    const r = harian[d];
    const st = STATUS_HADIR.includes(r.status) ? r.status : 'Hadir';
    return `<button type="button" class="list-item list-btn${d === $('hTanggal').value ? ' editing' : ''}" data-date="${d}">
      <div class="list-info"><strong>${esc(formatTanggal(d))}</strong>
      <span>${esc((r.ringkasan || r.keterangan || '').slice(0, 70))}${(r.ringkasan || '').length > 70 ? '…' : ''}</span></div>
      ${st !== 'Hadir' ? `<span class="pill pill-${st.toLowerCase()}">${st}</span>` : ''}
    </button>`;
  }).join('') : '<p class="empty">Belum ada laporan harian.</p>';
}

$('hTanggal').addEventListener('change', renderHarianForm);
$('hStatus').addEventListener('change', toggleKet);
$('harianList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-date]');
  if (!b) return;
  $('hTanggal').value = b.dataset.date;
  renderHarianForm();
  $('formHarian').scrollIntoView({ behavior: 'smooth' });
});

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-copy]');
  if (!b || !$(b.dataset.copy)) return;
  try {
    await navigator.clipboard.writeText($(b.dataset.copy).value);
    const old = b.textContent;
    b.textContent = 'Tersalin ✓';
    setTimeout(() => { b.textContent = old; }, 1500);
  } catch {
    $(b.dataset.copy).select();
    toast('Tekan Ctrl+C untuk menyalin.', true);
  }
});

function pickModel(models) {
  const flash = models.filter(m => /flash/.test(m) && !/lite|image|tts|audio|live|embed|thinking|exp/.test(m));
  const stable = flash.filter(m => !/preview/.test(m));
  const ver = m => (m.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  const best = list => list.slice().sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0];
  return best(stable) || best(flash) || AI_GEMINI_DEFAULT;
}

async function loadAiModels() {
  aiModels = await listGeminiModels(AI_KEY);
  return aiModels;
}

function currentModel() {
  const stored = readStore();
  return (stored && stored.aiModel) || AI_GEMINI_DEFAULT;
}

// Satu pintu untuk semua permintaan AI: Gemini (beberapa model) lalu Groq.
async function runAi(opts, msgId) {
  const res = await aiGenerate({
    keys: { gemini: AI_KEY, groq: GROQ_KEY },
    geminiModel: currentModel(),
    geminiModels: aiModels,
    onStatus: msgId ? t => msg(msgId, t) : null,
    ...opts
  });
  lastAiModel = `${res.provider} · ${res.model}`;
  return res.data;
}
let lastAiModel = '';

async function generateHarian(date, status = $('hStatus').value, ket = $('hKet').value.trim(), msgId) {
  if (!hasAi()) throw new Error('Kunci API AI belum diatur. Isi di kartu "Asisten AI".');
  if (!dayEntries(date).length && status === 'Hadir') {
    throw new Error('Belum ada kegiatan pada tanggal ini. Tambahkan kegiatan dulu atau ubah status kehadiran.');
  }
  const prompt = buildHarianPrompt({ config: CFG || {}, entries, harian, date, status, ket, tanggalLabel: formatTanggal(date) });
  return cleanHarian(await runAi({ system: AI_SYSTEM, prompt, schema: HARIAN_SCHEMA, temperature: 0.9 }, msgId));
}

$('btnAi').addEventListener('click', async ev => {
  const date = $('hTanggal').value;
  const hasText = ['hRingkasan', 'hPembelajaran', 'hKendala'].some(id => $(id).value.trim());
  if (hasText && !confirm('Isian yang ada akan diganti dengan tulisan baru dari AI. Lanjutkan?')) return;
  await withBusy(ev.currentTarget, async () => {
    msg('aiMsg', 'AI sedang menulis laporan…');
    const out = await generateHarian(date, undefined, undefined, 'aiMsg');
    lastAi[date] = out;
    $('hRingkasan').value = out.ringkasan;
    $('hPembelajaran').value = out.pembelajaran;
    $('hKendala').value = out.kendala;
    toast(`Laporan selesai ditulis (${lastAiModel}). Periksa dulu, lalu klik Simpan laporan.`);
  }, 'aiMsg');
});

$('formHarian').addEventListener('submit', async ev => {
  ev.preventDefault();
  const date = $('hTanggal').value;
  const rec = {
    status: $('hStatus').value,
    keterangan: $('hStatus').value === 'Hadir' ? '' : $('hKet').value.trim(),
    ringkasan: $('hRingkasan').value.trim(),
    pembelajaran: $('hPembelajaran').value.trim(),
    kendala: $('hKendala').value.trim(),
    diperbarui: new Date().toISOString()
  };
  // "auto": tulisan AI yang tidak diubah; boleh ditulis ulang otomatis saat kegiatan bertambah.
  const ai = lastAi[date] || (harian[date] && harian[date].auto ? harian[date] : null);
  rec.auto = Boolean(ai && ['ringkasan', 'pembelajaran', 'kendala'].every(k => (ai[k] || '') === rec[k]));
  if (rec.auto) {
    rec.sumber = sumberHarian(entries, date);
    if (harian[date] && harian[date].model) rec.model = harian[date].model;
    if (lastAiModel && lastAi[date]) rec.model = lastAiModel;
  }
  if (!rec.keterangan) delete rec.keterangan;
  // Lokasi GPS & waktu server saat laporan disimpan (untuk laporan hari ini).
  if (date === wibParts().tanggal && gps) {
    rec.lokasi = gps.nama || `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
    rec.koordinat = { lat: gps.lat, lng: gps.lng, ...(gps.akurasi ? { akurasi: gps.akurasi } : {}) };
  } else if (harian[date]) {
    if (harian[date].lokasi) rec.lokasi = harian[date].lokasi;
    if (harian[date].koordinat) rec.koordinat = harian[date].koordinat;
  }
  if (serverSynced) rec.diperbarui = serverNow().toISOString();
  const empty = rec.status === 'Hadir' && !rec.ringkasan && !rec.pembelajaran && !rec.kendala;
  await withBusy($('btnSaveHarian'), async () => {
    msg('harianMsg', 'Menyimpan ke GitHub…');
    let latest;
    await commit(`Laporan harian ${date}${rec.status !== 'Hadir' ? ` (${rec.status})` : ''}`, async base => {
      latest = await readRepoJSON(HARIAN_PATH, base, {});
      if (!latest || typeof latest !== 'object' || Array.isArray(latest)) latest = {};
      if (empty) delete latest[date]; else latest[date] = rec;
      const sorted = Object.fromEntries(Object.entries(latest).sort(([a], [b]) => b.localeCompare(a)));
      return [{ path: HARIAN_PATH, content: JSON.stringify(sorted, null, 2) + '\n' }];
    });
    harian = latest;
    renderHarianList();
    renderHarianForm();
    toast(empty ? 'Laporan harian dihapus.' : 'Laporan harian tersimpan. Menunggu website diperbarui…');
  }, 'harianMsg');
});

// ---------- Ringkasan otomatis ----------
// Setelah kegiatan disimpan: laporan harian tanggal itu ditulis ulang oleh AI
// (kecuali sudah Anda edit sendiri), lalu ringkasan dasbor diperbarui.
const RINGKASAN_PATH = 'data/ringkasan.json';

async function generateSummary(msgId) {
  const built = buildSummaryPrompt({ config: CFG || {}, entries, harian });
  if (!built) return null;
  const out = cleanSummary(await runAi({ system: SUMMARY_SYSTEM, prompt: built.prompt, schema: SUMMARY_SCHEMA, temperature: 0.8 }, msgId));
  return { diperbarui: new Date().toISOString(), minggu: built.minggu, ...out };
}

// Laporan harian ditulis otomatis, tanpa perlu menekan "Buat dengan AI":
// setelah kegiatan disimpan, saat panel dibuka, dan saat tab Laporan dibuka.
// Hanya hari yang kegiatannya berubah sejak laporan terakhir yang ditulis ulang,
// dan laporan yang sudah Anda edit sendiri tidak pernah ditimpa.
let autoAiRunning = null;
let autoAiFailedAt = 0;

function tanggalPerluAi(dates) {
  return [...new Set(dates)].filter(d => perluLaporanAi(entries, harian, d, (CFG || {}).hariLibur)).sort().reverse();
}

function autoAi(dates, { quiet = false } = {}) {
  dates = Array.isArray(dates) ? dates : [dates];
  if (!hasAi()) return Promise.resolve();
  const prev = autoAiRunning || Promise.resolve();
  autoAiRunning = prev.catch(() => {}).then(() => runAutoAi(dates, quiet));
  return autoAiRunning;
}

async function runAutoAi(dates, quiet) {
  const todo = tanggalPerluAi(dates).slice(0, 5);
  if (!todo.length) return;
  const onForm = () => todo.includes($('hTanggal').value);
  msg('autoAiMsg', '✨ AI sedang menulis laporan harian…');
  if (onForm()) msg('aiMsg', '✨ AI sedang menulis laporan harian otomatis…');
  try {
    const made = {};
    for (const date of todo) {
      const rec = harian[date] || {};
      const report = await generateHarian(date, rec.status || 'Hadir', rec.keterangan || '', onForm() ? 'aiMsg' : 'autoAiMsg');
      lastAi[date] = report;
      made[date] = { ...rec, status: rec.status || 'Hadir', ...report, auto: true, sumber: sumberHarian(entries, date), model: lastAiModel, diperbarui: new Date().toISOString() };
    }
    const summary = await generateSummary().catch(() => null);
    let latestH;
    await commit(`Laporan harian AI ${todo.join(', ')}`, async base => {
      latestH = await readRepoJSON(HARIAN_PATH, base, {});
      if (!latestH || typeof latestH !== 'object' || Array.isArray(latestH)) latestH = {};
      for (const [d, r] of Object.entries(made)) {
        const cur = latestH[d];
        if (!cur || cur.auto !== false) latestH[d] = { ...(cur || {}), ...r };
      }
      const sorted = Object.fromEntries(Object.entries(latestH).sort(([a], [b]) => b.localeCompare(a)));
      const changes = [{ path: HARIAN_PATH, content: JSON.stringify(sorted, null, 2) + '\n' }];
      if (summary) {
        const old = await readRepoJSON(RINGKASAN_PATH, base, {});
        const mingguan = { ...((old && old.mingguan) || {}), [summary.minggu]: summary.mingguIni };
        changes.push({ path: RINGKASAN_PATH, content: JSON.stringify({ ...summary, mingguan }, null, 2) + '\n' });
      }
      return changes;
    });
    harian = latestH;
    renderHarianList();
    if (todo.includes($('hTanggal').value)) renderHarianForm();
    autoAiFailedAt = 0;
    if (!quiet) toast(`✨ Laporan harian ${todo.length > 1 ? `${todo.length} hari ` : ''}siap disalin ke monev (${lastAiModel}).`);
  } catch (e) {
    autoAiFailedAt = Date.now();
    toast(`Laporan AI otomatis belum berhasil: ${e.message}`, true);
  } finally {
    msg('autoAiMsg', '');
    msg('aiMsg', '');
  }
}

// Susul laporan yang belum ada (7 hari terakhir) setiap panel dibuka.
function catchUpAi() {
  if (!hasAi() || repoSalinan() || Date.now() - autoAiFailedAt < 60000) return;
  const today = wibParts().tanggal;
  const recent = [...new Set(entries.map(e => e.tanggal))].filter(d => d <= today).sort().slice(-7);
  if (tanggalPerluAi(recent).length) autoAi(recent, { quiet: false });
}

$('btnSummary').addEventListener('click', async ev => {
  if (!hasAi()) return toast('Atur kunci API AI terlebih dahulu.', true);
  await withBusy(ev.currentTarget, async () => {
    msg('aiMsg', 'AI sedang menyusun ringkasan dasbor…');
    const summary = await generateSummary('aiMsg');
    if (!summary) throw new Error('Belum ada kegiatan untuk diringkas.');
    await commit('Ringkasan AI dasbor', async base => {
      const old = await readRepoJSON(RINGKASAN_PATH, base, {});
      const mingguan = { ...((old && old.mingguan) || {}), [summary.minggu]: summary.mingguIni };
      return [{ path: RINGKASAN_PATH, content: JSON.stringify({ ...summary, mingguan }, null, 2) + '\n' }];
    });
    toast('Ringkasan dasbor diperbarui.');
  }, 'aiMsg');
});

// ---------- Pengaturan kunci API (Gemini + Groq) ----------
function renderAi() {
  const stored = readStore() || {};
  const has = Boolean(stored.aiEnc || stored.groqEnc);
  const aktif = [AI_KEY && `Gemini (${currentModel()})`, GROQ_KEY && 'Groq'].filter(Boolean);
  $('aiStatus').textContent = aktif.length ? `Aktif · ${aktif.join(' + ')}` : has ? 'Tersimpan (buka ulang panel untuk memakai)' : 'Belum diatur';
  $('aiHasGemini').textContent = stored.aiEnc ? '· tersimpan ✓' : '';
  $('aiHasGroq').textContent = stored.groqEnc ? '· tersimpan ✓' : '';
  $('btnAiForget').hidden = !has;
  $('aiModelWrap').hidden = !AI_KEY;
  const list = aiModels.length ? aiModels.slice() : [currentModel()];
  if (!list.includes(currentModel())) list.unshift(currentModel());
  $('aiModel').innerHTML = list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('aiModel').value = currentModel();
  $('aiKey').value = '';
  $('groqKey').value = '';
  $('aiPass').value = '';
}

// Setelah panel terbuka: ambil daftar model; bila model tersimpan tidak ada lagi, pilih ulang.
async function refreshAiModels() {
  if (!AI_KEY) return;
  try {
    const models = await loadAiModels();
    const stored = readStore();
    if (stored && (!stored.aiModel || !models.includes(stored.aiModel))) writeStore({ ...stored, aiModel: pickModel(models) });
  } catch { /* kunci salah/offline: tetap pakai model tersimpan */ }
  renderAi();
}

$('aiModel').addEventListener('change', () => {
  const stored = readStore();
  if (stored) writeStore({ ...stored, aiModel: $('aiModel').value });
  renderAi();
  toast(`Model AI diganti ke ${$('aiModel').value}.`);
});

// Bersihkan hasil tempel di HP: spasi, baris baru, karakter tak terlihat, tanda kutip,
// atau teks seperti "GEMINI_API_KEY=AIza…". Keabsahan kunci tetap diuji langsung ke Google.
function cleanApiKey(raw) {
  const s = String(raw || '').replace(/[\s\u00A0\u180E\u200B-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/g, '');
  const m = s.match(/AIza[\w-]{20,}/) || s.match(/gsk_\w{20,}/) || s.match(/[\w.-]{20,}/g)?.sort((a, b) => b.length - a.length);
  return m ? m[0] : s.replace(/^['"`]+|['"`]+$/g, '');
}

$('formAi').addEventListener('submit', async ev => {
  ev.preventDefault();
  const gem = cleanApiKey($('aiKey').value);
  const groq = cleanApiKey($('groqKey').value);
  const pass = $('aiPass').value;
  if (!gem && !groq) return toast('Tempel kunci API Gemini atau Groq terlebih dahulu.', true);
  for (const [raw, k] of [[$('aiKey').value, gem], [$('groqKey').value, groq]]) {
    if (k && pass && [k, raw.trim()].includes(pass)) {
      $('aiKey').value = ''; $('groqKey').value = '';
      return toast('Kolom kunci terisi kata sandi panel (isi otomatis browser). Tempel kunci API dari Google AI Studio / Groq.', true);
    }
    if (k && k.length < 20) return toast(`Kunci terlalu pendek (${k.length} karakter). Salin ulang seluruh kunci.`, true);
  }
  const stored = readStore();
  if (!stored) return;
  await withBusy(ev.submitter, async () => {
    await decryptToken(stored.enc, pass);   // memastikan kata sandi panel benar
    const next = { ...stored };
    const saved = [];
    if (gem) {
      let models;
      try {
        models = await listGeminiModels(gem);              // sekaligus menguji kunci
      } catch (e) {
        throw new Error(`Gemini: ${e.message} (kunci terbaca ${gem.length} karakter, diawali "${gem.slice(0, 4)}…")`);
      }
      AI_KEY = gem;
      aiModels = models;
      next.aiEnc = await encryptToken(gem, pass);
      next.aiModel = pickModel(models);
      saved.push(`Gemini (${next.aiModel})`);
    }
    if (groq) {
      try {
        await listGroqModels(groq);
      } catch (e) {
        throw new Error(`Groq: ${e.message} (kunci terbaca ${groq.length} karakter, diawali "${groq.slice(0, 4)}…")`);
      }
      GROQ_KEY = groq;
      next.groqEnc = await encryptToken(groq, pass);
      saved.push('Groq');
    }
    writeStore(next);
    saveSession();
    renderAi();
    toast(`Kunci ${saved.join(' dan ')} tersimpan terenkripsi.`);
    catchUpAi();
  });
});

$('btnAiForget').addEventListener('click', () => {
  if (!confirm('Hapus semua kunci API AI (Gemini dan Groq) dari perangkat ini?')) return;
  const stored = readStore();
  if (stored) { delete stored.aiEnc; delete stored.aiModel; delete stored.groqEnc; writeStore(stored); }
  AI_KEY = '';
  GROQ_KEY = '';
  aiModels = [];
  saveSession();
  renderAi();
  toast('Kunci API AI dihapus dari perangkat ini.');
});

// ================= Google Drive (salinan foto) =================
// Login lewat Google Identity Services (tanpa server). Izin drive.file hanya
// memberi akses ke file/folder yang dibuat panel ini, bukan seluruh Drive.
const DRIVE_KEY = scoped('laporanmagang.drive');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT = 'Laporan Magang';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
let driveCfg = readDriveCfg();
let driveToken = null;
let driveTokenExp = 0;
let gisLoading = null;
const driveFolders = {};

function readDriveCfg() {
  try { return JSON.parse(localStorage.getItem(DRIVE_KEY)) || {}; } catch { return {}; }
}

function driveReady() {
  if (scriptMode()) return driveCfg.enabled !== false;
  return Boolean(driveCfg.enabled && driveCfg.clientId);
}

function driveConfigured() {
  return scriptMode() || Boolean(driveCfg.clientId);
}

// Izin Drive: Apps Script tidak butuh login; cara lama memakai token Google.
// Harus dipanggil sinkron di dalam klik (jendela login tidak diblokir).
function driveAuth() {
  return scriptMode() ? Promise.resolve() : ensureDriveToken();
}

// ================= Apps Script (Drive tanpa login) =================
let SCRIPT_KEY = '';   // kunci rahasia skrip, hanya di memori; tersimpan terenkripsi
const SCRIPT_PENDING = scoped('laporanmagang.skrip.baru');
const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
let scriptTemplate = '';
let scriptEmail = '';

function scriptUrl() {
  if (repoSalinan()) return '';
  const shared = CFG && CFG.drive && CFG.drive.skrip && CFG.drive.skrip.url;
  return SCRIPT_URL_RE.test(shared || '') ? shared : '';
}

function scriptMode() {
  return Boolean(scriptUrl() && SCRIPT_KEY);
}

function newScriptKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pendingScriptKey() {
  try {
    let k = localStorage.getItem(SCRIPT_PENDING);
    if (!k) { k = newScriptKey(); localStorage.setItem(SCRIPT_PENDING, k); }
    return k;
  } catch { return newScriptKey(); }
}

async function skrip(aksi, data = {}, { url = scriptUrl(), key = SCRIPT_KEY } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // tanpa preflight CORS
      body: JSON.stringify({ kunci: key, aksi, ...data }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
  } catch {
    // Biasanya karena Google membalas halaman login/izin (bukan data) sehingga diblokir browser.
    throw new Error('Apps Script tidak bisa dibaca. Periksa di script.google.com: Deploy → Kelola deployment → edit → "Yang memiliki akses: Siapa saja" (bukan "…Akun Google"), Versi baru → Deploy, lalu izinkan akses. Ketuk "Cek URL": harus muncul pesan "aktif".');
  }
  let out;
  try { out = await res.json(); } catch {
    throw new Error(`Apps Script membalas ${res.status} tanpa data. Pastikan deployment "Aplikasi web" dengan akses "Siapa saja".`);
  }
  if (!out || !out.ok) throw new Error(`Apps Script: ${(out && out.error) || 'gagal'}`);
  return out;
}

async function loadScriptTemplate() {
  if (scriptTemplate) return scriptTemplate;
  const res = await fetch(`apps-script/LaporanMagang.gs?v=${APP_VERSION}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Kode skrip tidak bisa dimuat.');
  scriptTemplate = await res.text();
  return scriptTemplate;
}

function scriptCodeFor(key) {
  // Kunci selalu base64url; karakter lain dibuang agar kode skrip tidak rusak.
  return scriptTemplate.replace('__KUNCI_RAHASIA__', () => String(key || '').replace(/[^A-Za-z0-9_-]/g, ''));
}

async function renderScript() {
  const url = scriptUrl();
  $('scriptStatus').textContent = scriptMode() ? `Aktif${scriptEmail ? ` · ${scriptEmail}` : ''} · tanpa login`
    : url ? 'Kunci belum ada di perangkat ini' : 'Belum diatur';
  $('btnScriptForget').hidden = !url;
  if (document.activeElement !== $('dScriptUrl')) $('dScriptUrl').value = url;
  if (document.activeElement !== $('dScriptKey')) $('dScriptKey').value = SCRIPT_KEY || pendingScriptKey();
  $('dScriptPass').value = '';
  try {
    await loadScriptTemplate();
    $('scriptCode').textContent = scriptCodeFor($('dScriptKey').value.trim());
  } catch (e) { $('scriptCode').textContent = e.message; }
}

$('dScriptKey').addEventListener('input', () => {
  if (scriptTemplate) $('scriptCode').textContent = scriptCodeFor($('dScriptKey').value.trim());
});

$('btnScriptKeyCopy').addEventListener('click', async () => {
  const key = $('dScriptKey').value.trim();
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    toast('Kunci rahasia disalin. Tempel di kartu yang sama pada perangkat lain, jangan dibagikan ke orang lain.');
  } catch {
    toast('Salin manual: tekan lama pada kolom kunci.', true);
  }
});

$('btnScriptCheck').addEventListener('click', () => {
  const url = $('dScriptUrl').value.trim();
  if (!SCRIPT_URL_RE.test(url)) return toast('Isi URL aplikasi web (berakhiran /exec) terlebih dahulu.', true);
  window.open(url, '_blank', 'noopener');
  toast('Di tab baru harus muncul {"ok":true,"pesan":"Penerima foto Laporan Magang aktif."}. Bila muncul halaman login/izin, perbaiki akses deployment.');
});

$('btnScriptCopy').addEventListener('click', async () => {
  try {
    await loadScriptTemplate();
    const key = $('dScriptKey').value.trim() || pendingScriptKey();
    await navigator.clipboard.writeText(scriptCodeFor(key));
    toast('Kode skrip tersalin (kunci rahasia sudah di dalamnya). Tempel di script.google.com.');
  } catch {
    $('scriptCode').closest('details').open = true;
    toast('Salin manual: buka "Lihat kode skrip", tekan lama lalu Pilih semua → Salin.', true);
  }
});

$('btnScriptNewKey').addEventListener('click', () => {
  if (scriptMode() && !confirm('Kunci baru membuat skrip yang sudah terpasang berhenti bekerja sampai kodenya diganti dan di-deploy ulang. Lanjutkan?')) return;
  const k = newScriptKey();
  try { localStorage.setItem(SCRIPT_PENDING, k); } catch { /* abaikan */ }
  $('dScriptKey').value = k;
  if (scriptTemplate) $('scriptCode').textContent = scriptCodeFor(k);
  toast('Kunci baru dibuat. Salin kode skrip lalu pasang/perbarui di script.google.com.');
});

$('formScript').addEventListener('submit', async ev => {
  ev.preventDefault();
  const url = $('dScriptUrl').value.trim();
  const key = $('dScriptKey').value.trim();
  const pass = $('dScriptPass').value;
  if (!SCRIPT_URL_RE.test(url)) return toast('URL tidak valid. Harus berbentuk https://script.google.com/macros/s/…/exec', true);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) return toast('Kunci rahasia tidak valid. Salin dari perangkat pertama atau buat kunci baru.', true);
  const stored = readStore();
  if (!stored) return;
  await withBusy(ev.submitter, async () => {
    await decryptToken(stored.enc, pass);   // memastikan kata sandi panel benar
    msg('scriptMsg', 'Menguji skrip…');
    const ping = await skrip('ping', {}, { url, key });
    scriptEmail = ping.email || '';
    SCRIPT_KEY = key;
    writeStore({ ...readStore(), scriptEnc: await encryptToken(key, pass) });
    saveSession();
    let latest;
    // Hanya URL yang disimpan di repo (publik). Kunci rahasia tetap di perangkat;
    // perangkat lain menyalinnya lewat tombol "Salin kunci" di perangkat pertama.
    await commit('Atur Google Drive lewat Apps Script', async base => {
      latest = await readRepoJSON(CONFIG_PATH, base, {});
      latest.drive = { ...(latest.drive || {}), skrip: { url } };
      return [{ path: CONFIG_PATH, content: JSON.stringify(latest, null, 2) + '\n' }];
    });
    CFG = { ...CFG, drive: latest.drive };
    driveCfg = { ...driveCfg, enabled: true };
    try { localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg)); localStorage.removeItem(SCRIPT_PENDING); } catch { /* abaikan */ }
    renderScript();
    renderDrive();
    toast(`✅ Terhubung ke Google Drive${scriptEmail ? ` (${scriptEmail})` : ''} tanpa login. Foto akan tersalin otomatis.`);
  }, 'scriptMsg');
});

$('btnScriptForget').addEventListener('click', () => {
  if (!confirm('Hapus pengaturan Apps Script dari website dan perangkat ini?')) return;
  withBusy($('btnScriptForget'), async () => {
    let latest;
    await commit('Hapus pengaturan Apps Script', async base => {
      latest = await readRepoJSON(CONFIG_PATH, base, {});
      if (latest.drive) delete latest.drive.skrip;
      return [{ path: CONFIG_PATH, content: JSON.stringify(latest, null, 2) + '\n' }];
    });
    CFG = { ...CFG, drive: latest.drive };
    SCRIPT_KEY = '';
    const st = readStore();
    if (st) { delete st.scriptEnc; writeStore(st); }
    saveSession();
    renderScript();
    renderDrive();
    toast('Pengaturan Apps Script dihapus.');
  });
});

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.onload = resolve;
      sc.onerror = () => { gisLoading = null; reject(new Error('Gagal memuat layanan login Google.')); };
      document.head.appendChild(sc);
    });
  }
  return gisLoading;
}

// Token Google (berlaku ±1 jam) disimpan terenkripsi dengan kunci perangkat,
// sehingga tidak perlu login ulang setiap halaman dimuat ulang. Google tidak
// memberi token jangka panjang untuk aplikasi tanpa server; setelah habis,
// panel meminta token baru tanpa memilih akun lagi (jendela menutup sendiri).
const DRIVE_TOKEN_KEY = scoped('laporanmagang.drivetoken');

async function saveDriveToken() {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = te.encode(JSON.stringify({ t: driveToken, exp: driveTokenExp, cid: driveCfg.clientId }));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), body));
    localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({ iv: toB64(iv), data: toB64(data) }));
  } catch { /* tanpa penyimpanan: cukup di memori */ }
}

async function loadDriveToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_KEY);
    if (!raw) return;
    const { iv, data } = JSON.parse(raw);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await deviceKey(), fromB64(data));
    const tok = JSON.parse(td.decode(plain));
    if (tok.cid === driveCfg.clientId && tok.exp > Date.now() + 60000) {
      driveToken = tok.t;
      driveTokenExp = tok.exp;
    } else {
      clearDriveToken();
    }
  } catch { clearDriveToken(); }
}

function clearDriveToken() {
  driveToken = null;
  driveTokenExp = 0;
  try { localStorage.removeItem(DRIVE_TOKEN_KEY); } catch { /* abaikan */ }
}

// Dipanggil sinkron dari event klik; jendela login hanya muncul bila token habis.
function ensureDriveToken() {
  if (driveToken && Date.now() < driveTokenExp - 60000) return Promise.resolve(driveToken);
  if (!(window.google && google.accounts && google.accounts.oauth2)) {
    loadGis().catch(() => {});
    return Promise.reject(new Error('Layanan Google belum termuat. Coba simpan sekali lagi.'));
  }
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: driveCfg.clientId,
      scope: DRIVE_SCOPE,
      // Akun yang pernah dipakai: langsung dipilih tanpa layar pilih akun/izin.
      ...(driveCfg.email ? { login_hint: driveCfg.email, hint: driveCfg.email, prompt: '' } : {}),
      callback: r => {
        if (r.error) return reject(new Error(`Google menolak: ${r.error}`));
        driveToken = r.access_token;
        driveTokenExp = Date.now() + Number(r.expires_in || 3600) * 1000;
        saveDriveToken();
        if (!driveCfg.email) rememberDriveAccount();
        resolve(driveToken);
      },
      error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'Jendela login Google ditutup.'
        : e && e.type === 'popup_failed_to_open' ? 'Jendela login Google diblokir browser. Izinkan pop-up untuk situs ini.'
        : `Login Google gagal (${(e && e.type) || 'tidak diketahui'}).`))
    });
    client.requestAccessToken(driveCfg.email ? { prompt: '', login_hint: driveCfg.email } : {});
  });
}

// Simpan alamat akun Google (hanya di perangkat ini) sebagai petunjuk login berikutnya.
async function rememberDriveAccount() {
  try {
    const about = await gdrive('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    const email = about.user && about.user.emailAddress;
    if (email) {
      driveCfg = { ...driveCfg, email };
      localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg));
    }
  } catch { /* tidak wajib */ }
}

async function gdrive(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${driveToken}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    let m = res.statusText;
    try { m = (await res.json()).error.message || m; } catch { /* abaikan */ }
    if (res.status === 401) clearDriveToken();
    throw new Error(`Google Drive ${res.status}: ${m}`);
  }
  return res.json();
}

async function driveFolder(name, parent = 'root') {
  const key = `${parent}/${name}`;
  if (driveFolders[key]) return driveFolders[key];
  const q = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent}' in parents`;
  const found = await gdrive(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
  const id = found.files.length ? found.files[0].id : (await gdrive(`${DRIVE_API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
  })).id;
  driveFolders[key] = id;
  return id;
}

function driveFileName(entry, file, i) {
  const ext = (file.name.match(/\.[A-Za-z0-9]{1,5}$/) || ['.jpg'])[0].toLowerCase();
  const title = entry.judul.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${(entry.jam || '').replace(':', '.')} ${title} (${i + 1})${ext}`.trim();
}

// Salin foto asli (bukan versi yang diperkecil) ke Laporan Magang/<tanggal>.
// Lewat Apps Script: foto asli dikirim (base64) dan disimpan skrip ke Drive.
async function copyViaScript(files, entry, msgId, nums) {
  let done = 0;
  let lastErr = null;
  const ids = await mapLimit(files, 2, async (file, i) => {
    try {
      const res = await skrip('unggah', {
        tanggal: entry.tanggal,
        nama: driveFileName(entry, file, nums ? nums[i] - 1 : i),
        mime: file.type || 'image/jpeg',
        data: await blobToBase64(file)
      });
      msg(msgId, `Menyalin ke Google Drive ${++done}/${files.length}…`);
      return res.id || null;
    } catch (e) {
      lastErr = e;
      return null;
    }
  });
  if (!ids.some(Boolean) && lastErr) throw lastErr;
  return { ids, error: lastErr };
}

// Hasil: ID file Drive per foto (null bila foto itu gagal disalin).
async function copyToDrive(files, entry, msgId = 'saveMsg', nums = null) {
  if (scriptMode()) return copyViaScript(files, entry, msgId, nums);
  const root = await driveFolder(DRIVE_ROOT);
  const day = await driveFolder(entry.tanggal, root);
  let done = 0;
  let lastErr = null;
  const ids = await mapLimit(files, UPLOAD_CONCURRENCY, async (file, i) => {
    try {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: driveFileName(entry, file, nums ? nums[i] - 1 : i), parents: [day] })], { type: 'application/json' }));
      form.append('file', file);
      const res = await gdrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
      msg(msgId, `Menyalin ke Google Drive ${++done}/${files.length}…`);
      return res.id || null;
    } catch (e) {
      lastErr = e;
      return null;
    }
  });
  if (!ids.some(Boolean) && lastErr) throw lastErr;
  return { ids, error: lastErr };
}

// ---------- Indikator penyimpanan (GitHub & Google Drive) ----------
const GB = 1024 ** 3;
let storageAt = 0;

function formatBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= GB) return `${(n / GB).toFixed(2).replace('.', ',')} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function setMeter(id, used, limit) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const bar = $(id);
  bar.querySelector('span').style.width = `${Math.max(pct, used ? 0.6 : 0)}%`;
  bar.classList.toggle('warn', pct >= 70 && pct < 90);
  bar.classList.toggle('danger', pct >= 90);
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  return pct;
}

function pctText(used, limit) {
  const p = (used / limit) * 100;
  return p < 0.1 ? '<0,1%' : `${p.toFixed(p < 10 ? 1 : 0).replace('.', ',')}%`;
}

// Website = semua file di branch saat ini (dari git tree); repository = angka GitHub
// (termasuk riwayat). Perkiraan akhir magang dari rata-rata per hari kerja.
async function loadStorage(force = false) {
  if (!TOKEN || (!force && Date.now() - storageAt < 5 * 60 * 1000)) return;
  storageAt = Date.now();
  $('storageUpdated').textContent = 'Memeriksa…';
  try {
    const [tree, repo] = await Promise.all([gh(`/git/trees/${encodeURIComponent(S.branch)}?recursive=1`), gh('')]);
    const blobs = (tree.tree || []).filter(t => t.type === 'blob');
    const sum = list => list.reduce((n, t) => n + (t.size || 0), 0);
    const isThumb = t => /^uploads\/.*-t\.jpg$/.test(t.path);
    const photos = blobs.filter(t => /^uploads\/\d{4}\//.test(t.path) && !isThumb(t));
    const site = sum(blobs);
    const fotoBytes = sum(photos), kecilBytes = sum(blobs.filter(isThumb));
    setMeter('stSiteBar', site, GB);
    $('stSiteText').textContent = `${formatBytes(site)} dari 1 GB · ${pctText(site, GB)}`;
    $('stSiteDetail').textContent = `${photos.length} foto (${formatBytes(fotoBytes)}) · foto kecil ${formatBytes(kecilBytes)} · halaman & data ${formatBytes(site - fotoBytes - kecilBytes)}${tree.truncated ? ' · daftar file terpotong, angka perkiraan' : ''}`;
    const repoBytes = (repo.size || 0) * 1024;
    setMeter('stRepoBar', repoBytes, GB);
    $('stRepoText').textContent = `${formatBytes(repoBytes)} dari 1 GB · ${pctText(repoBytes, GB)}`;

    // Perkiraan: rata-rata ukuran foto per hari kerja yang sudah lewat.
    const c = CFG || {};
    const today = wibParts().tanggal;
    if (c.tanggalMulai && c.tanggalSelesai && today >= c.tanggalMulai) {
      const lewat = Math.max(1, hitungHariKerja(c.tanggalMulai, today < c.tanggalSelesai ? today : c.tanggalSelesai));
      const sisa = today < c.tanggalSelesai ? hitungHariKerja(today, c.tanggalSelesai) - (isHariKerja(today) ? 1 : 0) : 0;
      const perHari = (fotoBytes + kecilBytes) / lewat;
      const akhir = site + perHari * Math.max(0, sisa);
      $('stForecast').hidden = false;
      $('stForecast').textContent = `Rata-rata ${formatBytes(perHari)} foto per hari kerja. Dengan kecepatan ini, website diperkirakan ±${formatBytes(akhir)} di akhir magang (${pctText(akhir, GB)} dari 1 GB)${akhir > 0.8 * GB ? ' — mendekati batas, pertimbangkan mengurangi jumlah foto per kegiatan.' : ' — aman.'}`;
    }
    $('storageUpdated').textContent = `Diperiksa ${formatWaktuWib(serverNow(), false)}`;
  } catch (e) {
    storageAt = 0;
    $('storageUpdated').textContent = `Gagal memeriksa: ${e.message}`;
  }
  if (scriptMode()) {
    $('btnStorageDrive').hidden = true;
    loadDriveStorage().catch(e => { $('stDriveDetail').textContent = e.message; });
  } else if (!driveCfg.clientId) {
    $('stDriveText').textContent = 'Belum diatur';
    $('stDriveDetail').textContent = 'Atur Google Drive di kartu "Salinan ke Google Drive" untuk melihat kuotanya.';
    $('btnStorageDrive').hidden = true;
  } else if (driveToken && Date.now() < driveTokenExp - 60000) {
    loadDriveStorage().catch(() => {});
  } else {
    $('btnStorageDrive').hidden = false;
  }
}

// Kuota akun Google (Drive + Gmail + Foto) dan ukuran file yang dibuat panel ini.
async function loadDriveStorage() {
  if (scriptMode()) {
    const st = await skrip('statistik');
    showDriveStorage(Number(st.terpakai || 0), Number(st.batas || 0), Number(st.folderBytes || 0), Number(st.jumlah || 0));
    return;
  }
  const about = await gdrive('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
  const q = about.storageQuota || {};
  const used = Number(q.usage || 0), limit = Number(q.limit || 0);
  let folderBytes = 0, count = 0, page = '';
  do {
    const r = await gdrive(`${DRIVE_API}?q=${encodeURIComponent("trashed = false and mimeType != 'application/vnd.google-apps.folder'")}&fields=nextPageToken,files(size)&pageSize=1000&spaces=drive${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    (r.files || []).forEach(f => { folderBytes += Number(f.size || 0); count++; });
    page = r.nextPageToken || '';
  } while (page);
  showDriveStorage(used, limit, folderBytes, count);
}

function showDriveStorage(used, limit, folderBytes, count) {
  if (limit) {
    setMeter('stDriveBar', used, limit);
    $('stDriveText').textContent = `${formatBytes(used)} dari ${formatBytes(limit)} · ${pctText(used, limit)}`;
  } else {
    setMeter('stDriveBar', 0, 1);
    $('stDriveText').textContent = `${formatBytes(used)} · tanpa batas`;
  }
  $('stDriveDetail').textContent = `Folder Laporan Magang: ${count} foto, ${formatBytes(folderBytes)}. Kuota akun dipakai bersama Gmail dan Google Foto.`;
  $('btnStorageDrive').hidden = true;
}

$('btnStorage').addEventListener('click', () => loadStorage(true));
$('btnStorageDrive').addEventListener('click', ev => {
  if (!driveConfigured()) return toast('Atur Google Drive terlebih dahulu (kartu Google Drive di bawah).', true);
  const tokenPromise = driveAuth();   // sinkron di dalam klik agar pop-up tidak diblokir
  tokenPromise.catch(() => {});
  withBusy(ev.currentTarget, async () => {
    await tokenPromise;
    await loadDriveStorage();
  });
});

// ---------- Foto kecil (thumbnail) untuk foto lama ----------
function photosWithoutThumb() {
  return entries.flatMap(e => (e.foto || []).filter(safePath)
    .filter(f => !(e.fotoKecil && safePath(e.fotoKecil[f])))
    .map(f => ({ entry: e, path: f })));
}

function renderThumbInfo() {
  const total = entries.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
  const todo = photosWithoutThumb().length;
  $('thumbInfo').textContent = !total ? 'Belum ada foto' : todo ? `${todo} dari ${total} foto belum punya versi kecil` : `Semua ${total} foto sudah dioptimalkan`;
  $('btnThumbs').hidden = !todo;
}

$('btnThumbs').addEventListener('click', ev => withBusy(ev.currentTarget, async () => {
  const todo = photosWithoutThumb();
  const made = [];   // { id, path, thumbPath, sha }
  let done = 0;
  await mapLimit(todo, 2, async ({ entry, path }) => {
    try {
      const small = await shrinkPhoto(await fetchPhoto(path), { maxSide: 480, quality: 0.72 });
      const sha = await uploadBlob(await blobToBase64(small));
      made.push({ id: entry.id, path, thumbPath: path.replace(/\.[a-z0-9]+$/i, '-t.jpg'), sha });
    } catch { /* lewati foto yang gagal */ }
    msg('thumbMsg', `Memproses ${++done}/${todo.length} foto…`);
  });
  if (made.length) {
    let latest;
    await commit(`Optimasi ${made.length} foto (versi kecil)`, async base => {
      latest = await readRepoJSON(DATA_PATH, base, []);
      latest.forEach(e => made.filter(m => m.id === e.id && (e.foto || []).includes(m.path))
        .forEach(m => { e.fotoKecil = { ...(e.fotoKecil || {}), [m.path]: m.thumbPath }; }));
      return [...made.map(m => ({ path: m.thumbPath, sha: m.sha })), { path: DATA_PATH, content: JSON.stringify(sortEntries(latest), null, 2) + '\n' }];
    });
    entries = latest;
    renderList();
  }
  renderThumbInfo();
  toast(made.length === todo.length ? `✅ ${made.length} foto dioptimalkan.` : `${made.length} foto dioptimalkan, ${todo.length - made.length} gagal. Coba lagi nanti.`, made.length !== todo.length);
}, 'thumbMsg'));

// ---------- Sinkronkan foto lama ke Drive ----------
function unsyncedPhotos() {
  return entries.flatMap(e => (e.foto || []).filter(safePath)
    .filter(f => !(e.fotoDrive && e.fotoDrive[f]))
    .map(f => ({ entry: e, path: f })));
}

function renderDriveSync() {
  const total = entries.reduce((n, e) => n + (e.foto || []).filter(safePath).length, 0);
  const todo = unsyncedPhotos().length;
  $('driveSyncBox').hidden = !driveConfigured() || !total;
  $('driveSyncInfo').textContent = todo
    ? `${total - todo} dari ${total} foto sudah ada di Google Drive. ${todo} foto belum tersinkron.`
    : `Semua ${total} foto sudah tersinkron ke Google Drive.`;
  $('btnDriveSync').hidden = !todo;
}

// Foto diambil dari GitHub (versi yang sudah diperkecil), lalu diunggah ke Drive.
async function fetchPhoto(path) {
  for (const url of [path, rawUrl(path)]) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return new File([await res.blob()], path.split('/').pop(), { type: 'image/jpeg' });
    } catch { /* coba sumber berikutnya */ }
  }
  throw new Error(`Foto ${path} tidak bisa diambil.`);
}

// { nomorFoto: idFile } untuk file "<jam> <judul> (n).ext" di Laporan Magang/<tanggal>.
async function existingDriveFiles(entry) {
  let found;
  if (scriptMode()) {
    found = await skrip('daftar', { tanggal: entry.tanggal });
  } else {
    const root = await driveFolder(DRIVE_ROOT);
    const day = await driveFolder(entry.tanggal, root);
    const q = `'${day}' in parents and trashed = false`;
    found = await gdrive(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200&spaces=drive`);
  }
  const prefix = driveFileName(entry, { name: 'x.jpg' }, 0).replace(/ \(1\)\.jpg$/, '');
  const out = {};
  for (const f of found.files || []) {
    const m = f.name.startsWith(prefix) && f.name.slice(prefix.length).match(/^ \((\d+)\)\.\w+$/);
    if (m && !out[m[1]]) out[m[1]] = f.id;
  }
  return out;
}

$('btnDriveSync').addEventListener('click', ev => {
  if (!driveConfigured()) return toast('Atur Google Drive terlebih dahulu.', true);
  const tokenPromise = driveAuth();   // sinkron di dalam klik agar pop-up tidak diblokir
  tokenPromise.catch(() => {});
  withBusy(ev.currentTarget, async () => {
    await tokenPromise;
    const todo = unsyncedPhotos();
    const byEntry = new Map();
    todo.forEach(t => byEntry.set(t.entry.id, [...(byEntry.get(t.entry.id) || []), t]));
    const result = {};   // id kegiatan -> { path: idDrive }
    let done = 0, failed = 0;
    for (const items of byEntry.values()) {
      const entry = items[0].entry;
      // Foto yang dulu sudah tersalin (sebelum status dicatat) dikenali dari namanya
      // di folder Drive tanggal itu, supaya tidak terunggah dua kali.
      const existing = await existingDriveFiles(entry).catch(() => ({}));
      const files = [];
      const paths = [];
      for (const it of items) {
        const n = (entry.foto || []).indexOf(it.path) + 1;
        if (existing[n]) { (result[entry.id] ||= {})[it.path] = existing[n]; done++; continue; }
        try { files.push(await fetchPhoto(it.path)); paths.push(it.path); } catch { failed++; }
      }
      const nums = paths.map(p => (entry.foto || []).indexOf(p) + 1);
      if (!files.length) continue;
      const { ids } = await copyToDrive(files, entry, 'driveSyncMsg', nums).catch(() => ({ ids: [] }));
      paths.forEach((p, i) => {
        if (ids[i]) { (result[entry.id] ||= {})[p] = ids[i]; done++; } else failed++;
      });
      msg('driveSyncMsg', `Tersinkron ${done}/${todo.length} foto…`);
    }
    if (done) {
      let latest;
      await commit(`Sinkron ${done} foto ke Google Drive`, async base => {
        latest = await readRepoJSON(DATA_PATH, base, []);
        latest.forEach(e => { if (result[e.id]) e.fotoDrive = { ...(e.fotoDrive || {}), ...result[e.id] }; });
        return [{ path: DATA_PATH, content: JSON.stringify(sortEntries(latest), null, 2) + '\n' }];
      });
      entries = latest;
      renderList();
    }
    renderDriveSync();
    toast(failed ? `${done} foto tersinkron, ${failed} gagal. Coba lagi nanti.` : `✅ ${done} foto tersinkron ke Google Drive.`, Boolean(failed));
  }, 'driveSyncMsg');
});

function renderDrive() {
  $('dClientId').value = driveCfg.clientId || '';
  $('dEnabled').checked = scriptMode() ? driveCfg.enabled !== false : Boolean(driveCfg.enabled);
  $('driveOrigin').textContent = location.origin;
  $('driveStatus').textContent = driveReady() ? (scriptMode() ? 'Aktif · lewat Apps Script (tanpa login)' : 'Aktif · login Google')
    : driveConfigured() ? 'Nonaktif' : 'Belum diatur';
  $('driveNote').hidden = !driveReady();
  renderDriveSync();
  if (driveCfg.folderId) {
    $('driveFolderLink').href = `https://drive.google.com/drive/folders/${encodeURIComponent(driveCfg.folderId)}`;
    $('driveFolderLink').hidden = false;
  }
}

// Client ID bukan rahasia, jadi disimpan di config.json agar HP dan laptop
// otomatis memakai pengaturan yang sama. Status aktif & login tetap per perangkat.
function adoptSharedDrive() {
  if (repoSalinan()) return;
  const shared = CFG && CFG.drive && CFG.drive.clientId;
  if (!shared || shared === driveCfg.clientId) return;
  const first = !driveCfg.clientId;
  clearDriveToken();
  driveCfg = { clientId: shared, enabled: first ? CFG.drive.aktif !== false : Boolean(driveCfg.enabled) };
  try { localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg)); } catch { /* abaikan */ }
  renderDrive();
  if (driveReady()) loadGis().catch(() => {});
}

$('formDrive').addEventListener('submit', async ev => {
  ev.preventDefault();
  const clientId = $('dClientId').value.replace(/\s+/g, '');
  if (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return toast('Client ID tidak valid. Harus berakhiran .apps.googleusercontent.com', true);
  }
  await withBusy(ev.submitter, async () => {
    if (clientId !== driveCfg.clientId) { clearDriveToken(); delete driveCfg.folderId; delete driveCfg.email; }
    driveCfg = { ...driveCfg, clientId, enabled: $('dEnabled').checked && (Boolean(clientId) || scriptMode()) };
    try { localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg)); } catch { /* abaikan */ }
    renderDrive();
    if (driveCfg.clientId) loadGis().catch(e => toast(e.message, true));
    const sharedId = (CFG && CFG.drive && CFG.drive.clientId) || '';
    if (CFG && clientId !== sharedId) {
      let latest;
      await commit('Perbarui pengaturan Google Drive', async base => {
        latest = await readRepoJSON(CONFIG_PATH, base, {});
        // Pertahankan pengaturan lain (mis. Apps Script) di bagian drive.
        const drive = { ...(latest.drive || {}) };
        if (clientId) drive.clientId = clientId; else delete drive.clientId;
        if (Object.keys(drive).length) latest.drive = drive; else delete latest.drive;
        return [{ path: CONFIG_PATH, content: JSON.stringify(latest, null, 2) + '\n' }];
      });
      CFG = { ...CFG, drive: latest.drive };
      if (!latest.drive) delete CFG.drive;
    }
    toast(scriptMode() ? 'Pengaturan Google Drive disimpan (memakai Apps Script, tanpa login).'
      : driveReady() ? 'Google Drive aktif di semua perangkat. Klik "Hubungkan & tes" untuk login di perangkat ini.' : 'Pengaturan Google Drive disimpan.');
  });
});

$('btnDriveTest').addEventListener('click', async ev => {
  if (!driveCfg.clientId) return toast('Isi dan simpan Client ID terlebih dahulu.', true);
  const tokenPromise = ensureDriveToken();
  await withBusy(ev.currentTarget, async () => {
    await tokenPromise;
    const id = await driveFolder(DRIVE_ROOT);
    driveCfg.folderId = id;
    try { localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg)); } catch { /* abaikan */ }
    renderDrive();
    toast('✅ Terhubung ke Google Drive. Folder "Laporan Magang" siap.');
  });
});

// Dipakai common.js: jangan muat ulang otomatis bila ada pekerjaan yang belum disimpan.
function adaIsianBelumDisimpan() {
  if (busy > 0 || newPhotos.length || editingId) return true;
  if (!$('startCard').hidden && $('mbNama').value.trim()) return true;
  if (typeof rahasiaBaru === 'string' && rahasiaBaru) return true;   // kunci notifikasi belum disalin
  return ['fJudul', 'fKet', 'hRingkasan', 'hPembelajaran', 'hKendala', 'aiKey', 'groqKey'].some(id => {
    const el = $(id);
    return el && el.value.trim() && el.value !== el.defaultValue && !(id.startsWith('h') && harianTersimpan(id));
  });
}

function harianTersimpan(id) {
  const rec = harian[$('hTanggal').value] || {};
  const key = { hRingkasan: 'ringkasan', hPembelajaran: 'pembelajaran', hKendala: 'kendala' }[id];
  return (rec[key] || '') === $(id).value;
}

// ================= Mulai baru (repo salinan) =================
// Teman yang memakai "Use this template"/fork mendapat salinan data pemilik
// lama. config.json menyimpan "repo" pemiliknya; bila berbeda dengan repo yang
// sedang dibuka, panel menawarkan untuk mengosongkan data dan mengisi profil
// baru. Selama belum dikosongkan, pengaturan Drive/Apps Script milik pemilik
// lama tidak dipakai.
function repoSalinan() {
  const r = String((CFG && CFG.repo) || '').toLowerCase();
  return Boolean(r) && r !== `${S.owner}/${S.repo}`.toLowerCase();
}

let startDismissed = false;

function renderStart(force = false) {
  const salinan = repoSalinan();
  const perlu = salinan || !(CFG && CFG.nama);
  if (!force && (!perlu || startDismissed)) { $('startCard').hidden = true; return; }
  const c = CFG || {};
  $('startTitle').textContent = salinan ? 'Repository ini salinan milik orang lain' : !c.nama ? 'Selamat datang' : 'Mulai dari awal';
  $('startNote').textContent = salinan
    ? `Isinya masih data ${c.nama || 'pemilik sebelumnya'} (${c.repo}). Kosongkan dulu lalu isi profil Anda supaya website ini menjadi laporan Anda sendiri. Yang akan dihapus dari repository ${S.owner}/${S.repo}:`
    : 'Semua data berikut akan dihapus dari repository ini, lalu profil diganti dengan isian di bawah:';
  // Salinan: identitas dikosongkan; program, instansi, dan tanggal biasanya sama (satu batch).
  $('mbNama').value = salinan ? '' : c.nama || '';
  $('mbPosisi').value = salinan ? '' : c.posisi || '';
  $('mbDivisi').value = salinan ? '' : c.divisi || '';
  $('mbInstansi').value = c.instansi || '';
  $('mbProgram').value = c.program || '';
  $('mbMulai').value = c.tanggalMulai || '';
  $('mbSelesai').value = c.tanggalSelesai || '';
  $('mbZona').value = ZONA_WAKTU[c.zonaWaktu] ? c.zonaWaktu : 'Asia/Jakarta';
  $('mbSetuju').checked = false;
  $('btnStartClose').hidden = false;
  $('startCard').hidden = false;
  countRepoData().then(list => { $('startList').innerHTML = list.map(t => `<li>${esc(t)}</li>`).join(''); })
    .catch(e => { $('startList').innerHTML = `<li>${esc(e.message)}</li>`; });
}

async function repoUploads(ref) {
  const tree = await gh(`/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (tree.truncated) throw new Error('Repository terlalu besar untuk dikosongkan otomatis dari panel.');
  return tree.tree.filter(t => t.type === 'blob' && t.path.startsWith('uploads/'));
}

async function countRepoData() {
  const [files, keg, har] = await Promise.all([
    repoUploads(S.branch),
    readRepoJSON(DATA_PATH, S.branch, []),
    readRepoJSON(HARIAN_PATH, S.branch, {})
  ]);
  const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
  return [
    `${Array.isArray(keg) ? keg.length : 0} kegiatan`,
    `${har && typeof har === 'object' ? Object.keys(har).length : 0} laporan harian dan ringkasan AI`,
    `${files.length} file foto/gambar (${formatBytes(bytes)})`,
    'Profil, foto profil, logo, ikon situs, footer, dan pengaturan Google Drive'
  ];
}

$('btnStartOpen').addEventListener('click', () => {
  renderStart(true);
  $('startCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('btnStartClose').addEventListener('click', () => { startDismissed = true; $('startCard').hidden = true; });

$('formStart').addEventListener('submit', async ev => {
  ev.preventDefault();
  const p = {
    nama: $('mbNama').value.trim(),
    posisi: $('mbPosisi').value.trim(),
    divisi: $('mbDivisi').value.trim(),
    instansi: $('mbInstansi').value.trim(),
    program: $('mbProgram').value.trim(),
    tanggalMulai: $('mbMulai').value,
    tanggalSelesai: $('mbSelesai').value,
    zonaWaktu: ZONA_WAKTU[$('mbZona').value] ? $('mbZona').value : 'Asia/Jakarta'
  };
  if (!p.nama) return toast('Nama wajib diisi.', true);
  if (!p.tanggalMulai || !p.tanggalSelesai || p.tanggalSelesai < p.tanggalMulai) return toast('Tanggal selesai harus sama atau setelah tanggal mulai.', true);
  if (!$('mbSetuju').checked) return toast('Centang pernyataan persetujuan dulu.', true);
  if (!confirm(`Kosongkan semua data di ${S.owner}/${S.repo} dan mulai sebagai ${p.nama}?`)) return;
  await withBusy($('btnStart'), async () => {
    const repo = `${S.owner}/${S.repo}`;
    let old = {};
    msg('startMsg', 'Mengosongkan repository…');
    await commit(`Mulai baru: laporan magang ${p.nama}`, async base => {
      const [files, cfg] = await Promise.all([repoUploads(base), readRepoJSON(CONFIG_PATH, base, {})]);
      old = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
      const milikSendiri = String(old.repo || '').toLowerCase() === repo.toLowerCase();
      const baru = {
        nama: p.nama, posisi: p.posisi, divisi: p.divisi, instansi: p.instansi, program: p.program,
        tanggalMulai: p.tanggalMulai, tanggalSelesai: p.tanggalSelesai, zonaWaktu: p.zonaWaktu, kotaTtd: '',
        fotoProfil: '', judulSitus: '', warnaTema: safeColor(old.warnaTema), tampilkanLinkAdmin: true,
        footer: { teks: '', judulTautan: '', bagian: [], tautan: [] },
        mentor: { nama: '', jabatan: '' }, portofolio: '', ikonSitus: '', logoInstansi: '',
        hariLibur: Array.isArray(old.hariLibur) && old.hariLibur.length ? old.hariLibur
          : LIBUR_SKB.map(([tanggal, nama, jenis]) => ({ tanggal, nama, jenis })),
        repo
      };
      // Drive milik pemilik lama tidak ikut; milik sendiri (sudah diatur di repo ini) dipertahankan.
      if (milikSendiri && old.drive) baru.drive = old.drive;
      if (milikSendiri && old.notifikasi) baru.notifikasi = old.notifikasi;
      return [
        ...files.map(f => ({ path: f.path, delete: true })),
        { path: DATA_PATH, content: '[]\n' },
        { path: HARIAN_PATH, content: '{}\n' },
        { path: RINGKASAN_PATH, content: '{}\n' },
        { path: CONFIG_PATH, content: JSON.stringify(baru, null, 2) + '\n' },
        // Perangkat notifikasi pemilik lama tidak ikut.
        ...(milikSendiri ? [] : [{ path: 'data/notifikasi.json', content: JSON.stringify({ langganan: [] }, null, 2) + '\n' }])
      ];
    });
    // Client ID Google pemilik lama yang sempat tersalin ke perangkat ini.
    const oldClient = old.drive && old.drive.clientId;
    if (oldClient && driveCfg.clientId === oldClient && String(old.repo || '').toLowerCase() !== repo.toLowerCase()) {
      clearDriveToken();
      driveCfg = {};
      try { localStorage.removeItem(DRIVE_KEY); } catch { /* abaikan */ }
    }
    startDismissed = true;
    $('startCard').hidden = true;
    resetForm();
    await Promise.all([loadEntries(), loadConfig(), loadHarian()]);
    renderHarianForm();
    renderDrive();
    renderScript();
    if (typeof initNotifikasi === 'function') initNotifikasi();
    openTab('profil');
    toast('Repository sudah bersih dan profil Anda tersimpan. Lengkapi foto, logo, dan footer di tab Profil.');
  }, 'startMsg');
});

// ================= Utilitas UI =================
function msg(id, text) { $(id).textContent = text; }

async function withBusy(btn, fn, msgId) {
  busy++;
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy--;
    if (btn) btn.disabled = false;
    if (msgId) msg(msgId, '');
    }
}

let toastTimer;
function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 4000);
}

window.addEventListener('beforeunload', ev => {
  if (busy) { ev.preventDefault(); ev.returnValue = ''; }
});

// ================= Mulai =================
(function init() {
  if (!window.crypto || !crypto.subtle) {
    document.querySelector('main').innerHTML = '<p class="empty">Panel admin harus dibuka lewat HTTPS.</p>';
    return;
  }
  const stored = readStore();
  const legacy = takeLegacy();
  if (stored && stored.enc) {
    S = { owner: stored.owner, repo: stored.repo, branch: stored.branch || 'main' };
    showUnlock();
    // Sesi yang masih berlaku: langsung masuk tanpa kata sandi.
    loadSession().then(sess => {
      if (!sess || !sess.token) return;
      TOKEN = sess.token;
      AI_KEY = sess.ai || '';
      GROQ_KEY = sess.groq || '';
      SCRIPT_KEY = sess.skrip || '';
      enterApp().catch(e => toast(e.message, true));
    });
  } else if (legacy) {
    S = { owner: legacy.owner || '', repo: legacy.repo || '', branch: legacy.branch || 'main' };
    showSetup('Versi sebelumnya menyimpan token tanpa enkripsi. Token itu sudah dihapus dari penyimpanan browser dan dipindahkan ke kolom di bawah. Buat kata sandi panel supaya token disimpan terenkripsi.');
    $('sToken').value = legacy.token;
  } else {
    showSetup();
  }
})();
