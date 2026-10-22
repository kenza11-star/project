# kynx-relay (server cadangan multiplayer untuk blitz.cloud)

Satu proses Node yang berjalan terus; state room disimpan di memori (tanpa database, tanpa Supabase). API sama dengan `/api/rooms/*` di aplikasi utama.
Game memakainya otomatis HANYA bila server utama (Vercel + Supabase) gagal.

## Pasang di blitz.cloud
1. Jadikan folder `blitz-relay/` repo GitHub sendiri (berisi `server.js`, `package.json`, `Dockerfile`).
2. Dashboard blitz.cloud -> "Host sesuatu yang baru" -> deploy dari repo GitHub itu, alamat mis. `relay` (jadi `https://relay.kynx.blitz.cloud`). Port aplikasi: 3000 (atau ikuti `PORT` dari blitz).
3. Isi variabel lingkungan aplikasi (nilainya SAMA dengan yang di Vercel):
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
4. Cek `https://relay.kynx.blitz.cloud/health` -> `{"ok":true,...}`.
5. Di Vercel tambahkan `NEXT_PUBLIC_RELAY_URL=https://relay.kynx.blitz.cloud` lalu **Redeploy** (variabel NEXT_PUBLIC_ baru terbaca saat build).

## Perilaku
- Room yang dibuat di server utama tetap di server utama. Room baru dibuat di relay hanya bila server utama gagal. Gabung dengan kode: coba utama dulu, lalu relay.
- State di memori: bila relay restart, room yang sedang berjalan di relay hilang (pemain kembali ke lobby). Room di server utama tidak terpengaruh.
- Undangan teman & daftar teman tetap lewat server utama (relay hanya untuk room).
- Tes: `node test.js`.


## Endpoint loker/lemari (`POST /api/rooms/locker`)
Body `{roomId, action: 'enter'|'exit'|'release', locker?}`; balasan `{ok, reason, owner, lockers, server_time}`. `/api/rooms/sync` juga mengembalikan `lockers`. Maks 1 pemain per loker, 1 loker per pemain; klaim lepas saat pemegang keluar / offline (>30 dtk saat bermain) / lease 40 dtk habis. Deploy ulang relay agar endpoint ini aktif.
