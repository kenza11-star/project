// Frame impact jumpscare ala anime/horor (logika murni, tanpa DOM/three; dites di scripts/test-impact.js).
// Urutan potong-cepat tepat saat benturan (JS_IMPACT_AT), semua dihitung dari waktu jumpscare `t` -> FUNGSI WAKTU MURNI:
//   1 = B&W + garis kecepatan   2 = B&W terbalik (negatif) + zoom   3 = glitch RGB tipis (monokrom)   4 = merah tua gelap   5 = getar/blur yang mereda
// Tidak ada timer/loop sendiri: lewat IMPACT_END hasilnya selalu idx 0 (mati). Tidak mungkin "nyangkut".
// reduced (prefers-reduced-motion): tanpa kilatan keras/strobo/getar; hanya satu denyut merah lembut.
import { JS_IMPACT_AT } from './monsterfx';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Durasi tiap frame keras (detik). Sengaja sangat singkat: terasa seperti "tersentak", bukan animasi. */
export const IMPACT_FRAME_DUR = [0.07, 0.07, 0.11, 0.32] as const;
export const IMPACT_AFTER_DUR = 0.95;
const HARD_END = IMPACT_FRAME_DUR[0] + IMPACT_FRAME_DUR[1] + IMPACT_FRAME_DUR[2] + IMPACT_FRAME_DUR[3];
/** Waktu jumpscare (detik) saat seluruh efek impact sudah selesai (< fase fade jumpscare di 2,5 dtk). */
export const IMPACT_END = JS_IMPACT_AT + HARD_END + IMPACT_AFTER_DUR;

export type ImpactIdx = 0 | 1 | 2 | 3 | 4 | 5;
export interface ImpactOut {
  idx: ImpactIdx;
  g: number;       // 0..2 varian glitch (berganti tiap ~0,04 dtk, hanya di frame 3)
  rot: number;     // derajat: rotasi garis kecepatan per frame
  a: number;       // 0..1 kekuatan lapisan merah (frame 5 / mode reduced)
  blur: number;    // px blur layar (frame 5)
  fov: number;     // derajat tambahan FOV kamera (hentakan zoom)
  zoom: number;    // >= 1: pembesaran layar ke arah wajah monster (close-up impact, seperti panel manga)
  sx: number; sy: number;   // radian tambahan getar kamera
}

const FRAME_ROT = [0, 0, 7, 0, -5, 0];
const FRAME_FOV = [0, 5, 9, 6, 3];
const FRAME_ZOOM = [1, 1.7, 2.9, 2.3, 2.1];   // frame 2 = wajah memenuhi layar
const FRAME_SX = [0, 0.05, -0.07, 0.04, 0.05];
const FRAME_SY = [0, -0.03, 0.05, -0.04, 0.03];

const out: ImpactOut = { idx: 0, g: 0, rot: 0, a: 0, blur: 0, fov: 0, zoom: 1, sx: 0, sy: 0 };

/** Keadaan efek impact pada waktu jumpscare `t`. Objek hasil dipakai ulang (tanpa alokasi). */
export function impactAt(t: number, reduced = false): ImpactOut {
  const o = out; o.idx = 0; o.g = 0; o.rot = 0; o.a = 0; o.blur = 0; o.fov = 0; o.zoom = 1; o.sx = 0; o.sy = 0;
  const r = t - JS_IMPACT_AT;
  if (!(r >= 0) || r >= HARD_END + IMPACT_AFTER_DUR) return o;
  if (reduced) {   // satu denyut merah lembut, tanpa strobo / getar
    const k = clamp01(r / 0.7); if (k >= 1) return o;
    o.idx = 5; o.a = 0.45 * (1 - k) * (1 - k); o.blur = 2 * (1 - k); o.fov = 1 * (1 - k); o.zoom = 1 + 0.12 * (1 - k);
    return o;
  }
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    acc += IMPACT_FRAME_DUR[i];
    if (r < acc) {
      o.idx = (i + 1) as ImpactIdx; o.rot = FRAME_ROT[i + 1]; o.fov = FRAME_FOV[i + 1]; o.zoom = FRAME_ZOOM[i + 1]; o.sx = FRAME_SX[i + 1]; o.sy = FRAME_SY[i + 1];
      if (i === 2) o.g = Math.floor(r / 0.04) % 3;
      return o;
    }
  }
  const k = clamp01((r - HARD_END) / IMPACT_AFTER_DUR), e = Math.pow(1 - k, 1.4);   // meredanya lebih lambat (kurva 1,4) supaya merah/blur terasa lama
  o.idx = 5; o.a = 0.8 * e; o.blur = 7 * e; o.fov = 4 * e; o.zoom = 1 + 1.1 * e;
  o.sx = 0.03 * e * Math.sin(t * 70); o.sy = 0.025 * e * Math.sin(t * 57 + 1);
  return o;
}

// ---- garis kecepatan (path SVG, dibuat sekali, deterministik) ----
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Pancaran garis runcing dari tengah (viewBox 100x100, pusat 50,50). Lebar & panjang acak -> seperti panel manga. */
export function rayPath(seed: number, n = 40): string {
  const rnd = mulberry(seed); const p: string[] = [], f = (v: number) => v.toFixed(2);
  for (let i = 0; i < n; i++) {
    const a = ((i + rnd() * 0.8) / n) * 2 * Math.PI, hw = (0.22 + rnd() * rnd() * 1.1) * Math.PI / 180, r0 = 9 + rnd() * 10, r1 = 62;
    p.push('M' + f(50 + Math.cos(a - hw) * r1) + ' ' + f(50 + Math.sin(a - hw) * r1) + 'L' + f(50 + Math.cos(a) * r0) + ' ' + f(50 + Math.sin(a) * r0) + 'L' + f(50 + Math.cos(a + hw) * r1) + ' ' + f(50 + Math.sin(a + hw) * r1) + 'Z');
  }
  return p.join('');
}
export const IMPACT_RAYS_A = rayPath(7), IMPACT_RAYS_B = rayPath(31, 36);
