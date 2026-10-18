// Stamina sprint. Logika murni.
import * as CFG from './config';

export class Stamina {
  value = CFG.STAMINA_MAX;
  exhausted = false;     // habis -> harus pulih sampai STAMINA_RESUME_AT dulu
  private delay = 0;

  get pct(): number { return Math.round((this.value / CFG.STAMINA_MAX) * 100); }
  canSprint(): boolean { return !this.exhausted && this.value > 0; }

  /** Panggil tiap frame. `sprinting` = pemain benar-benar sedang lari. Mengembalikan 'exhausted' pada frame habis. */
  update(dt: number, sprinting: boolean): 'exhausted' | null {
    let ev: 'exhausted' | null = null;
    if (sprinting && this.canSprint()) {
      this.value -= CFG.STAMINA_DRAIN * dt;
      this.delay = CFG.STAMINA_REGEN_DELAY;
      if (this.value <= 0) { this.value = 0; this.exhausted = true; ev = 'exhausted'; }
    } else {
      if (this.delay > 0) this.delay -= dt;
      else this.value = Math.min(CFG.STAMINA_MAX, this.value + CFG.STAMINA_REGEN * dt);
      if (this.exhausted && this.value >= CFG.STAMINA_RESUME_AT) this.exhausted = false;
    }
    return ev;
  }
  reset(): void { this.value = CFG.STAMINA_MAX; this.exhausted = false; this.delay = 0; }
}
