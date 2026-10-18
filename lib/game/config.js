"use strict";
// Konfigurasi game Backrooms. Ubah nilai di sini.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPRINT_SPEED = exports.WALK_SPEED = exports.FLASH_LOW_PCT = exports.FLASH_DISTANCE = exports.FLASH_ANGLE = exports.FLASH_INTENSITY = exports.MIN_BATTERY_PICKUPS = exports.START_BATTERIES = exports.FLASH_MAX_SECONDS = exports.LFX_DARK_AMBIENT = exports.LFX_OUTAGE_HOLD = exports.LFX_OUTAGE_MEAN = exports.LFX_ELECTRICAL_CHANCE = exports.LFX_FLICKER_MEAN = exports.MATERIAL_GRIME = exports.MATERIAL_BUMP = exports.MATERIAL_UPGRADE = exports.SHADOW_MAP = exports.SHADOWS = exports.POST_CA = exports.POST_DESAT = exports.POST_CONTRAST = exports.POST_VIGNETTE = exports.POST_MSAA = exports.POSTFX = exports.EXPOSURE_BASE = exports.GRAIN_OPACITY = exports.ATMOS_ENABLED = exports.FOG_COLOR = exports.FOG_DENSITY = exports.AMBIENT = exports.LIGHT_POOL = exports.LIGHT_SCALE = exports.SODA_CULL_DIST = exports.SODA_MIN_GAP = exports.SODA_SHELVES = exports.SODA_TABLES = exports.PLAYER_RADIUS_CROUCH = exports.PLAYER_RADIUS = exports.REACH = exports.LEVEL_Y = exports.SCP_URL = exports.SODA_URL = exports.CHAIR_URL = exports.MAP_URL = exports.MAX_FURNITURE = exports.MIN_FURNITURE = exports.REQUIRED_KEYS = exports.MAP_SEED = exports.RANDOMIZE_PROPS = void 0;
exports.SCARE_BLUR_IN = exports.SCARE_BLUR_PX = exports.SCARE_SLOW_MUL = exports.SCARE_SLOW_SECONDS = exports.SCARE_DURATION = exports.SCARE_PICK_MAX = exports.SCARE_PICK_FRAC = exports.SCARE_PICK_MIN = exports.ROOM_STATE = exports.ROOM_STATE_ENABLED = exports.DECOR_COUNTS = exports.DECOR_MIN_GAP = exports.DECOR_ENABLED = exports.HEART_BELOW = exports.MUFFLE_MIN_HZ = exports.OPENING_BLUR_PX = exports.OPENING_SECONDS = exports.OPENING_ENABLED = exports.SWAY_IDLE = exports.DUST_COUNT = exports.BUZZ_VOLUME = exports.AMBIENCE_VOLUME = exports.FOOTSTEP_VOLUME = exports.MAX_VOICES = exports.MASTER_VOLUME = exports.FLOOR_CREAK_GAP = exports.STRIDE_STAIRS = exports.STRIDE_CROUCH = exports.STRIDE_RUN = exports.STRIDE_WALK = exports.FLOOR_CREAK_CHANCE = exports.DOOR_SLAM_SECONDS = exports.DOOR_CLOSE_SCALE = exports.DOOR_OPEN_SLOW = exports.SLAM_MAX_DIST = exports.SLAM_MIN_DIST = exports.EVENT_WEIGHTS = exports.EVENT_TYPE_COOLDOWN = exports.EVENT_RETRY_MAX = exports.EVENT_RETRY_MIN = exports.EVENT_GAP_MAX = exports.EVENT_GAP_MIN = exports.EVENT_FIRST_MAX = exports.EVENT_FIRST_MIN = exports.STAMINA_RESUME_AT = exports.STAMINA_REGEN_DELAY = exports.STAMINA_REGEN = exports.STAMINA_DRAIN = exports.STAMINA_MAX = exports.CROUCH_SPEED = void 0;
exports.MONSTER_VIEW_RANGE = exports.MONSTER_HEART_RANGE = exports.MONSTER_NET_HZ = exports.MONSTER_GRACE = exports.MONSTER_RESET_TIME = exports.MONSTER_CATCH_RADIUS = exports.MONSTER_SEARCH_TIME = exports.MONSTER_LOSE_TIME = exports.MONSTER_HEAR_CROUCH = exports.MONSTER_HEAR_WALK = exports.MONSTER_HEAR_RUN = exports.MONSTER_SENSE_RADIUS = exports.MONSTER_FOV_DEG = exports.MONSTER_SIGHT_RANGE = exports.MONSTER_CHASE_SPEED = exports.MONSTER_INVESTIGATE_SPEED = exports.MONSTER_PATROL_SPEED = exports.MONSTER_RADIUS = exports.MONSTER_LEVEL = exports.MONSTER_ENABLED = exports.SPAWN_MIN_GAP = exports.SPAWN_SPREAD = exports.MAX_PLAYERS = exports.PLAYER_MODE_DEFAULT = exports.SCARE_BLUR_OUT = void 0;
// true = furniture tambahan di-spawn acak tiap run. false = hanya furniture bawaan map.
exports.RANDOMIZE_PROPS = true;
// null = seed acak BARU tiap mulai / restart (layout, key, event berubah tiap run).
// Angka = semua elemen acak selalu sama (reproducible).
exports.MAP_SEED = null;
// Jumlah key = jumlah gembok di exit (lihat lib/game/keys.ts: Yellow, Red, Green).
exports.REQUIRED_KEYS = 3;
// Jumlah furniture acak tambahan per run.
exports.MIN_FURNITURE = 8;
exports.MAX_FURNITURE = 14;
// ---- Map / interaksi ----
exports.MAP_URL = '/models/backrooms_full.glb'; // satu-satunya map utama
exports.CHAIR_URL = '/models/chair.glb'; // model kursi custom; bila gagal dimuat, kursi bawaan map tetap dipakai
exports.SODA_URL = '/models/NORVIX_SODA_330ML_1file_vertexcolor.glb'; // Soda NORVIX (GLB + vertex color); bila gagal dimuat, soda tidak di-spawn
exports.SCP_URL = '/models/scp-106.glb'; // SCP-106 (skinned, tanpa animasi bawaan -> dianimasikan dari transformasi tulang, lihat scp106.ts)
exports.LEVEL_Y = [0, 3.4]; // tinggi lantai per level: lantai 1 (y=0) dan lantai 2 (permukaan slab)
exports.REACH = 2.4; // jarak maksimum interaksi (meter)
exports.PLAYER_RADIUS = 0.3; // radius collision pemain (berdiri)
exports.PLAYER_RADIUS_CROUCH = 0.24; // collider lebih kecil saat jongkok
// ---- Soda NORVIX (menggantikan Almond Water). Diletakkan di permukaan nyata: meja/meja kerja, papan rak, dan di dalam laci/lemari (isi container) ----
exports.SODA_TABLES = 5; // soda di atas meja / meja kerja (titik bawaan map + meja acak) per run
exports.SODA_SHELVES = 3; // soda di papan rak StorageShelf per run
exports.SODA_MIN_GAP = 3.0; // jarak minimum antar soda (m) agar tidak menumpuk di satu ruangan
exports.SODA_CULL_DIST = 9; // soda di luar jarak ini tidak digambar (model 112 rb vertex: hemat GPU HP; kabut sudah menutupinya)
// ---- Lighting ----
exports.LIGHT_SCALE = 0.6; // skala intensitas lampu GLB (turunkan bila terlalu terang)
exports.LIGHT_POOL = 3; // jumlah lampu dinamis aktif dari map (ringan untuk HP)
exports.AMBIENT = 0.075; // cahaya ambient dasar. Kecil = area tanpa lampu benar-benar gelap
exports.FOG_DENSITY = 0.115;
exports.FOG_COLOR = 0x0a0b06; // fog lembap kehijauan-kuning gelap (juga warna background)
exports.ATMOS_ENABLED = true; // overlay grading + film grain (CSS ringan, tanpa post-processing pass)
exports.GRAIN_OPACITY = 0.07; // film grain halus (0 = mati)
exports.EXPOSURE_BASE = 1.08; // exposure dasar; sedikit 'bernapas' agar tidak terasa statis
exports.POSTFX = true; // post-processing 1 pass (tone map + grade + vignette + CA + grain). false = render langsung
exports.POST_MSAA = 2; // MSAA pada render target (0/2/4). Turunkan ke 0 bila GPU HP lemah
exports.POST_VIGNETTE = 0.55; // kegelapan tepi layar
exports.POST_CONTRAST = 0.5; // S-curve (0..1)
exports.POST_DESAT = 0.14; // pudar warna (tua/lembap)
exports.POST_CA = 0.014; // chromatic aberration tepi layar
exports.SHADOWS = true; // bayangan senter (1 SpotLight, 1 render pass tambahan; hanya diperbarui saat senter ON)
exports.SHADOW_MAP = 512; // resolusi shadow map senter (turunkan ke 256 bila FPS drop di HP lama)
// ---- Material upgrade (lib/game/materials.ts): detail kotor/lembap procedural, ringan ----
exports.MATERIAL_UPGRADE = true; // false = material asli GLB
exports.MATERIAL_BUMP = 1.0; // kekuatan bump halus
exports.MATERIAL_GRIME = 1.0; // kekuatan noda/AO kotor
// ---- Horror lighting FX (lib/game/lightfx.ts) ----
exports.LFX_FLICKER_MEAN = 300; // rata-rata detik antar kedip PER LAMPU (proses acak global berbasis waktu, tidak tergantung posisi pemain)
exports.LFX_ELECTRICAL_CHANCE = 0.22; // peluang sebuah kedip menjadi electrical flicker (stutter panjang)
exports.LFX_OUTAGE_MEAN = 1500; // rata-rata detik antar lampu mati PER LAMPU
exports.LFX_OUTAGE_HOLD = [3, 15]; // lama satu lampu mati (detik)
exports.LFX_DARK_AMBIENT = 0.55; // ambient turun sampai ini saat lampu terdekat mati
// ---- Flashlight & battery ----
exports.FLASH_MAX_SECONDS = 120; // pemakaian terus-menerus maksimal per battery (2 menit)
exports.START_BATTERIES = 1; // battery di inventory saat mulai
exports.MIN_BATTERY_PICKUPS = 3; // minimal battery tambahan yang tersembunyi di furniture per run
exports.FLASH_INTENSITY = 40;
exports.FLASH_ANGLE = 0.46; // radian (cone)
exports.FLASH_DISTANCE = 15;
exports.FLASH_LOW_PCT = 15; // di bawah ini senter berkedip
// ---- Stamina ----
exports.WALK_SPEED = 2.2;
exports.SPRINT_SPEED = 4.0;
exports.CROUCH_SPEED = 1.1;
exports.STAMINA_MAX = 100;
exports.STAMINA_DRAIN = 20; // per detik saat sprint (5 detik penuh -> habis)
exports.STAMINA_REGEN = 13; // per detik saat tidak sprint
exports.STAMINA_REGEN_DELAY = 0.9; // jeda (detik) sebelum regen mulai
exports.STAMINA_RESUME_AT = 20; // setelah habis, baru bisa sprint lagi di nilai ini
// ---- Random horror event ----
exports.EVENT_FIRST_MIN = 50; // detik sebelum event pertama
exports.EVENT_FIRST_MAX = 100;
exports.EVENT_GAP_MIN = 45; // jeda antar event
exports.EVENT_GAP_MAX = 120;
exports.EVENT_RETRY_MIN = 12; // bila event gagal (kondisi tidak aman) coba lagi
exports.EVENT_RETRY_MAX = 25;
exports.EVENT_TYPE_COOLDOWN = 100; // jenis yang sama tidak diulang dalam rentang ini
exports.EVENT_WEIGHTS = { lights: 3, door: 3, furniture: 2, entity: 2, slam: 2 };
exports.SLAM_MIN_DIST = 7; // event bantingan pintu: jarak minimum dari pemain (m)
exports.SLAM_MAX_DIST = 26; // ...dan maksimum (masih terdengar jelas)
exports.DOOR_OPEN_SLOW = 3.4; // pengali waktu buka pintu (0,7 dtk x 3,4 = ~2,4 dtk) agar selaras dengan suara derit pintu yang lambat
exports.DOOR_CLOSE_SCALE = 0.85; // pengali waktu tutup pintu (~0,6 dtk) selaras suara tutup pintu
exports.DOOR_SLAM_SECONDS = 0.22; // pintu dibanting menutup oleh event
exports.FLOOR_CREAK_CHANCE = 0.035; // peluang decit papan lantai per langkah jalan (acak, jarang)
exports.STRIDE_WALK = 1.2; // panjang langkah (m) -> cadence = kecepatan / panjang langkah: jalan ~1,8/dtk
exports.STRIDE_RUN = 1.2; // lari ~3,3 langkah/dtk (kecepatan lari lebih tinggi, panjang langkah sama)
exports.STRIDE_CROUCH = 0.75; // jongkok ~1,5/dtk
exports.STRIDE_STAIRS = 0.95; // tangga ~1,8/dtk (kecepatan x STAIR_SPEED_MUL)
exports.FLOOR_CREAK_GAP = 25; // jeda minimum antar decit (detik)
// ---- Audio ----
exports.MASTER_VOLUME = 0.85;
exports.MAX_VOICES = 10; // batas suara aktif bersamaan (ringan untuk HP)
exports.FOOTSTEP_VOLUME = 0.2; // pelan
exports.AMBIENCE_VOLUME = 0.12;
exports.BUZZ_VOLUME = 0.09;
// ---- Atmosfer ----
exports.DUST_COUNT = 70; // partikel debu (1 draw call)
exports.SWAY_IDLE = 0.0035; // goyang napas saat diam (radian)
exports.OPENING_ENABLED = true; // opening bangun setelah pingsan (sekali saat pertama masuk game)
exports.OPENING_SECONDS = 7.5; // total durasi (detik)
exports.OPENING_BLUR_PX = 11; // blur awal (px); turun sampai 0
exports.MUFFLE_MIN_HZ = 320; // low-pass saat paling teredam (Hz)
exports.HEART_BELOW = 28; // detak jantung bila stamina di bawah ini (%) atau kelelahan
// ---- Environmental storytelling (dekor ringan, tanpa collision) ----
exports.DECOR_ENABLED = true;
exports.DECOR_MIN_GAP = 2.2; // jarak minimum antar-dekor (meter) agar map tidak penuh
exports.DECOR_COUNTS = { paper: 8, stain: 5, box: 4, can: 3, cable: 4, pipe: 3, vent: 4, extinguisher: 2, warning: 3, exit: 2 };
// ---- Variasi kondisi ruangan per seed (pintu terbuka, lampu redup/berkedip, container kosong terbuka, furniture bergeser, jumlah dekor) ----
exports.ROOM_STATE_ENABLED = true;
exports.ROOM_STATE = { doors: [2, 4], lights: [3, 5], containers: [2, 4], shifts: [1, 3], decorVar: 0.4 };
// ---- SCP-106 jumpscare (KHUSUS locker & lemari; lokasi pemicu diacak per run dari seed, tiap lokasi terpilih memicu SEKALI) ----
exports.SCARE_PICK_MIN = 5; // minimal lokasi pemicu per run (bila kandidat <= ini, tetap disisakan 1 yang normal)
exports.SCARE_PICK_FRAC = 0.12; // proporsi kandidat yang menjadi pemicu
exports.SCARE_PICK_MAX = 12; // batas atas (jangan membuat semua locker jadi pemicu)
exports.SCARE_DURATION = 1.25; // detik SCP terlihat sebelum langsung menghilang
exports.SCARE_SLOW_SECONDS = 1.5; // pemain diperlambat TEPAT selama ini
exports.SCARE_SLOW_MUL = 0.35; // pengali kecepatan saat diperlambat (setelah 1,5 dtk kembali 1.0)
exports.SCARE_BLUR_PX = 5; // blur penglihatan puncak (px, CSS filter pada canvas game)
exports.SCARE_BLUR_IN = 0.12; // detik naiknya blur
exports.SCARE_BLUR_OUT = 0.9; // detik pulihnya blur secara halus setelah efek berakhir
// ---- Mode pemain (Single Player / 2 / 3 / 4 Players). Dipilih di lobby, disimpan di perangkat, dipakai PlayScene untuk spawn & slot ----
// CATATAN: belum ada networking. Hanya slot 0 (pemain lokal) yang bisa dimainkan; slot lain adalah slot terdaftar (struktur spawn/kamera siap).
exports.PLAYER_MODE_DEFAULT = 1;
exports.MAX_PLAYERS = 4;
exports.SPAWN_SPREAD = 0.9; // jarak (m) slot tambahan dari titik spawn utama (slot 0 selalu tepat di titik spawn asli)
exports.SPAWN_MIN_GAP = 0.6; // jarak minimum antar titik spawn (m)
// ---- Monster (Gaunt Creature): patroli di lantai atas, deteksi, kejar, tangkap. Semua angka dalam meter / detik.
exports.MONSTER_ENABLED = true;
exports.MONSTER_LEVEL = 1; // lantai atas (mezzanine)
exports.MONSTER_RADIUS = 0.3; // radius gerak/collision (sama dengan pemain & inflasi NavGrid agar muat di pintu 1,18 m)
exports.MONSTER_PATROL_SPEED = 1.6; // jalan patroli (pemain jalan = 2,2; lari = 4,0)
exports.MONSTER_INVESTIGATE_SPEED = 2.3;
exports.MONSTER_CHASE_SPEED = 3.1; // lebih cepat dari jalan, lebih lambat dari lari pemain (stamina membatasi lari)
exports.MONSTER_SIGHT_RANGE = 12; // jarak pandang (butuh garis pandang & dalam sudut pandang)
exports.MONSTER_FOV_DEG = 120;
exports.MONSTER_SENSE_RADIUS = 2.0; // terasa walau di luar sudut pandang (butuh garis pandang)
exports.MONSTER_HEAR_RUN = 10; // jarak dengar: lari / jalan / jongkok (didengar menembus dinding separuh jarak)
exports.MONSTER_HEAR_WALK = 4.5;
exports.MONSTER_HEAR_CROUCH = 1.6;
exports.MONSTER_LOSE_TIME = 6; // detik tanpa mendeteksi target -> berhenti mengejar
exports.MONSTER_SEARCH_TIME = 5; // mencari di titik terakhir sebelum kembali patroli
exports.MONSTER_CATCH_RADIUS = 1.05; // jarak tangkap (divalidasi otoritas)
exports.MONSTER_RESET_TIME = 6; // jeda monster setelah menangkap (pemain lain aman selama ini)
exports.MONSTER_GRACE = 10; // detik kebal setelah respawn
exports.MONSTER_NET_HZ = 10; // frekuensi snapshot monster ke pemain lain
exports.MONSTER_HEART_RANGE = 22; // jarak mulai terdengar detak jantung
exports.MONSTER_VIEW_RANGE = 34; // di luar jarak ini model tidak digambar/dianimasikan (hemat FPS)
