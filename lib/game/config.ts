// Konfigurasi game Backrooms. Ubah nilai di sini.

// true = furniture tambahan di-spawn acak tiap run. false = hanya furniture bawaan map.
export const RANDOMIZE_PROPS = true;

// null = seed acak BARU tiap mulai / restart (layout, key, event berubah tiap run).
// Angka = semua elemen acak selalu sama (reproducible).
export const MAP_SEED: number | null = null;

// Jumlah key = jumlah gembok di exit (lihat lib/game/keys.ts: Yellow, Red, Green).
export const REQUIRED_KEYS = 3;

// Jumlah furniture acak tambahan per run.
export const MIN_FURNITURE = 8;
export const MAX_FURNITURE = 14;

// ---- Map / interaksi ----
export const MAP_URL = '/models/backrooms_full.glb'; // satu-satunya map utama
export const CHAIR_URL = '/models/chair.glb'; // model kursi custom; bila gagal dimuat, kursi bawaan map tetap dipakai
export const SODA_URL = '/models/NORVIX_SODA_330ML_1file_vertexcolor.glb'; // Soda NORVIX (GLB + vertex color); bila gagal dimuat, soda tidak di-spawn
export const SCP_URL = '/models/scp-106.glb';  // SCP-106 (skinned, tanpa animasi bawaan -> dianimasikan dari transformasi tulang, lihat scp106.ts)
export const LEVEL_Y = [0, 3.4]; // tinggi lantai per level: lantai 1 (y=0) dan lantai 2 (permukaan slab)
export const REACH = 2.4;          // jarak maksimum interaksi (meter)
export const PLAYER_RADIUS = 0.3;  // radius collision pemain (berdiri)
export const PLAYER_RADIUS_CROUCH = 0.24; // collider lebih kecil saat jongkok
// ---- Soda NORVIX (menggantikan Almond Water). Diletakkan di permukaan nyata: meja/meja kerja, papan rak, dan di dalam laci/lemari (isi container) ----
export const SODA_TABLES = 5;      // soda di atas meja / meja kerja (titik bawaan map + meja acak) per run
export const SODA_SHELVES = 3;     // soda di papan rak StorageShelf per run
export const SODA_MIN_GAP = 3.0;   // jarak minimum antar soda (m) agar tidak menumpuk di satu ruangan
export const SODA_CULL_DIST = 9;   // soda di luar jarak ini tidak digambar (model 112 rb vertex: hemat GPU HP; kabut sudah menutupinya)

// ---- Lighting ----
export const LIGHT_SCALE = 0.6;    // skala intensitas lampu GLB (turunkan bila terlalu terang)
export const LIGHT_POOL = 3;       // jumlah lampu dinamis aktif dari map (ringan untuk HP)
export const AMBIENT = 0.075;      // cahaya ambient dasar. Kecil = area tanpa lampu benar-benar gelap
export const FOG_DENSITY = 0.115;
export const FOG_COLOR = 0x0a0b06;     // fog lembap kehijauan-kuning gelap (juga warna background)
export const ATMOS_ENABLED = true;      // overlay grading + film grain (CSS ringan, tanpa post-processing pass)
export const GRAIN_OPACITY = 0.07;      // film grain halus (0 = mati)
export const EXPOSURE_BASE = 1.08;      // exposure dasar; sedikit 'bernapas' agar tidak terasa statis
export const POSTFX = true;            // post-processing 1 pass (tone map + grade + vignette + CA + grain). false = render langsung
export const POST_MSAA = 2;            // MSAA pada render target (0/2/4). Turunkan ke 0 bila GPU HP lemah
export const POST_VIGNETTE = 0.55;     // kegelapan tepi layar
export const POST_CONTRAST = 0.5;      // S-curve (0..1)
export const POST_DESAT = 0.14;        // pudar warna (tua/lembap)
export const POST_CA = 0.014;          // chromatic aberration tepi layar
export const SHADOWS = true;          // bayangan senter (1 SpotLight, 1 render pass tambahan; hanya diperbarui saat senter ON)
export const SHADOW_MAP = 512;        // resolusi shadow map senter (turunkan ke 256 bila FPS drop di HP lama)

