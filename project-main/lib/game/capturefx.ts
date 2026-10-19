// Efek POV pemain yang tertangkap (TAHAP 3). Logika murni (tanpa three/DOM/WebAudio; dites di scripts/test-capture.js):
//   'drag'   : diseret. Pandangan terbuka dari hitam sebentar, lalu perlahan makin gelap (smoothstep, tidak pernah turun lagi).
//   'settle' : seretan selesai / dibatalkan -> dari gelap saat itu ke hitam total.
//   'hold'   : hitam total, menunggu beberapa detik.
//   'done'   : hold selesai -> out.wake = true TEPAT SEKALI; PlayScene lalu memulihkan kontrol & memulai WakeUp (fade-in dari opening).
// Hanya menghasilkan angka per frame (objek hasil dipakai ulang, tanpa alokasi). Tidak menyentuh HP/kontrol: itu urusan PlayScene.
export type CapPhase = 'idle' | 'drag' | 'settle' | 'hold' | 'done';
export interface CaptureCfg {
  openSeconds: number; darkenSeconds: number; darkenMax: number; settleSeconds: number; holdSeconds: number;
  /** batas aman: bila seretan tak kunjung selesai (mis. sinyal 'tiba' hilang), dianggap tiba setelah ini */
  maxDragSeconds: number; reduced?: boolean;
}
export interface CaptureOut {
  phase: CapPhase; t: number;
  black: number;   // 0..1 lapisan hitam di atas game
  muffle: number;  // 0..1 peredam audio (ikut gelap)
  pitch: number; roll: number; dip: number;   // offset VISUAL kamera (radian / meter): kepala terkulai & goyah saat diseret; bidik tidak berubah
  wake: boolean;   // true hanya pada frame ketika hold selesai
}
const sstep = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

export class CaptureFx {
  private phase: CapPhase = 'idle'; private t = 0; private s = 0; private h = 0; private b0 = 1;
  private out: CaptureOut = { phase: 'idle', t: 0, black: 0, muffle: 0, pitch: 0, roll: 0, dip: 0, wake: false };
  constructor(private cfg: CaptureCfg) {}
  get active(): boolean { return this.phase !== 'idle' && this.phase !== 'done'; }
  get current(): CapPhase { return this.phase; }
  /** Mulai (dipanggil sekali per tangkapan, saat jumpscare selesai & layar masih hitam). Memanggil lagi saat aktif = diabaikan. */
  start(): void { if (this.phase !== 'idle') return; this.phase = 'drag'; this.t = this.s = this.h = 0; this.b0 = 1; this.compute(false); }
  /** Seretan selesai atau batal (apa pun alasannya): menuju hitam total lalu hold. Aman dipanggil berulang / di fase lain. */
  arrive(): void { if (this.phase !== 'drag') return; this.b0 = this.out.black; this.phase = 'settle'; this.s = 0; }
  /** Hentikan segera tanpa bangun (restart, respawn, keluar, putus): semua kembali netral. */
  cancel(): void { this.phase = 'idle'; this.t = this.s = this.h = 0; this.compute(false); }
  update(dt: number): CaptureOut {
    const d = Math.min(Math.max(dt, 0), 0.1); let wake = false;
    if (this.phase === 'drag') { this.t += d; if (this.t >= this.cfg.maxDragSeconds) this.arrive0(); }
    else if (this.phase === 'settle') { this.t += d; this.s += d; if (this.s >= this.cfg.settleSeconds) { this.phase = 'hold'; this.h = 0; } }
    else if (this.phase === 'hold') { this.t += d; this.h += d; if (this.h >= this.cfg.holdSeconds) { this.phase = 'done'; wake = true; } }
    this.compute(wake); return this.out;
  }
  private arrive0() { this.compute(false); this.arrive(); }
  private compute(wake: boolean) {
    const c = this.cfg, o = this.out, t = this.t; o.phase = this.phase; o.t = t; o.wake = wake;
    if (this.phase === 'idle') { o.black = 0; o.muffle = 0; o.pitch = o.roll = o.dip = 0; return; }
    let black: number, sway: number;
    if (this.phase === 'drag') {
      const open = 1 - sstep(t / c.openSeconds), dark = c.darkenMax * sstep(t / c.darkenSeconds);
      black = Math.max(open, dark); sway = 1;
    } else if (this.phase === 'settle') {
      const k = sstep(this.s / c.settleSeconds); black = this.b0 + (1 - this.b0) * k; sway = 1 - k;
    } else { black = 1; sway = 0; }
    o.black = black < 0 ? 0 : black > 1 ? 1 : black;
    o.muffle = 0.85 * o.black;
    const ramp = sstep(t / 1.0), red = c.reduced ? 0 : 1;
    o.dip = -(c.reduced ? 0.2 : 0.4) * ramp * (this.phase === 'drag' || this.phase === 'settle' ? 1 : 0);
    o.pitch = red * sway * ramp * 0.06 * Math.sin(1.6 * t);
    o.roll = red * sway * ramp * 0.05 * Math.sin(2.4 * t + 1);
  }
}

/** Titik bangun yang aman: posisi sekarang bila bebas, kalau tidak titik bebas terdekat (cincin 0,3 m sampai `maxR`). null = tidak ada (pakai posisi semula). */
export function safeWakePoint(blocked: (x: number, z: number) => boolean, x: number, z: number, maxR = 3): { x: number; z: number } | null {
  if (!blocked(x, z)) return { x, z };
  for (let r = 0.3; r <= maxR + 1e-9; r += 0.3) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.3));
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r; if (!blocked(px, pz)) return { x: px, z: pz }; }
  }
  return null;
}
