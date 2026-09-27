# Laporan Kegiatan Magang · BPS Kabupaten Bengkulu Tengah

Website dokumentasi kegiatan harian magang (Program Magang Nasional MagangHub Kemnaker)
yang di-hosting gratis di **GitHub Pages**. Foto dan keterangan kegiatan ditambahkan
lewat **panel admin** (`admin.html`) langsung dari browser/HP, tanpa server atau database.

- `index.html`: halaman publik. Kegiatan dikelompokkan per **minggu** lalu per **hari**
  (pagi / siang / sore), dengan filter minggu, tanggal, dan pencarian, galeri foto, serta
  tombol **Cetak laporan** (bisa disimpan sebagai PDF untuk laporan mingguan).
- `admin.html`: tambah, edit, dan hapus kegiatan serta unggah foto. Foto otomatis diperkecil
  (maks. 1600px, JPEG) lalu disimpan ke folder `uploads/`, dan data ke `data/kegiatan.json`.
  Setiap penyimpanan menjadi **satu commit** di repository ini.

## Cara memasang (sekali saja)

1. **Gabungkan ke branch `main`** (merge branch ini ke `main`).
2. **Aktifkan GitHub Pages**: *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
   pilih branch `main` dan folder `/ (root)`, lalu **Save**.
   Setelah ±1 menit website tersedia di `https://<username>.github.io/laporanmaganghub/`.
   > Untuk akun GitHub gratis, repository harus **public** agar GitHub Pages bisa dipakai.
3. **Buat token GitHub** untuk panel admin:
   *Settings akun → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*
   - Repository access: **Only select repositories** → pilih `laporanmaganghub`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Atur masa berlaku sampai akhir magang (mis. April 2027), lalu salin tokennya.
4. Buka `https://<username>.github.io/laporanmaganghub/admin.html`, isi username, nama repo,
   branch `main`, tempel token, lalu klik **Simpan & hubungkan**.

## Pemakaian harian

1. Buka `admin.html` di HP atau laptop.
2. Isi tanggal, jam (sesi pagi/siang/sore terisi otomatis), judul, lokasi, keterangan, dan pilih foto.
3. Klik **Simpan kegiatan**. Website publik diperbarui dalam ±1 menit.

Untuk pemeriksaan mingguan, kirim tautan dengan filter minggu, misalnya
`https://<username>.github.io/laporanmaganghub/?minggu=3`, atau gunakan **Cetak laporan → Simpan sebagai PDF**.

## Mengubah profil

Edit `data/config.json` (nama, posisi, instansi, tanggal mulai dan selesai magang).
Tanggal mulai dipakai untuk menghitung "Hari ke-" dan "Minggu ke-".

## Catatan keamanan

- Token hanya disimpan di browser yang dipakai (localStorage). Klik **Hapus token** jika memakai
  perangkat orang lain, dan jangan pernah menaruh token di dalam file repository.
- Siapa pun bisa membuka `admin.html`, tetapi tanpa token tidak ada yang bisa diubah.
- Karena repository public, semua foto yang diunggah bisa dilihat publik. Hindari mengunggah
  dokumen rahasia, data mentah responden, atau informasi pribadi lain.
