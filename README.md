# Laporan Kegiatan Magang · BPS Kabupaten Bengkulu Tengah

Website dokumentasi kegiatan harian magang (Program Magang Nasional MagangHub Kemnaker)
yang di-hosting gratis di **GitHub Pages**. Foto dan keterangan kegiatan ditambahkan
lewat **panel admin** (`admin.html`) langsung dari browser/HP, tanpa server atau database.

- `index.html`: halaman publik bergaya dasbor (navbar, hero profil dengan progres "Hari ke-X",
  tab, dan sidebar info instansi & mentor). Terdiri dari tiga tampilan:
  - **Kegiatan Harian**: kegiatan per minggu, per hari, dan per jam (pagi/siang/sore) beserta foto.
  - **Galeri Foto**: semua foto kegiatan.
  - **Rekap Mingguan**: ringkasan tiap minggu dengan tombol lihat detail dan cetak.

  Tersedia filter minggu, tanggal, dan pencarian, serta tombol **Cetak Laporan** (bisa disimpan
  sebagai PDF). Tampilan responsif untuk HP dan laptop.
- `admin.html`: panel yang dikunci dengan kata sandi, terdiri dari tiga tab:
  - **Kegiatan**: tambah, edit, dan hapus kegiatan serta foto. Foto otomatis diperkecil
    (maks. 1600px, JPEG) dan metadata-nya (termasuk lokasi GPS) dibuang.
  - **Profil & Tampilan**: foto profil, nama, posisi, instansi, tanggal magang, mentor pembimbing,
    judul tab, warna tema, serta isi footer (bagian bebas seperti Tentang/Kontak dan daftar tautan).
  - **Keamanan**: status koneksi, ganti kata sandi panel, dan hapus token dari perangkat.

  Setiap penyimpanan menjadi **satu commit** di repository ini (`data/`, `uploads/`).

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
   branch `main`, tempel token, **buat kata sandi panel** (min. 8 karakter), lalu klik **Simpan & hubungkan**.
   Selanjutnya panel cukup dibuka dengan kata sandi tersebut.

## Pemakaian harian

1. Buka `admin.html` di HP atau laptop dan masukkan kata sandi panel.
2. Isi tanggal, jam (sesi pagi/siang/sore terisi otomatis), judul, lokasi, keterangan, dan pilih foto.
3. Klik **Simpan kegiatan**. Website publik diperbarui dalam ±1 menit.

Untuk pemeriksaan mingguan, kirim tautan dengan filter minggu, misalnya
`https://<username>.github.io/laporanmaganghub/?minggu=3`, atau gunakan **Cetak laporan → Simpan sebagai PDF**.

## Jika tampilan berantakan setelah pembaruan

GitHub Pages menyimpan cache file CSS/JS di browser sekitar 10 menit. Setiap file CSS/JS dimuat dengan
penanda versi (`style.css?v=4`), jadi browser otomatis mengambil versi baru. Kalau tampilan masih aneh,
tekan **Ctrl + F5** (atau **Cmd + Shift + R** di Mac) sekali untuk memuat ulang tanpa cache.

Untuk pengembang: setiap kali mengubah file di `assets/`, naikkan angka `?v=` di `index.html` dan `admin.html`.

## Mengubah profil dan tampilan

Buka tab **Profil & Tampilan** di panel admin. Semua pengaturan disimpan di `data/config.json`.
Tanggal mulai dipakai untuk menghitung "Hari ke-" dan "Minggu ke-".

## Keamanan

GitHub Pages hanya menyajikan file statis, jadi tidak ada server yang bisa memeriksa login.
Yang melindungi repository adalah **token GitHub**. Panel ini menjaga token itu sebagai berikut:

| Perlindungan | Keterangan |
|---|---|
| Token terenkripsi | Disimpan di browser dalam bentuk terenkripsi AES-256-GCM, dengan kunci dari kata sandi panel (PBKDF2-SHA256, 310.000 iterasi). Token asli hanya ada di memori selama panel terbuka. |
| Kunci otomatis | Panel terkunci setelah 15 menit tidak aktif, saat tombol **Kunci** ditekan, atau saat halaman dimuat ulang. |
| Batas percobaan | Setelah 5 kali salah kata sandi, percobaan berikutnya ditunda. |
| Content-Security-Policy | Hanya skrip dari situs ini yang boleh berjalan, dan panel admin hanya boleh terhubung ke `api.github.com`. |
| Anti-clickjacking | Panel admin menolak tampil di dalam `<iframe>`. |
| Validasi data | Semua teks di-escape. Tautan footer hanya boleh `https://`, `mailto:`, atau `tel:`, dan foto hanya dari folder `uploads/`. |
| Tautan admin tersembunyi | Tautan "Panel admin" tidak tampil di website kecuali diaktifkan. Halaman admin juga `noindex`. |

Hal yang tetap perlu Anda jaga:

- Gunakan token **fine-grained** yang hanya untuk repo ini dengan izin *Contents: Read and write*
  dan masa berlaku terbatas. Jangan pakai token classic (`ghp_…`).
- Jangan bagikan token atau kata sandi panel. Jika token bocor, cabut di
  <https://github.com/settings/personal-access-tokens> lalu buat yang baru.
- Di komputer umum, klik **Keamanan → Hapus token dari perangkat ini** setelah selesai.
- Karena repository **public**, semua foto dan keterangan bisa dilihat siapa saja. Jangan unggah
  dokumen rahasia, data mentah responden, atau informasi pribadi lain.
