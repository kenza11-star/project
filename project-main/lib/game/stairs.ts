// Tangga yang benar-benar dijalani (tanpa teleport). Logika murni (tanpa three.js) agar bisa dites dengan GLB asli.
//
// Model: tangga lurus di sepanjang sumbu X. Koordinat tangga: u = jarak sepanjang tangga dari kaki tangga (0..run), v = geser lateral dari garis tengah.
// Pemain punya state `onStairs`. Di luar tangga, collision memakai grid lantai + kotak badan tangga (padat, mencegah masuk dari sisi/ujung).
// Pintu masuk hanya dua "mulut": kaki tangga (lantai 1) dan ujung atas (lantai 2), dan hanya di dalam lebar tangga.
// Di dalam tangga: lebar dibatasi dinding samping (tidak bisa keluar lewat sisi), ketinggian mengikuti anak tangga.
import type { CollisionWorld } from './collision';

export interface StairDef {
  bx: number; zc: number;   // titik kaki tangga (u=0) dan garis tengah z
  sgn: 1 | -1;              // arah naik sepanjang X
  run: number; hw: number;  // panjang lintasan & setengah lebar
  rise: number; steps: number;
  baseY: number;            // tinggi lantai bawah
  tread: number; stepH: number;
}

/** Margin kotak badan tangga (rel samping 5 cm) = sama dengan OBB `Stairs_A_*` di mapdata. */
export const STAIR_MARGIN = 0.05;
const EXIT_HYST = 0.02;
/** Kecepatan jalan di tangga dibanding lantai datar. */
export const STAIR_SPEED_MUL = 0.8;

export function stairFromExtras(st: { run: number; width: number; rise: number; steps: number; bottom: number[]; top: number[]; direction: number[] }): StairDef | null {
  if (!st || !st.direction || st.direction[0] === 0 || st.direction[2] !== 0) return null; // hanya tangga lurus sepanjang X
  const sgn = st.direction[0] > 0 ? 1 : -1;
  return {
    bx: st.bottom[0], zc: (st.bottom[2] + st.top[2]) / 2, sgn, run: st.run, hw: st.width / 2,
    rise: st.rise, steps: st.steps, baseY: st.bottom[1], tread: st.run / st.steps, stepH: st.rise / st.steps,
  };
}

export const stairU = (S: StairDef, x: number) => (x - S.bx) * S.sgn;
const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Tinggi permukaan tangga di jarak u: bertingkat per anak tangga, dengan tepi naik dibulatkan agar tidak menyentak. */
export function stairHeight(S: StairDef, u: number): number {
  if (u <= 0) return S.baseY;
  if (u >= S.run) return S.baseY + S.rise;
  const k = Math.floor(u / S.tread), frac = u / S.tread - k;
  return S.baseY + S.stepH * (k + sstep(frac / 0.35));
}

/** Bagian state pemain yang dipakai gerak (PlayerState memenuhi ini). */
export interface Mover { x: number; z: number; y: number; level: number; onStairs: boolean }

export const lateralLimit = (S: StairDef, R: number) => S.hw - R;

/** Apakah titik (x,z) berada di dalam bukaan tangga (di antara kedua ujung & lebar)? Dipakai untuk placement/validasi. */
export function inStairFootprint(S: StairDef, x: number, z: number, pad = 0): boolean {
  const u = stairU(S, x);
  return u >= -pad && u <= S.run + pad && Math.abs(z - S.zc) <= S.hw + pad;
}

/**
 * Satu langkah gerak sumbu-tunggal (ddx atau ddz). Mengembalikan true bila bergerak.
 * - Di tangga: hanya dibatasi lebar; melewati ujung = keluar ke lantai (level berganti di sini, BUKAN teleport: posisi tetap kontinu).
 * - Di lantai: collision normal; masuk tangga hanya lewat mulut (kaki di lantai 1 / ujung atas di lantai 2).
 */
export function stepAxis(cw: CollisionWorld, S: StairDef | null, p: Mover, ddx: number, ddz: number, R: number, topLevel = 1): boolean {
  const nx = p.x + ddx, nz = p.z + ddz;
  if (!S) { if (cw.blocked(nx, nz, R, p.level)) return false; p.x = nx; p.z = nz; return true; }
  const reach = STAIR_MARGIN + R; // jarak titik pusat pemain dari ujung tangga saat menempel badan tangga
  const u = stairU(S, nx), v = nz - S.zc, ucur = stairU(S, p.x);
  if (p.onStairs) {
    if (Math.abs(v) > lateralLimit(S, R) + 1e-6) return false;           // dinding samping
    if (u <= -reach - EXIT_HYST) {                                       // keluar di kaki tangga -> lantai bawah
      if (cw.blocked(nx, nz, R, 0)) return false;
      p.x = nx; p.z = nz; p.onStairs = false; p.level = 0; return true;
    }
    if (u >= S.run + reach + EXIT_HYST) {                                // keluar di ujung atas -> lantai atas
      if (cw.blocked(nx, nz, R, topLevel)) return false;
      p.x = nx; p.z = nz; p.onStairs = false; p.level = topLevel; return true;
    }
    p.x = nx; p.z = nz; return true;
  }
  // di lantai: mulut tangga
  const latOk = Math.abs(v) <= lateralLimit(S, R) + 1e-6;
  if (latOk && p.level === 0 && p.y < S.baseY + 0.45 && ucur <= -reach + 1e-6 && u > -reach && u < 0.8) { p.x = nx; p.z = nz; p.onStairs = true; return true; }
  if (latOk && p.level === topLevel && p.y > S.baseY + S.rise - 0.45 && ucur >= S.run + reach - 1e-6 && u < S.run + reach && u > S.run - 0.8) { p.x = nx; p.z = nz; p.onStairs = true; return true; }
  if (cw.blocked(nx, nz, R, p.level)) return false;
  p.x = nx; p.z = nz; return true;
}

/** Gerak pemain sejauh (dx,dz) dalam beberapa sub-langkah (frame lag tidak bisa menembus dinding tipis). */
export function movePlayer(cw: CollisionWorld, S: StairDef | null, p: Mover, dx: number, dz: number, R: number, topLevel = 1): void {
  const n = Math.min(6, Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08)));
  for (let q = 0; q < n; q++) { stepAxis(cw, S, p, dx / n, 0, R, topLevel); stepAxis(cw, S, p, 0, dz / n, R, topLevel); }
}

/** Tinggi lantai target di bawah pemain (kamera mengikuti dengan interpolasi). */
export function floorTarget(S: StairDef | null, p: Mover, levelY: (l: number) => number): number {
  if (S && p.onStairs) return stairHeight(S, stairU(S, p.x));
  return levelY(p.level);
}

/** Bolehkah berdiri (setelah jongkok)? Di tangga: cukup lebar tangga, bukan grid. */
export function canStandAt(cw: CollisionWorld, S: StairDef | null, p: Mover, R: number): boolean {
  if (S && p.onStairs) return Math.abs(p.z - S.zc) <= lateralLimit(S, R) + 1e-6;
  return !cw.blocked(p.x, p.z, R, p.level);
}
