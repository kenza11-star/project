// Rencana seretan monster (murni, tanpa three/DOM; dites dengan GLB asli di scripts/test-drag.js):
// memilih SATU ruangan valid secara acak, lalu satu titik tujuan yang aman di dalamnya (bukan di dalam objek, bukan di luar map, bukan di
// area terlarang), dan jalur yang benar-benar terjangkau dari titik tangkapan. Memakai grid navigasi monster & collision yang SUDAH ada.
import type { CollisionWorld } from './collision';
import * as CFG from './config';
import type { MonsterNav, Pt } from './monsternav';
import type { Rng } from './rng';

export interface DragRoom { id: string; type: string; level: number; rect: { minx: number; minz: number; maxx: number; maxz: number } }
export interface DragEnv {
  rooms: readonly DragRoom[];
  /** Area terlarang untuk tujuan (spawn, pintu keluar, tangga, ayunan pintu): titik tujuan harus di luar semuanya. */
  avoid: readonly { x: number; z: number; r: number }[];
  /** STAGE 2: titik pintu penjara di lantai atas (ujung tangga). Ada = korban diseret ke sini (lewat tangga bila perlu), lalu dipindah ke slot penjara. */
  prison?: { x: number; z: number; lv: number; /** titik berdiri monster untuk slot i (jalur nyata, tanpa teleport) */ slotGoal?: (slot: number) => { x: number; z: number } };
}
export interface DragPlan { room: string; goal: Pt; path: Pt[]; length: number; lv?: number }

const inRect = (r: DragRoom['rect'], x: number, z: number) => x >= r.minx && x <= r.maxx && z >= r.minz && z <= r.maxz;
export const pathLength = (from: Pt, path: readonly Pt[]): number => { let L = 0, px = from.x, pz = from.z; for (const p of path) { L += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; } return L; };

/** Apakah titik ini aman sebagai tujuan seret: sel navigasi bebas, ruang bebas di sekitar, di luar area terlarang, dan di dalam ruangan. */
export function safeDragPoint(nav: MonsterNav, cw: CollisionWorld, env: DragEnv, level: number, x: number, z: number, room?: DragRoom): boolean {
  if (!nav.isOk(x, z) || nav.isPocket(x, z)) return false;                                   // di luar map / tidak terjangkau / dalam dinding atau furnitur tetap
  if (cw.blocked(x, z, CFG.MONSTER_DRAG_CLEAR, level)) return false;   // furnitur/dinding/pintu tertutup terlalu dekat
  if (room && !inRect(room.rect, x, z)) return false;
  for (const a of env.avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) return false;
  return true;
}

/** STAGE 2: rencana seret ke pintu penjara. Tanpa jalur terpilih lebih dulu: monster memakai nav normal (goTo, tangga bila beda lantai); bila terhalang seretan berhenti & korban tetap dipindah (fade). */
export function planPrisonDrag(p: NonNullable<DragEnv['prison']>, slot = -1): DragPlan { const g = p.slotGoal && slot >= 0 ? p.slotGoal(slot) : { x: p.x, z: p.z }; return { room: 'prison', goal: { x: g.x, z: g.z }, path: [], length: 0, lv: p.lv }; }

/** Fisher-Yates dengan rng sim (deterministik per seed). */
function shuffled<T>(a: readonly T[], rng: Rng): T[] { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }

/**
 * Pilih ruangan acak yang valid (lantai sama dengan titik tangkapan, bukan ruangan terlarang, bukan ruangan tempat tertangkap, punya titik aman,
 * terjangkau lewat jalur navigasi, tidak terlalu dekat / terlalu jauh) lalu titik tujuan acak yang aman di dalamnya. null bila tidak ada.
 */
export function planDrag(nav: MonsterNav, cw: CollisionWorld, env: DragEnv, from: Pt, level: number, rng: Rng): DragPlan | null {
  const skip = new Set(CFG.MONSTER_DRAG_SKIP_ROOMS);
  const rooms = env.rooms.filter((r) => r.level === level && !skip.has(r.type.toLowerCase()) && !inRect(r.rect, from.x, from.z));
  for (const room of shuffled(rooms, rng)) {
    const cands: Pt[] = [], step = nav.cell, m = 0.4, R = room.rect;
    for (let z = R.minz + m; z <= R.maxz - m; z += step) for (let x = R.minx + m; x <= R.maxx - m; x += step) {
      if (Math.hypot(x - from.x, z - from.z) < CFG.MONSTER_DRAG_MIN_DIST) continue;
      if (safeDragPoint(nav, cw, env, level, x, z, room)) cands.push({ x, z });
    }
    if (cands.length < 6) continue;                                       // ruangan nyaris penuh furnitur: bukan tujuan yang layak
    for (const g of shuffled(cands, rng).slice(0, 6)) {
      const path = nav.path(from.x, from.z, g.x, g.z); if (!path || !path.length) continue;
      const end = path[path.length - 1]; if (Math.hypot(end.x - g.x, end.z - g.z) > 0.6) continue;   // jalur harus benar-benar sampai di tujuan (bukan titik terdekat)
      const length = pathLength(from, path); if (length > CFG.MONSTER_DRAG_MAX_PATH) continue;
      return { room: room.id, goal: g, path, length };
    }
  }
  return null;
}

/** Jejak monster: posisi korban = titik pada jejak yang sudah dilalui monster, `back` meter di belakangnya (pasti jalur yang bisa dilewati). */
export class DragTrail {
  private pts: Pt[] = [];
  clear() { this.pts.length = 0; }
  /** Titik awal jejak (posisi korban saat tertangkap) agar korban bergerak mulus ke belakang monster. */
  seed(x: number, z: number) { this.pts.length = 0; this.pts.push({ x, z }); }
  push(x: number, z: number, back = CFG.MONSTER_DRAG_TRAIL) {
    const l = this.pts[this.pts.length - 1];
    if (!l || Math.hypot(l.x - x, l.z - z) >= 0.05) this.pts.push({ x, z }); else return;
    let acc = 0; for (let i = this.pts.length - 1; i > 0; i--) { acc += Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z); if (acc > back + 3) { this.pts.splice(0, i - 1); break; } }
  }
  /** Titik `back` meter di belakang ujung jejak (sepanjang jejak); jejak lebih pendek -> titik paling awal. null bila kosong. */
  behind(back = CFG.MONSTER_DRAG_TRAIL): Pt | null {
    const p = this.pts; if (!p.length) return null; let rest = back;
    for (let i = p.length - 1; i > 0; i--) {
      const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
      if (rest <= d) { const k = d > 0 ? rest / d : 0; return { x: p[i].x + (p[i - 1].x - p[i].x) * k, z: p[i].z + (p[i - 1].z - p[i].z) * k }; }
      rest -= d;
    }
    return { x: p[0].x, z: p[0].z };
  }
}
