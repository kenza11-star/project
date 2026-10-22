# Checklist tes dua HP (setelah deploy)

Pakai HP A = host, HP B = joiner, dua akun berbeda yang sudah berteman.

0. **Buka URL yang SAMA di kedua HP**: alamat produksi (domain utama project di Vercel), BUKAN alamat deployment lama
   (yang berbentuk `nama-xxxxxxxxx-tim.vercel.app`; alamat itu membeku di versi kode lama selamanya).
1. Di panel room, baris kecil di bawah daftar pemain (`v... · be ...`) harus **sama persis di kedua HP**.
   - `v` beda  -> salah satu HP membuka deployment/JS lama: tutup tab, buka ulang alamat produksi.
   - `be` beda -> dua HP terhubung ke database yang berbeda (cek ENV Supabase di Vercel: Production vs Preview).
2. HP A: Buat room -> tampil `PEMAIN (1/2)`. Salin / bagikan kode.
3. HP B: Gabung dengan kode -> HP B langsung `PEMAIN (2/2)`.
4. HP A (tanpa refresh): dalam <= 3 detik berubah jadi `PEMAIN (2/2)`, kedua nama tampil, tombol **Mulai** aktif.
5. HP A tekan Sembunyikan lalu buka lagi lewat chip `ROOM xxxxxx`: tetap 2/2 (Sembunyikan tidak mengeluarkan siapa pun).
6. HP B tekan Keluar room -> HP A kembali 1/2 dan tetap host. HP B gabung lagi dengan kode -> 2/2 lagi.
7. Matikan data HP B ~20 detik lalu nyalakan: tidak keluar room, kembali 2/2.
8. HP B coba tekan Mulai: tidak ada tombol Mulai (hanya host).
9. HP A tekan Mulai: kedua HP masuk gameplay bersamaan.
10. Tekan "+" di samping teman yang sudah di room berkali-kali: pesan "sudah ada di room" tidak menumpuk.

Bila masih tidak sinkron: di Chrome HP buka `chrome://inspect` atau di desktop jalankan `copy(JSON.stringify(window.__roomDiag))` di konsol
(setelah `localStorage.roomDebug='1'`) dan kirim hasilnya; log server ada di Vercel -> Logs, cari `[room]`.
