// Geometri pintu untuk navigasi monster (murni, tanpa three/DOM): dipakai World (pintu nyata) DAN skrip uji, jadi logika yang dites = logika yang jalan di game.
// Bingkai pintu: n = normal dinding (cos yaw, -sin yaw), l = arah daun tertutup dari engsel (sin yaw, cos yaw). Sisi sapuan = sisi tempat daun berayun terbuka.
//   u = jarak sepanjang dinding dari engsel, v = jarak ke arah sisi sapuan (positif = sisi sapuan), r = jarak ke engsel, ang = sudut dari daun tertutup (0..PI) di sisi sapuan.
// Tiga zona: SAPUAN (daerah yang disapu daun: ang < sudut buka), KANTONG (di BALIK daun terbuka, antara daun & dinding sisi engsel: ang >= sudut buka), dan AMBANG (celah pintu).
import type { LeafGeom } from './door';

export interface Pt2 { x: number; z: number }
export interface DoorFrame { nx: number; nz: number; lx: number; lz: number; sw: number }
export interface FrameXY { u: number; v: number; r: number; ang: number }

export function doorFrame(g: LeafGeom): DoorFrame {
  return { nx: Math.cos(g.yaw), nz: -Math.sin(g.yaw), lx: Math.sin(g.yaw), lz: Math.cos(g.yaw), sw: Math.sign(Math.sin(g.openRad)) || 1 };
}
/** Titik (x,z) dalam bingkai pintu. v positif = sisi sapuan. */
export function frameXY(g: LeafGeom, x: number, z: number, f: DoorFrame = doorFrame(g)): FrameXY {
  const rx = x - g.hingeX, rz = z - g.hingeZ, u = rx * f.lx + rz * f.lz, v = (rx * f.nx + rz * f.nz) * f.sw;
  return { u, v, r: Math.hypot(u, v), ang: Math.atan2(v, u) };
}
/** Titik tengah ambang (pada garis daun tertutup). */
export function doorCenter(g: LeafGeom, f: DoorFrame = doorFrame(g)): Pt2 { return { x: g.hingeX + f.lx * g.len / 2, z: g.hingeZ + f.lz * g.len / 2 }; }

/** Di BALIK daun terbuka (kantong sisi engsel)? Sisi sapuan, dalam jangkauan daun, dan sudutnya sudah melewati daun terbuka. margin = tambahan jangkauan radial (m). */
export function inPocket(g: LeafGeom, x: number, z: number, margin = 0.1, f: DoorFrame = doorFrame(g)): boolean {
  const c = frameXY(g, x, z, f);
  return c.v > -0.05 && c.r <= g.len + margin && c.ang >= Math.abs(g.openRad) - 0.1;
}
/** Di daerah sapuan daun (di depan daun tertutup / daun yang sedang berayun)? */
export function inSweep(g: LeafGeom, x: number, z: number, R: number, f: DoorFrame = doorFrame(g)): boolean {
  const c = frameXY(g, x, z, f);
  return c.v > -R && c.r <= g.len + R + 0.05 && c.ang < Math.abs(g.openRad) - 0.1;
}
/** Lorong tengah ambang (daerah sapuan yang BOLEH dilewati karena tegak lurus tepat di tengah celah): |u - len/2| <= half. */
export function inFunnel(g: LeafGeom, x: number, z: number, half: number, f: DoorFrame = doorFrame(g)): boolean {
  const c = frameXY(g, x, z, f); return Math.abs(c.u - g.len / 2) <= half;
}

export interface DoorTrapGeo {
  pocket: boolean;     // true = di balik daun terbuka; false = di daerah sapuan
  bx: number; bz: number; dist: number;   // arah (satuan) & jarak mundur langsung keluar dari zona (sisi sapuan)
  via: Pt2 | null;     // kantong: titik antara di luar ujung daun (keluar dari kantong tanpa menembus daun)
  exit: Pt2;           // titik bebas di TENGAH ambang, di sisi sapuan, di luar jangkauan daun
}
/**
 * Monster di zona jebakan pintu? null = aman. Kantong -> harus keluar lewat ujung daun (via) lalu ke titik tengah (exit). Sapuan -> mundur ke sisi sapuan sampai lepas jangkauan daun.
 * Pemanggil memutuskan KAPAN relevan (mis. sapuan hanya bila daun belum terbuka penuh, kantong hanya bila daun sudah terbuka cukup).
 */
export function trapGeo(g: LeafGeom, x: number, z: number, R: number): DoorTrapGeo | null {
  const f = doorFrame(g), c = frameXY(g, x, z, f), reach = g.len + R + 0.2, o = Math.abs(g.openRad);
  const toW = (u: number, v: number): Pt2 => ({ x: g.hingeX + f.lx * u + f.nx * f.sw * v, z: g.hingeZ + f.lz * u + f.nz * f.sw * v });
  const exit = toW(g.len / 2, Math.sqrt(Math.max(0, reach * reach - (g.len / 2) * (g.len / 2))) + 0.25);
  if (inPocket(g, x, z, 0.1, f)) {
    const phi = (o + Math.PI) / 2, via = toW(Math.cos(phi) * (g.len + R + 0.35), Math.sin(phi) * (g.len + R + 0.35));
    const dx = via.x - x, dz = via.z - z, d = Math.hypot(dx, dz) || 1;
    return { pocket: true, bx: dx / d, bz: dz / d, dist: d, via, exit };
  }
  if (c.v > -R && c.r <= g.len + R + 0.05 && c.ang < o - 0.1) {
    const vNeed = Math.sqrt(Math.max(0, reach * reach - c.u * c.u)), need = Math.max(0.2, vNeed - c.v);
    return { pocket: false, bx: f.nx * f.sw, bz: f.nz * f.sw, dist: need, via: null, exit };
  }
  return null;
}

/**
 * Pintu menutup di depan monster yang membuka KE ARAHNYA (monster berdiri di area sapuan & bergerak menuju dinding pintu): arah+jarak mundur supaya di luar sapuan.
 * (= logika lama World.monsterDoorBackoff, dipindah ke sini agar dites.) null = aman / tidak relevan.
 */
export function backoffFor(g: LeafGeom, x: number, z: number, dx: number, dz: number, R: number): { bx: number; bz: number; dist: number } | null {
  const nx = Math.cos(g.yaw), nz = -Math.sin(g.yaw), lx = Math.sin(g.yaw), lz = Math.cos(g.yaw);
  const rx = x - g.hingeX, rz = z - g.hingeZ, perp = rx * nx + rz * nz, along = rx * lx + rz * lz, side = Math.sign(perp), sw = Math.sign(Math.sin(g.openRad));
  if (!side || side !== sw || along < -R || along > g.len + R) return null;
  if ((dx * nx + dz * nz) * side > -0.55 || Math.abs(perp) > 1.9) return null;
  const need = g.len + R + 0.2 - Math.abs(perp); if (need <= 0) return null;
  return { bx: nx * side, bz: nz * side, dist: need };
}