// ---- Material upgrade (lib/game/materials.ts): detail kotor/lembap procedural, ringan ----
export const MATERIAL_UPGRADE = true;  // false = material asli GLB
export const MATERIAL_BUMP = 1.0;      // kekuatan bump halus
export const MATERIAL_GRIME = 1.0;     // kekuatan noda/AO kotor

// ---- Horror lighting FX (lib/game/lightfx.ts) ----
export const LFX_FLICKER_MEAN = 300;   // rata-rata detik antar kedip PER LAMPU (proses acak global berbasis waktu, tidak tergantung posisi pemain)
export const LFX_ELECTRICAL_CHANCE = 0.22;                  // peluang sebuah kedip menjadi electrical flicker (stutter panjang)
export const LFX_OUTAGE_MEAN = 1500;   // rata-rata detik antar lampu mati PER LAMPU
export const LFX_OUTAGE_HOLD: [number, number] = [3, 15];   // lama satu lampu mati (detik)
export const LFX_DARK_AMBIENT = 0.55;                       // ambient turun sampai ini saat lampu terdekat mati

// ---- Flashlight & battery ----
export const FLASH_MAX_SECONDS = 120;   // pemakaian terus-menerus maksimal per battery (2 menit)
export const START_BATTERIES = 1;       // battery di inventory saat mulai
export const MIN_BATTERY_PICKUPS = 3;   // minimal battery tambahan yang tersembunyi di furniture per run
export const FLASH_INTENSITY = 40;
export const FLASH_ANGLE = 0.46;        // radian (cone)
export const FLASH_DISTANCE = 15;
export const FLASH_LOW_PCT = 15;        // di bawah ini senter berkedip

// ---- Stamina ----
export const WALK_SPEED = 2.2;
export const SPRINT_SPEED = 4.0;
export const CROUCH_SPEED = 1.1;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 20;        // per detik saat sprint (5 detik penuh -> habis)
export const STAMINA_REGEN = 13;        // per detik saat tidak sprint
export const STAMINA_REGEN_DELAY = 0.9; // jeda (detik) sebelum regen mulai
export const STAMINA_RESUME_AT = 20;    // setelah habis, baru bisa sprint lagi di nilai ini

// ---- Random horror event ----
export const EVENT_FIRST_MIN = 50;      // detik sebelum event pertama
export const EVENT_FIRST_MAX = 100;
export const EVENT_GAP_MIN = 45;        // jeda antar event
export const EVENT_GAP_MAX = 120;
export const EVENT_RETRY_MIN = 12;      // bila event gagal (kondisi tidak aman) coba lagi
export const EVENT_RETRY_MAX = 25;
export const EVENT_TYPE_COOLDOWN = 100; // jenis yang sama tidak diulang dalam rentang ini
export const EVENT_WEIGHTS = { lights: 3, door: 3, furniture: 2, entity: 2, slam: 2 };
export const SLAM_MIN_DIST = 7;        // event bantingan pintu: jarak minimum dari pemain (m)
export const SLAM_MAX_DIST = 26;       // ...dan maksimum (masih terdengar jelas)
export const DOOR_OPEN_SLOW = 3.4;     // pengali waktu buka pintu (0,7 dtk x 3,4 = ~2,4 dtk) agar selaras dengan suara derit pintu yang lambat
export const DOOR_CLOSE_SCALE = 0.85;  // pengali waktu tutup pintu (~0,6 dtk) selaras suara tutup pintu
export const DOOR_SLAM_SECONDS = 0.22; // pintu dibanting menutup oleh event
export const FLOOR_CREAK_CHANCE = 0.035; // peluang decit papan lantai per langkah jalan (acak, jarang)
export const STRIDE_WALK = 1.2;       // panjang langkah (m) -> cadence = kecepatan / panjang langkah: jalan ~1,8/dtk
export const STRIDE_RUN = 1.2;        // lari ~3,3 langkah/dtk (kecepatan lari lebih tinggi, panjang langkah sama)
export const STRIDE_CROUCH = 0.75;    // jongkok ~1,5/dtk
export const STRIDE_STAIRS = 0.95;    // tangga ~1,8/dtk (kecepatan x STAIR_SPEED_MUL)
export const FLOOR_CREAK_GAP = 25;       // jeda minimum antar decit (detik)

