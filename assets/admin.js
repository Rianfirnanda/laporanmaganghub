// Panel admin: mengelola kegiatan, profil, dan tampilan website langsung ke
// repository lewat GitHub API (satu commit per penyimpanan).
//
// Keamanan:
// - Token GitHub dienkripsi (AES-GCM, kunci dari kata sandi via PBKDF2) sebelum
//   disimpan di localStorage. Token asli hanya ada di memori selama panel terbuka.
// - Panel terkunci otomatis setelah tidak aktif, dan tidak mau tampil di dalam frame.

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
const AUTO_LOCK_MINUTES = 15;
const PBKDF2_ITERATIONS = 310000;
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
}

// Versi lama menyimpan token tanpa enkripsi: ambil sekali lalu hapus.
function takeLegacy() {
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY));
    localStorage.removeItem(LEGACY_KEY);
    return old && old.token ? old : null;
  } catch { return null; }
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
  const baseCommit = await gh(`/git/commits/${baseSha}`);
  const changes = await buildChanges(baseSha);
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
    $('uPass').value = '';
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
  touch();
  renderSecurity();
  resetForm();
  await Promise.all([loadEntries(), loadConfig()]);
}

function lock(reason) {
  TOKEN = '';
  entries = [];
  CFG = null;
  $('entryList').innerHTML = '<p class="empty">Memuat…</p>';
  resetForm();
  profileState = { newFile: null, newUrl: '', remove: false };
  if (readStore()) showUnlock(); else showSetup();
  if (reason) toast(reason);
}

$('btnLock').addEventListener('click', () => {
  if (busy) return toast('Tunggu proses penyimpanan selesai.', true);
  lock('Panel dikunci.');
});

// Kunci otomatis saat tidak aktif
let lastActive = Date.now();
function touch() { lastActive = Date.now(); }
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(t => document.addEventListener(t, touch, { passive: true }));
setInterval(() => {
  if (TOKEN && !busy && Date.now() - lastActive > AUTO_LOCK_MINUTES * 60000) {
    lock(`Panel dikunci otomatis setelah ${AUTO_LOCK_MINUTES} menit tidak aktif.`);
  }
}, 20000);

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
async function imageToBase64(file, { maxSide = 1600, square = false, quality = 0.82 } = {}) {
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
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
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
  await withBusy($('btnSave'), async () => {
    const tanggal = $('fTanggal').value;
    const id = editingId || `${tanggal.replaceAll('-', '')}-${Date.now().toString(36)}`;
    const [y, m, d] = tanggal.split('-');
    const fileChanges = [];
    const uploaded = [];

    for (let i = 0; i < newPhotos.length; i++) {
      msg('saveMsg', `Memproses foto ${i + 1}/${newPhotos.length}…`);
      const sha = await uploadBlob(await imageToBase64(newPhotos[i].file));
      const path = `uploads/${y}/${m}/${d}/${id}-${Date.now().toString(36)}${i}.jpg`;
      fileChanges.push({ path, sha });
      uploaded.push(path);
    }
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
    toast(`${isEdit ? 'Perubahan' : 'Kegiatan'} tersimpan. Website diperbarui dalam ±1 menit.`);
    resetForm();
    renderList();
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
let profileState = { newFile: null, newUrl: '', remove: false };

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
  if (profileState.newUrl) URL.revokeObjectURL(profileState.newUrl);
  profileState = { newFile: null, newUrl: '', remove: false };
  renderAvatar();
}

function renderAvatar() {
  const box = $('cfgAvatar');
  const src = profileState.newUrl || (!profileState.remove && rawUrl(CFG && CFG.fotoProfil));
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    box.replaceChildren(img);
  } else {
    box.textContent = inisial($('cNama').value);
  }
  $('cfgFotoHapus').hidden = !src;
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
$('cNama').addEventListener('input', renderAvatar);

$('cfgFoto').addEventListener('change', ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  if (profileState.newUrl) URL.revokeObjectURL(profileState.newUrl);
  profileState = { newFile: file, newUrl: URL.createObjectURL(file), remove: false };
  renderAvatar();
});
$('cfgFotoHapus').addEventListener('click', () => {
  if (profileState.newUrl) URL.revokeObjectURL(profileState.newUrl);
  profileState = { newFile: null, newUrl: '', remove: true };
  renderAvatar();
});
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
    footer: {
      teks: $('cFooterTeks').value.trim(),
      judulTautan: $('cJudulTautan').value.trim(),
      bagian,
      tautan
    }
  };
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
    const oldPhoto = safePath(CFG && CFG.fotoProfil);
    const changes = [];
    cfg.fotoProfil = oldPhoto;
    if (profileState.newFile) {
      msg('configMsg', 'Memproses foto profil…');
      const sha = await uploadBlob(await imageToBase64(profileState.newFile, { maxSide: 480, square: true, quality: 0.88 }));
      cfg.fotoProfil = `uploads/profil/foto-${Date.now().toString(36)}.jpg`;
      changes.push({ path: cfg.fotoProfil, sha });
      if (oldPhoto) changes.push({ path: oldPhoto, delete: true });
    } else if (profileState.remove) {
      cfg.fotoProfil = '';
      if (oldPhoto) changes.push({ path: oldPhoto, delete: true });
    }
    changes.push({ path: CONFIG_PATH, content: JSON.stringify(cfg, null, 2) + '\n' });

    msg('configMsg', 'Menyimpan ke GitHub…');
    await commit('Perbarui profil dan tampilan website', async () => changes);
    CFG = cfg;
    fillConfigForm();
    renderHero(true);
    toast('Pengaturan tersimpan. Website diperbarui dalam ±1 menit.');
  }, 'configMsg');
});

// ================= Keamanan =================
function renderSecurity() {
  const stored = readStore();
  const rows = [
    ['Repository', `${S.owner}/${S.repo} (branch ${S.branch})`],
    ['Jenis token', TOKEN.startsWith('github_pat_') ? '✅ Fine-grained' : '⚠️ Classic, sebaiknya diganti fine-grained'],
    ['Penyimpanan token', stored ? '✅ Terenkripsi AES-256 dengan kata sandi panel' : '—'],
    ['Kunci otomatis', `Setelah ${AUTO_LOCK_MINUTES} menit tidak aktif`]
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
    writeStore({ ...stored, enc: await encryptToken(token, $('pNew').value) });
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
    touch();
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
    document.querySelector('.admin-main').innerHTML = '<p class="empty">Panel admin harus dibuka lewat HTTPS.</p>';
    return;
  }
  const stored = readStore();
  const legacy = takeLegacy();
  if (stored && stored.enc) {
    S = { owner: stored.owner, repo: stored.repo, branch: stored.branch || 'main' };
    showUnlock();
  } else if (legacy) {
    S = { owner: legacy.owner || '', repo: legacy.repo || '', branch: legacy.branch || 'main' };
    showSetup('Versi sebelumnya menyimpan token tanpa enkripsi. Token itu sudah dihapus dari penyimpanan browser dan dipindahkan ke kolom di bawah. Buat kata sandi panel supaya token disimpan terenkripsi.');
    $('sToken').value = legacy.token;
  } else {
    showSetup();
  }
})();
