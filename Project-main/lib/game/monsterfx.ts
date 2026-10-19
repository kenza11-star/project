// Efek horor monster (murni): bahaya menurut jarak (detak jantung, HUD, vignette) dan timeline jumpscare.
import * as CFG from './config';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };

/** Bahaya 0..1: makin dekat makin tinggi (mulus); sedang dikejar = minimal 0,45; beda lantai jauh lebih redam. */
export function dangerOf(dist: number, chasing: boolean, sameLevel: boolean): number {
  const far = CFG.MONSTER_HEART_RANGE, near = 2.5;
  let d = sstep((far - dist) / (far - near));
  if (!sameLevel) d *= 0.45;
  if (chasing && sameLevel && dist < far * 1.3) d = Math.max(d, 0.45 + 0.55 * d);
  return clamp01(d);
}
export interface HeartFx { bpm: number; volume: number; amp: number; shake: number; vig: number; vigStart: number; red: number }
/** Parameter efek menurut bahaya: detak jantung (suara + HUD), getar, dan vignette merah bertahap. */
export function heartFx(danger: number): HeartFx {
  const d = clamp01(danger), d15 = Math.pow(d, 1.5);
  return { bpm: 62 + 98 * d, volume: 0.04 + 0.96 * Math.pow(d, 1.3), amp: 0.12 + 0.28 * d, shake: d > 0.35 ? ((d - 0.35) / 0.65) * 5 : 0, vig: 0.55 + 0.35 * d15, vigStart: 45 - 25 * d15, red: Math.round(110 * d15) };
}
/** Bentuk denyut 'lub-dub' 0..1 pada fase 0..1 (dipakai HUD dan sinkron dengan suara). */
export const pulseShape = (p: number) => Math.max(Math.exp(-Math.pow(p / 0.07, 2)), 0.6 * Math.exp(-Math.pow((p - 0.3) / 0.08, 2)));

/** Penjadwal detak: satu 'lub-dub' per 60/bpm detik; berhenti bila bahaya sangat rendah. */
export class HeartBeat {
  phase = 1; private since = 99; active = false;
  /** true pada frame saat detak baru harus diputar. */
  update(dt: number, danger: number): boolean {
    this.active = danger > 0.02; if (!this.active) { this.since = 99; this.phase = 1; return false; }
    const iv = 60 / heartFx(danger).bpm; this.since += dt; let beat = false;
    if (this.since >= iv) { this.since = this.since >= iv * 2 ? 0 : this.since - iv; beat = true; }
    this.phase = clamp01(this.since / iv); return beat;
  }
}

// ---------------------------------------------------------------- jumpscare
export type JsPhase = 'turn' | 'lunge' | 'grab' | 'fade' | 'done';
export interface JsCue { name: 'scream' | 'impact' }
export interface JsFrame {
  t: number; phase: JsPhase;
  lookW: number;     // 0..1 bobot kamera menoleh ke wajah monster
  dist: number;      // jarak monster di depan kamera (m) saat belum 'reach'
  reach: number;     // 0..1 tangan monster disejajarkan ke kamera (menutupi wajah)
  grabT: number;     // detik pada klip 'grab'
  shakeX: number; shakeY: number; roll: number;   // offset kamera (radian)
  fovAdd: number;    // derajat
  black: number;     // 0..1
  blood: number;     // 0..1 overlay darah (vignette merah + percikan): naik dari fase lunge ke grab
  split: number;     // 0..1 pergeseran warna merah/biru tipis (denyut saat benturan; kecil bila reduced motion)
  faint: number;     // 0..1 pingsan: kamera ambruk (turun, miring) bersamaan dengan fade ke hitam
  done: boolean; cues: JsCue[];
}
export const JS_TOTAL = 3.6;
export const JS_FACE_DIST = 0.7, JS_FACE_ABOVE = 0.12;   // wajah mendekat sampai ~0,7 m dari kamera; kepala sedikit di atas kamera agar wajah terlihat
/** Waktu (detik sejak tangkapan) teriakan & benturan tangan. Dipakai bersama oleh timeline jumpscare korban dan audio tangkapan spasial (captureaudio.ts) agar semua pemain mendengar urutan yang sama. */
export const JS_SCREAM_AT = 0.4, JS_IMPACT_AT = 0.95;
/** Lapisan audio tangkapan (captureaudio.ts), semuanya jatuh SEBELUM benturan: dengung rendah mulai lebih awal; teriakan naik bertahap rendah -> sedang -> tinggi (JS_SCREAM_AT = tahap rendah); lalu benturan di JS_IMPACT_AT. */
export const JS_HUM_AT = 0.05, JS_SCREAM_MID_AT = 0.58, JS_SCREAM_HI_AT = 0.76;