// ---- Audio ----
export const MASTER_VOLUME = 0.85;
export const MAX_VOICES = 10;           // batas suara aktif bersamaan (ringan untuk HP)
export const FOOTSTEP_VOLUME = 0.2;     // pelan
export const AMBIENCE_VOLUME = 0.12;
export const BUZZ_VOLUME = 0.09;

// ---- Atmosfer ----
export const DUST_COUNT = 70;          // partikel debu (1 draw call)
export const SWAY_IDLE = 0.0035;       // goyang napas saat diam (radian)
export const OPENING_ENABLED = true;   // opening bangun setelah pingsan (sekali saat pertama masuk game)
export const OPENING_SECONDS = 7.5;     // total durasi (detik)
export const OPENING_BLUR_PX = 11;      // blur awal (px); turun sampai 0
export const MUFFLE_MIN_HZ = 320;       // low-pass saat paling teredam (Hz)
export const HEART_BELOW = 28;         // detak jantung bila stamina di bawah ini (%) atau kelelahan

// ---- Environmental storytelling (dekor ringan, tanpa collision) ----
export const DECOR_ENABLED = true;
export const DECOR_MIN_GAP = 2.2;      // jarak minimum antar-dekor (meter) agar map tidak penuh
export const DECOR_COUNTS = { paper: 8, stain: 5, box: 4, can: 3, cable: 4, pipe: 3, vent: 4, extinguisher: 2, warning: 3, exit: 2 };

// ---- Variasi kondisi ruangan per seed (pintu terbuka, lampu redup/berkedip, container kosong terbuka, furniture bergeser, jumlah dekor) ----
export const ROOM_STATE_ENABLED = true;
export const ROOM_STATE: { doors: [number, number]; lights: [number, number]; containers: [number, number]; shifts: [number, number]; decorVar: number } =
  { doors: [2, 4], lights: [3, 5], containers: [2, 4], shifts: [1, 3], decorVar: 0.4 };

// ---- SCP-106 jumpscare (KHUSUS locker & lemari; lokasi pemicu diacak per run dari seed, tiap lokasi terpilih memicu SEKALI) ----
export const SCARE_PICK_MIN = 5;          // minimal lokasi pemicu per run (bila kandidat <= ini, tetap disisakan 1 yang normal)
export const SCARE_PICK_FRAC = 0.12;      // proporsi kandidat yang menjadi pemicu
export const SCARE_PICK_MAX = 12;         // batas atas (jangan membuat semua locker jadi pemicu)
export const SCARE_DURATION = 1.25;       // detik SCP terlihat sebelum langsung menghilang
export const SCARE_SLOW_SECONDS = 1.5;    // pemain diperlambat TEPAT selama ini
export const SCARE_SLOW_MUL = 0.35;       // pengali kecepatan saat diperlambat (setelah 1,5 dtk kembali 1.0)
export const SCARE_BLUR_PX = 5;           // blur penglihatan puncak (px, CSS filter pada canvas game)
export const SCARE_BLUR_IN = 0.12;        // detik naiknya blur
export const SCARE_BLUR_OUT = 0.9;        // detik pulihnya blur secara halus setelah efek berakhir

