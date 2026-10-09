// Efek lampu horor: flicker acak, electrical flicker, dan lampu mati sementara per-sumber. Logika murni (tanpa THREE) -> bisa diuji di Node.
// Hanya menyimpan state untuk lampu yang sedang punya event (beberapa entri), jadi biaya per frame ~nol. Scheduler memakai jeda acak panjang.
import * as CFG from './config';

type Step = [number, number]; // [durasi detik, level target 0..1]
interface Fx { seq: Step[]; i: number; t: number; cur: number; off: boolean }

export class LightFx {
  private fx = new Map<number, Fx>();
  private rnd: () => number;
  private nextFlick: number;
  private nextOut: number;
  private clock = 0;
  private count = 1;
  constructor(rnd: () => number = Math.random) { this.rnd = rnd; this.nextFlick = this.gap(CFG.LFX_FLICKER_GAP); this.nextOut = this.gap(CFG.LFX_OUTAGE_GAP, 0.5); }

  private r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  private gap(g: [number, number], first = 0.4) { return this.r(g[0], g[1]) * (first < 1 ? first + this.rnd() * (1 - first) : 1); }

  setCount(n: number) { this.count = Math.max(1, n); }
  reset() { this.fx.clear(); this.nextFlick = this.gap(CFG.LFX_FLICKER_GAP); this.nextOut = this.gap(CFG.LFX_OUTAGE_GAP, 0.5); }
  get offCount() { let n = 0; for (const f of this.fx.values()) if (f.off) n++; return n; }
  get active() { return this.fx.size; }

  /** Level 0..1 untuk lampu i (1 = normal). Sudah dihaluskan agar transisi tidak seperti strobo. */
  level(i: number): number { const f = this.fx.get(i); return f ? f.cur : 1; }

  /** Dip kedip acak untuk lampu yang memang rusak (flicker=true): tak berpola, kedalaman & durasi bervariasi. Dipanggil dari slot pool. */
  faultyDip(chance: number): { depth: number; dur: number } | null {
    if (this.rnd() > chance * 0.22) return null;
    const heavy = this.rnd() < 0.18;
    return { depth: heavy ? this.r(0.12, 0.3) : this.r(0.35, 0.8), dur: heavy ? this.r(0.05, 0.12) : this.r(0.04, 0.26) };
  }
  /** Jeda sampai pengecekan kedip berikutnya untuk lampu rusak (acak, bukan 0.12 dtk tetap). */
  faultyGap() { return this.r(0.06, 0.55); }

  private start(i: number, seq: Step[], off = false) { this.fx.set(i, { seq, i: 0, t: 0, cur: 1, off }); }

  /** near = indeks lampu terdekat pemain (terurut). blackout = event lampu mati global sedang berjalan -> jangan menambah event baru. */
  update(dt: number, near: number[], blackout: boolean) {
    this.clock += dt;
    for (const [k, f] of this.fx) {
      f.t += dt;
      while (f.i < f.seq.length && f.t >= f.seq[f.i][0]) { f.t -= f.seq[f.i][0]; f.i++; }
      if (f.i >= f.seq.length) { f.cur += (1 - f.cur) * Math.min(1, dt * 14); if (f.cur > 0.985) this.fx.delete(k); f.off = false; continue; }
      f.off = f.seq[f.i][1] <= 0.02 && f.seq[f.i][0] > 0.6;
      f.cur += (f.seq[f.i][1] - f.cur) * Math.min(1, dt * 28); // attack ~35 ms: kedip terasa tajam tapi bukan strobo
    }
    if (blackout || !near.length) return;
    if ((this.nextFlick -= dt) <= 0) {
      this.nextFlick = this.r(CFG.LFX_FLICKER_GAP[0], CFG.LFX_FLICKER_GAP[1]);
      const i = this.pickNear(near, 4);
      if (i >= 0) this.start(i, this.rnd() < CFG.LFX_ELECTRICAL_CHANCE ? this.electrical() : this.flicker());
    }
    if ((this.nextOut -= dt) <= 0) {
      this.nextOut = this.r(CFG.LFX_OUTAGE_GAP[0], CFG.LFX_OUTAGE_GAP[1]);
      const maxOff = Math.max(1, Math.floor(this.count * 0.12));
      const lim = this.rnd() < 0.12 ? Math.min(2, maxOff) : 1; // dua lampu mati bersamaan sangat jarang
      if (this.offCount < lim) { const i = this.pickNear(near, 6); if (i >= 0) this.start(i, this.outage(), true); }
    }
  }

  private pickNear(near: number[], k: number): number {
    const c = near.slice(0, k).filter((i) => !this.fx.has(i));
    return c.length ? c[Math.floor(this.rnd() * c.length)] : -1;
  }
  /** Kedip biasa: 2-4 dip, durasi & kedalaman acak, minimal 60 ms antar-transisi. */
  private flicker(): Step[] {
    const n = 2 + Math.floor(this.rnd() * 3), s: Step[] = [];
    for (let k = 0; k < n; k++) { s.push([this.r(0.08, 0.22), this.r(0.25, 0.75)]); s.push([this.r(0.26, 0.55), this.r(0.85, 1)]); }
    return s;
  }
  /** Electrical flicker: rangkaian stutter lebih panjang, ada dip dalam singkat, lalu 'nyangkut' redup sebelum pulih. */
  private electrical(): Step[] {
    const n = 4 + Math.floor(this.rnd() * 4), s: Step[] = [];
    for (let k = 0; k < n; k++) s.push([this.r(0.08, 0.18), this.rnd() < 0.3 ? this.r(0.1, 0.22) : this.r(0.35, 0.8)], [this.r(0.22, 0.38), this.r(0.7, 1)]);
    s.push([this.r(0.25, 0.7), this.r(0.4, 0.6)]);
    return s;
  }
  /** Lampu mati: kedip-sekarat -> mati beberapa detik -> kedip-hidup (tidak pernah strobo cepat). */
  private outage(): Step[] {
    const hold = this.r(CFG.LFX_OUTAGE_HOLD[0], CFG.LFX_OUTAGE_HOLD[1]);
    return [[this.r(0.2, 0.35), 0.55], [this.r(0.2, 0.35), 0.95], [this.r(0.17, 0.3), 0.2], [this.r(0.2, 0.35), 0.7], [this.r(0.2, 0.45), 0.05], [hold, 0],
      [this.r(0.2, 0.35), 0.45], [this.r(0.2, 0.35), 0], [this.r(0.2, 0.3), 0.8], [this.r(0.17, 0.3), 0.3], [this.r(0.2, 0.5), 1]];
  }
}
