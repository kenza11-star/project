# Ruang Hari · 1.1

Ruang untuk rencana, cerita, dan jeda kecilmu. Aplikasi harian menggunakan **HTML, CSS, JavaScript murni** dan **localStorage**, dibungkus dengan Capacitor untuk Android. Gaya putih abu-abu, panel kaca, aksen hitam, dan navigasi yang nyaman di HP.

## Fitur

- Tugas: tambah, edit, hapus, centang selesai, kategori, prioritas, tanggal/jam, pencarian, filter, kalender mingguan, dan progres nyata.
- Jurnal: cerita harian, tanggal, suasana hati, edit dan hapus.
- Profil: nama panggilan, bio, foto dari perangkat atau inisial. Nama tampil di dashboard. Foto dipotong persegi dan diperkecil menjadi 256px agar hemat ruang.
- Animasi saat scroll menggunakan IntersectionObserver dan transisi berpindah tab. Menghormati pengaturan Reduce Motion perangkat.
- Pengingat Android lokal terjadwal dan pengingat web selama halaman terbuka.
- Pemutar musik lokal: playlist, play/pause, previous/next, seek, serta penyimpanan audio di perangkat.
- Timer fokus 25 menit.
- Ekspor/impor cadangan JSON berisi tugas, jurnal, dan profil. Impor menambahkan tugas/jurnal yang ID-nya belum ada, dan meminta pilihan sebelum mengganti profil.
- GitHub Actions untuk APK debug yang dapat dipasang.

## Penyimpanan

**Tidak memerlukan backend, akun, Supabase, atau database server.**

| Data | Tempat penyimpanan |
| --- | --- |
| Tugas dan jurnal | localStorage: `rh.local` |
| Nama, bio, foto profil | localStorage: `rh.profile` |
| Riwayat pengingat | localStorage: `rh.inbox`, `rh.notified` |
| Berkas musik | IndexedDB: `ruang-hari-music` |

Musik memakai IndexedDB karena file audio terlalu besar untuk kuota localStorage. Musik tidak dimasukkan ke cadangan JSON. Tidak ada berkas pengguna yang diunggah ke server. Data bertahan setelah aplikasi/browser ditutup, selama data aplikasi tidak dihapus. Aplikasi dan versi web memiliki ruang penyimpanan terpisah; gunakan ekspor/impor untuk memindahkan data.

Jika sebelumnya memakai mode lokal versi 1.0 pada origin/perangkat yang sama, tugas dan jurnal tetap terbaca karena kunci `rh.local` dipertahankan. Versi 1.1 tidak lagi menghubungkan ke backend lama; data akun lama perlu diekspor dari versi lama kemudian diimpor di sini.

## Coba versi web

Butuh Node.js 22.16+:

```bash
npm ci
npm start
```

Buka `http://localhost:3000`. `npm start` hanya menjalankan server file statis untuk pengembangan, bukan backend/database. Untuk hosting cukup unggah isi folder `dist` ke hosting statis HTTPS. HTTPS diperlukan untuk notifikasi sistem web pada browser yang mendukungnya.

Pengembangan frontend bisa langsung mengedit `dist/index.html`, `dist/style.css`, `dist/app.js`. Script `build:web` hanya membundel bridge plugin Android ke `dist/native.js`; tidak mengubah implementasi frontend menjadi framework.

## Build APK melalui GitHub Actions dari HP

Push ke `main`/`master` memicu workflow **Build Android APK**. Bisa juga secara manual:

1. Buka tab **Actions** repository.
2. Pilih **Build Android APK → Run workflow → Run workflow**.
3. Tunggu job berhasil.
4. Buka run → **Artifacts → Ruang-Hari-Android-APK**.
5. Unduh artifact ZIP, ekstrak `app-debug.apk`, lalu pasang di Android.
6. Buka Pengaturan aplikasi → **Aktifkan** pengingat.

Workflow memakai Node 22, Java 21, Android SDK, `npm ci`, pemeriksaan sintaks, bundle bridge, Capacitor sync, resource ikon, dan Gradle `assembleDebug`. APK berisi frontend lokal sehingga tidak memerlukan server untuk digunakan.

**Hasilnya APK debug**, bukan AAB/release untuk Play Store. Kunci debug runner dapat berbeda antar-run; jika update APK ditolak karena tanda tangan berbeda, ekspor data dahulu sebelum menghapus aplikasi lama. Musik perlu dipilih ulang setelah data aplikasi dihapus.

### Build lokal opsional

Butuh Java 21 dan Android SDK:

```bash
npm ci
npm run android:init
node scripts/android-resources.mjs
cd android
./gradlew assembleDebug
```

`android:init` untuk pertama kali; sesudahnya gunakan `npm run android:sync`, jalankan script resources lagi, lalu Gradle. Folder Android dibuat otomatis dan tidak dikomit.

## Pengingat, animasi, dan batasan

- Android meminta izin notifikasi. Jadwal diserahkan ke OS sehingga dapat muncul saat UI tidak terbuka. Tanpa izin alarm tepat, Android bisa menunda pengingat. Kebijakan baterai/Doze/force-stop perangkat juga memengaruhi notifikasi. Ini pengingat harian, bukan alarm kritis.
- Versi web memerlukan halaman terbuka dan izin notifikasi. Browser HP tertentu tidak mendukung notifikasi sistem dari halaman; pengingat di aplikasi tetap tersedia. Tidak ada push dari server ketika halaman ditutup.
- Jadwal mengikuti waktu lokal perangkat. Timer di halaman memeriksa waktu sebenarnya setelah halaman kembali aktif; notifikasi fokus Android dijadwalkan ke OS.
- Musik berasal dari file milik pengguna (maksimal 100 MB per lagu). Format tergantung dukungan perangkat; MP3 direkomendasikan. Tidak ada streaming Spotify/YouTube atau foreground media service untuk audio latar belakang jangka panjang.
- Foto JPG/PNG/WebP maksimal 8 MB, diproses sepenuhnya di perangkat. Foto profil dapat dihapus atau diganti kapan saja.
- localStorage memiliki kuota terbatas. Jika penyimpanan gagal, aplikasi menampilkan pesan dan tidak mengganti state tugas/jurnal yang berhasil disimpan sebelumnya. Ekspor cadangan secara berkala; menghapus data browser, mencopot aplikasi, atau memakai mode privat bisa menyebabkan kehilangan data lokal.
- Animasi scroll hanya diterapkan pada panel di bawah layar dan dijalankan satu kali per render agar konten utama langsung terbaca. Tab berpindah dengan fade dan gerak pendek. Reduce Motion menonaktifkan efek gerak.

## Struktur

```text
.github/workflows/   Build APK dan pemeriksaan aplikasi
dist/                HTML, CSS, JavaScript dan bridge Android
native/              Entry Local Notifications
scripts/             Server statis, bundler bridge, resource Android
capacitor.config.json
package.json
package-lock.json
```

Pemeriksaan lokal: `npm run check`, `npm run build:web`. Verifikasi UI mencakup tugas dan jurnal tersimpan setelah reload, pemutaran audio lokal, dan pengubahan profil. Pengingat Android tetap perlu diuji pada HP fisik.