// ---- Mode pemain (Single Player / 2 / 3 / 4 Players). Dipilih di lobby, disimpan di perangkat, dipakai PlayScene untuk spawn & slot ----
// CATATAN: belum ada networking. Hanya slot 0 (pemain lokal) yang bisa dimainkan; slot lain adalah slot terdaftar (struktur spawn/kamera siap).
export const PLAYER_MODE_DEFAULT: 1 | 2 | 3 | 4 = 1;
export const MAX_PLAYERS = 4;
export const SPAWN_SPREAD = 0.9;   // jarak (m) slot tambahan dari titik spawn utama (slot 0 selalu tepat di titik spawn asli)
export const SPAWN_MIN_GAP = 0.6;  // jarak minimum antar titik spawn (m)

// ---- Monster (Gaunt Creature): patroli di lantai atas, deteksi, kejar, tangkap. Semua angka dalam meter / detik.
export const MONSTER_ENABLED = true;
export const MONSTER_URL = '/models/gaunt-creature.glb'; // model monster berangka (scripts/rig-monster.py); gagal dimuat -> tanpa monster
export const MONSTER_LEVEL = 1;            // lantai atas (mezzanine)
export const MONSTER_TWO_FLOORS = true;    // monster patroli di KEDUA lantai (turun/naik tangga, mengikuti pemain yang pindah lantai); false = hanya lantai atas
export const MONSTER_GLOW = 0.28;          // cahaya tipis pada tekstur monster supaya tetap terlihat di tempat gelap (0 = mati)
export const MONSTER_RADIUS = 0.3;         // radius gerak/collision (sama dengan pemain & inflasi NavGrid agar muat di pintu 1,18 m)
export const MONSTER_PATROL_SPEED = 1.6;   // jalan patroli (pemain jalan = 2,2; lari = 4,0)
export const MONSTER_INVESTIGATE_SPEED = 2.3;
export const MONSTER_CHASE_SPEED = 3.1;    // lebih cepat dari jalan, lebih lambat dari lari pemain (stamina membatasi lari)
export const MONSTER_SIGHT_RANGE = 12;     // jarak pandang (butuh garis pandang & dalam sudut pandang)
export const MONSTER_FOV_DEG = 120;
export const MONSTER_SENSE_RADIUS = 2.0;   // terasa walau di luar sudut pandang (butuh garis pandang)
export const MONSTER_HEAR_RUN = 10;        // jarak dengar: lari / jalan / jongkok (didengar menembus dinding separuh jarak)
export const MONSTER_HEAR_WALK = 4.5;
export const MONSTER_HEAR_CROUCH = 1.6;
export const MONSTER_LOSE_TIME = 6;        // detik tanpa mendeteksi target -> berhenti mengejar
export const MONSTER_SEARCH_TIME = 5;      // mencari di titik terakhir sebelum kembali patroli
export const MONSTER_CATCH_RADIUS = 1.05;  // jarak tangkap (divalidasi otoritas)
export const MONSTER_RESET_TIME = 6;       // jeda monster setelah menangkap (pemain lain aman selama ini)
export const MONSTER_GRACE = 10;           // detik kebal setelah respawn
export const MONSTER_NET_HZ = 10;          // frekuensi snapshot monster ke pemain lain
export const MONSTER_HEART_RANGE = 22;     // jarak mulai terdengar detak jantung
// ---- Monster Drag (TAHAP 2): monster yang berhasil menangkap pemain menyeretnya ke satu ruangan acak yang valid; pemain tetap 'tertangkap' di sana.
export const MONSTER_DRAG_ENABLED = true;   // false = perilaku lama (monster pindah ke titik patroli, pemain respawn)
export const MONSTER_DRAG_START = 3.8;      // detik setelah tangkapan sebelum seretan mulai (> JS_TOTAL 3,6 dtk: jumpscare selesai dulu)
export const MONSTER_DRAG_SPEED = 1.3;      // kecepatan menyeret (lebih lambat dari patroli 1,6)
export const MONSTER_DRAG_MAX_SECONDS = 90; // batas waktu seretan; lewat ini seretan dihentikan di tempat (korban tetap tertangkap)
export const MONSTER_DRAG_MIN_DIST = 10;    // tujuan minimal sejauh ini (garis lurus) dari titik tangkapan
export const MONSTER_DRAG_MAX_PATH = 110;   // jalur seret maksimal (m) agar tidak melebihi batas waktu
export const MONSTER_DRAG_CLEAR = 0.55;     // titik tujuan harus punya ruang bebas sebesar ini dari dinding/furnitur (pemain 0,30 + margin)
export const MONSTER_DRAG_TRAIL = 0.9;      // jarak korban di belakang monster sepanjang jejak monster (titik jejak = pasti jalur yang bisa dilewati)
export const MONSTER_DRAG_WAIT = 10;        // korban menunggu seretan dimulai maks sekian detik setelah jumpscare; lewat ini tetap tertangkap di tempat
/** Tipe ruangan yang TIDAK boleh jadi tujuan seret (ruang rahasia, vault, area tangga/pintu keluar). */
export const MONSTER_DRAG_SKIP_ROOMS = ['ladder', 'stair', 'hidden1', 'hidden2', 'vault', 'exit'];
export const MONSTER_VIEW_RANGE = 34;      // di luar jarak ini model tidak digambar/dianimasikan (hemat FPS)
// ---- Capture POV (TAHAP 3): efek khusus untuk pemain yang tertangkap (hanya korban; pemain lain tidak terpengaruh).
// Diseret: layar perlahan gelap -> tiba: gelap total, tunggu CAPTURE_HOLD_SECONDS -> bangun (fade-in, blur/vignette turun, kontrol pulih).
export const CAPTURE_POV_ENABLED = true;    // false = perilaku TAHAP 2 (korban tetap tertangkap di tujuan, solo: tombol Main lagi)
export const CAPTURE_OPEN_SECONDS = 0.9;    // setelah jumpscare: pandangan terbuka dari hitam (melihat dirinya diseret)
export const CAPTURE_DARKEN_SECONDS = 14;   // waktu menuju gelap hampir penuh selama diseret (smoothstep, tanpa lonjakan)
export const CAPTURE_DARKEN_MAX = 0.96;     // kegelapan maksimum selama masih diseret (1.0 dicapai setelah tiba)
export const CAPTURE_SETTLE_SECONDS = 1.0;  // dari gelap saat tiba -> hitam total
export const CAPTURE_HOLD_SECONDS = 3.5;    // menunggu dalam gelap setelah tiba di ruangan
export const CAPTURE_WAKE_SECONDS = 5;      // durasi bangun (memakai WakeUp dari opening: fade-in, blur, vignette, suara teredam -> jernih)
export const CAPTURE_WAKE_BLUR = 7;         // blur awal saat bangun (px; otomatis dimatikan di HP yang FPS-nya rendah)
export const CAPTURE_GRACE = 12;            // detik kebal setelah bangun (dihitung otoritas saat korban tidak lagi 'tertangkap')

// TAHAP 4 -- audio tangkapan (spasial, terdengar pemain lain di sekitar lokasi). Jangkauan dengar = SFX.capture_scream.max / capture_impact.max (sfx.ts).
export const CAPTURE_AUDIO_ENABLED = true;        // false = perilaku lama (hanya korban, teriakan non-posisional dari timeline jumpscare)
export const CAPTURE_AUDIO_Y = 1.3;               // tinggi sumber suara di atas lantai (kepala/dada korban)
export const CAPTURE_AUDIO_OTHER_FLOOR_VOL = 0.6; // pengali volume bila pendengar di lantai lain (suara tembus lantai)
export const CAPTURE_AUDIO_VICTIM_COOLDOWN = 8;   // detik: korban yang sama tidak memicu suara tangkapan lagi (anti-spam; tangkapan sah berikutnya >= 28 dtk karena kebal)
export const CAPTURE_AUDIO_MIN_GAP = 1.5;         // detik minimum antar kejadian tangkapan yang diputar di satu klien (anti-banjir)
export const CAPTURE_AUDIO_LATE_DROP = 1.0;       // suara terjadwal yang terlambat > ini (tab di-background) dibuang, bukan diputar telat
