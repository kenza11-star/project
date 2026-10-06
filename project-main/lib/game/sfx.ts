// Daftar SFX (semua dibuat prosedural oleh scripts/gen-sfx.py -> public/sfx/*.wav, bebas lisensi).
export type SfxName =
  | 'step_carpet' | 'step_tile' | 'ambient' | 'buzz' | 'distant'
  | 'door_open' | 'door_close' | 'door_locked'
  | 'key_pickup' | 'item_pickup' | 'lock_unlock' | 'chain_fall'
  | 'drawer_open' | 'drawer_close' | 'cabinet_open' | 'cabinet_close'
  | 'locker_open' | 'locker_close' | 'lid_open' | 'lid_close' | 'search'
  | 'flash_click' | 'battery_use' | 'flash_die'
  | 'lights_off' | 'lights_on' | 'furniture_scrape'
  | 'entity_whisper' | 'entity_steps' | 'breath';

export interface SfxDef {
  files: string[];   // varian (dipilih acak, tidak berulang berurutan)
  vol: number;       // volume dasar 0..1
  jitter: number;    // variasi pitch +/- (0.05 = 5%)
  max: number;       // jarak maksimum terdengar (meter) untuk suara posisional; di luar itu tidak diputar
  ref?: number;      // jarak referensi (volume penuh)
  prio: number;      // prioritas bila batas suara tercapai (besar = penting)
  gap?: number;      // jeda minimum antar pemutaran jenis yang sama (detik)
  loop?: boolean;
}

export const SFX: Record<SfxName, SfxDef> = {
  step_carpet: { files: ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'], vol: 1, jitter: 0.08, max: 0, prio: 1, gap: 0.12 },
  step_tile: { files: ['step_tile_1', 'step_tile_2'], vol: 1, jitter: 0.08, max: 0, prio: 1, gap: 0.12 },
  ambient: { files: ['ambient_loop'], vol: 1, jitter: 0, max: 0, prio: 3, loop: true },
  buzz: { files: ['buzz_loop'], vol: 1, jitter: 0.02, max: 9, ref: 1.5, prio: 2, loop: true },
  distant: { files: ['distant_1', 'distant_2', 'distant_3'], vol: 0.55, jitter: 0.06, max: 30, ref: 4, prio: 3 },
  door_open: { files: ['door_open'], vol: 0.8, jitter: 0.07, max: 18, ref: 2, prio: 5, gap: 0.2 },
  door_close: { files: ['door_close'], vol: 0.9, jitter: 0.07, max: 18, ref: 2, prio: 5, gap: 0.2 },
  door_locked: { files: ['door_locked'], vol: 0.7, jitter: 0.05, max: 10, ref: 2, prio: 6 },
  key_pickup: { files: ['key_pickup'], vol: 0.7, jitter: 0.04, max: 0, prio: 8 },
  item_pickup: { files: ['item_pickup'], vol: 0.6, jitter: 0.08, max: 0, prio: 6 },
  lock_unlock: { files: ['lock_unlock'], vol: 0.85, jitter: 0.03, max: 12, ref: 2, prio: 8 },
  chain_fall: { files: ['chain_fall'], vol: 0.9, jitter: 0.03, max: 16, ref: 2, prio: 8 },
  drawer_open: { files: ['drawer_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  drawer_close: { files: ['drawer_close'], vol: 0.65, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  cabinet_open: { files: ['cabinet_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  cabinet_close: { files: ['cabinet_close'], vol: 0.7, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  locker_open: { files: ['locker_open'], vol: 0.6, jitter: 0.06, max: 12, ref: 1.5, prio: 4 },
  locker_close: { files: ['locker_close'], vol: 0.7, jitter: 0.06, max: 12, ref: 1.5, prio: 4 },
  lid_open: { files: ['lid_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  lid_close: { files: ['lid_close'], vol: 0.7, jitter: 0.08, max: 12, ref: 1.5, prio: 4 },
  search: { files: ['search'], vol: 0.5, jitter: 0.06, max: 10, ref: 1.5, prio: 4 },
  flash_click: { files: ['flash_click'], vol: 0.55, jitter: 0.05, max: 0, prio: 7 },
  battery_use: { files: ['battery_use'], vol: 0.7, jitter: 0.03, max: 0, prio: 7 },
  flash_die: { files: ['flash_die'], vol: 0.7, jitter: 0.03, max: 0, prio: 7 },
  lights_off: { files: ['lights_off'], vol: 0.85, jitter: 0.03, max: 0, prio: 9 },
  lights_on: { files: ['lights_on'], vol: 0.85, jitter: 0.03, max: 0, prio: 9 },
  furniture_scrape: { files: ['furniture_scrape'], vol: 0.85, jitter: 0.06, max: 22, ref: 2.5, prio: 9 },
  entity_whisper: { files: ['entity_whisper'], vol: 0.6, jitter: 0.05, max: 24, ref: 3, prio: 9 },
  entity_steps: { files: ['entity_steps'], vol: 0.55, jitter: 0.04, max: 22, ref: 3, prio: 9 },
  breath: { files: ['breath'], vol: 0.5, jitter: 0.04, max: 0, prio: 6, gap: 1 },
};

export const SFX_BASE = '/sfx/';
