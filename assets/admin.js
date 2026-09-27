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
const STORE_KEY = 'laporanmagang.v2';
const LEGACY_KEY = 'laporanmagang.settings';
const DATA_PATH = 'data/kegiatan.json';
const CONFIG_PATH = 'data/config.json';
const PBKDF2_ITERATIONS = 310000;
const UPLOAD_CONCURRENCY = 3;
const DEFAULT_PORTOFOLIO = 'https://rianfirnanda.vercel.app';
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
const SESSION_KEY = 'laporanmagang.sesi';
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
    const body = JSON.stringify({ token: TOKEN, ai: AI_KEY, exp: rememberMe ? Date.now() + REMEMBER_DAYS * 86400000 : 0 });
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
  const g = { branch: 'main', ...guessRepo(), ...S };
  $('sOwner').value = g.owner || '';
  $('sRepo').value = g.repo || '';
  $('sBranch').value = g.branch || 'main';
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
  if (driveReady()) loadGis().catch(() => {});
  resetForm();
  renderAi();
  refreshAiModels();
  if (!$('hTanggal').value) $('hTanggal').value = todayStr();
  await Promise.all([loadEntries(), loadConfig(), loadHarian()]);
  renderHarianForm();
}

function lock(reason) {
  clearSession();
  TOKEN = '';
  AI_KEY = '';
  harian = {};
  driveToken = null;
  entries = [];
  CFG = null;
  $('entryList').innerHTML = '<p class="empty">Memuat…</p>';
  resetForm();
  resetImageSlots();
  if (readStore()) showUnlock(); else showSetup();
  if (reason) toast(reason);
}

$('btnLock').addEventListener('click', () => {
  if (busy) return toast('Tunggu proses penyimpanan selesai.', true);
  lock('Panel dikunci.');
});

// ================= Tab =================
$('tabbar').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-tab]');
  if (!btn) return;
  document.querySelectorAll('.tabbar-item').forEach(t => {
    t.classList.toggle('active', t === btn);
    t.setAttribute('aria-selected', String(t === btn));
  });
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
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
let newPhotos = [];       // { file, url }
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

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    newPhotos.push({ file, url: URL.createObjectURL(file) });
  }
  renderPreviews();
}

function renderPreviews() {
  const kept = keptPhotos.map((p, i) =>
    `<div class="preview"><img src="${esc(rawUrl(p))}" alt=""><button type="button" data-kept="${i}" title="Hapus foto">${icon('x')}</button></div>`);
  const fresh = newPhotos.map((p, i) =>
    `<div class="preview new"><img src="${esc(p.url)}" alt=""><button type="button" data-new="${i}" title="Batal">${icon('x')}</button></div>`);
  $('previews').innerHTML = kept.concat(fresh).join('');
}

