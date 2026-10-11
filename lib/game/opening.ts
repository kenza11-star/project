// Opening "bangun setelah pingsan": layar hampir hitam -> terbuka perlahan, pandangan sangat blur + vignette, kepala goyah,
// suara teredam -> jernih, gerak & bidik awalnya lambat/goyah, lalu semuanya kembali normal.
// Murni (tanpa three/DOM/WebAudio): hanya menghitung nilai tiap frame. Penerapannya memakai sistem yang sudah ada:
// kamera & loop (PlayScene), AudioManager (setMuffle + sfx breath/heartbeat), vignette CSS yang sudah ada.
export const VIG_DEFAULT = 0.55;       // alpha tepi vignette normal (sama dengan .vignette di globals.css)
export const VIG_START_DEFAULT = 45;   // % radius mulai gelap pada vignette normal

export interface WakeCue { name: 'breath' | 'heartbeat'; vol: number; rate: number }
export interface WakeFx {
  t: number;
  black: number;     // 0..1 lapisan hitam di atas game (1 = hitam total)
  blur: number;      // radius blur CSS (px)
  vig: number;       // alpha tepi vignette (normal = VIG_DEFAULT)
  vigStart: number;  // % radius vignette mulai gelap (normal = VIG_START_DEFAULT; lebih kecil = vignette lebih lebar)
  muffle: number;    // 0..1 peredam audio (0 = jernih)
  speed: number;     // pengali kecepatan jalan (1 = normal)
  look: number;      // pengali sensitivitas bidik (1 = normal)
  drift: number;     // radian: arah jalan sedikit melenceng (kaki belum stabil)
  yaw: number; pitch: number; roll: number; dip: number; // offset VISUAL kamera saja (radian / meter); bidik pemain tidak berubah
  done: boolean;
  lowPower: boolean; // FPS terus rendah -> blur (efek paling mahal) dimatikan halus; fade hitam & vignette tetap jalan
  cues: WakeCue[];   // suara yang harus diputar pada frame ini (napas / detak jantung, pelan)
}
export interface WakeOpts { duration?: number; reduced?: boolean; maxBlur?: number; seed?: number }

