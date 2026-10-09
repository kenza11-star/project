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
- Map: `public/models/backrooms_full.glb`. Dimuat di `components/lobby/PlayScene.tsx` lewat `lib/game/world.ts`. Collision dari mesh dinding map + kotak furniture.
- Semua angka yang bisa diubah ada di `lib/game/config.ts` (seed, jumlah furniture, battery, stamina, event, audio, lighting).
- **Key & exit**: 3 key berwarna (Yellow/Red/Green, `lib/game/keys.ts`) tersembunyi di dalam container (laci, lemari, locker, crate, box). Cari container (SEARCH) -> key muncul di dalam container terbuka -> bidik dengan crosshair `+` -> `PICK UP` -> masuk inventory dan hilang dari world. Exit punya rantai + 3 gembok berwarna; tiap gembok hanya terbuka oleh key dengan warna/ID yang sama (bukan sekadar jumlah). Setelah ketiganya terbuka, rantai lepas dan pintu exit terbuka.
- **Furniture**: semua laci, lemari, locker, peti, dan kotak bisa dibuka lalu ditutup lagi (tombol Interaksi / E). Pertama kali dibuka = menggeledah (isi muncul sekali); sesudahnya buka-tutup bebas. Tiap jenis punya SFX buka/tutup sendiri (drawer, cabinet, locker, lid). Key yang belum diambil ikut tersembunyi saat container ditutup.
- **Landscape**: game langsung tampil landscape tanpa layar blokir. Screen Orientation API + fullscreen dicoba saat klik Play (enhancement). Bila ditolak dan HP masih portrait, fallback CSS (`html.rotfix`, dipasang script di `app/layout.tsx`) memutar seluruh UI 90° sehingga canvas/joystick/tombol tetap landscape; koordinat sentuh dipetakan di `PlayScene`. Tombol Demo di lobby hanya muncul saat development.
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

## Environmental storytelling (dekor ringan)
- `lib/game/decor.ts` (logika murni, dites) + `GameWorld.buildDecor` di `world.ts`. Angka di `config.ts` (`DECOR_ENABLED`, `DECOR_COUNTS`, `DECOR_MIN_GAP`).
- Per run (RNG turunan seed, tidak mengubah urutan RNG furniture/key/event): ~45-65 instance kertas, noda, kardus, kaleng/ember, kabel, pipa, ventilasi, APAR, rambu peringatan, rambu EXIT kecil di atas pintu biasa.
- Reuse aset map: noda `Decal_Stain`, kardus `Box_Util`, pipa `Pipe_Util`, rambu `Exit_Sign`, material `M_Dirt/M_Cardboard/M_MetalDark/M_ExitSign`. Hanya kertas, APAR, rambu peringatan, kaleng, ventilasi yang geometri kecil baru (tanpa tekstur/dependency).
- Aman: tanpa collision & tidak ikut raycast; menjauhi spawn/exit/tangga/pintu; kardus/benda kecil hanya di jalur sempit antara dinding dan area jalan pemain (tidak pernah di sel yang bisa dijalani) dan jauh dari furniture; benda dinding menempel di permukaan dinding asli. Path, key, exit, spawn tidak disentuh.
- Performa: 1 InstancedMesh per jenis (maks ~9 draw call), dihitung sekali per run, nol biaya per frame, dibuang & dibuat ulang saat restart, dispose saat unmount.

## Variasi kondisi ruangan per seed
- `lib/game/roomstate.ts` (logika murni, dites) + `GameWorld.initialShifts/applyRoomState`. Angka di `config.ts` (`ROOM_STATE_ENABLED`, `ROOM_STATE`). Memakai RNG turunan dari seed run (seed sama -> kondisi sama; urutan RNG furniture/key/event tidak berubah).
- Variasi: 1-3 furniture acak bergeser sejak awal; 2-4 pintu biasa terbuka; 3-5 lampu redup/berkedip; 2-4 container KOSONG sudah terbuka; jumlah dekor (kertas, noda, kardus, kabel, ventilasi) bervariasi.
- Aman: pergeseran memakai validasi yang sama dengan event furniture (`planShift`: flood-fill, titik wajib, akses container, keepout). Container berisi key/loot tidak pernah dibuka duluan. Pintu locked/exit tidak disentuh. Area sekitar spawn dan exit tetap terang & bersih (pintu >= 3.5 m dari spawn, lampu >= 7 m dari spawn/exit).

## Map utama: backrooms_full.glb
- Skema map dibaca di `lib/game/mapdata.ts` (`normalizeMap` + `extractMapData`): spawn lantai 1, exit `Door_24` (3 gembok warna), tangga A (dijalani langsung, lihat bagian Polish interaksi), 266 container (laci/lemari/locker/kulkas) dari furniture bawaan, 295 collider furniture, lantai 2 (`LEVEL_Y` di config).
- Kunci/kode bawaan map untuk pintu non-exit diabaikan (pintu biasa); exit lantai 2 tersegel permanen. Ruang rahasia tersegel (Hidden2, Vault) tidak dipakai.
- Furniture acak = salinan furniture bawaan (`TEMPLATE` di world.ts). Mesh statis digabung (batching) saat load untuk mengurangi draw call di HP.


