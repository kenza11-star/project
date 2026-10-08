"use strict";
// Konfigurasi game Backrooms. Ubah nilai di sini.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOM_STATE_ENABLED = exports.DECOR_COUNTS = exports.DECOR_MIN_GAP = exports.DECOR_ENABLED = exports.HEART_BELOW = exports.SWAY_IDLE = exports.DUST_COUNT = exports.BUZZ_VOLUME = exports.AMBIENCE_VOLUME = exports.FOOTSTEP_VOLUME = exports.MAX_VOICES = exports.MASTER_VOLUME = exports.EVENT_WEIGHTS = exports.EVENT_TYPE_COOLDOWN = exports.EVENT_RETRY_MAX = exports.EVENT_RETRY_MIN = exports.EVENT_GAP_MAX = exports.EVENT_GAP_MIN = exports.EVENT_FIRST_MAX = exports.EVENT_FIRST_MIN = exports.STAMINA_RESUME_AT = exports.STAMINA_REGEN_DELAY = exports.STAMINA_REGEN = exports.STAMINA_DRAIN = exports.STAMINA_MAX = exports.CROUCH_SPEED = exports.SPRINT_SPEED = exports.WALK_SPEED = exports.FLASH_LOW_PCT = exports.FLASH_DISTANCE = exports.FLASH_ANGLE = exports.FLASH_INTENSITY = exports.MIN_BATTERY_PICKUPS = exports.START_BATTERIES = exports.FLASH_MAX_SECONDS = exports.FOG_DENSITY = exports.AMBIENT = exports.LIGHT_POOL = exports.LIGHT_SCALE = exports.ALMOND_COUNT = exports.PLAYER_RADIUS_CROUCH = exports.PLAYER_RADIUS = exports.REACH = exports.LEVEL_Y = exports.MAP_URL = exports.MAX_FURNITURE = exports.MIN_FURNITURE = exports.REQUIRED_KEYS = exports.MAP_SEED = exports.RANDOMIZE_PROPS = void 0;
exports.ROOM_STATE = void 0;
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
exports.LEVEL_Y = [0, 3.4]; // tinggi lantai per level: lantai 1 (y=0) dan lantai 2 (permukaan slab)
exports.REACH = 2.4; // jarak maksimum interaksi (meter)
exports.PLAYER_RADIUS = 0.3; // radius collision pemain (berdiri)
exports.PLAYER_RADIUS_CROUCH = 0.24; // collider lebih kecil saat jongkok
exports.ALMOND_COUNT = 8; // Almond Water yang tersebar di lantai (fitur lama)
// ---- Lighting ----
exports.LIGHT_SCALE = 0.6; // skala intensitas lampu GLB (turunkan bila terlalu terang)
exports.LIGHT_POOL = 3; // jumlah lampu dinamis aktif dari map (ringan untuk HP)
exports.AMBIENT = 0.18; // cahaya ambient dasar. Kecil = area tanpa lampu benar-benar gelap
exports.FOG_DENSITY = 0.085;
// ---- Flashlight & battery ----
exports.FLASH_MAX_SECONDS = 120; // pemakaian terus-menerus maksimal per battery (2 menit)
exports.START_BATTERIES = 1; // battery di inventory saat mulai
exports.MIN_BATTERY_PICKUPS = 3; // minimal battery tambahan yang tersembunyi di furniture per run
exports.FLASH_INTENSITY = 26;
exports.FLASH_ANGLE = 0.52; // radian (cone)
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
exports.EVENT_WEIGHTS = { lights: 3, door: 3, furniture: 2, entity: 2 };
// ---- Audio ----
exports.MASTER_VOLUME = 0.85;
exports.MAX_VOICES = 10; // batas suara aktif bersamaan (ringan untuk HP)
exports.FOOTSTEP_VOLUME = 0.2; // pelan
exports.AMBIENCE_VOLUME = 0.12;
exports.BUZZ_VOLUME = 0.09;
// ---- Atmosfer ----
exports.DUST_COUNT = 70; // partikel debu (1 draw call)
exports.SWAY_IDLE = 0.0035; // goyang napas saat diam (radian)
exports.HEART_BELOW = 28; // detak jantung bila stamina di bawah ini (%) atau kelelahan
// ---- Environmental storytelling (dekor ringan, tanpa collision) ----
exports.DECOR_ENABLED = true;
exports.DECOR_MIN_GAP = 2.2; // jarak minimum antar-dekor (meter) agar map tidak penuh
exports.DECOR_COUNTS = { paper: 8, stain: 5, box: 4, can: 3, cable: 4, pipe: 3, vent: 4, extinguisher: 2, warning: 3, exit: 2 };
// ---- Variasi kondisi ruangan per seed (pintu terbuka, lampu redup/berkedip, container kosong terbuka, furniture bergeser, jumlah dekor) ----
exports.ROOM_STATE_ENABLED = true;
exports.ROOM_STATE = { doors: [2, 4], lights: [3, 5], containers: [2, 4], shifts: [1, 3], decorVar: 0.4 };
