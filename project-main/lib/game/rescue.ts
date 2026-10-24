// STAGE 3 -- sesi penyelamatan korban 'bound' (logika murni, tanpa three/react). Hanya HOST yang menjalankannya (otoritas); klien lain mengirim 'rreq' dan menerima 'rs'/'rok'.
// Aturan: 1 sesi per korban (penyelamat tambahan bergabung ke sesi yang sama), kecepatan = min(jumlah penyelamat, maxMul) / holdSeconds, tanpa penyelamat = sesi dibatalkan (progres hilang).

export interface RescueEvents { prog: { v: string; p: number; n: number }[]; done: string[]; cancel: string[] }

export class RescueHost {
  private ses = new Map<string, { who: Map<string, number>; p: number }>();   // korban -> { penyelamat -> waktu kabar terakhir (detik), progres 0..1 }
  private clock = 0;
  constructor(private holdSeconds: number, private maxMul: number, private timeout: number) {}

  /** Penyelamat mulai/berhenti menahan (juga dipanggil berkala sebagai keepalive). */
  set(victim: string, rescuer: string, on: boolean) {
    if (victim === rescuer) return;
    let s = this.ses.get(victim);
    if (!on) { s?.who.delete(rescuer); return; }
    if (!s) { s = { who: new Map(), p: 0 }; this.ses.set(victim, s); }
    s.who.set(rescuer, this.clock);
  }
  /** Progres 0..1 (0 bila tidak ada sesi). */
  progress(victim: string): number { return this.ses.get(victim)?.p ?? 0; }
  has(victim: string): boolean { return this.ses.has(victim); }
  clear() { this.ses.clear(); }
  /** Per frame di host. valid(korban, penyelamat) = korban masih 'bound', penyelamat hidup & dalam jangkauan. Mengembalikan progres untuk disiarkan, sesi selesai, dan sesi batal. */
  update(dt: number, valid: (victim: string, rescuer: string) => boolean): RescueEvents {
    this.clock += dt;
    const out: RescueEvents = { prog: [], done: [], cancel: [] };
    for (const [victim, s] of [...this.ses]) {
      for (const [r, t] of [...s.who]) if (this.clock - t > this.timeout || !valid(victim, r)) s.who.delete(r);
      const n = s.who.size;
      if (n === 0) { this.ses.delete(victim); out.cancel.push(victim); continue; }
      s.p = Math.min(1, s.p + (dt * Math.min(n, this.maxMul)) / this.holdSeconds);
      if (s.p >= 1) { this.ses.delete(victim); out.done.push(victim); continue; }
      out.prog.push({ v: victim, p: s.p, n });
    }
    return out;
  }
}