## Polish interaksi, pintu, furniture & tangga
- **Tangga** (`lib/game/stairs.ts`): tidak ada teleport/CLIMB. Pemain berjalan masuk lewat mulut tangga (kaki di lantai 1, ujung atas di lantai 2), tinggi kaki mengikuti anak tangga (`PlayerState.y`, kamera diinterpolasi), dinding samping menahan, badan tangga padat dari sisi & kolong. Naik dan turun memakai logika yang sama; kecepatan x0,8, bob kamera lebih kuat, langkah lebih rapat (SFX langkah keras; tidak ada SFX tangga khusus).
- **Pintu** (`lib/game/door.ts`): engsel = origin node pintu; daun berayun dengan easing halus. Collision mengikuti pose daun selama sudut < 70% (terbuka cukup lebar = non-blocking), tidak menembus pemain (daun berhenti sampai pemain menyingkir), tidak pernah menjebak (collision menunggu pemain keluar dari ambang). Jangkauan 2,0 m.
- **Container** (`lib/game/swing.ts`): bukaan dibatasi bila akan menembus dinding/furniture lain (`openLimit`, dihitung ulang tiap run & setelah furniture bergeser; container yang terlalu sempit tidak dipakai untuk key). Laci/pintu yang terbuka penuh punya collision sesuai pose (aktif hanya saat pemain tidak tumpang tindih). Interaksi container ditolak bila garis ke target menembus dinding.
- **Placement**: keepout ditambah area ayunan semua pintu + seluruh ruang tangga; `auditPlacements` memeriksa ulang tiap run (dinding, furniture lain, area bebas) dan menolak run yang gagal.
- Tes: `npm run test:game` (termasuk `scripts/test-polish.js`).


## Perbaikan akar masalah: pintu / locker / laci / lemari tidak bisa dibuka (video bug part 1-3)
- **Penyebab**: `GameWorld.build` memetakan node glTF -> objek three lewat `gltf.parser.associations`. Di three 0.164.1, klon mesh yang berbagi geometri memakai SATU objek asosiasi, sehingga hanya node terakhir per grup mesh yang terpetakan. Di map ini 538 dari 540 node interaktif berbagi mesh (semua `Door_NN`, `Locker_NN`, `Drawer_NN`, lemari, kulkas), jadi hampir semuanya tidak punya objek three: tidak terdaftar ke raycast ("Tidak ada yang bisa dilakukan"), tidak beranimasi, dan `Door_24` (exit) tidak pernah membuka walau tampil "EXIT OPEN".
- **Perbaikan**: pemetaan lewat NAMA node (`indexNodesByName` di `mapdata.ts`, nama unik), bukan `associations`. Satu sistem existing dipakai ulang; tidak ada sistem baru untuk pintu/container.
- **Tambahan**: tutup ventilasi (8 flap, 4 ventilasi) dan tuas generator kini interaktif lewat `FlapRT` kecil (easing, SFX, reset tiap run, tanpa raycast/state React per frame).
- **Uji**: `npm run test:game` (3183 + 37 pemeriksaan, termasuk regresi pemetaan semua node interaktif) dan `npm run audit:map` (overlap furniture bawaan vs dinding/antar furniture).


## Fitur baru: sembunyi, kasur, detak jantung & napas kelelahan
- **Kasur** (`generateBeds` di `layout.ts`, model prosedural di `GameWorld.buildBed`): 3 kasur per run (2 di ruang istirahat, 1 di ruang lain), kepala menempel dinding, divalidasi seperti furniture (tidak menimpa dinding/furniture, tidak menutup pintu/jalur utama/spawn/tangga, tidak membuat celah jebakan, RNG terpisah sehingga seed furniture tidak berubah). Bidik kasur lalu tekan interaksi / tombol HIDE: karakter merangkak ke kolong, layar tertutup bawah-kasur dengan garis pandang rendah, menoleh dibatasi. Tekan lagi untuk keluar dari sisi masuk.
- **Locker & lemari** (semua `Locker` dan `Cabinet`, bawaan map maupun acak): bidik lalu tekan tombol HIDE (atau `H`). Urutan: pintu terbuka -> masuk -> pintu menutup -> masker celah ventilasi horizontal untuk mengintip. Tombol interaksi / HIDE untuk keluar (pintu terbuka lagi, karakter keluar ke depan; bila jalan keluar terhalang muncul BLOCKED). Senter otomatis mati selama bersembunyi lalu kembali seperti semula.
- **Detak jantung**: SFX baru (`heartbeat.wav`, lub-dub dengan dentuman dada), tempo & volume naik saat stamina menipis dan paling cepat saat habis.
- **Napas kelelahan**: `pant.wav` berulang selama stamina habis (selain `breath.wav` saat baru habis). `rustle.wav` untuk merangkak.
- Semua SFX dibuat prosedural oleh `python3 scripts/gen-body-sfx.py` (numpy saja, bebas lisensi). Uji: `npm run test:game` (termasuk `scripts/test-hide.js`: penempatan kasur 200 seed).

## Kursi custom (chair.glb)
- Semua kursi bawaan map (node `extras.type = "Chair"`, 38 buah) diganti model `public/models/chair.glb` saat load (`GameWorld.swapChairs` di `world.ts`, URL di `config.ts` -> `CHAIR_URL`). File map tidak diubah; bila `chair.glb` hilang/rusak, kursi bawaan map dipakai otomatis.
- **Anti-tembus**: collision kursi TIDAK diganti. Model diskalakan seragam (`lib/game/chairfit.ts`) agar footprint-nya selalu di dalam kotak collision kursi bawaan (0,5 x 0,5 m) dan tingginya 1,03 m; pivot di tengah, kaki di lantai, sandaran di belakang (-Z lokal) seperti kursi lama. Jadi pemain tidak bisa masuk ke bagian kursi mana pun.
- Performa HP: 1 geometri + 1 material untuk semua kursi, ikut batching statis (`batchStatic`). Tekstur chair.glb diperkecil 1024 -> 512 px (geometri tidak diubah), 2,4 MB -> 0,7 MB.
- Uji: `npm run test:game` (termasuk `scripts/test-chair.js`: footprint di dalam kotak collision untuk 38 kursi, orientasi, dan ~9.700 gerakan pemain dari 24 arah memakai fungsi gerak game asli).