const sstep = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * x * (x * (x * 6 - 15) + 10); }; // smootherstep: awal & akhir halus (kecepatan 0)
const ramp = (t: number, a: number, b: number) => sstep((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wob = (t: number, w1: number, p1: number, w2: number, p2: number) => (Math.sin(w1 * t + p1) + 0.5 * Math.sin(w2 * t + p2)) / 1.5; // goyang alami, -1..1

export class WakeUp {
  readonly duration: number;
  private t = 0;
  private reduced: boolean;
  private maxBlur: number;
  private ph: number[];
  private hbNext: number;
  private breathI = 0;
  private ema = 1 / 60;     // rata-rata durasi frame (untuk mendeteksi HP yang tidak kuat menahan blur)
  private lowPower = false;
  private blurK = 1;        // pengali blur: 1 -> 0 dalam 0,4 detik setelah lowPower
  private fx: WakeFx = { t: 0, black: 0, blur: 0, vig: VIG_DEFAULT, vigStart: VIG_START_DEFAULT, muffle: 0, speed: 1, look: 1, drift: 0, yaw: 0, pitch: 0, roll: 0, dip: 0, done: false, lowPower: false, cues: [] };

  constructor(o: WakeOpts = {}) {
    this.duration = Math.max(2, o.duration ?? 7.5);
    this.reduced = !!o.reduced;
    this.maxBlur = o.maxBlur ?? 11;
    let s = ((o.seed ?? 1) * 2654435761) >>> 0; // fase goyang deterministik (bisa dites)
    this.ph = Array.from({ length: 10 }, () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * Math.PI * 2; });
    this.hbNext = 0.3 * (this.duration / 7.5);
    this.compute();
  }

  /** Nilai pada waktu sekarang tanpa memajukan waktu (dipakai untuk frame pertama: layar sudah hitam sebelum game tampil). */
  peek(): WakeFx { return this.fx; }

  update(dt: number): WakeFx {
    if (!this.fx.done) {
      const d = Math.min(Math.max(dt, 0), 0.1);
      this.t += d;
      this.ema += (Math.min(d, 0.05) - this.ema) * 0.08;
      if (!this.lowPower && this.t > 0.5 && this.ema > 0.036) this.lowPower = true; // bertahan < ~28 FPS (lonjakan sesaat tidak dihitung)
      if (this.lowPower && this.blurK > 0) this.blurK = Math.max(0, this.blurK - d / 0.4);
      this.compute();
    }
    return this.fx;
  }

  private compute() {
    const T = this.duration, S = T / 7.5, t = Math.min(this.t, T), p = this.ph, f = this.fx;
    f.t = t; f.done = t >= T; f.cues.length = 0; f.lowPower = this.lowPower;
    if (f.done) { // semua kembali persis normal
      f.black = 0; f.blur = 0; f.vig = VIG_DEFAULT; f.vigStart = VIG_START_DEFAULT; f.muffle = 0; f.speed = 1; f.look = 1;
      f.drift = f.yaw = f.pitch = f.roll = f.dip = 0; return;
    }
    f.black = 0.97 * (1 - ramp(t, 0.7 * S, 3.4 * S));                              // hampir hitam -> terbuka perlahan
    f.blur = this.maxBlur * (this.reduced ? 0.5 : 1) * Math.pow(1 - ramp(t, 0.2 * S, 6.2 * S), 1.4) * this.blurK; // paling kuat di awal, turun bertahap
    const vk = ramp(t, 0.5 * S, 7.0 * S);
    f.vig = lerp(0.95, VIG_DEFAULT, vk); f.vigStart = lerp(14, VIG_START_DEFAULT, vk);
    f.muffle = 0.92 * (1 - ramp(t, 0.4 * S, 6.6 * S));                              // teredam -> jernih
    f.speed = lerp(0.45, 1, ramp(t, 1.0 * S, 7.2 * S));
    f.look = lerp(0.6, 1, ramp(t, 1.0 * S, 7.0 * S));
    if (this.reduced) { f.drift = f.yaw = f.pitch = f.roll = f.dip = 0; } // prefers-reduced-motion: tanpa goyang kamera
    else {
      const A = Math.pow(1 - ramp(t, 0.3 * S, T), 1.2);                              // amplitudo goyang mengecil sampai 0
      f.pitch = -0.11 * (1 - ramp(t, 0.4 * S, 4.2 * S)) + A * 0.04 * wob(t, 2.2, p[0], 3.6, p[1]); // kepala terkulai lalu terangkat (+-6 derajat)
      f.yaw = A * 0.045 * wob(t, 1.9, p[2], 3.1, p[3]);
      f.roll = 0.04 * (1 - ramp(t, 0.4 * S, 3.6 * S)) + A * 0.035 * wob(t, 2.3, p[4], 3.7, p[5]); // miring ringan (maks ~4,6 derajat)
      f.dip = -0.09 * (1 - ramp(t, 0.4 * S, 3.4 * S)) + A * 0.012 * wob(t, 3.0, p[6], 4.4, p[7]);
      f.drift = A * 0.07 * wob(t, 1.7, p[8], 2.9, p[9]);
    }
    // suara: napas 3x (makin pelan) + detak jantung samar yang menghilang
    const br = [0.5, 3.6, 6.2];
    if (this.breathI < br.length && t >= br[this.breathI] * S) { f.cues.push({ name: 'breath', vol: [0.55, 0.45, 0.32][this.breathI], rate: 0.9 + 0.03 * this.breathI }); this.breathI++; }
    if (t >= this.hbNext && t < 6.9 * S) {
      f.cues.push({ name: 'heartbeat', vol: 0.42 * (1 - 0.75 * ramp(t, 2 * S, 6.9 * S)), rate: 0.95 });
      this.hbNext = t + lerp(1.15, 0.95, t / T) * S;
    }
  }
}

// ---------------------------------------------------------------- penerapan ke DOM (canvas game + .vignette yang sudah ada)
export interface WakeTargets { canvas: HTMLElement | null; vignette: HTMLElement | null }
export interface WakeLast { op: number; blur: number; vg: number; vs: number; vEl: HTMLElement | null }
export const newWakeLast = (): WakeLast => ({ op: -1, blur: -1, vg: -1, vs: -1, vEl: null });

/** Tulis ke style hanya bila nilainya berubah cukup besar (blur dikuantisasi) -> murah untuk HP. */
export function applyWakeFx(el: WakeTargets, fx: WakeFx, last: WakeLast): void {
  const c = el.canvas;
  if (c) {
    const op = Math.round((1 - fx.black) * 200) / 200;
    if (op !== last.op) { last.op = op; c.style.opacity = op >= 1 ? '' : String(op); }
    const b = fx.blur < 0.15 ? 0 : Math.round(fx.blur * 4) / 4;
    if (b !== last.blur) { last.blur = b; c.style.filter = b ? `blur(${b}px)` : ''; }
  }
  const v = el.vignette;
  if (v) {
    const vg = Math.round(fx.vig * 100) / 100, vs = Math.round(fx.vigStart * 2) / 2;
    if (v !== last.vEl || vg !== last.vg || vs !== last.vs) { last.vEl = v; last.vg = vg; last.vs = vs; v.style.setProperty('--vg', String(vg)); v.style.setProperty('--vs', vs + '%'); }
  }
}
/** Kembalikan style ke kondisi semula (tanpa sisa inline style). */
export function clearWakeFx(el: WakeTargets, last: WakeLast): void {
  if (el.canvas) { el.canvas.style.opacity = ''; el.canvas.style.filter = ''; }
  if (el.vignette) { el.vignette.style.removeProperty('--vg'); el.vignette.style.removeProperty('--vs'); }
  last.op = last.blur = last.vg = last.vs = -1; last.vEl = null;
}
