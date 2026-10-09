// Efek lampu horor (logika murni, tanpa three; dites di scripts/test-lampfx.js).
// Tiap lampu punya antrean langkah [durasi, level]; gain halus mengikuti level.
// Kejadian hanya dipicu untuk lampu yang sedang dekat pemain (pool kecil), jadi biaya per frame kecil.
// Aman mata: level terendah saat kedip > 0 (bukan mati total), jeda antar langkah >= 0.05 dtk, dan
// urutan kedip dibatasi supaya tidak lebih dari ~3 ayunan besar per detik.

export const LAMPFX = {
  FLAKY_GAP: [0.5, 4.5] as [number, number],      // jeda antar kedip lampu yang memang rusak (dtk)
  NORMAL_GAP: [40, 150] as [number, number],      // lampu normal: gangguan listrik sangat jarang (dtk)
  OUTAGE_GAP: [14, 48] as [number, number],       // jeda minimum antar lampu mati sementara (dtk)
  OUTAGE_HOLD: [1.8, 8.5] as [number, number],    // lama lampu mati (dtk)
  MAX_OUT: 2,                                     // maks lampu mati bersamaan
  MAX_NEAR_OUT_FRAC: 0.34,                        // maks porsi lampu dekat pemain yang mati bersamaan
  FADE_DOWN: 28,                                  // laju gain turun (1/dtk)
  FADE_UP: 16,                                    // laju gain naik (1/dtk)
};

type Step = [number, number]; // [durasi dtk, level 0..1]

interface Lamp { steps: Step[]; i: number; t: number; lvl: number; g: number; next: number; out: boolean }

export class LampFx {
  readonly g: Float32Array;
  private lamps: Lamp[];
  private running = new Set<number>();
  private outCount = 0;
  private outT: number;
  constructor(n: number, private rnd: () => number = Math.random) {
    this.g = new Float32Array(n).fill(1);
    this.lamps = Array.from({ length: n }, () => ({ steps: [], i: 0, t: 0, lvl: 1, g: 1, next: 0, out: false }));
    this.outT = this.range(LAMPFX.OUTAGE_GAP);
  }
  private range(r: [number, number]) { return r[0] + (r[1] - r[0]) * this.rnd(); }
  private between(a: number, b: number) { return a + (b - a) * this.rnd(); }

  reset() {
    this.g.fill(1); this.running.clear(); this.outCount = 0; this.outT = this.range(LAMPFX.OUTAGE_GAP);
    for (const l of this.lamps) { l.steps = []; l.i = 0; l.t = 0; l.lvl = 1; l.g = 1; l.next = 0; l.out = false; }
  }

  get outages() { return this.outCount; }

  // --- pola kedip (semua acak, tidak berulang tetap) ---
  private dip(): Step[] { return [[this.between(0.05, 0.22), this.between(0.3, 0.7)], [0.1, 1]]; }
  private stutter(): Step[] {
    const n = 2 + Math.floor(this.rnd() * 3), s: Step[] = [];
    for (let k = 0; k < n; k++) { s.push([this.between(0.07, 0.16), this.between(0.3, 0.75)]); s.push([this.between(0.2, 0.55), 1]); }
    return s;
  }
  private electrical(): Step[] {
    // gangguan listrik: ayunan tak beraturan ~1-1,5 dtk, level 0.3..1 (tidak mati total)
    const n = 4 + Math.floor(this.rnd() * 3), s: Step[] = [];
    for (let k = 0; k < n; k++) s.push([this.between(0.16, 0.45), k % 2 === 0 ? this.between(0.35, 0.6) : this.between(0.8, 1)]);
    s.push([0.15, 1]);
    return s;
  }
  private outage(): Step[] {
    const hold = this.range(LAMPFX.OUTAGE_HOLD);
    return [
      [this.between(0.1, 0.16), 0.5], [this.between(0.18, 0.3), 0.9], [this.between(0.15, 0.25), 0.15],
      [hold, 0],
      [this.between(0.2, 0.3), 0.45], [this.between(0.3, 0.45), 0.05], [this.between(0.25, 0.35), 0.85], [this.between(0.4, 0.6), 0.3], [0.3, 1],
    ];
  }

  private start(i: number, steps: Step[], out = false) {
    const l = this.lamps[i];
    l.steps = steps; l.i = 0; l.t = 0; l.lvl = steps[0][1]; l.out = out;
    this.running.add(i);
  }

  /**
   * dt: detik; clock: waktu game; near: indeks lampu yang sedang dekat pemain (pool);
   * flaky(i): lampu rusak?; canOut(i): boleh dimatikan sementara (jauh dari spawn/exit).
   */
  update(dt: number, clock: number, near: number[], flaky: (i: number) => boolean, canOut: (i: number) => boolean) {
    // 1) majukan antrean yang sedang jalan
    for (const i of this.running) {
      const l = this.lamps[i];
      l.t += dt;
      while (l.i < l.steps.length && l.t >= l.steps[l.i][0]) { l.t -= l.steps[l.i][0]; l.i++; if (l.i < l.steps.length) l.lvl = l.steps[l.i][1]; }
      if (l.i >= l.steps.length) {
        l.lvl = 1; l.steps = [];
        if (l.out) { l.out = false; this.outCount = Math.max(0, this.outCount - 1); }
        if (Math.abs(l.g - 1) < 0.002) { l.g = 1; this.g[i] = 1; this.running.delete(i); continue; }
      }
      this.smooth(l, i, dt);
    }
    // 2) pemicu kedip untuk lampu dekat pemain
    for (const i of near) {
      const l = this.lamps[i];
      if (l.steps.length || clock < l.next) continue;
      if (l.next === 0) { l.next = clock + (flaky(i) ? this.range(LAMPFX.FLAKY_GAP) : this.range(LAMPFX.NORMAL_GAP)) * this.rnd(); continue; } // sebar waktu pertama
      const r = this.rnd();
      if (flaky(i)) this.start(i, r < 0.6 ? this.dip() : r < 0.9 ? this.stutter() : this.electrical());
      else this.start(i, r < 0.55 ? this.dip() : r < 0.9 ? this.stutter() : this.electrical());
      l.next = clock + (flaky(i) ? this.range(LAMPFX.FLAKY_GAP) : this.range(LAMPFX.NORMAL_GAP));
    }
    // 3) lampu mati sementara (jarang, tidak serempak)
    this.outT -= dt;
    if (this.outT <= 0 && near.length) {
      this.outT = this.range(LAMPFX.OUTAGE_GAP);
      const nearOut = near.reduce((a, i) => a + (this.lamps[i].out ? 1 : 0), 0);
      if (this.outCount < LAMPFX.MAX_OUT && nearOut + 1 <= Math.max(1, Math.floor(near.length * LAMPFX.MAX_NEAR_OUT_FRAC))) {
        const c = near.filter((i) => !this.lamps[i].out && !this.lamps[i].steps.length && canOut(i));
        if (c.length) { this.start(c[Math.floor(this.rnd() * c.length)], this.outage(), true); this.outCount++; }
      }
    }
  }

  private smooth(l: Lamp, i: number, dt: number) {
    const k = l.lvl < l.g ? LAMPFX.FADE_DOWN : LAMPFX.FADE_UP;
    l.g += (l.lvl - l.g) * Math.min(1, k * dt);
    this.g[i] = l.g;
  }
}