$('previews').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.kept !== undefined) {
    removedPhotos.push(keptPhotos.splice(Number(b.dataset.kept), 1)[0]);
  } else {
    const [p] = newPhotos.splice(Number(b.dataset.new), 1);
    URL.revokeObjectURL(p.url);
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
  newPhotos.forEach(p => URL.revokeObjectURL(p.url));
  newPhotos = []; keptPhotos = []; removedPhotos = [];
  $('formEntry').reset();
  $('fTanggal').value = todayStr();
  const now = new Date();
  $('fJam').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('fSesi').value = sesiDariJam($('fJam').value);
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
$('btnCancelEdit').addEventListener('click', resetForm);

$('formEntry').addEventListener('submit', async ev => {
  ev.preventDefault();
  // Harus dipanggil langsung di dalam klik agar jendela login Google tidak diblokir.
  const photosForDrive = driveReady() ? newPhotos.map(p => p.file) : [];
  const drivePromise = photosForDrive.length ? ensureDriveToken() : null;
  if (drivePromise) drivePromise.catch(() => {});
  await withBusy($('btnSave'), async () => {
    const tanggal = $('fTanggal').value;
    const id = editingId || `${tanggal.replaceAll('-', '')}-${Date.now().toString(36)}`;
    const [y, m, d] = tanggal.split('-');
    const stamp = Date.now().toString(36);
    let done = 0;
    if (newPhotos.length) msg('saveMsg', `Mengunggah foto 0/${newPhotos.length}…`);
    const fileChanges = await mapLimit(newPhotos, UPLOAD_CONCURRENCY, async (p, i) => {
      const sha = await uploadBlob(await imageToBase64(p.file));
      msg('saveMsg', `Mengunggah foto ${++done}/${newPhotos.length}…`);
      return { path: `uploads/${y}/${m}/${d}/${id}-${stamp}${i}.jpg`, sha };
    });
    const uploaded = fileChanges.map(c => c.path);
    removedPhotos.forEach(path => fileChanges.push({ path, delete: true }));

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
    if (drivePromise) {
      try {
        await drivePromise;
        msg('saveMsg', 'Menyalin foto ke Google Drive…');
        await copyToDrive(photosForDrive, data);
        driveMsg = ' Foto juga tersalin ke Google Drive.';
      } catch (e) {
        toast(`Tersimpan di GitHub, tetapi gagal menyalin ke Google Drive: ${e.message}`, true);
        driveMsg = null;
      }
    }
    if (driveMsg !== null) toast(`${isEdit ? 'Perubahan' : 'Kegiatan'} tersimpan.${driveMsg} Menunggu website diperbarui…`);
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
      const photos = target ? (target.foto || []).filter(safePath) : [];
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
    const first = rawUrl((e.foto || [])[0]);
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
    fillConfigForm();
    renderHero(true);
  } catch (e) {
    toast(`Gagal memuat pengaturan: ${e.message}`, true);
  }
}

function fillConfigForm() {
  const c = CFG || {};
  const f = c.footer || {};
  $('cNama').value = c.nama || '';
  $('cPosisi').value = c.posisi || '';
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
  $('cJudulTautan').value = f.judulTautan || '';
  $('cSections').replaceChildren();
  (f.bagian || []).forEach(b => addRow('cSections', 'tplSection', { '.r-judul': b.judul, '.r-isi': b.isi }));
  $('cLinks').replaceChildren();
  (f.tautan || []).forEach(l => addRow('cLinks', 'tplLink', { '.r-label': l.label, '.r-url': l.url }));
  $('cPortofolio').value = c.portofolio ?? DEFAULT_PORTOFOLIO;
  resetImageSlots();
  renderImageSlots();
}

function addRow(listId, tplId, values = {}) {
  const row = $(tplId).content.firstElementChild.cloneNode(true);
  for (const [sel, val] of Object.entries(values)) row.querySelector(sel).value = val || '';
  $(listId).appendChild(row);
  return row;
}

['cSections', 'cLinks'].forEach(id => $(id).addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  const row = b.closest('.repeat-row');
  if (b.hasAttribute('data-remove')) row.remove();
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
    posisi: $('cPosisi').value.trim(),
    instansi: $('cInstansi').value.trim(),
    program: $('cProgram').value.trim(),
    tanggalMulai: $('cMulai').value,
    tanggalSelesai: $('cSelesai').value,
    mentor: { nama: $('cMentorNama').value.trim(), jabatan: $('cMentorJabatan').value.trim() },
    judulSitus: $('cJudul').value.trim(),
    warnaTema: safeColor($('cWarna').value),
    tampilkanLinkAdmin: $('cAdminLink').checked,
    portofolio: $('cPortofolio').value.trim(),
    footer: {
      teks: $('cFooterTeks').value.trim(),
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
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
let harian = {};
let AI_KEY = '';   // hanya di memori; tersimpan terenkripsi sebagai stored.aiEnc
const lastAi = {};  // hasil AI terakhir per tanggal (untuk menandai laporan "auto")
let aiModels = [];  // model Gemini yang tersedia untuk kunci ini

const AI_SYSTEM = `Kamu membantu seorang peserta magang menulis laporan harian untuk daftar hadir di monev MagangHub Kemnaker. Laporan diisi setiap sore dan terdiri dari tiga bagian: ringkasan kegiatan, pembelajaran yang didapat, dan kendala yang dihadapi.

Tulis seolah-olah peserta sendiri yang menulis: bahasa Indonesia sehari-hari yang sopan, sudut pandang orang pertama ("saya"), kalimat yang mengalir, tanpa poin-poin, tanpa judul, tanpa emoji, dan tanpa kalimat pembuka seperti "Berikut" atau "Pada hari ini saya telah melaksanakan". Variasikan susunan kalimat dan hindari frasa klise seperti "sangat bermanfaat", "menambah wawasan", atau "secara keseluruhan".

- ringkasan: 2-4 kalimat tentang apa saja yang dikerjakan dari pagi sampai sore, mengikuti urutan catatan. Sebut hal konkret (nama pekerjaan, jumlah, aplikasi, tempat) bila ada di catatan.
- pembelajaran: 1-3 kalimat tentang hal yang dipelajari atau keterampilan yang terasah dari kegiatan itu, masuk akal berdasarkan catatan, bukan pujian umum.
- kendala: 1-2 kalimat tentang kendala yang tersirat di catatan beserta cara mengatasinya bila disebut. Jika catatan tidak menyebut kendala, tulis singkat dan jujur bahwa tidak ada kendala berarti; jangan mengarang masalah.

Jangan menambahkan kegiatan, angka, nama orang, atau detail yang tidak ada di catatan. Jika status kehadiran Sakit atau Izin, ringkasan cukup menjelaskan ketidakhadiran itu secara singkat dan sopan, lalu isi pembelajaran dan kendala dengan "-" bila tidak relevan.`;

const HARIAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ringkasan: { type: 'STRING' },
    pembelajaran: { type: 'STRING' },
    kendala: { type: 'STRING' }
  },
  required: ['ringkasan', 'pembelajaran', 'kendala'],
  propertyOrdering: ['ringkasan', 'pembelajaran', 'kendala']
};

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
  const dates = Object.keys(harian).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
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

function harianPrompt(date, status = $('hStatus').value, ket = $('hKet').value.trim()) {
  const c = CFG || {};
  const items = dayEntries(date);
  const lines = items.map(e => {
    const parts = [`- ${e.jam || '??:??'} (${e.sesi || sesiDariJam(e.jam)}): ${e.judul}`];
    if (e.lokasi) parts.push(`Lokasi: ${e.lokasi}.`);
    if (e.keterangan) parts.push(`Catatan: ${e.keterangan.replace(/\s+/g, ' ')}`);
    return parts.join(' ');
  });
  const prev = Object.keys(harian).filter(d => d < date && harian[d].ringkasan).sort().pop();
  return [
    `Peserta: ${c.posisi || 'peserta magang'} di ${c.instansi || 'instansi'}.`,
    `Tanggal: ${formatTanggal(date)}. Status kehadiran: ${status}${ket ? ` (${ket})` : ''}.`,
    '',
    lines.length ? `Catatan kegiatan hari ini, urut jam:\n${lines.join('\n')}` : 'Tidak ada catatan kegiatan pada hari ini.',
    prev ? `\nRingkasan laporan hari sebelumnya, untuk dihindari susunan kalimatnya agar tidak berulang:\n${harian[prev].ringkasan}` : '',
    '',
    'Tulis ketiga isian laporan daftar hadir untuk hari ini.'
  ].join('\n');
}

// Gemini API dipanggil langsung dari browser dengan kunci milik pengguna.
async function gemini(path, body) {
  const res = await fetch(`${GEMINI_API}/${path}`, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { 'x-goog-api-key': AI_KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let m = res.statusText;
    let reason = '';
    try {
      const err = (await res.json()).error || {};
      m = err.message || m;
      reason = JSON.stringify(err.details || '');
    } catch { /* abaikan */ }
    if (/API_KEY_INVALID|API key not valid/i.test(`${m} ${reason}`)) m = 'Kunci API Gemini tidak valid.';
    else if (res.status === 429) m = 'Kuota gratis Gemini sedang habis. Tunggu sebentar (atau sampai besok) lalu coba lagi.';
    else if (res.status === 403) m = 'Kunci API tidak diizinkan memakai Gemini API. Pastikan kunci dibuat di Google AI Studio.';
    throw new Error(`Gemini ${res.status}: ${m}`);
  }
  return res.json();
}

// Pilih model "Flash" terbaru yang stabil (keluarga dengan kuota gratis).
function pickModel(models) {
  const flash = models.filter(m => /flash/.test(m) && !/lite|image|tts|audio|live|embed|thinking|exp/.test(m));
  const stable = flash.filter(m => !/preview/.test(m));
  const ver = m => (m.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  const best = list => list.slice().sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0];
  return best(stable) || best(flash) || GEMINI_FALLBACK_MODEL;
}

async function loadAiModels() {
  const data = await gemini('models?pageSize=200');
  aiModels = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(m => /^gemini-/.test(m));
  return aiModels;
}

function currentModel() {
  const stored = readStore();
  return (stored && stored.aiModel) || GEMINI_FALLBACK_MODEL;
}

async function generateHarian(date, status = $('hStatus').value, ket = $('hKet').value.trim()) {
  if (!AI_KEY) throw new Error('Kunci API Gemini belum diatur. Isi di kartu "Asisten AI".');
  if (!dayEntries(date).length && status === 'Hadir') {
    throw new Error('Belum ada kegiatan pada tanggal ini. Tambahkan kegiatan dulu atau ubah status kehadiran.');
  }
  const data = await gemini(`models/${encodeURIComponent(currentModel())}:generateContent`, {
    systemInstruction: { parts: [{ text: AI_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: harianPrompt(date, status, ket) }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: HARIAN_SCHEMA
    }
  });
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error('Gemini menolak memproses catatan ini. Coba ubah catatan kegiatan.');
  }
  const cand = (data.candidates || [])[0];
  if (!cand) throw new Error('Gemini tidak memberi jawaban. Coba lagi.');
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('Jawaban AI terpotong. Coba lagi.');
  if (cand.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason)) {
    throw new Error(`Gemini berhenti (${cand.finishReason}). Coba ubah catatan kegiatan lalu ulangi.`);
  }
  const text = ((cand.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Jawaban AI tidak terbaca. Coba lagi.'); }
  return {
    ringkasan: String(out.ringkasan || '').trim(),
    pembelajaran: String(out.pembelajaran || '').trim(),
    kendala: String(out.kendala || '').trim()
  };
}

$('btnAi').addEventListener('click', async ev => {
  const date = $('hTanggal').value;
  const hasText = ['hRingkasan', 'hPembelajaran', 'hKendala'].some(id => $(id).value.trim());
  if (hasText && !confirm('Isian yang ada akan diganti dengan tulisan baru dari AI. Lanjutkan?')) return;
  await withBusy(ev.currentTarget, async () => {
    msg('aiMsg', 'Gemini sedang menulis laporan…');
    const out = await generateHarian(date);
    lastAi[date] = out;
    $('hRingkasan').value = out.ringkasan;
    $('hPembelajaran').value = out.pembelajaran;
    $('hKendala').value = out.kendala;
    toast('Laporan selesai ditulis. Periksa dulu, lalu klik Simpan laporan.');
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
  if (!rec.keterangan) delete rec.keterangan;
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

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mingguIni: { type: 'STRING' },
    sorotan: { type: 'ARRAY', items: { type: 'STRING' } },
    keseluruhan: { type: 'STRING' }
  },
  required: ['mingguIni', 'sorotan', 'keseluruhan'],
  propertyOrdering: ['mingguIni', 'sorotan', 'keseluruhan']
};

const SUMMARY_SYSTEM = `Kamu menulis ringkasan singkat untuk halaman publik dokumentasi magang seorang peserta. Pembacanya atasan dan pengunjung, jadi tulis dalam bahasa Indonesia yang natural, hangat, dan ringkas, dengan sudut pandang orang ketiga (sebut "peserta" atau nama depannya). Tanpa poin-poin, tanpa emoji, tanpa frasa klise.

- mingguIni: 2-3 kalimat tentang apa saja yang dikerjakan pada minggu terbaru.
- sorotan: 3 frasa pendek (masing-masing maksimal 6 kata) berisi hal paling menonjol minggu terbaru.
- keseluruhan: 2-3 kalimat tentang perjalanan magang sejauh ini.

Hanya gunakan fakta dari data. Jangan mengarang kegiatan, angka, atau nama.`;

function summaryPrompt() {
  const c = CFG || {};
  const dates = [...new Set([...entries.map(e => e.tanggal), ...Object.keys(harian)])].sort();
  if (!dates.length) return '';
  const cfg = { tanggalMulai: c.tanggalMulai || dates[0] };
  const lastWeek = mingguKe(cfg, dates[dates.length - 1]);
  const lines = dates.map(d => {
    const w = mingguKe(cfg, d);
    const r = harian[d] || {};
    const titles = dayEntries(d).map(e => e.judul).join('; ');
    const st = ['Sakit', 'Izin'].includes(r.status) ? ` [${r.status}]` : '';
    const detail = w === lastWeek && r.ringkasan ? ` Ringkasan: ${r.ringkasan}` : '';
    return `- Minggu ${w}, ${d}${st}: ${titles || '(tidak ada kegiatan)'}${detail}`;
  });
  return [
    `Peserta: ${c.nama || 'peserta'} (${c.posisi || 'peserta magang'}) di ${c.instansi || 'instansi'}. Minggu terbaru: ${lastWeek}.`,
    'Data kegiatan per hari:',
    ...lines.slice(-60)
  ].join('\n');
}

async function generateSummary() {
  const prompt = summaryPrompt();
  if (!prompt) return null;
  const data = await gemini(`models/${encodeURIComponent(currentModel())}:generateContent`, {
    systemInstruction: { parts: [{ text: SUMMARY_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: SUMMARY_SCHEMA }
  });
  const cand = (data.candidates || [])[0];
  if (!cand || (cand.finishReason && cand.finishReason !== 'STOP')) throw new Error('Gemini tidak menyelesaikan ringkasan.');
  const out = JSON.parse(((cand.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join(''));
  const dates = [...entries.map(e => e.tanggal)].sort();
  return {
    diperbarui: new Date().toISOString(),
    minggu: dates.length ? mingguKe({ tanggalMulai: (CFG && CFG.tanggalMulai) || dates[0] }, dates[dates.length - 1]) : 0,
    mingguIni: String(out.mingguIni || '').trim(),
    sorotan: (Array.isArray(out.sorotan) ? out.sorotan : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4),
    keseluruhan: String(out.keseluruhan || '').trim()
  };
}

let autoAiRunning = null;
async function autoAi(date) {
  if (!AI_KEY) return;
  if (autoAiRunning) await autoAiRunning.catch(() => {});
  autoAiRunning = (async () => {
    msg('autoAiMsg', '✨ AI sedang meringkas kegiatan…');
    try {
      const rec = harian[date];
      const canRewrite = !rec || rec.auto !== false;
      const report = canRewrite && dayEntries(date).length ? await generateHarian(date, (rec && rec.status) || 'Hadir', (rec && rec.keterangan) || '') : null;
      if (report) lastAi[date] = report;
      if (report) Object.assign(harian, { [date]: { ...(rec || {}), status: (rec && rec.status) || 'Hadir', ...report, auto: true, diperbarui: new Date().toISOString() } });
      const summary = await generateSummary().catch(() => null);
      if (!report && !summary) return;
      let latestH;
      await commit(`Ringkasan AI ${date}`, async base => {
        const changes = [];
        if (report) {
          latestH = await readRepoJSON(HARIAN_PATH, base, {});
          if (!latestH || typeof latestH !== 'object' || Array.isArray(latestH)) latestH = {};
          const cur = latestH[date];
          if (!cur || cur.auto !== false) latestH[date] = harian[date];
          const sorted = Object.fromEntries(Object.entries(latestH).sort(([a], [b]) => b.localeCompare(a)));
          changes.push({ path: HARIAN_PATH, content: JSON.stringify(sorted, null, 2) + '\n' });
        }
        if (summary) {
          const old = await readRepoJSON(RINGKASAN_PATH, base, {});
          const mingguan = { ...((old && old.mingguan) || {}), [summary.minggu]: summary.mingguIni };
          changes.push({ path: RINGKASAN_PATH, content: JSON.stringify({ ...summary, mingguan }, null, 2) + '\n' });
        }
        return changes;
      });
      if (latestH) harian = latestH;
      renderHarianList();
      if ($('hTanggal').value === date) renderHarianForm();
      toast('✨ Laporan harian dan ringkasan dasbor diperbarui oleh AI.');
    } catch (e) {
      toast(`Kegiatan tersimpan, tetapi ringkasan AI gagal: ${e.message}`, true);
    } finally {
      msg('autoAiMsg', '');
    }
  })();
  return autoAiRunning;
}

$('btnSummary').addEventListener('click', async ev => {
  if (!AI_KEY) return toast('Atur kunci API Gemini terlebih dahulu.', true);
  await withBusy(ev.currentTarget, async () => {
    msg('aiMsg', 'AI sedang menyusun ringkasan dasbor…');
    const summary = await generateSummary();
    if (!summary) throw new Error('Belum ada kegiatan untuk diringkas.');
    await commit('Ringkasan AI dasbor', async base => {
      const old = await readRepoJSON(RINGKASAN_PATH, base, {});
      const mingguan = { ...((old && old.mingguan) || {}), [summary.minggu]: summary.mingguIni };
      return [{ path: RINGKASAN_PATH, content: JSON.stringify({ ...summary, mingguan }, null, 2) + '\n' }];
    });
    toast('Ringkasan dasbor diperbarui.');
  }, 'aiMsg');
});

// ---------- Pengaturan kunci API Gemini ----------
function renderAi() {
  const stored = readStore();
  const has = Boolean(stored && stored.aiEnc);
  $('aiStatus').textContent = AI_KEY ? `Aktif · ${currentModel()}` : has ? 'Tersimpan (buka ulang panel untuk memakai)' : 'Belum diatur';
  $('btnAiForget').hidden = !has;
  $('aiModelWrap').hidden = !AI_KEY;
  const list = aiModels.length ? aiModels : [currentModel()];
  if (!list.includes(currentModel())) list.unshift(currentModel());
  $('aiModel').innerHTML = list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('aiModel').value = currentModel();
  $('aiKey').value = '';
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

$('formAi').addEventListener('submit', async ev => {
  ev.preventDefault();
  const key = $('aiKey').value.trim();
  if (!key) return toast('Tempel kunci API Gemini dari Google AI Studio terlebih dahulu.', true);
  // Format kunci bisa berubah (umumnya diawali "AIza"); keabsahannya diuji langsung ke Google.
  if (!/^[\w.-]{20,}$/.test(key)) return toast('Kunci API tidak valid. Salin ulang kunci dari Google AI Studio tanpa spasi.', true);
  const stored = readStore();
  if (!stored) return;
  await withBusy(ev.submitter, async () => {
    await decryptToken(stored.enc, $('aiPass').value);   // memastikan kata sandi panel benar
    const prev = AI_KEY;
    AI_KEY = key;
    saveSession();
    let models;
    try {
      models = await loadAiModels();                      // sekaligus menguji kunci
    } catch (e) {
      AI_KEY = prev;
      throw e;
    }
    writeStore({ ...stored, aiEnc: await encryptToken(key, $('aiPass').value), aiModel: pickModel(models) });
    renderAi();
    toast(`Kunci Gemini tersimpan terenkripsi. Model: ${currentModel()}.`);
  });
});

$('btnAiForget').addEventListener('click', () => {
  if (!confirm('Hapus kunci API Gemini dari perangkat ini?')) return;
  const stored = readStore();
  if (stored) { delete stored.aiEnc; delete stored.aiModel; writeStore(stored); }
  AI_KEY = '';
  aiModels = [];
  renderAi();
  toast('Kunci API Gemini dihapus dari perangkat ini.');
});

// ================= Google Drive (salinan foto) =================
// Login lewat Google Identity Services (tanpa server). Izin drive.file hanya
// memberi akses ke file/folder yang dibuat panel ini, bukan seluruh Drive.
const DRIVE_KEY = 'laporanmagang.drive';
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
  return Boolean(driveCfg.enabled && driveCfg.clientId);
}

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
      callback: r => {
        if (r.error) return reject(new Error(`Google menolak: ${r.error}`));
        driveToken = r.access_token;
        driveTokenExp = Date.now() + Number(r.expires_in || 3600) * 1000;
        resolve(driveToken);
      },
      error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'Jendela login Google ditutup.'
        : e && e.type === 'popup_failed_to_open' ? 'Jendela login Google diblokir browser. Izinkan pop-up untuk situs ini.'
        : `Login Google gagal (${(e && e.type) || 'tidak diketahui'}).`))
    });
    client.requestAccessToken();
  });
}

async function gdrive(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${driveToken}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    let m = res.statusText;
    try { m = (await res.json()).error.message || m; } catch { /* abaikan */ }
    if (res.status === 401) driveToken = null;
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
async function copyToDrive(files, entry) {
  const root = await driveFolder(DRIVE_ROOT);
  const day = await driveFolder(entry.tanggal, root);
  let done = 0;
  await mapLimit(files, UPLOAD_CONCURRENCY, async (file, i) => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: driveFileName(entry, file, i), parents: [day] })], { type: 'application/json' }));
    form.append('file', file);
    await gdrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
    msg('saveMsg', `Menyalin ke Google Drive ${++done}/${files.length}…`);
  });
  return root;
}

