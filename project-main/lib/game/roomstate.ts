// Variasi kecil kondisi ruangan per seed (logika murni, tanpa three.js, bisa dites):
// pintu terbuka, lampu redup/berkedip, container kosong sudah terbuka, furniture sedikit bergeser, jumlah dekor.
// Layout utama tidak berubah; semua variasi hanya memilih dari kandidat yang aman (jauh dari spawn/exit, tidak menyentuh key).
import { CollisionWorld, type ObbIn } from './collision';
import { NavGrid, swingBox, boxesOverlap, SEARCHABLE, type Placement } from './layout';
import type { Rng } from './rng';
import type { DecorKind } from './decor';

export interface RoomStateCfg { doors: [number, number]; lights: [number, number]; containers: [number, number]; shifts: [number, number]; decorVar: number }
export interface RoomStateIn {
  rng: Rng; cfg: RoomStateCfg;
  spawn: { x: number; z: number }; exit: { x: number; z: number };
  doors: { cx: number; cz: number; level: number; type: string; locked: boolean }[];  // urutan = this.doors
  lights: { x: number; z: number }[];                                                // urutan = lightSrcs
  containers: { id: string; x: number; z: number }[];                                // HANYA yang isinya kosong (tidak berisi key/loot)
}
export interface RoomState {
  openDoors: number[]; dimLights: number[]; flickerLights: number[]; openContainers: string[];
  decorMul: Partial<Record<DecorKind, number>>;
}

const far = (a: { x: number; z: number }, x: number, z: number, r: number) => Math.hypot(a.x - x, a.z - z) >= r;
/** Ambil n (acak dalam [lo,hi], maks `frac` dari kandidat) indeks dari daftar kandidat. */
const take = <T>(rng: Rng, c: T[], [lo, hi]: [number, number], frac: number): T[] => rng.shuffle(c.slice()).slice(0, Math.min(rng.int(lo, hi), Math.floor(c.length * frac)));

export function planRoomState(o: RoomStateIn): RoomState {
  const { rng, cfg } = o;
  const doorC: number[] = []; o.doors.forEach((d, i) => { if (d.type === 'door' && !d.locked && d.level === 0 && far(o.spawn, d.cx, d.cz, 3.5) && far(o.exit, d.cx, d.cz, 4)) doorC.push(i); });
  const lightC: number[] = []; o.lights.forEach((l, i) => { if (far(o.spawn, l.x, l.z, 7) && far(o.exit, l.x, l.z, 7)) lightC.push(i); }); // sekitar spawn & exit tetap terang
  const contC = o.containers.filter((c) => far(o.spawn, c.x, c.z, 3.5));
  const lights = take(rng, lightC, cfg.lights, 0.3);
  const dimLights: number[] = [], flickerLights: number[] = [];
  for (const i of lights) (rng.chance(0.5) ? dimLights : flickerLights).push(i);
  const decorMul: RoomState['decorMul'] = {};
  for (const k of ['paper', 'stain', 'box', 'can', 'cable', 'vent'] as DecorKind[]) decorMul[k] = rng.range(1 - cfg.decorVar, 1 + cfg.decorVar);
  return {
    openDoors: take(rng, doorC, cfg.doors, 0.35), dimLights, flickerLights,
    openContainers: take(rng, contC, cfg.containers, 0.4).map((c) => c.id),
    decorMul,
  };
}

// ---------- geser furniture (dipakai event "furniture" dan variasi awal run) ----------
export interface ShiftIn {
  cw: CollisionWorld; fixed: ObbIn[]; placements: Placement[]; q: Placement; dx: number; dz: number;
  keepouts: { x: number; z: number; r: number }[]; pickups: { x: number; z: number }[];
  spawn: { x: number; z: number }; baseReach: number;
  mustOk: { x: number; z: number; rad?: number }[]; accessPts: { x: number; z: number }[];
}
const boxOf = (x: number, z: number, q: Placement) => ({ cx: x, cz: z, hx: q.hx, hz: q.hz, cos: Math.cos(q.yaw), sin: Math.sin(q.yaw) });

/** Validasi pergeseran furniture q sejauh (dx,dz). Mengembalikan nav baru + jumlah sel terjangkau, atau null bila tidak aman:
 *  seluruh lintasan & area ayunan tidak boleh menimpa dinding/furniture lain/keepout, dan jalan, titik wajib, serta akses container tetap terjangkau. */
export function planShift(a: ShiftIn): { nav: NavGrid; n: number } | null {
  const { q, dx, dz } = a;
  const nav = new NavGrid(a.cw, 0, a.fixed);
  for (const o of a.placements) if (o !== q) nav.addObb({ id: o.id, cx: o.x, cz: o.z, hx: o.hx, hz: o.hz, yaw: o.yaw, level: 0, kind: o.kind }, 0.05);
  for (let k = 0.1; k <= 1.0001; k += 0.1) { // lintasan digeser langkah 10%
    const ob = { id: q.id, cx: q.x + dx * k, cz: q.z + dz * k, hx: q.hx, hz: q.hz, yaw: q.yaw, level: 0, kind: q.kind };
    if (nav.hits(nav.occ, ob, 0.1) || nav.hits(nav.occ, { ...ob, ...swingBox(q.kind, ob) }, 0.02)) return null;
    const sw = swingBox(q.kind, ob);
    for (const kp of a.keepouts) if (CollisionWorld.distToObb({ ...sw, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) }, kp.x, kp.z) < kp.r) return null;
    for (const f of nav.fixed) if (f.kind !== 'rail' && boxesOverlap(ob, f, 0.05)) return null;
  }
  const nx = q.x + dx, nz = q.z + dz;
  for (const k of a.keepouts) if (CollisionWorld.distToObb(boxOf(nx, nz, q), k.x, k.z) < k.r) return null;
  for (const k of a.pickups) if (Math.hypot(k.x - nx, k.z - nz) < 0.9 + Math.max(q.hx, q.hz)) return null;
  nav.addObb({ id: q.id, cx: nx, cz: nz, hx: q.hx, hz: q.hz, yaw: q.yaw, level: 0, kind: q.kind }, 0.05);
  const n = nav.flood(a.spawn.x, a.spawn.z);
  if (n < a.baseReach * 0.97) return null;
  for (const m of a.mustOk) if (!nav.reached(m.x, m.z, m.rad ?? 0.25)) return null;
  for (const p of a.accessPts) if (!nav.reached(p.x, p.z, 1.6)) return null;
  for (const o of a.placements) if (o !== q && SEARCHABLE.includes(o.kind) && !nav.reached(o.ax, o.az, 0.15)) return null; // titik akses furniture lain tetap bebas
  if (SEARCHABLE.includes(q.kind) && !nav.reached(q.ax + dx, q.az + dz, 0.15)) return null;
  return { nav, n };
}
