// Efek jumpscare SCP-106 (logika murni, tanpa DOM/three.js; dites di scripts/test-scare.js).
//  - pemain diperlambat TEPAT `slowSeconds` (kecepatan konstan, lalu kembali 1.0 seketika sesudahnya),
//  - penglihatan buram: naik cepat, bertahan selama slow, lalu pulih HALUS (smoothstep) sesudah efek berakhir,
//  - satu efek aktif pada satu waktu: trigger() saat efek masih berjalan DITOLAK (slow & blur tidak pernah bertumpuk),
//  - tidak menyentuh HP, kontrol, atau sensitivitas kamera: hanya menghasilkan pengali kecepatan & radius blur.
export interface ScareFxCfg { slowSeconds: number; slowMul: number; blurPx: number; blurIn: number; blurOut: number }
export interface ScareFxOut { active: boolean; speed: number; blur: number; t: number }

const sm = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export class ScareFx {
  private t = -1;                // < 0 = tidak aktif
  private cfg: ScareFxCfg;
  private out: ScareFxOut = { active: false, speed: 1, blur: 0, t: 0 };
  /** jumlah trigger yang diterima / ditolak (diagnostik & tes) */
  accepted = 0; rejected = 0;

  constructor(cfg: ScareFxCfg) { this.cfg = cfg; }

  get active(): boolean { return this.t >= 0; }
  get total(): number { return this.cfg.slowSeconds + this.cfg.blurOut; }

  /** Mulai efek. false = ditolak karena efek sebelumnya masih berjalan (mencegah penumpukan). */
  trigger(): boolean {
    if (this.t >= 0) { this.rejected++; return false; }
    this.t = 0; this.accepted++;
    return true;
  }

  /** Hentikan segera & kembalikan semuanya normal (restart run / unmount). */
  reset(): void { this.t = -1; this.out.active = false; this.out.speed = 1; this.out.blur = 0; this.out.t = 0; }

  /** Majukan waktu `dt` detik (hanya dipanggil saat game berjalan). Objek hasil dipakai ulang (tanpa alokasi per frame). */
  update(dt: number): ScareFxOut {
    const o = this.out, c = this.cfg;
    if (this.t < 0) { o.active = false; o.speed = 1; o.blur = 0; o.t = 0; return o; }
    this.t += Math.max(0, dt);
    const t = this.t;
    if (t >= c.slowSeconds + c.blurOut) { this.reset(); return o; }
    o.active = true; o.t = t;
    o.speed = t < c.slowSeconds ? c.slowMul : 1;                                   // tepat slowSeconds
    o.blur = c.blurPx * (t < c.slowSeconds ? sm(t / c.blurIn) : 1 - sm((t - c.slowSeconds) / c.blurOut)); // naik cepat, tahan, pulih halus
    return o;
  }
}

/** Gabungkan efek lain yang mungkin sedang aktif (mis. opening bangun pingsan) TANPA menumpuk: kecepatan = yang paling lambat, blur = yang paling kuat. */
export const combineSpeed = (...v: number[]) => v.reduce((a, b) => Math.min(a, b), 1);
export const combineBlur = (...v: number[]) => v.reduce((a, b) => Math.max(a, b), 0);
