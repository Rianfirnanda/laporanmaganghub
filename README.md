# Laporan Kegiatan Magang

Website untuk mencatat kegiatan magang setiap hari, lengkap dengan foto, lokasi, dan laporan harian yang ditulis AI. Semua diatur dari panel admin, tanpa perlu mengubah kode. Gratis, berjalan di GitHub Pages.

## Apa saja yang bisa dilakukan

- **Catat kegiatan dari HP.** Ambil foto langsung dari kamera. Lokasi GPS dan jam diisi otomatis dari waktu server, jadi tidak bisa diakali dengan mengubah jam HP.
- **Laporan harian otomatis.** AI menulis ringkasan kegiatan, pembelajaran, dan kendala dari catatan Anda. Tinggal salin ke monev MagangHub.
- **Dasbor publik.** Menampilkan progres magang, kegiatan per hari, galeri foto, dan rekap mingguan.
- **Laporan mingguan siap cetak.** Versi dokumen A4 dan versi slide, bisa disimpan sebagai PDF.
- **Hari kerja dihitung dengan benar.** Hanya Senin sampai Jumat, di luar libur nasional dan cuti bersama.
- **Salinan foto ke Google Drive.** Foto asli ikut tersimpan di Drive Anda tanpa perlu login berulang.
- **Notifikasi push.** HP Anda diberi kabar saat laporan AI selesai atau gagal, saat ada perubahan data, dan saat website diperbarui.
- **Bisa dipakai teman.** Siapa pun bisa menyalin repo ini dan memakainya untuk laporan sendiri.

## Mulai pakai

Langkah ini untuk yang baru menyalin repo. Cukup sekali.

1. **Salin repo.** Klik **Use this template** lalu **Create a new repository**. Pilih akun Anda, beri nama bebas, dan pilih **Public**.
2. **Nyalakan website.** Di repo baru, buka **Settings → Pages**. Pilih *Deploy from a branch*, branch **main**, folder **/ (root)**, lalu **Save**. Tunggu 1 sampai 2 menit. Alamat website Anda: `https://USERNAME.github.io/NAMA-REPO/`.
3. **Buat token GitHub.** Buka **Settings akun → Developer settings → Fine-grained tokens → Generate new token**.
   - *Repository access*: **Only select repositories**, pilih repo Anda.
   - *Permissions*: **Contents** diisi **Read and write**.
   - Salin tokennya (diawali `github_pat_`).
4. **Buka panel admin** di `https://USERNAME.github.io/NAMA-REPO/admin.html`. Tempel token, lalu buat kata sandi panel.
5. **Mulai baru.** Panel akan mengenali bahwa repo ini hasil salinan. Isi nama, posisi, divisi, instansi, dan tanggal magang, lalu tekan **Kosongkan & mulai baru**. Data milik pemilik lama terhapus dan website menjadi milik Anda.
6. **Pasang di HP.** Buka panel di Chrome, ketuk menu ⋮ lalu **Tambahkan ke layar utama**. Panel sekarang bisa dibuka seperti aplikasi.

## Pemakaian sehari-hari

| Kapan | Yang dilakukan |
| --- | --- |
| Saat ada kegiatan | Buka panel, ketuk **Ambil foto**, isi judul kegiatan, lalu **Simpan**. Kalau ada masalah, tulis di kolom **Kendala** agar ikut masuk laporan harian. |
| Sore sebelum absen | Buka tab **Laporan**. Laporan AI sudah siap. Salin tiga isiannya ke monev MagangHub. |
| Sakit atau izin | Tab **Laporan**, pilih status **Sakit** atau **Izin**, tulis keterangan, lalu simpan. |
| Akhir minggu | Di dasbor, buka **Laporan** atau **Slide**, pilih minggunya, lalu **Cetak** (bisa disimpan sebagai PDF). |

Setelah menyimpan, website publik ikut berubah dalam 1 sampai 2 menit. Halaman memuat versi terbaru sendiri, jadi tidak perlu hapus cache.

## Pengaturan tambahan

Semuanya opsional dan bisa diatur kapan saja.

| Fitur | Cara mengatur |
| --- | --- |
| Profil, foto, logo, warna, footer, mentor, zona waktu | Panel, tab **Profil** |
| Hari libur nasional dan cuti bersama | Tab **Profil**, tombol **Isi dari SKB** |
| Kunci AI (gratis) | Tab **Laporan**, kartu AI. Ambil kunci di [Google AI Studio](https://aistudio.google.com/apikey) dan/atau [Groq](https://console.groq.com/keys) |
| Laporan AI tetap jalan walau panel tidak dibuka | Di repo: **Settings → Secrets and variables → Actions → New repository secret**, isi `GEMINI_API_KEY` dan/atau `GROQ_API_KEY` |
| Salinan foto ke Google Drive | Tab **Keamanan**, kartu **Google Drive tanpa login (Apps Script)**. Ikuti langkah di kartunya |
| Notifikasi push | Tab **Keamanan**, kartu **Notifikasi push**. Buat kunci, simpan sebagai secret `VAPID_PRIVATE_KEY`, lalu **Aktifkan di perangkat ini**. Di iPhone, tambahkan ke layar utama dulu (iOS 16.4 ke atas) |
| HP atau laptop kedua | Buka panel, hubungkan dengan token yang sama. Untuk Google Drive, di perangkat pertama ketuk **Pasang di perangkat lain**, lalu ketik kode yang muncul di perangkat kedua |

## Keamanan

- Token GitHub, kunci AI, dan kunci Google Drive **tidak pernah disimpan di repo**. Semuanya terenkripsi (AES-256) di perangkat Anda dengan kata sandi panel.
- Kunci rahasia notifikasi hanya disimpan sebagai secret GitHub. Alamat notifikasi tiap perangkat disimpan terenkripsi dan hanya bisa dibuka oleh GitHub Actions milik Anda.
- Pakai token fine-grained yang hanya bisa mengakses repo ini. Jangan bagikan token atau kata sandi panel ke siapa pun.
- Repo ini publik. Kegiatan dan foto di folder `data/` dan `uploads/` bisa dilihat semua orang. Jangan unggah dokumen rahasia kantor.
- Repo hasil salinan masih menyimpan riwayat lama pemilik sebelumnya. **Mulai baru** hanya mengosongkan isi yang tampil di website.

## Kalau ada kendala

- **Lupa kata sandi panel.** Ketuk **Lupa kata sandi?**, lalu masukkan token lagi dan buat kata sandi baru.
- **Muncul pesan token tidak valid.** Token sudah kedaluwarsa. Buat token baru, lalu di tab **Keamanan** ketuk **Hapus token dari perangkat ini** dan hubungkan ulang.
- **Laporan AI tidak muncul sendiri.** Periksa secret `GEMINI_API_KEY` atau `GROQ_API_KEY` di repo, lalu lihat tab **Actions** di GitHub.
- **Notifikasi tidak datang.** Pastikan secret `VAPID_PRIVATE_KEY` sudah ada dan izin notifikasi di browser tidak diblokir, lalu ketuk **Kirim tes**.
- **Foto gagal tersalin ke Drive.** Di tab **Keamanan**, ketuk **Cek URL** pada kartu Apps Script. Harus muncul pesan "aktif".
