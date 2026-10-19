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
  done: boolean; cues: JsCue[];
}
export const JS_TOTAL = 3.6;
/** Waktu (detik sejak tangkapan) teriakan & benturan tangan. Dipakai bersama oleh timeline jumpscare korban dan audio tangkapan spasial (captureaudio.ts) agar semua pemain mendengar urutan yang sama. */
export const JS_SCREAM_AT = 0.4, JS_IMPACT_AT = 0.95;
export class Jumpscare {
  private t = 0; private sc = false; private im = false;
  private f: JsFrame = { t: 0, phase: 'turn', lookW: 0, dist: 1.6, reach: 0, grabT: 0, shakeX: 0, shakeY: 0, roll: 0, fovAdd: 0, black: 0, done: false, cues: [] };
  constructor(readonly reduced = false) {}
  update(dt: number): JsFrame {
    const f = this.f; f.cues.length = 0; if (f.done) return f;
    this.t += Math.min(Math.max(dt, 0), 0.1); const t = this.t; f.t = t;
    f.phase = t < 0.3 ? 'turn' : t < 1.0 ? 'lunge' : t < 2.5 ? 'grab' : t < JS_TOTAL ? 'fade' : 'done';
    f.lookW = sstep(t / 0.3);
    f.reach = sstep((t - 0.25) / 0.75); f.dist = 1.6 - 0.9 * f.reach;
    f.grabT = Math.max(0, t - 0.15);
    const amp = (this.reduced ? 0.4 : 1) * (t < 0.25 ? 0.15 : 0.35 + 0.65 * sstep((t - 0.9) / 0.4)) * (1 - 0.5 * sstep((t - 2.5) / 0.9));
    f.shakeX = 0.022 * amp * Math.sin(t * 91) + 0.01 * amp * Math.sin(t * 143); f.shakeY = 0.02 * amp * Math.sin(t * 77 + 1) + 0.01 * amp * Math.sin(t * 131);
    f.roll = (this.reduced ? 0.4 : 1) * 0.07 * sstep((t - 0.2) / 0.5) * Math.sin(t * 8.5) * (1 - sstep((t - 2.4) / 1.0));
    f.fovAdd = (this.reduced ? 0.5 : 1) * (7 * sstep(t / 0.3) + 6 * Math.exp(-Math.pow((t - 0.95) / 0.12, 2))) * (1 - sstep((t - 2.4) / 0.8));
    f.black = sstep((t - 2.5) / 0.9);
    if (!this.sc && t >= JS_SCREAM_AT) { this.sc = true; f.cues.push({ name: 'scream' }); }
    if (!this.im && t >= JS_IMPACT_AT) { this.im = true; f.cues.push({ name: 'impact' }); }
    if (t >= JS_TOTAL) { f.done = true; f.black = 1; f.phase = 'done'; }
    return f;
  }
}
