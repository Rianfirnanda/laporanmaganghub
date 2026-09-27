# Laporan Kegiatan Magang

Website pribadi untuk mencatat kegiatan magang setiap hari, khusus untuk peserta **Program Magang Nasional MagangHub Kemnaker**. Anda cukup memotret kegiatan dari HP, lalu website ini menyusun dokumentasi, laporan harian untuk monev, dan laporan mingguan secara otomatis.

Semuanya **gratis**, tidak perlu bisa coding, dan semua pengaturan dilakukan lewat tombol di panel admin.

---

## Daftar isi

1. [Apa yang bisa dilakukan](#apa-yang-bisa-dilakukan)
2. [Istilah yang perlu diketahui](#istilah-yang-perlu-diketahui)
3. [Yang perlu disiapkan](#yang-perlu-disiapkan)
4. [Langkah 1: Salin repository](#langkah-1-salin-repository)
5. [Langkah 2: Nyalakan website](#langkah-2-nyalakan-website)
6. [Langkah 3: Buat token GitHub](#langkah-3-buat-token-github)
7. [Langkah 4: Masuk ke panel admin](#langkah-4-masuk-ke-panel-admin)
8. [Langkah 5: Mulai baru dan isi profil](#langkah-5-mulai-baru-dan-isi-profil)
9. [Langkah 6: Pasang di HP](#langkah-6-pasang-di-hp)
10. [Langkah 7: Nyalakan AI untuk laporan harian](#langkah-7-nyalakan-ai-untuk-laporan-harian)
11. [Pemakaian sehari-hari](#pemakaian-sehari-hari)
12. [Fitur tambahan (opsional)](#fitur-tambahan-opsional)
13. [Memakai di HP atau laptop kedua](#memakai-di-hp-atau-laptop-kedua)
14. [Keamanan dan privasi](#keamanan-dan-privasi)
15. [Kalau ada kendala](#kalau-ada-kendala)

---

## Apa yang bisa dilakukan

| Fitur | Penjelasan singkat |
| --- | --- |
| **Catat kegiatan dari HP** | Foto langsung dari kamera. Lokasi GPS dan jam diisi otomatis dari waktu server, jadi tidak bisa diakali dengan mengubah jam HP. |
| **Laporan harian otomatis** | AI menulis **Uraian Aktivitas**, **Pembelajaran yang Diperoleh**, dan **Kendala yang Dialami**, sama seperti kolom di monev MagangHub. Anda tinggal salin. |
| **Website dokumentasi** | Halaman publik berisi progres magang, kegiatan per hari, galeri foto, dan rekap mingguan. Bisa ditunjukkan ke mentor atau atasan. |
| **Laporan mingguan** | Versi dokumen A4 dan versi slide presentasi, bisa dicetak atau disimpan sebagai PDF. |
| **Hitungan hari kerja** | Hanya Senin sampai Jumat, di luar libur nasional dan cuti bersama. |
| **Salinan ke Google Drive** | Foto asli otomatis tersimpan juga di Google Drive Anda. |
| **Notifikasi di HP** | Kabar saat laporan AI selesai atau gagal, dan saat ada perubahan data. |

---

## Istilah yang perlu diketahui

Tidak perlu hafal, cukup dibaca sekali supaya langkah-langkah di bawah lebih mudah dipahami.

| Istilah | Artinya |
| --- | --- |
| **GitHub** | Situs penyimpanan file milik Microsoft. Semua data laporan Anda disimpan di sini, gratis. |
| **Repository (repo)** | "Folder" proyek di GitHub. Website Anda berasal dari repo ini. |
| **GitHub Pages** | Layanan gratis dari GitHub yang mengubah repo menjadi website yang bisa dibuka siapa saja. |
| **Panel admin** | Halaman khusus Anda (`admin.html`) untuk menambah kegiatan dan mengatur website. Dikunci dengan kata sandi. |
| **Token** | Semacam "kunci akses" yang mengizinkan panel admin menyimpan data ke repo Anda. Dibuat sekali di GitHub. |
| **Secret** | Tempat menyimpan kunci rahasia di pengaturan repo GitHub, dipakai oleh robot otomatis. Isinya tidak bisa dilihat orang lain. |
| **Kunci API** | Kode dari layanan AI (Google Gemini atau Groq) agar website bisa memakai AI secara gratis. |

---

## Yang perlu disiapkan

- **Akun GitHub.** Kalau belum punya, daftar gratis di [github.com/signup](https://github.com/signup) memakai email Anda.
- **Akun Google** (Gmail). Dipakai untuk kunci AI Gemini dan salinan foto ke Google Drive.
- **HP dengan Google Chrome** (Android) atau **Safari** (iPhone), dan sebaiknya juga laptop untuk penyiapan awal. Penyiapan lebih nyaman di laptop.
- Waktu sekitar **20 sampai 30 menit** untuk penyiapan pertama. Setelah itu, pemakaian harian hanya beberapa detik.

---

## Langkah 1: Salin repository

1. Login ke GitHub, lalu buka halaman repository ini.
2. Klik tombol hijau **Use this template**, lalu pilih **Create a new repository**.
3. Isi formulirnya:
   - **Owner**: pilih akun Anda.
   - **Repository name**: nama bebas, misalnya `laporan-magang`. Nama ini akan menjadi bagian alamat website Anda.
   - Pilih **Public**. GitHub Pages gratis hanya untuk repo publik.
4. Klik **Create repository**. Tunggu beberapa detik sampai repo baru Anda terbuka.

> Kalau tombol **Use this template** tidak ada, klik **Fork** lalu **Create fork**. Setelah itu buka tab **Actions** di repo Anda dan klik **I understand my workflows, go ahead and enable them** supaya robot otomatis bisa berjalan.

---

## Langkah 2: Nyalakan website

1. Di repo baru Anda, klik tab **Settings** (ikon roda gigi, di deretan menu atas).
2. Di menu kiri, klik **Pages**.
3. Pada bagian **Build and deployment**:
   - **Source**: pilih **Deploy from a branch**.
   - **Branch**: pilih **main**, lalu folder **/ (root)**.
   - Klik **Save**.
4. Tunggu 1 sampai 2 menit, lalu muat ulang halaman itu. Akan muncul tulisan **Your site is live at** diikuti alamat website Anda, bentuknya:

   ```
   https://USERNAME.github.io/NAMA-REPO/
   ```

   Ganti `USERNAME` dengan username GitHub Anda dan `NAMA-REPO` dengan nama repo tadi. Simpan alamat ini.

Saat pertama dibuka, website masih menampilkan data pemilik lama dengan pemberitahuan kuning di atasnya. Itu normal dan akan hilang di Langkah 5.

---

## Langkah 3: Buat token GitHub

Token ini mengizinkan panel admin menyimpan kegiatan ke repo Anda. Buat sekali saja.

1. Klik foto profil Anda di pojok kanan atas GitHub, lalu **Settings**.
2. Gulir ke paling bawah menu kiri, klik **Developer settings**.
3. Klik **Personal access tokens**, lalu **Fine-grained tokens**, lalu tombol **Generate new token**.
4. Isi formulirnya:
   - **Token name**: bebas, misalnya `Laporan Magang`.
   - **Expiration**: pilih tanggal yang melewati akhir masa magang Anda (pilih **Custom** bila perlu). Kalau token kedaluwarsa, panel tidak bisa menyimpan data sampai Anda membuat token baru.
   - **Repository access**: pilih **Only select repositories**, lalu pilih repo laporan Anda saja.
   - **Permissions**: pada bagian **Repository permissions**, cari **Contents** dan ubah menjadi **Read and write**. (Pada tampilan GitHub yang baru, klik **Add permissions**, centang **Contents**, lalu pilih **Read and write**.)
5. Klik **Generate token**, lalu **salin token** yang muncul (diawali `github_pat_`).

> Token hanya ditampilkan sekali. Tempel dulu di catatan sementara, lalu hapus catatan itu setelah Langkah 4 selesai. Jangan kirim token ke siapa pun.

---

## Langkah 4: Masuk ke panel admin

1. Buka alamat website Anda ditambah `admin.html`, contohnya:

   ```
   https://USERNAME.github.io/NAMA-REPO/admin.html
   ```

2. Muncul kartu **Hubungkan ke GitHub**. Kolom **Username / owner** dan **Nama repository** biasanya sudah terisi otomatis. Periksa sekali lagi.
3. Tempel token ke kolom **Token GitHub**.
4. Buat **Kata sandi panel** (minimal 8 karakter) dan ulangi di kolom berikutnya. Kata sandi ini dipakai untuk membuka panel di perangkat ini. Pakai kata sandi yang tidak mudah ditebak dan jangan lupa.
5. Klik **Simpan & hubungkan**.

Setelah itu, setiap membuka panel Anda cukup mengetik kata sandi panel. Centang **Tetap masuk di perangkat ini (30 hari)** supaya tidak perlu mengetik kata sandi setiap kali.

---

## Langkah 5: Mulai baru dan isi profil

Karena repo Anda hasil salinan, panel otomatis menampilkan kartu **Mulai baru**.

1. Isi **Nama lengkap**, **Posisi**, **Divisi / unit kerja** (boleh kosong), **Instansi**, dan **Keterangan program**.
2. Isi **Tanggal mulai magang** dan **Tanggal selesai magang** sesuai surat penempatan.
3. Pilih **Zona waktu**: WIB, WITA, atau WIT sesuai lokasi magang.
4. Centang pernyataan persetujuan, lalu klik **Kosongkan & mulai baru**.

Semua data pemilik lama (kegiatan, foto, laporan, profil) dihapus dari repo Anda, dan website menjadi milik Anda. Daftar hari libur nasional tetap disimpan.

Setelah itu, lengkapi di tab **Profil**:

- **Ganti foto profil** dan **logo instansi**.
- **Warna tema** website.
- **Hari libur nasional & cuti bersama**: klik **Isi dari SKB** agar tanggal merah otomatis tidak dihitung sebagai hari kerja. Tambahkan libur daerah dengan **Tambah tanggal**.
- **Nama mentor pembimbing** dan **Kota tanda tangan laporan** (untuk laporan mingguan).
- **Footer**: tautan portofolio, teks kredit, dan informasi lain di bagian bawah website.

Klik **Simpan pengaturan** setiap selesai mengubah. Website publik ikut berubah dalam 1 sampai 2 menit.

---

## Langkah 6: Pasang di HP

Supaya panel bisa dibuka seperti aplikasi:

- **Android (Chrome)**: buka panel admin, ketuk menu **⋮** di kanan atas, lalu **Tambahkan ke layar utama** atau **Instal aplikasi**.
- **iPhone (Safari)**: buka panel admin, ketuk tombol **Bagikan**, lalu **Tambahkan ke Layar Utama**.

Kalau HP berbeda dengan perangkat yang dipakai di Langkah 4, hubungkan dulu dengan token yang sama. Caranya ada di bagian [Memakai di HP atau laptop kedua](#memakai-di-hp-atau-laptop-kedua).

---

## Langkah 7: Nyalakan AI untuk laporan harian

AI menulis laporan harian dari catatan kegiatan Anda. Ada dua layanan gratis; cukup satu, tetapi memasang keduanya membuat AI jarang gagal.

### a. Ambil kunci API

- **Google Gemini**: buka [aistudio.google.com/apikey](https://aistudio.google.com/apikey), login dengan akun Google, klik **Create API key**, lalu salin kuncinya (diawali `AIza`).
- **Groq** (cadangan): buka [console.groq.com/keys](https://console.groq.com/keys), daftar atau login, klik **Create API Key**, lalu salin kuncinya (diawali `gsk_`).

### b. Masukkan ke panel

1. Buka panel admin, tab **Laporan**, kartu **Asisten AI**.
2. Tempel kunci ke **Kunci API Gemini** dan/atau **Kunci API Groq, cadangan**.
3. Isi **Kata sandi panel**, lalu klik **Simpan kunci**.

Mulai sekarang, setiap kali Anda menyimpan kegiatan, laporan harian untuk tanggal itu langsung ditulis AI.

### c. Robot otomatis (disarankan)

Supaya laporan tetap ditulis walaupun panel tidak dibuka, simpan kunci yang sama sebagai **secret** di GitHub:

1. Di repo Anda, klik **Settings**, lalu di menu kiri **Secrets and variables**, lalu **Actions**.
2. Klik **New repository secret**.
3. Isi **Name** dengan `GEMINI_API_KEY` dan **Secret** dengan kunci Gemini, lalu klik **Add secret**.
4. Ulangi untuk Groq dengan nama `GROQ_API_KEY` bila punya.

Robot berjalan sendiri sekitar 1 menit setelah Anda menyimpan kegiatan, dan sekali lagi setiap hari pukul 15.40 WIB.

---

## Pemakaian sehari-hari

### Mencatat kegiatan (pagi, siang, sore)

1. Buka panel dari ikon di layar HP.
2. Ketuk **Ambil foto** untuk membuka kamera, atau pilih **Galeri / file** untuk foto yang sudah ada. Boleh lebih dari satu foto.
3. Isi **Judul kegiatan**, misalnya "Entri data Susenas". **Tanggal**, **Jam**, **Sesi**, dan **Lokasi** terisi otomatis; ubah bila perlu.
4. Tulis **Keterangan** singkat: apa yang dikerjakan, hasilnya, dan dengan siapa.
5. Kalau ada masalah, tulis di kolom **Kendala** (misalnya "jaringan kantor sempat putus"). Kosongkan bila tidak ada.
6. Ketuk **Simpan kegiatan**.

Boleh mencatat beberapa kali sehari. Setiap kegiatan baru membuat laporan harian hari itu diperbarui otomatis.

### Mengisi monev MagangHub (sore hari)

1. Buka panel, tab **Laporan**.
2. Pilih **Tanggal** hari ini. Laporan AI sudah terisi di tiga kolom:
   - **Uraian Aktivitas**
   - **Pembelajaran yang Diperoleh**
   - **Kendala yang Dialami**
3. Ketuk **Salin** di tiap kolom, lalu tempel ke kolom yang sama di portal monev MagangHub.
4. Kalau ingin mengubah isi, edit langsung lalu ketuk **Simpan laporan**. Laporan yang sudah Anda edit tidak akan ditimpa AI.
5. Kurang cocok dengan hasil AI? Ketuk **Tulis ulang dengan AI** untuk versi baru.

### Sakit atau izin

1. Tab **Laporan**, pilih tanggalnya.
2. Ubah **Status kehadiran** menjadi **Sakit** atau **Izin**, tulis keterangannya.
3. Ketuk **Simpan laporan**. Hari itu tercatat di dasbor dan laporan mingguan.

### Laporan mingguan (akhir minggu)

1. Buka website publik Anda, klik **Laporan** (dokumen A4) atau **Slide** (presentasi).
2. Pilih minggu yang diinginkan.
3. Klik **Cetak / Simpan PDF**. Di jendela cetak, pilih **Simpan sebagai PDF**, ukuran kertas **A4**, dan centang **Grafis latar belakang** agar warna ikut tercetak.

---

## Fitur tambahan (opsional)

### Salinan foto ke Google Drive

Foto asli otomatis tersimpan juga ke Google Drive Anda di folder **Laporan Magang/tanggal**, tanpa perlu login Google setiap kali. Penyiapan sekali, sekitar 5 menit, sebaiknya di laptop.

1. Panel admin, tab **Keamanan**, kartu **Google Drive tanpa login (Apps Script)**. Klik **Salin kode skrip**.
2. Buka [script.google.com](https://script.google.com/home/projects/create) (login dengan akun Google yang Drive-nya ingin dipakai). Proyek baru langsung terbuka.
3. Hapus seluruh isi file `Code.gs`, tempel kode tadi, lalu klik ikon **Simpan** (disket).
4. Klik **Terapkan** (Deploy), lalu **Deployment baru**. Klik ikon roda gigi di samping **Pilih jenis**, pilih **Aplikasi web**, lalu atur:
   - **Jalankan sebagai**: **Saya**
   - **Yang memiliki akses**: **Siapa saja** (bukan "Siapa saja yang memiliki Akun Google")
5. Klik **Terapkan**, lalu **Izinkan akses**. Pilih akun Google Anda. Muncul peringatan "Google belum memverifikasi aplikasi ini"; ini wajar karena skripnya buatan sendiri. Klik **Lanjutan**, lalu **Buka … (tidak aman)**, lalu **Izinkan**.
6. Salin **URL aplikasi web** (berakhiran `/exec`) dan tempel di kolom **URL aplikasi web** pada panel.
7. Klik **Cek URL**. Tab baru harus menampilkan tulisan `"Penerima foto Laporan Magang aktif."`.
8. Isi **Kata sandi panel**, lalu klik **Simpan & tes**. Status berubah menjadi **Aktif · tanpa login**.

### Notifikasi di HP

1. Panel, tab **Keamanan**, kartu **Notifikasi push**. Klik **Buat kunci notifikasi**.
2. Muncul kotak kuning berisi kunci rahasia. Klik **Salin**, lalu klik tautan di kotak itu untuk membuka halaman secret GitHub.
3. Buat secret baru: **Name** `VAPID_PRIVATE_KEY`, **Secret** tempel kunci tadi, lalu **Add secret**.
4. Kembali ke panel, klik **Sudah saya simpan**.
5. Pilih jenis notifikasi yang diinginkan, klik **Aktifkan di perangkat ini**, lalu pilih **Izinkan** saat browser meminta izin.
6. Klik **Kirim tes**. Notifikasi uji muncul dalam sekitar 30 sampai 90 detik.

Di iPhone, notifikasi hanya bekerja bila panel dibuka dari ikon di layar utama (iOS 16.4 ke atas).

### Lainnya

| Fitur | Tempat mengatur |
| --- | --- |
| Tanda tangan kota, mentor, zona waktu | Tab **Profil** |
| Menyembunyikan tombol "Panel admin" di website | Tab **Profil**, bagian **Tampilan** |
| Mengganti kata sandi panel | Tab **Keamanan**, kartu **Ganti kata sandi panel** |
| Melihat sisa kapasitas penyimpanan | Tab **Keamanan**, kartu **Penyimpanan** |
| Mengosongkan semua data dan mulai lagi | Tab **Keamanan**, kartu **Mulai dari awal** |

---

## Memakai di HP atau laptop kedua

Setiap perangkat perlu dihubungkan sekali.

1. Buka `admin.html` di perangkat kedua.
2. Tempel **token GitHub** yang sama (atau buat token baru seperti Langkah 3), lalu buat kata sandi panel untuk perangkat ini.
3. **Kunci AI**: masukkan lagi di kartu **Asisten AI**.
4. **Google Drive**: di perangkat pertama, buka kartu **Google Drive tanpa login** dan klik **Pasang di perangkat lain**. Muncul kode seperti `K7QM4-XPA9D` yang berlaku 15 menit. Di perangkat kedua, ketik kode itu di kolom **Kode pasangan**, isi kata sandi panel, lalu klik **Pasang**. Skrip di Google tidak perlu diubah.
5. **Notifikasi**: klik **Aktifkan di perangkat ini** di perangkat kedua.

---

## Keamanan dan privasi

- **Token, kunci AI, dan kunci Google Drive tidak pernah disimpan di repo.** Semuanya dienkripsi (AES-256) dengan kata sandi panel dan hanya tersimpan di perangkat Anda.
- **Kunci notifikasi** hanya disimpan sebagai secret GitHub. Alamat notifikasi tiap perangkat disimpan terenkripsi.
- **Pakai token fine-grained** yang hanya bisa mengakses repo laporan. Jangan bagikan token, kata sandi panel, atau kode pasangan kepada siapa pun.
- **Repo ini publik.** Semua isi kegiatan, keterangan, kolom kendala, dan foto bisa dilihat orang lain. Jangan unggah dokumen rahasia kantor, data pribadi responden, atau foto layar berisi data sensitif.
- **Repo hasil salinan** masih menyimpan riwayat file pemilik sebelumnya di GitHub. Tombol **Mulai baru** hanya mengosongkan isi yang tampil di website.
- Kalau HP hilang atau memakai perangkat orang lain, buka tab **Keamanan** lalu klik **Hapus token dari perangkat ini**. Bila perlu, cabut token di GitHub (**Settings → Developer settings → Fine-grained tokens**).

---

## Kalau ada kendala

| Masalah | Solusi |
| --- | --- |
| Website belum berubah setelah menyimpan | Tunggu 1 sampai 2 menit. Halaman memuat versi terbaru sendiri, tidak perlu hapus cache. |
| Lupa kata sandi panel | Di layar kunci, klik **Lupa kata sandi?**, lalu masukkan token lagi dan buat kata sandi baru. |
| Muncul pesan "Token tidak valid atau sudah kedaluwarsa" | Buat token baru (Langkah 3). Di tab **Keamanan**, klik **Hapus token dari perangkat ini**, lalu hubungkan ulang. |
| Muncul pesan "Token tidak punya izin menulis" | Buka pengaturan token di GitHub, pastikan repo laporan dipilih dan **Contents** diatur **Read and write**. |
| Laporan AI tidak muncul | Pastikan kunci AI sudah disimpan di kartu **Asisten AI**. Untuk robot, periksa secret `GEMINI_API_KEY` atau `GROQ_API_KEY`, lalu lihat tab **Actions** di repo. |
| AI "sedang sibuk" | Layanan gratis kadang penuh. Tunggu beberapa menit lalu klik **Tulis ulang dengan AI**, atau tambahkan kunci Groq sebagai cadangan. |
| Foto tidak tersalin ke Drive, muncul "Apps Script tidak bisa dibaca" | Klik **Cek URL**. Kalau yang muncul halaman login Google, buka script.google.com, **Terapkan → Kelola deployment**, edit, pastikan **Yang memiliki akses: Siapa saja**, pilih **Versi baru**, lalu **Terapkan**. |
| Muncul "Kunci di perangkat ini tidak cocok dengan skrip" | Perangkat ini belum tersambung. Pakai **kode pasangan** dari perangkat yang sudah tersambung. |
| Notifikasi tidak datang | Pastikan secret `VAPID_PRIVATE_KEY` sudah ada, izin notifikasi di browser tidak diblokir, lalu klik **Kirim tes**. |
| Foto "tidak bisa dibaca" | Foto dari Google Foto atau cloud mungkin belum terunduh penuh. Buka dulu fotonya di galeri sampai tampil jelas, lalu pilih ulang. |
| Indikator jaringan di panel merah atau kuning | Sinyal sedang lemah. Tunggu sampai hijau sebelum mengunggah banyak foto. |
