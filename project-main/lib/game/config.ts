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
export const LEVEL_Y = [0, 3.4]; // tinggi lantai per level: lantai 1 (y=0) dan lantai 2 (permukaan slab)
export const REACH = 2.4;          // jarak maksimum interaksi (meter)
export const PLAYER_RADIUS = 0.3;  // radius collision pemain (berdiri)
export const PLAYER_RADIUS_CROUCH = 0.24; // collider lebih kecil saat jongkok
export const ALMOND_COUNT = 8;     // Almond Water yang tersebar di lantai (fitur lama)

// ---- Lighting ----
export const LIGHT_SCALE = 0.6;    // skala intensitas lampu GLB (turunkan bila terlalu terang)
export const LIGHT_POOL = 3;       // jumlah lampu dinamis aktif dari map (ringan untuk HP)
export const AMBIENT = 0.18;       // cahaya ambient dasar. Kecil = area tanpa lampu benar-benar gelap
export const FOG_DENSITY = 0.085;

// ---- Flashlight & battery ----
export const FLASH_MAX_SECONDS = 120;   // pemakaian terus-menerus maksimal per battery (2 menit)
export const START_BATTERIES = 1;       // battery di inventory saat mulai
export const MIN_BATTERY_PICKUPS = 3;   // minimal battery tambahan yang tersembunyi di furniture per run
export const FLASH_INTENSITY = 26;
export const FLASH_ANGLE = 0.52;        // radian (cone)
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
export const EVENT_WEIGHTS = { lights: 3, door: 3, furniture: 2, entity: 2 };

// ---- Audio ----
export const MASTER_VOLUME = 0.85;
export const MAX_VOICES = 10;           // batas suara aktif bersamaan (ringan untuk HP)
export const FOOTSTEP_VOLUME = 0.2;     // pelan
export const AMBIENCE_VOLUME = 0.12;
export const BUZZ_VOLUME = 0.09;

// ---- Atmosfer ----
export const DUST_COUNT = 70;          // partikel debu (1 draw call)
export const SWAY_IDLE = 0.0035;       // goyang napas saat diam (radian)
export const HEART_BELOW = 28;         // detak jantung bila stamina di bawah ini (%) atau kelelahan

// ---- Environmental storytelling (dekor ringan, tanpa collision) ----
export const DECOR_ENABLED = true;
export const DECOR_MIN_GAP = 2.2;      // jarak minimum antar-dekor (meter) agar map tidak penuh
export const DECOR_COUNTS = { paper: 8, stain: 5, box: 4, can: 3, cable: 4, pipe: 3, vent: 4, extinguisher: 2, warning: 3, exit: 2 };

// ---- Variasi kondisi ruangan per seed (pintu terbuka, lampu redup/berkedip, container kosong terbuka, furniture bergeser, jumlah dekor) ----
export const ROOM_STATE_ENABLED = true;
export const ROOM_STATE: { doors: [number, number]; lights: [number, number]; containers: [number, number]; shifts: [number, number]; decorVar: number } =
  { doors: [2, 4], lights: [3, 5], containers: [2, 4], shifts: [1, 3], decorVar: 0.4 };
