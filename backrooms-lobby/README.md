# Backrooms Lobby (prototype)

Lobby 3D horror bergaya Backrooms: Next.js 14 + TypeScript + Three.js + @pixiv/three-vrm. Tanpa backend, tanpa env var.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # build produksi (siap Vercel: import repo, framework Next.js, tanpa setting tambahan)
```

## Catatan
- Karakter default = model James (`public/models/james.glb`). Untuk mengganti default, timpa file itu dengan model lain (.glb embedded). Pemain bisa upload karakter sendiri lewat tombol Karakter; tombol "Kembali ke default" memuat James lagi.
- Model James tidak punya tulang, jadi dipasangi kerangka humanoid + skin otomatis saat dimuat (`lib/3d/rigcore.ts`, `autorig.ts`). Animasi jalan, lari, lompat, jongkok, idle dibuat prosedural di `lib/3d/motion.ts`. Tombol Jalan/Lari/Lompat/Jongkok di pojok kiri bawah lobby; tanpa ditekan, karakter bergerak sendiri secara acak. Model statis lain yang diupload juga di-rig otomatis; model ber-rig (Mixamo/VRM) memakai animasinya sendiri.
- UID: 5 digit acak, dibuat otomatis sekali per perangkat/browser dan disimpan di localStorage (tidak bisa diedit). Tidak bentrok dengan UID demo.
- Teman/invite/party memakai MOCK USER lokal (UID demo 12345, 23456, 34567, 45678). Data di localStorage/IndexedDB perangkat ini saja. TIDAK real-time antar perangkat. Tombol DEMO mensimulasikan sisi teman. Karena belum ada backend, UID acak belum bisa dicari perangkat lain.
- Untuk backend nanti: ganti fungsi di `lib/social/logic.ts` dengan API/WebSocket.
- Model upload: .glb / .gltf (embedded) / .vrm, maks 40 MB. Clip animasi dipakai bila ada (idle/walk); jika tidak, idle prosedural + lengan diturunkan dari T-pose.
- Foto profil diperkecil otomatis (WEBP) sebelum disimpan di IndexedDB. Fitur upload background sudah dihapus; latar selalu ruang Backrooms.
- Struktur: `lib/3d` (renderer, karakter), `lib/storage`, `lib/social`, `components/*`.

## Kredit
- Model default "James realistic male character 3D model" oleh StormierTunic16 (https://sketchfab.com/jondavila98), lisensi CC BY 4.0. Tekstur dikecilkan ke 2048 px agar ringan di HP; geometri tidak diubah.

## Game Backrooms (map GLB)
- Map: `public/models/backrooms_level_0.glb`. Dimuat di `components/lobby/PlayScene.tsx` lewat `lib/game/world.ts`. Collision dari mesh dinding map + kotak furniture.
- Semua angka yang bisa diubah ada di `lib/game/config.ts` (seed, jumlah furniture, battery, stamina, event, audio, lighting).
- **Key & exit**: 3 key berwarna (Yellow/Red/Green, `lib/game/keys.ts`) tersembunyi di dalam container (laci, lemari, locker, crate, box). Cari container (SEARCH) -> key muncul di dalam container terbuka -> bidik dengan crosshair `+` -> `PICK UP` -> masuk inventory dan hilang dari world. Exit punya rantai + 3 gembok berwarna; tiap gembok hanya terbuka oleh key dengan warna/ID yang sama (bukan sekadar jumlah). Setelah ketiganya terbuka, rantai lepas dan pintu exit terbuka.
- **Furniture**: semua laci, lemari, locker, peti, dan kotak bisa dibuka lalu ditutup lagi (tombol Interaksi / E). Pertama kali dibuka = menggeledah (isi muncul sekali); sesudahnya buka-tutup bebas. Tiap jenis punya SFX buka/tutup sendiri (drawer, cabinet, locker, lid). Key yang belum diambil ikut tersembunyi saat container ditutup.
- **Kontrol mobile**: analog kiri (jalan), geser kanan (lihat), tombol floating transparan di kanan bawah (Interaksi, Senter, Lari, Jongkok; tanpa teks). Lari otomatis lepas saat berhenti.
- **Senter (F / tombol senter)**: SpotLight mengikuti POV. Battery 2 menit pemakaian terus-menerus (`FLASH_MAX_SECONDS`), persen tampil di HUD, berkurang hanya saat ON, mati otomatis saat habis. Pemain mulai dengan 1 battery di inventory; battery tambahan ada di furniture (minimal `MIN_BATTERY_PICKUPS` per run). Pakai battery dari inventory = recharge 100%. Cahaya ambient sengaja kecil: area berlampu terang karena lampu map, area tanpa lampu gelap.
- **Sprint & stamina**: tombol lari / Shift. Jongkok (C / tombol jongkok): kamera & collider turun, lebih lambat, langkah lebih pelan; tidak bisa berdiri bila ruang terlalu sempit. Stamina turun saat lari, pulih saat tidak lari (ada jeda), tidak bisa sprint saat habis sampai pulih ke `STAMINA_RESUME_AT`.
- **Event horor acak** (`lib/game/events.ts`, efek di `world.ts`): lampu mati-nyala, pintu terbuka sendiri lalu menutup, furniture bergeser, bayangan melintas. Jarang (45-120 dtk), jenis tidak berulang berurutan, dan selalu divalidasi aman: tidak menutup jalan/key/container/exit (flood-fill ulang), tidak menjebak pemain di pintu, container berisi key tidak pernah dipindah, bayangan tanpa collision.
- **Seed**: `MAP_SEED = null` -> seed baru tiap mulai/restart. Seed menentukan furniture, posisi tiap key, isi container, serta jadwal & jenis event. Isi angka untuk layout yang selalu sama.
- **Audio** (`lib/game/audio.ts`, `lib/game/sfx.ts`): WebAudio, SFX posisional (atenuasi linear, panner equalpower), pitch & varian acak, maksimal `MAX_VOICES` suara bersamaan, throttle per jenis, langkah kaki & ambience pelan. Tiap event punya SFX sendiri (lights_off/on, door_open/close, furniture_scrape, entity_steps+whisper).
- **File SFX** di `public/sfx/*.wav` disintesis sendiri oleh `scripts/gen-sfx.py` (noise + osilator; tanpa sample pihak ketiga, jadi bebas masalah lisensi). Ganti dengan rekaman CC0 favoritmu dengan nama file yang sama bila mau; jalankan ulang generator dengan `npm run gen:sfx` (butuh python3 + numpy + scipy).
- Bidikan key: furniture pemilik key tidak menghalangi crosshair, tetapi dinding/objek lain tetap menghalangi (tidak bisa interaksi menembus). Raycast dibatasi ~20 Hz dan dilewati saat kamera diam.
- HUD senter & stamina ditulis langsung ke DOM (tanpa render ulang React per frame).
- Resolusi render adaptif: turun otomatis bila FPS rendah di HP, naik lagi bila lancar.
- Inventory per pemain (`lib/game/inventory.ts`). Tes logika dengan GLB asli: `npm run test:game`.

## Anti-softlock
- Tiap run divalidasi sebelum dimulai: 3 key (Yellow/Red/Green) ada di 3 container berbeda yang bisa dibuka, terjangkau, posisinya di atas lantai & di dalam map (bukan di dinding); exit terjangkau dari spawn; spawn tidak menabrak apa pun.
- Bila gagal: key dipilih ulang dari container valid, lalu seed turunan (maks 6 percobaan), dan percobaan terakhir memakai layout bawaan map tanpa furniture acak. Tidak ada loop tanpa batas dan tidak crash.
- Spawn yang tidak aman otomatis digeser ke titik aman terdekat.
- Tes: `npm run test:game` (600 seed + kasus rusak yang disengaja).
