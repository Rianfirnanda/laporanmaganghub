// Panel admin: menambah/mengedit/menghapus kegiatan dan mengunggah foto
// langsung ke repository lewat GitHub API (satu commit per penyimpanan).

const $ = id => document.getElementById(id);
const LS_KEY = 'laporanmagang.settings';
const DATA_PATH = 'data/kegiatan.json';
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;

let S = loadSettings();
let entries = [];
let editingId = null;
let newPhotos = [];       // { file, url }
let keptPhotos = [];      // path foto lama yang dipertahankan saat edit
let removedPhotos = [];   // path foto lama yang dihapus saat edit

// ---------- Pengaturan ----------
function guessRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return {};
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = first && !first.endsWith('.html') ? first : `${owner}.github.io`;
  return { owner, repo };
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { /* abaikan */ }
  return { branch: 'main', ...guessRepo(), ...s };
}

function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* abaikan */ }
}

function fillSettingsForm() {
  $('sOwner').value = S.owner || '';
  $('sRepo').value = S.repo || '';
  $('sBranch').value = S.branch || 'main';
  $('sToken').value = S.token || '';
}

// ---------- GitHub API ----------
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${S.owner}/${S.repo}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${S.token}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* abaikan */ }
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

async function fetchEntries(ref) {
  try {
    const text = await gh(`/contents/${DATA_PATH}?ref=${encodeURIComponent(ref)}`, { raw: true });
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

async function uploadBlob(base64) {
  const blob = await gh('/git/blobs', { method: 'POST', body: { content: base64, encoding: 'base64' } });
  return blob.sha;
}

// Ambil data terbaru, terapkan perubahan, lalu buat satu commit berisi
// foto baru, foto yang dihapus, dan kegiatan.json yang diperbarui.
async function commitChange(mutate, fileChanges, message) {
  const ref = await gh(`/git/ref/heads/${encodeURIComponent(S.branch)}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(`/git/commits/${baseSha}`);
  const latest = await fetchEntries(baseSha);
  mutate(latest);

  const tree = fileChanges.map(c => c.delete
    ? { path: c.path, mode: '100644', type: 'blob', sha: null }
    : { path: c.path, mode: '100644', type: 'blob', sha: c.sha });
  tree.push({ path: DATA_PATH, mode: '100644', type: 'blob', content: JSON.stringify(sortEntries(latest), null, 2) + '\n' });

  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
  const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [baseSha] } });
  await gh(`/git/refs/heads/${encodeURIComponent(S.branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
  entries = latest;
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${S.owner}/${S.repo}/${S.branch}/${path}`;
}

// ---------- Foto ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Tidak bisa membaca foto ${file.name}`)); };
    img.src = url;
  });
}

async function compressToBase64(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
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
    `<div class="preview"><img src="${esc(rawUrl(p))}" alt=""><button type="button" data-kept="${i}" title="Hapus foto">×</button></div>`);
  const fresh = newPhotos.map((p, i) =>
    `<div class="preview new"><img src="${p.url}" alt=""><button type="button" data-new="${i}" title="Batal">×</button></div>`);
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

// ---------- Form kegiatan ----------
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
}

function startEdit(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  resetForm();
  editingId = id;
  $('fTanggal').value = e.tanggal;
  $('fJam').value = e.jam || '';
  $('fSesi').value = e.sesi || sesiDariJam(e.jam);
  $('fJudul').value = e.judul || '';
  $('fLokasi').value = e.lokasi || '';
  $('fKet').value = e.keterangan || '';
  keptPhotos = [...(e.foto || [])];
  $('formTitle').textContent = 'Edit kegiatan';
  $('btnCancelEdit').hidden = false;
  $('btnSave').textContent = 'Simpan perubahan';
  renderPreviews();
  $('cardForm').scrollIntoView({ behavior: 'smooth' });
}

$('fJam').addEventListener('change', () => { $('fSesi').value = sesiDariJam($('fJam').value); });
$('btnCancelEdit').addEventListener('click', resetForm);