function renderDrive() {
  $('dClientId').value = driveCfg.clientId || '';
  $('dEnabled').checked = Boolean(driveCfg.enabled);
  $('driveOrigin').textContent = location.origin;
  $('driveStatus').textContent = driveReady() ? 'Aktif' : driveCfg.clientId ? 'Nonaktif' : 'Belum diatur';
  $('driveNote').hidden = !driveReady();
  if (driveCfg.folderId) {
    $('driveFolderLink').href = `https://drive.google.com/drive/folders/${encodeURIComponent(driveCfg.folderId)}`;
    $('driveFolderLink').hidden = false;
  }
}

$('formDrive').addEventListener('submit', ev => {
  ev.preventDefault();
  const clientId = $('dClientId').value.trim();
  if (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return toast('Client ID tidak valid. Harus berakhiran .apps.googleusercontent.com', true);
  }
  if (clientId !== driveCfg.clientId) { driveToken = null; delete driveCfg.folderId; }
  driveCfg = { ...driveCfg, clientId, enabled: $('dEnabled').checked && Boolean(clientId) };
  try { localStorage.setItem(DRIVE_KEY, JSON.stringify(driveCfg)); } catch { /* abaikan */ }
  renderDrive();
  if (driveCfg.clientId) loadGis().catch(e => toast(e.message, true));
  toast(driveReady() ? 'Google Drive aktif. Klik "Hubungkan & tes" untuk login.' : 'Pengaturan Google Drive disimpan.');
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
