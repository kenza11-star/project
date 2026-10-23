// Puzzle saklar (logika murni, tanpa three.js; dites di scripts/test-switch.js).
// 5 saklar di 5 ruangan terpisah (lantai 1). Urutan benar = permutasi acak dari seed room (sama di semua klien, TIDAK disiarkan).
// Salah urutan = semua saklar kembali mati (reset). Benar semua = misi saklar selesai. Host memutuskan (lihat World.pressSwitch).
import type { Room } from './mapdata';
import { NavGrid } from './layout';
import { makeRng, type Rng } from './rng';

export const SWITCH_COUNT = 5;
/** Ruangan lantai 1 yang boleh berisi saklar (bukan hub/jalan/tangga/exit/ruang tersembunyi). */
export const SWITCH_ROOM_TYPES = ['admin', 'archive', 'break', 'docs', 'kitchen', 'locker', 'meeting', 'tech'];

/** order[k] = indeks saklar yang harus ditekan ke-k. Deterministik dari seed; tidak pernah urut 0,1,2,3,4. */
export function switchOrder(seed: number, n = SWITCH_COUNT): number[] {
  const rng = makeRng((seed ^ 0x51a7c0de) >>> 0);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let t = 0; t < 8; t++) { rng.shuffle(a); if (a.some((v, i) => v !== i)) break; }
  return a;
}

export type PressResult = 'ignored' | 'ok' | 'done' | 'reset';
export class SwitchPuzzle {
  /** v = versi (naik tiap perubahan, dipakai sinkron jaringan); p = banyak saklar yang sudah benar (mengikuti `order`). */
  v = 0; p = 0;
  constructor(readonly order: number[]) {}
  get n() { return this.order.length; }
  get done() { return this.p >= this.n; }
  isOn(i: number): boolean { const k = this.order.indexOf(i); return k >= 0 && k < this.p; }
  /** Tekan saklar i (hanya dipanggil di host / single player). */
  press(i: number): PressResult {
    if (!Number.isInteger(i) || i < 0 || i >= this.n || this.done || this.isOn(i)) return 'ignored';
    this.v++;
    if (this.order[this.p] === i) { this.p++; return this.done ? 'done' : 'ok'; }
    this.p = 0; return 'reset';
  }
  /** Terapkan state otoritatif dari host. true bila berubah (versi lebih baru). */
  apply(v: number, p: number): boolean {
    if (!(v > this.v) || !Number.isInteger(p) || p < 0 || p > this.n) return false;
    this.v = v; this.p = p; return true;
  }
  reset() { this.v = 0; this.p = 0; }
}

// ---------- penempatan: saklar menempel di dinding, di 5 ruangan berbeda ----------
export interface SwitchSpot { id: string; room: string; x: number; y: number; z: number; yaw: number; ax: number; az: number }
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export interface PlanSwitchOpts { rooms: Room[]; spawn: { x: number; z: number }; keepouts: { x: number; z: number; r: number }[]; mustReach?: { x: number; z: number; rad?: number }[]; count?: number; maxAttempts?: number }

/** Pilih `count` titik dinding di ruangan berbeda: terjangkau, ada ruang berdiri di depannya, tidak tertutup furniture, jauh dari spawn/pintu/exit/tangga.
 *  Panggil SETELAH furniture ditempatkan (nav sudah memuatnya). Saklar tidak punya collision, jadi jalan tidak berubah. */
export function planSwitches(nav: NavGrid, rng: Rng, o: PlanSwitchOpts): SwitchSpot[] {
  const want = o.count ?? SWITCH_COUNT, out: SwitchSpot[] = [];
  const rooms = rng.shuffle(o.rooms.filter((r) => r.level === 0 && SWITCH_ROOM_TYPES.includes(r.type)).slice());
  const occAt = (x: number, z: number) => { const [i, j] = nav.cellOf(x, z); return i < 0 || j < 0 || i >= nav.W || j >= nav.H || nav.occ[j * nav.W + i] === 1; };
  for (const rm of rooms) {
    if (out.length >= want) break;
    const R = rm.rect;
    for (let a = 0; a < (o.maxAttempts ?? 500); a++) {
      const px = rng.range(R.minx + 0.8, R.maxx - 0.8), pz = rng.range(R.minz + 0.8, R.maxz - 0.8);
      let best = -1, bd = 9; // dinding terdekat dari titik uji
      for (let k = 0; k < 4; k++) {
        let d = 0; while (d < 6) { const [i, j] = nav.cellOf(px + DIRS[k][0] * d, pz + DIRS[k][1] * d); if (nav.wallOnly[j * nav.W + i]) break; d += 0.05; }
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0 || bd >= 4) continue;
      const wx = DIRS[best][0], wz = DIRS[best][1], wd = bd - 0.05;
      const sx = px + wx * wd, sz = pz + wz * wd;           // titik di permukaan dinding
      const x = sx + wx * 0.02, z = sz + wz * 0.02;         // pusat kotak saklar (tebal 0,14): sisi belakang masuk ke dinding, jadi tidak pernah melayang walau raster dinding kasar (0,1 m)
      const ax = sx - wx * 0.8, az = sz - wz * 0.8;         // titik berdiri di depan saklar
      if (![0.04, 0.08, 0.12, 0.16].some((d) => { const [wi, wj] = nav.cellOf(x + wx * d, z + wz * d); return nav.wallOnly[wj * nav.W + wi] === 1; })) continue; // sel dinding harus tepat di belakang kotak
      if (ax < R.minx + 0.2 || ax > R.maxx - 0.2 || az < R.minz + 0.2 || az > R.maxz - 0.2) continue;
      const [ci, cj] = nav.cellOf(ax, az); if (!nav.isReachedCell(ci, cj)) continue;
      let blocked = false;
      for (let d = 0.1; d <= 0.8 && !blocked; d += 0.05) if (occAt(sx - wx * d, sz - wz * d) && d > 0.12) blocked = true;      // furniture di depan dinding
      for (let di = -4; di <= 4 && !blocked; di++) for (let dj = -4; dj <= 4; dj++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= nav.W || jj >= nav.H) continue; if (nav.occ[jj * nav.W + ii]) { blocked = true; break; } } // ruang berdiri
      if (blocked) continue;
      if (Math.hypot(x - o.spawn.x, z - o.spawn.z) < 6) continue;
      if (o.keepouts.some((k) => Math.hypot(k.x - x, k.z - z) < k.r)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
      out.push({ id: 'sw' + out.length, room: rm.id, x, y: 1.25, z, yaw: Math.atan2(-wx, -wz), ax, az });
      break;
    }
  }
  return out;
}