$('formEntry').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (!S.token) return toast('Hubungkan GitHub terlebih dahulu.', true);
  const btn = $('btnSave');
  btn.disabled = true;
  try {
    const tanggal = $('fTanggal').value;
    const id = editingId || `${tanggal.replaceAll('-', '')}-${Date.now().toString(36)}`;
    const [y, m, d] = tanggal.split('-');
    const fileChanges = [];
    const uploaded = [];

    for (let i = 0; i < newPhotos.length; i++) {
      msg(`Memproses foto ${i + 1}/${newPhotos.length}…`);
      const base64 = await compressToBase64(newPhotos[i].file);
      const sha = await uploadBlob(base64);
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

    msg('Menyimpan ke GitHub…');
    const isEdit = Boolean(editingId);
    await commitChange(list => {
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) list[idx] = data; else list.push(data);
    }, fileChanges, `${isEdit ? 'Edit' : 'Tambah'} kegiatan ${tanggal}: ${data.judul}`);

    toast(`${isEdit ? 'Perubahan' : 'Kegiatan'} tersimpan. Website diperbarui dalam ±1 menit.`);
    resetForm();
    renderList();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    msg('');
  }
});

async function deleteEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !confirm(`Hapus kegiatan "${e.judul}" (${formatTanggal(e.tanggal)}) beserta fotonya?`)) return;
  try {
    msg('Menghapus…');
    await commitChange(list => {
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) list.splice(idx, 1);
    }, (e.foto || []).map(path => ({ path, delete: true })), `Hapus kegiatan ${e.tanggal}: ${e.judul}`);
    if (editingId === id) resetForm();
    toast('Kegiatan dihapus.');
    renderList();
  } catch (err) {
    toast(err.message, true);
  } finally {
    msg('');
  }
}

// ---------- Daftar ----------
function renderList() {
  const q = $('listCari').value.trim().toLowerCase();
  const list = sortEntries(entries).filter(e => !q || `${e.judul} ${e.keterangan} ${e.tanggal}`.toLowerCase().includes(q));
  if (!list.length) {
    $('entryList').innerHTML = `<p class="empty">${entries.length ? 'Tidak ada yang cocok.' : 'Belum ada kegiatan.'}</p>`;
    return;
  }
  let lastDate = '';
  $('entryList').innerHTML = list.map(e => {
    const head = e.tanggal !== lastDate ? `<h3 class="list-date">${formatTanggal(e.tanggal)}</h3>` : '';
    lastDate = e.tanggal;
    const thumb = e.foto && e.foto.length
      ? `<img src="${esc(rawUrl(e.foto[0]))}" alt="" loading="lazy">`
      : '<div class="no-thumb">—</div>';
    return `${head}<div class="list-item">
      ${thumb}
      <div class="list-info">
        <strong>${esc(e.judul)}</strong>
        <span>${esc(e.jam || '')} · ${esc(e.sesi || sesiDariJam(e.jam))} · ${(e.foto || []).length} foto</span>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${esc(e.id)}">Edit</button>
        <button class="btn btn-danger btn-sm" data-del="${esc(e.id)}">Hapus</button>
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

// ---------- Koneksi ----------
async function connect() {
  if (!S.owner || !S.repo || !S.token) {
    setStatus('Belum terhubung', false);
    return;
  }
  setStatus('Menghubungkan…', false);
  try {
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) throw new Error('Token tidak punya izin menulis ke repository ini.');
    entries = await fetchEntries(S.branch);
    setStatus(`Terhubung ke ${S.owner}/${S.repo}`, true);
    $('cardSettings').classList.add('collapsed');
    renderList();
  } catch (e) {
    setStatus('Gagal terhubung', false);
    $('cardSettings').classList.remove('collapsed');
    toast(e.message, true);
  }
}

function setStatus(text, ok) {
  $('connStatus').textContent = text;
  $('connStatus').classList.toggle('ok', ok);
}

$('formSettings').addEventListener('submit', ev => {
  ev.preventDefault();
  S = {
    owner: $('sOwner').value.trim(),
    repo: $('sRepo').value.trim(),
    branch: $('sBranch').value.trim() || 'main',
    token: $('sToken').value.trim()
  };
  saveSettings();
  connect();
});

$('btnLogout').addEventListener('click', () => {
  S.token = '';
  saveSettings();
  $('sToken').value = '';
  entries = [];
  $('cardSettings').classList.remove('collapsed');
  $('entryList').innerHTML = '<p class="empty">Hubungkan GitHub untuk memuat data.</p>';
  setStatus('Belum terhubung', false);
});

$('connStatus').addEventListener('click', () => $('cardSettings').classList.toggle('collapsed'));

// ---------- Utilitas UI ----------
function msg(text) { $('saveMsg').textContent = text; }

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
  if ($('btnSave').disabled) { ev.preventDefault(); ev.returnValue = ''; }
});

fillSettingsForm();
resetForm();
connect();
