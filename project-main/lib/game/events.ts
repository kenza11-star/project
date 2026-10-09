// Penjadwal event horor acak. Logika murni & deterministik: seed yang sama -> urutan jenis & jeda yang sama.
import type { Rng } from './rng';
import * as CFG from './config';

export type EventType = 'lights' | 'door' | 'furniture' | 'entity';

export class EventScheduler {
  private rng: Rng;
  private timer: number;
  private last: EventType | null = null;
  private lastAt: Partial<Record<EventType, number>> = {};
  private clock = 0;

  constructor(rng: Rng) { this.rng = rng; this.timer = rng.range(CFG.EVENT_FIRST_MIN, CFG.EVENT_FIRST_MAX); }

  /** Jenis berikutnya (bobot, tidak sama dengan sebelumnya, belum cooldown). Selalu memakai jumlah panggilan RNG yang sama. */
  private pickType(): EventType {
    const entries = (Object.keys(CFG.EVENT_WEIGHTS) as EventType[]).map((t) => {
      let w = CFG.EVENT_WEIGHTS[t];
      if (t === this.last) w = 0;
      const at = this.lastAt[t];
      if (at !== undefined && this.clock - at < CFG.EVENT_TYPE_COOLDOWN) w *= 0.15;
      return [t, w] as [EventType, number];
    });
    if (entries.every(([, w]) => w <= 0)) return 'lights';
    return this.rng.weighted(entries);
  }

  /**
   * Panggil tiap frame. Mengembalikan jenis event yang harus dicoba sekarang (atau null).
   * `run(type)` mencoba menjalankan event dan mengembalikan true bila berhasil (kondisi aman terpenuhi).
   * Bila gagal -> dicoba lagi lebih cepat; bila berhasil -> jeda panjang acak.
   */
  update(dt: number, run: (t: EventType) => boolean): EventType | null {
    this.clock += dt;
    this.timer -= dt;
    if (this.timer > 0) return null;
    const type = this.pickType();
    const ok = run(type);
    if (ok) {
      this.last = type; this.lastAt[type] = this.clock;
      this.timer = this.rng.range(CFG.EVENT_GAP_MIN, CFG.EVENT_GAP_MAX);
      return type;
    }
    this.timer = this.rng.range(CFG.EVENT_RETRY_MIN, CFG.EVENT_RETRY_MAX);
    return null;
  }
}
