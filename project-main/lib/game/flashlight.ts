// Senter + battery. Logika murni (tanpa three.js). Battery hanya berkurang saat senter ON.
import * as CFG from './config';

export class Flashlight {
  readonly max: number;
  charge: number;      // detik pemakaian tersisa
  on = false;

  constructor(maxSeconds = CFG.FLASH_MAX_SECONDS) { this.max = maxSeconds; this.charge = maxSeconds; }

  get pct(): number { return Math.max(0, Math.min(100, Math.ceil((this.charge / this.max) * 100 - 1e-9))); }
  get empty(): boolean { return this.charge <= 0; }
  get full(): boolean { return this.charge >= this.max - 1e-6; }

  /** Nyalakan/matikan. Mengembalikan state baru. Tidak bisa ON bila battery habis. */
  toggle(): boolean {
    if (this.on) { this.on = false; return false; }
    if (this.empty) return false;
    this.on = true; return true;
  }

  /** Kurangi battery hanya saat ON. Mengembalikan 'died' pada frame saat battery habis. */
  update(dt: number): 'died' | null {
    if (!this.on) return null;
    this.charge -= dt;
    if (this.charge <= 0) { this.charge = 0; this.on = false; return 'died'; }
    return null;
  }

  /** Pakai battery: isi penuh. */
  recharge(): void { this.charge = this.max; }

  reset(): void { this.charge = this.max; this.on = false; }

  /** Pengali intensitas 0..1: redup & berkedip saat battery hampir habis. `r` = angka acak 0..1 (untuk kedip). */
  factor(r: number): number {
    if (!this.on) return 0;
    const p = this.pct;
    if (p > CFG.FLASH_LOW_PCT) return 1;
    const base = 0.35 + 0.65 * (p / CFG.FLASH_LOW_PCT);
    return r < 0.06 ? base * 0.25 : base;
  }
}
