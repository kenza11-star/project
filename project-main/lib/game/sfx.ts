// Daftar SFX. File .wav lama dibuat prosedural oleh scripts/gen-sfx.py (tetap ada, dipakai sebagai cadangan bila file baru gagal dimuat);
// file .mp3 dari repo Sound dipakai lewat potongan (clip) di sfxclips.ts (dibuat scripts/gen-sfx-clips.py).
import { CLIPS, WALK_CLIPS, RUN_CLIPS, STAIRS_CLIPS, HEART_CLIPS, BREATH_CLIPS } from './sfxclips';
export { CLIPS };
export type SfxName =
  | 'step_carpet' | 'step_tile' | 'ambient' | 'buzz' | 'distant'
  | 'door_open' | 'door_close' | 'door_locked'
  | 'key_pickup' | 'item_pickup' | 'lock_unlock' | 'chain_fall'
  | 'drawer_open' | 'drawer_close' | 'cabinet_open' | 'cabinet_close'
  | 'locker_open' | 'locker_close' | 'lid_open' | 'lid_close' | 'search'
  | 'flash_click' | 'battery_use' | 'flash_die'
  | 'lights_off' | 'lights_on' | 'furniture_scrape'
  | 'entity_whisper' | 'entity_steps' | 'breath' | 'heartbeat' | 'pant' | 'rustle'
  | 'step_walk' | 'step_run' | 'step_stairs' | 'floor_creak' | 'door_slam' | 'impact_slam';

export interface SfxDef {
  files: string[];   // varian: nama clip (sfxclips.ts) atau nama .wav (dipilih acak, tidak berulang berurutan)
  legacy?: string[]; // file .wav lama: dipakai hanya bila SEMUA varian baru gagal dimuat
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
  distant: { files: ['distant_1', 'distant_2', 'distant_3', 'floor_creak'], vol: 0.55, jitter: 0.06, max: 30, ref: 4, prio: 3 },
  door_open: { files: ['door_creak'], legacy: ['door_open'], vol: 0.55, jitter: 0.07, max: 18, ref: 2, prio: 5, gap: 0.2 },
  door_close: { files: ['door_close_hit'], legacy: ['door_close'], vol: 0.9, jitter: 0.07, max: 18, ref: 2, prio: 5, gap: 0.2 },
  door_locked: { files: ['door_locked'], vol: 0.7, jitter: 0.05, max: 10, ref: 2, prio: 6 },
  key_pickup: { files: ['key_pickup'], vol: 0.7, jitter: 0.04, max: 0, prio: 8 },
  item_pickup: { files: ['item_pickup'], vol: 0.6, jitter: 0.08, max: 0, prio: 6 },
  lock_unlock: { files: ['unlock_metal'], legacy: ['lock_unlock'], vol: 0.85, jitter: 0.03, max: 12, ref: 2, prio: 8 },
  chain_fall: { files: ['chain_fall'], vol: 0.9, jitter: 0.03, max: 16, ref: 2, prio: 8 },
  drawer_open: { files: ['drawer_open_a', 'drawer_open_b'], legacy: ['drawer_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  drawer_close: { files: ['drawer_close_a', 'drawer_close_b'], legacy: ['drawer_close'], vol: 0.65, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  cabinet_open: { files: ['cabinet_open_a'], legacy: ['cabinet_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  cabinet_close: { files: ['cabinet_close_a'], legacy: ['cabinet_close'], vol: 0.7, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  locker_open: { files: ['locker_open_a'], legacy: ['locker_open'], vol: 0.6, jitter: 0.06, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  locker_close: { files: ['locker_close_a'], legacy: ['locker_close'], vol: 0.7, jitter: 0.06, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  lid_open: { files: ['lid_open'], vol: 0.6, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  lid_close: { files: ['lid_close'], vol: 0.7, jitter: 0.08, max: 12, ref: 1.5, prio: 4, gap: 0.15 },
  search: { files: ['search'], vol: 0.5, jitter: 0.06, max: 10, ref: 1.5, prio: 4 },
  flash_click: { files: ['flash_click'], vol: 0.55, jitter: 0.05, max: 0, prio: 7 },
  battery_use: { files: ['battery_use'], vol: 0.7, jitter: 0.03, max: 0, prio: 7 },
  flash_die: { files: ['flash_die'], vol: 0.7, jitter: 0.03, max: 0, prio: 7 },
  lights_off: { files: ['lights_off'], vol: 0.85, jitter: 0.03, max: 0, prio: 9 },
  lights_on: { files: ['lights_on'], vol: 0.85, jitter: 0.03, max: 0, prio: 9 },
  furniture_scrape: { files: ['furniture_scrape'], vol: 0.85, jitter: 0.06, max: 22, ref: 2.5, prio: 9 },
  entity_whisper: { files: ['entity_whisper'], vol: 0.6, jitter: 0.05, max: 24, ref: 3, prio: 9 },
  entity_steps: { files: ['entity_steps'], vol: 0.55, jitter: 0.04, max: 22, ref: 3, prio: 9 },
  heartbeat: { files: HEART_CLIPS, legacy: ['heartbeat'], vol: 0.6, jitter: 0.02, max: 0, prio: 5, gap: 0.25 },
  pant: { files: BREATH_CLIPS, legacy: ['pant'], vol: 0.5, jitter: 0.03, max: 0, prio: 6, gap: 1.8 },
  rustle: { files: ['rustle'], vol: 0.55, jitter: 0.06, max: 8, ref: 1.5, prio: 4, gap: 0.3 },
  breath: { files: BREATH_CLIPS, legacy: ['breath'], vol: 0.45, jitter: 0.04, max: 0, prio: 6, gap: 1 },
  step_walk: { files: WALK_CLIPS, legacy: ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'], vol: 1, jitter: 0.04, max: 0, prio: 1, gap: 0.12 },
  step_run: { files: RUN_CLIPS, legacy: ['step_tile_1', 'step_tile_2'], vol: 1, jitter: 0.04, max: 0, prio: 1, gap: 0.08 },
  step_stairs: { files: STAIRS_CLIPS, legacy: ['step_tile_1', 'step_tile_2'], vol: 1, jitter: 0.04, max: 0, prio: 1, gap: 0.12 },
  floor_creak: { files: ['floor_creak'], vol: 0.6, jitter: 0.05, max: 0, prio: 2, gap: 6 },
  door_slam: { files: ['door_slam'], vol: 1, jitter: 0.04, max: 40, ref: 3, prio: 9 },
  impact_slam: { files: ['impact_slam'], vol: 0.95, jitter: 0.04, max: 40, ref: 3, prio: 9 },
};

export const SFX_BASE = '/sfx/';