/** Pingsan (jumpscare faint 0..1, lalu fase diseret): peredam audio naik sampai ~0,9 (suara teredam, jauh). */
export const faintMuffle = (faint: number) => 0.9 * sstep(faint);
/** Detak jantung saat pingsan: makin pingsan makin LAMBAT (jeda 0,7 -> 1,9 dtk), pelan, dan nada turun (rate < 1). */
export function faintHeartFx(faint: number) { const k = sstep(faint); return { interval: 0.7 + 1.2 * k, volume: 0.6 - 0.22 * k, rate: 0.9 - 0.2 * k }; }
/** Penjadwal detak pingsan (murni). true pada frame saat detak harus diputar; faint <= 0 -> berhenti & mulai ulang dari detak langsung saat pingsan berikutnya. */
export class FaintBeat {
  private since = 99;
  update(dt: number, faint: number): boolean {
    if (!(faint > 0.02)) { this.since = 99; return false; }
    const iv = faintHeartFx(faint).interval; this.since += Math.max(0, dt);
    if (this.since >= iv) { this.since = this.since >= iv * 2 ? 0 : this.since - iv; return true; }
    return false;
  }
}
export class Jumpscare {
  private t = 0; private sc = false; private im = false;
  private f: JsFrame = { t: 0, phase: 'turn', lookW: 0, dist: 1.6, reach: 0, grabT: 0, shakeX: 0, shakeY: 0, roll: 0, fovAdd: 0, black: 0, blood: 0, split: 0, faint: 0, done: false, cues: [] };
  constructor(readonly reduced = false) {}
  update(dt: number): JsFrame {
    const f = this.f; f.cues.length = 0; if (f.done) return f;
    this.t += Math.min(Math.max(dt, 0), 0.1); const t = this.t; f.t = t;
    f.phase = t < 0.3 ? 'turn' : t < 1.0 ? 'lunge' : t < 2.5 ? 'grab' : t < JS_TOTAL ? 'fade' : 'done';
    f.lookW = sstep(t / 0.3);
    f.reach = sstep((t - 0.25) / 0.75); f.dist = 1.6 - 0.9 * f.reach;
    f.grabT = Math.max(0, t - 0.15);
    const rk = this.reduced ? 0.4 : 1, kick = Math.exp(-Math.pow((t - JS_IMPACT_AT) / 0.1, 2));   // kick: hentakan tepat saat benturan (JS_IMPACT_AT)
    const amp = rk * (t < 0.25 ? 0.15 : 0.4 + 0.6 * sstep((t - 0.9) / 0.4) + 0.9 * kick) * (1 - 0.5 * sstep((t - 2.5) / 0.9));
    f.shakeX = 0.034 * amp * Math.sin(t * 91) + 0.015 * amp * Math.sin(t * 143); f.shakeY = 0.03 * amp * Math.sin(t * 77 + 1) + 0.014 * amp * Math.sin(t * 131);
    f.roll = rk * 0.1 * sstep((t - 0.2) / 0.5) * Math.sin(t * 8.5) * (1 - sstep((t - 2.4) / 1.0));
    f.fovAdd = (this.reduced ? 0.5 : 1) * (8 * sstep(t / 0.3) + 9 * kick) * (1 - sstep((t - 2.4) / 0.8));
    f.blood = sstep((t - 0.3) / 1.0);   // mulai di lunge, penuh di awal grab; tetap sampai layar hitam menutup
    f.split = (this.reduced ? 0.3 : 1) * (0.3 * sstep((t - 0.3) / 0.7) + 0.7 * Math.exp(-Math.pow((t - JS_IMPACT_AT) / 0.18, 2))) * (1 - sstep((t - 2.4) / 0.8));
    f.faint = rk * sstep((t - 2.4) / 1.0);   // pingsan: kamera ambruk selama fade
    f.black = sstep((t - 2.5) / 0.9);   // fade ke hitam selesai di 3,4 dtk; total tetap JS_TOTAL
    if (!this.sc && t >= JS_SCREAM_AT) { this.sc = true; f.cues.push({ name: 'scream' }); }
    if (!this.im && t >= JS_IMPACT_AT) { this.im = true; f.cues.push({ name: 'impact' }); }
    if (t >= JS_TOTAL) { f.done = true; f.black = 1; f.phase = 'done'; }
    return f;
  }
}
