# Setup Backend: Firebase + Supabase + Vercel

Dokumen ini menjelaskan variabel lingkungan yang dibutuhkan, dari mana nilainya diambil, dan mana yang publik atau rahasia.
**Semua nilai kamu isi sendiri di Vercel.** Repo ini tidak berisi kredensial apa pun, dan tidak ada nilai bawaan yang palsu.

## 1. Arsitektur singkat

| Bagian | Teknologi | Peran |
|---|---|---|
| Frontend | Next.js 14 (App Router), Three.js | Lobby, game, UI room |
| Auth | Firebase Authentication (Email/Password) | Register, login, logout, identitas (Firebase UID) |
| Backend/API | Route handler Next.js di Vercel (`app/api/*`, Node runtime) | Verifikasi ID token (Firebase Admin), tulis ke database lewat `service_role` |
| Database | Supabase Postgres + RLS | `profiles`, `rooms`, `room_members` |
| Realtime | Supabase Realtime (channel **private**: broadcast + presence) | Posisi, rotasi, status animasi pemain, pemain masuk/keluar |

Alur identitas:
1. Klien register/login ke Firebase (username dipetakan ke email internal `username@players.kynx-horror.invalid`; tanpa email asli, tanpa verifikasi/reset password).
2. Klien memanggil `POST /api/auth/session` dengan ID token. Server memverifikasi token (Firebase Admin), memasang klaim `role=authenticated`, dan membuat profil.
3. Klien memakai ID token yang sama untuk Supabase (**Third-Party Auth**). RLS membaca `auth.jwt() ->> 'sub'` (= Firebase UID).
4. Semua **tulis** (buat/gabung/keluar/mulai room, ubah nama) lewat API Vercel. Browser hanya **membaca** data room miliknya (RLS) dan memakai channel Realtime.

## 2. Daftar Environment Variables

### Publik (`NEXT_PUBLIC_*`): masuk bundel browser, memang tidak rahasia

| Variabel | Ambil dari | Catatan |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Console, Project settings, General, Your apps (Web), SDK config: `apiKey` | Pengenal proyek, bukan rahasia. Boleh dibatasi di Google Cloud Console |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | idem: `authDomain` (`<project>.firebaseapp.com`) | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | idem: `projectId` | Juga dipakai server bila `FIREBASE_PROJECT_ID` kosong |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | idem: `appId` | |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard, Project Settings, API: Project URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard, Project Settings, API: kunci `anon` (atau `publishable`) | Aman di browser **hanya karena RLS aktif** (sudah di `supabase/schema.sql`) |
| `NEXT_PUBLIC_NET_SEND_HZ` *(opsional)* | Pilihanmu | Kosong = 10 Hz. Turunkan bila kuota pesan Realtime terlampaui |
| `NEXT_PUBLIC_AUTH_EMAIL_DOMAIN` *(opsional)* | Pilihanmu | Kosong = bawaan. Ubah hanya bila Firebase menolak domain bawaan |

### Rahasia (HANYA server; jangan pernah diberi awalan `NEXT_PUBLIC_`)

| Variabel | Ambil dari | Catatan |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Firebase Console, Project settings, Service accounts, Generate new private key (JSON): `project_id` | |
| `FIREBASE_CLIENT_EMAIL` | JSON yang sama: `client_email` | |
| `FIREBASE_PRIVATE_KEY` | JSON yang sama: `private_key` | Tempel apa adanya (teks yang diawali baris BEGIN PRIVATE KEY). Boleh juga satu baris dengan `\n`, keduanya dikenali |
| `CRON_SECRET` | Buat sendiri: `openssl rand -hex 32` (min. 16 karakter) | RAHASIA, hanya server. Mengamankan `/api/cron/cleanup` (dipanggil Vercel Cron harian dari `vercel.json`). Kosong = endpoint mati (503) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard, Project Settings, API: `service_role` / secret key | Melewati RLS. Hanya dibaca di `lib/server/*` |

Pemeriksaan otomatis `npm run check:secrets` memastikan: kode klien tidak mengimpor `lib/server`, tidak menyebut variabel rahasia, tidak ada `NEXT_PUBLIC_*` bernama rahasia, `.env.example` kosong, dan `.env*` ada di `.gitignore`.

## 3. Langkah setup

**Firebase**
1. Buat project. Authentication, Sign-in method, aktifkan **Email/Password**.
2. Project settings, Your apps, tambah **Web app**, salin 4 nilai config publik.
3. Project settings, Service accounts, **Generate new private key**, simpan JSON di tempat aman (jangan di-commit), salin 3 nilai server.

**Supabase**
1. Buat project. SQL Editor: tempel dan jalankan seluruh `supabase/schema.sql`.
2. Authentication, **Third-Party Auth**, tambah **Firebase**, isi Firebase Project ID. (Nama menu bisa sedikit berbeda antar versi dashboard.)
3. Realtime settings: matikan **Allow public access** supaya hanya channel private (dijaga RLS) yang dipakai.
4. Salin Project URL, anon key, dan service_role key.

