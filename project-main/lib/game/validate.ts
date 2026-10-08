// Validasi anti-softlock (logika murni, tanpa three.js): memastikan tiap run bisa diselesaikan.
// Dipakai oleh GameWorld.startRun (dengan data nyata dari scene) dan oleh tes (dengan data dari GLB).
import type { CollisionWorld } from './collision';
import type { NavGrid } from './layout';
import * as CFG from './config';

export interface V { x: number; y: number; z: number }
export interface SlotInfo {
  id: string; level: number;
  ax: number; az: number;   // titik berdiri pemain di depan container
  keyPos: V;                // posisi dunia tempat key akan muncul
  usable: boolean;          // container punya bagian yang bisa dibuka & mesh yang bisa dibidik
}

const floorY = (level: number) => CFG.LEVEL_Y[level] ?? 0;

/** Posisi key valid? (hingga, di atas lantai, di dalam grid map, bukan di dalam dinding). Mengembalikan alasan gagal atau null. */
export function keyPosProblem(cw: CollisionWorld, level: number, p: V): string | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return 'posisi key tidak valid (NaN)';
  const fy = floorY(level);
  if (p.y < fy + 0.2) return 'key di bawah lantai';
  if (p.y > fy + 2.3) return 'key terlalu tinggi';
  if (p.x < cw.x0 || p.z < cw.z0 || p.x > cw.x0 + cw.W * cw.cell || p.z > cw.z0 + cw.H * cw.cell) return 'key di luar map';
  if (cw.gridBlocked(p.x, p.z, 0.02, level)) return 'key di dalam dinding';
  return null;
}

/** Slot container boleh dipakai untuk key? Mengembalikan alasan gagal atau null. `nav` = hasil flood dari spawn (lantai 0). */
export function slotProblem(cw: CollisionWorld, nav: NavGrid | null, s: SlotInfo): string | null {
  if (!s.usable) return `container ${s.id} tidak bisa dibuka/dicari`;
  const kp = keyPosProblem(cw, s.level, s.keyPos);
  if (kp) return `${s.id}: ${kp}`;
  if (s.level === 0) {
    if (!nav || !nav.reached(s.ax, s.az, 1.6)) return `${s.id}: tidak terjangkau dari spawn`;
    // key harus bisa dibidik dari titik berdiri (jarak datar & jarak dari mata)
    const h = Math.hypot(s.keyPos.x - s.ax, s.keyPos.z - s.az);
    if (h > 2.0 || Math.hypot(h, 1.65 - s.keyPos.y) > CFG.REACH + 0.4) return `${s.id}: key terlalu jauh dari titik berdiri`;
  }
  return null;
}

export interface RunCheck {
  cw: CollisionWorld; nav: NavGrid;                  // nav sudah di-flood dari spawn
  spawn: { x: number; z: number };
  exitInside: { x: number; z: number };
  required: string[];                                // id key yang wajib ada
  keys: { key: string; slot: SlotInfo }[];           // key yang sudah ditempatkan
  ladderReachable?: boolean;                         // dibutuhkan bila ada key di mezzanine
}

/** Validasi akhir satu run. Daftar kosong = run bisa diselesaikan. */
export function validateRun(c: RunCheck): string[] {
  const bad: string[] = [];
  const got = c.keys.map((k) => k.key).sort().join(',');
  if (got !== c.required.slice().sort().join(',')) bad.push(`key tidak lengkap/duplikat: ${got || '(kosong)'}`);
  const slots = new Set<string>();
  for (const k of c.keys) {
    if (slots.has(k.slot.id)) bad.push(`dua key di container yang sama: ${k.slot.id}`);
    slots.add(k.slot.id);
    const p = slotProblem(c.cw, c.nav, k.slot);
    if (p) bad.push(`key ${k.key}: ${p}`);
    if (k.slot.level === 1 && !c.ladderReachable) bad.push(`key ${k.key} di lantai 2 tapi tangga tidak terjangkau`);
  }
  if (c.cw.blocked(c.spawn.x, c.spawn.z, CFG.PLAYER_RADIUS, 0)) bad.push('spawn berada di dalam benda/dinding');
  if (!c.nav.reached(c.spawn.x, c.spawn.z, 0.15)) bad.push('spawn di luar area terjangkau');
  if (!c.nav.reached(c.exitInside.x, c.exitInside.z, 0.7)) bad.push('exit tidak terjangkau dari spawn');
  return bad;
}

/**
 * Cari titik spawn yang valid: titik asli bila aman, jika tidak titik terdekat yang tidak menabrak apa pun
 * dan berada di area luas yang terhubung (bukan kantong sempit). `nav` = NavGrid statis (tanpa furniture acak).
 */
export function findSafeSpawn(cw: CollisionWorld, nav: NavGrid, sp: { x: number; z: number }, minArea = 5000): { x: number; z: number; moved: boolean } | null {
  const R = CFG.PLAYER_RADIUS + 0.1;
  const ok = (x: number, z: number) => !cw.blocked(x, z, R, 0) && nav.flood(x, z) >= minArea;
  if (ok(sp.x, sp.z)) return { x: sp.x, z: sp.z, moved: false };
  for (let r = 0.25; r <= 5; r += 0.25) {
    const n = Math.max(8, Math.round(r * 10));
    for (let a = 0; a < n; a++) {
      const th = (a / n) * Math.PI * 2, x = sp.x + Math.cos(th) * r, z = sp.z + Math.sin(th) * r;
      if (ok(x, z)) return { x, z, moved: true };
    }
  }
  return null;
}
