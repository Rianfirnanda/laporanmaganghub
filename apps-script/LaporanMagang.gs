/**
 * Laporan Magang — penerima foto untuk Google Drive (tanpa login Google di panel).
 *
 * Skrip ini berjalan di akun Google Anda sendiri. Panel admin mengirim foto ke
 * sini, lalu skrip menyimpannya ke Drive Anda di folder "Laporan Magang/<tanggal>".
 * Hanya permintaan yang membawa KUNCI yang benar yang diproses.
 *
 * Cara memasang (sekali saja):
 *  1. Buka https://script.google.com → "Proyek baru". Hapus isi Code.gs, lalu
 *     tempel SELURUH kode ini (salin dari panel admin agar KUNCI sudah terisi).
 *  2. Klik Deploy → Deployment baru → ikon roda gigi → "Aplikasi web".
 *     - Jalankan sebagai: Saya
 *     - Yang memiliki akses: Siapa saja
 *  3. Klik Deploy → Beri akses → pilih akun Anda → "Lanjutan" → "Buka … (tidak aman)"
 *     → Izinkan. (Peringatan muncul karena skrip buatan sendiri belum diverifikasi Google.)
 *  4. Salin "URL aplikasi web" (berakhiran /exec) ke panel admin.
 *
 * Bila kode diubah: Deploy → Kelola deployment → edit (ikon pensil) → Versi: Versi baru.
 */

const KUNCI = '__KUNCI_RAHASIA__';
const FOLDER_UTAMA = 'Laporan Magang';

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jawab({ ok: false, error: 'Permintaan tidak valid.' });
  }
  if (KUNCI.indexOf('__') === 0) return jawab({ ok: false, error: 'KUNCI di skrip belum diisi. Salin ulang kode dari panel admin.' });
  if (!req || req.kunci !== KUNCI) return jawab({ ok: false, error: 'Kunci salah.' });
  try {
    switch (req.aksi) {
      case 'ping': return jawab({ ok: true, email: emailSaya(), folder: folderUtama().getUrl() });
      case 'unggah': return jawab(unggah(req));
      case 'daftar': return jawab(daftar(req));
      case 'statistik': return jawab(statistik());
      default: return jawab({ ok: false, error: 'Aksi tidak dikenal.' });
    }
  } catch (err) {
    return jawab({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return jawab({ ok: true, pesan: 'Penerima foto Laporan Magang aktif.' });
}

function jawab(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function emailSaya() {
  try { return Session.getEffectiveUser().getEmail(); } catch (err) { return ''; }
}

function ambilFolder(nama, induk) {
  const it = induk.getFoldersByName(nama);
  return it.hasNext() ? it.next() : induk.createFolder(nama);
}

// Kunci skrip mencegah folder ganda saat beberapa foto diunggah bersamaan.
function denganKunci(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function folderUtama() {
  return denganKunci(function () { return ambilFolder(FOLDER_UTAMA, DriveApp.getRootFolder()); });
}

function folderTanggal(tanggal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tanggal))) throw new Error('Tanggal tidak valid.');
  const utama = folderUtama();
  return denganKunci(function () { return ambilFolder(String(tanggal), utama); });
}

function unggah(req) {
  const nama = String(req.nama || 'foto.jpg').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120);
  const mime = /^image\/[\w.+-]+$/.test(String(req.mime || '')) ? req.mime : 'image/jpeg';
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length) throw new Error('Foto kosong.');
  const file = folderTanggal(req.tanggal).createFile(Utilities.newBlob(bytes, mime, nama));
  return { ok: true, id: file.getId() };
}

function daftar(req) {
  const it = folderUtama().getFoldersByName(String(req.tanggal || ''));
  const files = [];
  if (it.hasNext()) {
    const fit = it.next().getFiles();
    while (fit.hasNext()) {
      const f = fit.next();
      if (!f.isTrashed()) files.push({ id: f.getId(), name: f.getName() });
    }
  }
  return { ok: true, files: files };
}

function statistik() {
  let bytes = 0;
  let jumlah = 0;
  const folders = folderUtama().getFolders();
  while (folders.hasNext()) {
    const fit = folders.next().getFiles();
    while (fit.hasNext()) {
      const f = fit.next();
      if (!f.isTrashed()) { bytes += f.getSize(); jumlah++; }
    }
  }
  return {
    ok: true,
    email: emailSaya(),
    terpakai: DriveApp.getStorageUsed(),
    batas: DriveApp.getStorageLimit(),
    folderBytes: bytes,
    jumlah: jumlah
  };
}
