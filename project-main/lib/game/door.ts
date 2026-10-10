// Logika pintu murni (tanpa three.js): pose daun pintu di sekitar engsel, collision mengikuti sudut, dan cek sapuan terhadap pemain.
// Engsel = origin node pintu di GLB (daun memanjang sepanjang +Z lokal). Rotasi tambahan memutar daun di sekitar engsel (bukan dari tengah).
import { CollisionWorld, type Obb } from './collision';

export interface LeafGeom {
  hingeX: number; hingeZ: number; // posisi engsel (dunia)
  len: number;                    // panjang daun (m)
  yaw: number;                    // yaw daun saat tertutup
  openRad: number;                // sudut buka (rad, bertanda)
  half: number;                   // setengah tebal collision (m)
}

/** Daun dianggap menutup bukaan selama sudut < ambang ini (0..1 dari sudut buka). Lewat ambang, bukaan cukup lebar dilewati pemain (radius 0,3). */
export const OPEN_FREE_FRAC = 0.7;
export const DOOR_REACH = 2.0;

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Pose OBB daun pada fraksi sudut a (0 = tertutup, 1 = terbuka penuh). */
export function leafPose(g: LeafGeom, a: number): { cx: number; cz: number; hx: number; hz: number; yaw: number } {
  const yaw = g.yaw + g.openRad * a;
  const dx = Math.sin(yaw), dz = Math.cos(yaw); // +Z lokal setelah rotasi Y
  return { cx: g.hingeX + dx * g.len / 2, cz: g.hingeZ + dz * g.len / 2, hx: g.half, hz: g.len / 2, yaw };
}

/** Salin pose ke OBB collision (cos/sin ikut diperbarui). */
export function applyPose(o: Obb, g: LeafGeom, a: number): void {
  const p = leafPose(g, a);
  o.cx = p.cx; o.cz = p.cz; o.hx = p.hx; o.hz = p.hz; o.yaw = p.yaw; o.cos = Math.cos(p.yaw); o.sin = Math.sin(p.yaw); o.rad = Math.hypot(p.hx, p.hz);
}

/** Jarak lingkaran pemain (x,z) ke daun pada fraksi a. < r = menembus. */
export function leafDist(g: LeafGeom, a: number, x: number, z: number): number {
  const p = leafPose(g, a);
  return CollisionWorld.distToObb({ cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, cos: Math.cos(p.yaw), sin: Math.sin(p.yaw) }, x, z);
}

/** Collision pintu mengikuti sudut daun: menghalangi selama daun masih menutup bukaan. */
export const doorBlocksAt = (a: number) => a < OPEN_FREE_FRAC;

/**
 * Daun tidak boleh menembus pemain: apakah gerak dari fraksi a0 ke a1 menyapu tubuh pemain (lingkaran r)? Dicek di beberapa titik antara.
 * Dipakai tiap frame: bila true, pintu berhenti di sudut sekarang dan lanjut setelah pemain menyingkir.
 */
export function sweepHitsPlayer(g: LeafGeom, a0: number, a1: number, px: number, pz: number, r: number): boolean {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.08));
  for (let i = 1; i <= n; i++) if (leafDist(g, a0 + ((a1 - a0) * i) / n, px, pz) < r) return true;
  return false;
}

/** Apakah daun (di sudut a) menyentuh pemain? */
export const leafTouches = (g: LeafGeom, a: number, px: number, pz: number, r: number) => leafDist(g, a, px, pz) < r;

/** Titik-titik di area sapuan daun (untuk keepout furniture): sepanjang daun pada beberapa sudut. */
export function swingPoints(g: LeafGeom): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const a of [0, 0.33, 0.66, 1]) {
    const yaw = g.yaw + g.openRad * a;
    for (const t of [0.3, 0.65, 1.0]) out.push({ x: g.hingeX + Math.sin(yaw) * g.len * t, z: g.hingeZ + Math.cos(yaw) * g.len * t });
  }
  return out;
}
