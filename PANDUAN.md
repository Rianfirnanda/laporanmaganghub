# Panduan memakai untuk laporan magang Anda sendiri

Website ini bisa dipakai siapa saja. Semua pengaturan (profil, divisi, instansi, tanggal magang, zona waktu, token GitHub, kunci AI, Google Drive) diatur dari panel admin, tanpa mengubah kode.

## 1. Salin repository

1. Buka repository ini di GitHub, klik **Use this template → Create a new repository**.
   - Pilih akun Anda, beri nama bebas (misalnya `laporan-magang`), dan pilih **Public**. GitHub Pages gratis hanya untuk repo publik.
   - Kalau tombol itu tidak ada, pakai **Fork**. Setelah itu buka tab **Actions** di repo Anda, lalu klik **I understand my workflows, go ahead and enable them**.
2. Di repo Anda, buka **Settings → Pages**. Pilih *Source: Deploy from a branch*, lalu *Branch: main* dan */ (root)*, kemudian **Save**.
   Tunggu 1–2 menit. Website Anda ada di `https://USERNAME.github.io/NAMA-REPO/`.

## 2. Hubungkan panel admin

1. Buat token GitHub di **Settings akun → Developer settings → Fine-grained tokens → Generate new token**:
   - *Repository access*: **Only select repositories**, lalu pilih repo Anda.
   - *Permissions → Repository permissions → Contents*: **Read and write**.
   - Salin token yang diawali `github_pat_…`.
2. Buka `https://USERNAME.github.io/NAMA-REPO/admin.html`. Username dan nama repo terisi otomatis.
3. Tempel token, lalu buat kata sandi panel. Kata sandi ini hanya berlaku di perangkat itu dan dipakai untuk mengenkripsi token.

## 3. Mulai baru

Setelah terhubung, panel mendeteksi bahwa repo ini salinan dan menampilkan kartu **Mulai baru**.

1. Isi nama, posisi, divisi, instansi, program, tanggal magang, dan zona waktu.
2. Centang persetujuan, lalu klik **Kosongkan & mulai baru**.

Dalam satu commit, semua kegiatan, foto, laporan harian, ringkasan AI, profil, dan pengaturan Google Drive milik pemilik lama dihapus. Daftar hari libur nasional tetap disimpan.

Kartu yang sama bisa dibuka lagi kapan saja dari tab **Keamanan → Mulai dari awal**.

## 4. Lengkapi (semuanya opsional)

| Yang diatur | Di mana |
| --- | --- |
| Foto profil, logo instansi, ikon situs, warna, footer, portofolio, mentor, kota tanda tangan | Panel → **Profil** |
| Hari libur nasional & cuti bersama | Panel → **Profil** → *Isi dari SKB* |
| Laporan harian AI (Gemini/Groq, gratis) | Panel → **Laporan** → kartu AI. Kunci dari [aistudio.google.com/apikey](https://aistudio.google.com/apikey) dan [console.groq.com/keys](https://console.groq.com/keys) |
| Laporan AI otomatis walau panel tidak dibuka | Repo → **Settings → Secrets and variables → Actions** → *New repository secret*: `GEMINI_API_KEY` dan/atau `GROQ_API_KEY` |
| Salinan foto ke Google Drive tanpa login | Panel → **Keamanan** → *Google Drive tanpa login (Apps Script)*, ikuti langkah di kartunya |
| Pintasan di HP | Buka panel di Chrome → menu ⋮ → **Tambahkan ke layar utama** |

## Keamanan

- Token GitHub, kunci AI, dan kunci Apps Script **tidak pernah masuk ke repository**. Semuanya disimpan terenkripsi (AES-256, dengan kata sandi panel) di perangkat masing-masing.
- Setiap orang memakai token, akun Google, dan kunci AI **miliknya sendiri**. Jangan bagikan token atau kata sandi panel.
- Repository publik: isi folder `data/` dan `uploads/` (kegiatan dan foto) bisa dilihat siapa saja. Jangan unggah dokumen rahasia kantor.
- Repo hasil *Use this template* atau *Fork* masih menyimpan riwayat commit (termasuk foto) pemilik lama sampai Anda menghapus repo itu. Fitur *Mulai baru* hanya mengosongkan isi terbaru yang tampil di website.