**Vercel**
1. Project, Settings, Environment Variables: isi semua variabel di atas untuk Production (dan Preview bila dipakai). Jangan centang "expose" apa pun untuk variabel rahasia; jangan beri awalan `NEXT_PUBLIC_`.
2. **Redeploy** (perubahan env baru berlaku di deployment berikutnya). Untuk lokal: salin `.env.example` ke `.env.local`.
3. Buka `GET /api/status`: mengembalikan `true/false` per kelompok variabel (tanpa nilai). Semua harus `true`.
4. Daftar akun di game, lalu uji room dengan dua browser/perangkat.

## 4. Status fitur (jujur)

### Sudah diimplementasikan dan diuji di sandbox (tanpa kredensial)
- Lobby responsif (portrait, landscape, PC), fallback putar-layar hanya saat bermain (diperiksa lewat screenshot Chromium dengan CSS asli).
- Tombol **KARAKTER** menampilkan modal `COMING SOON`; semua pemain memakai model default; sakelar modular di `lib/character/config.ts`.
- Pause: Single Player = freeze penuh; multiplayer = overlay lokal (tes `test-pause.js`, `test-net.js`).
- Lapisan jaringan: protokol tervalidasi, interpolasi, `RoomClient` (maks 4 pemain, masuk/keluar, reconnect + backoff, pengiriman tidak bergantung pause): `npm run test:net`.
- Skema SQL + RLS + kebijakan Realtime diuji di Postgres 16 lokal dengan stub role Supabase: `npm run test:sql` (48 pemeriksaan: akses lintas pemain ditolak, kapasitas, reconnect, anti-penyamaan channel).
- Aturan identitas/room/pemeriksaan rahasia: `npm run test:backend`.

### Sudah ditulis tetapi BELUM terbukti: butuh kredensial valid dan uji nyata
- Login/daftar/logout Firebase (`lib/auth/firebaseProvider.ts`), verifikasi token & klaim role (`app/api/auth/session`).
- Semua route `app/api/rooms/*` dan `app/api/profile`.
- Transport Supabase Realtime (`lib/net/supabaseTransport.ts`), ruang tunggu room (`RoomModal`).
- Third-Party Auth Firebase di Supabase dan kebijakan `realtime.messages` pada Realtime sungguhan (SQL-nya teruji di Postgres, perilaku layanan Supabase belum).
- `next build` penuh dan instalasi paket baru (`firebase`, `firebase-admin`, `@supabase/supabase-js`) belum bisa dijalankan di sandbox (registry npm diblokir). Jalankan `npm install && npm run build` sebelum deploy.

### Belum selesai
- **Dunia bersama**: yang tersinkron hanyalah pemain (posisi, rotasi, jongkok/lari, sembunyi). Seed dunia sama (layout furniture, key, jadwal event identik), tetapi pintu/laci yang dibuka, item yang diambil, dan posisi SCP **belum** disinkronkan antar pemain; butuh protokol event/host-otoritatif.
- Anti-cheat: posisi dipercaya klien (hanya divalidasi bentuk & batas dunia).
- Teman, undangan, dan party masih **mock lokal** (`lib/social/logic.ts`); tombol TAMBAH TEMAN belum memakai database. Gabung lewat kode room.
- Reset password (tidak ada email asli), pembersihan otomatis room lama, rate limit terdistribusi (saat ini memori per instance).
- Kuota pesan Realtime: 4 pemain x 10 Hz bisa melewati batas paket gratis Supabase; atur `NEXT_PUBLIC_NET_SEND_HZ`.


## Pembaruan: fitur yang dulu "belum selesai"

| Fitur | Status | Catatan |
|---|---|---|
| Pembersihan room | Ditulis + SQL diuji | `cleanup_rooms()` (anggota basi > 5 mnt keluar, host dipindah, room kosong ditutup, `waiting` > 3 jam ditutup, tertutup > 1 hari dihapus). Dipanggil `/api/cron/cleanup` via Vercel Cron harian (batas paket Hobby = 1x/hari). Butuh `CRON_SECRET`. Slot basi juga dilepas saat ada yang `join` (120 dtk). |
| Rate limit terdistribusi | Ditulis + SQL diuji | `rate_hit()` di Postgres, dipakai semua endpoint kecuali heartbeat (cukup lapis memori). Bila DB gagal, lapis memori tetap berlaku (fail-open disengaja). |
| Teman nyata | Ditulis + SQL/RLS diuji | Tabel `friendships`, `/api/friends`, UI teman memakai server saat login online. Party dan undangan game masih lokal (mock). |
| Validasi gerak (anti-teleport) | Diuji (logika murni) | Sisi penerima: perpindahan > 8 m/dtk dipotong; banjir pesan > 50 Hz dibuang. Ini perlindungan tampilan, BUKAN anti-cheat penuh: tiap klien tetap memegang posisinya sendiri. |
| Sinkronisasi dunia | Logika diuji; integrasi game belum diuji di browser | Pintu (aksi pemain), benda/key diambil, gembok, container loot. Event + digest berkala (CRDT sederhana). Kejadian acak (pintu dibanting, scare, SCP-106, lampu) tetap lokal per pemain. |
| Reset password | TIDAK dikerjakan | Email login adalah alamat internal `.invalid` yang tidak bisa menerima surat. Butuh keputusan desain: minta email asli saat daftar (opsional) lalu pakai `sendPasswordResetEmail`. |
