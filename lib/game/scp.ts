// Logika murni (tanpa three.js, bisa dites) untuk jumpscare SCP-106 dari locker/lemari:
//  - pemilihan acak locker/lemari pemicu (minimal N, tidak pernah semua)
//  - efek ScareFx: pemain diperlambat TEPAT `slowMs`, blur POV naik cepat lalu pulih halus; tidak bisa menumpuk
//  - garis waktu animasi (terjang, angkat lengan, memeluk) + kunci pose lengan
import type { Rng } from './rng';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => { const k = clamp01(t); return k * k * (3 - 2 * k); };

/** Jumlah pemicu: minimal `min`, atau `frac` dari seluruh locker/lemari bila lebih besar; tidak pernah semua (selalu ada yang aman). */
export function scareCount(total: number, min: number, frac: number): number {
  if (total <= 1) return 0;
  const want = Math.max(min, Math.ceil(total * frac));
  return Math.max(0, Math.min(want, total - 1));
}

/** Pilih acak (Fisher-Yates dari RNG seed run) unit furniture pemicu. Unit unik; hasil tidak berubah selama sesi. */
export function pickScareUnits(ids: string[], rng: Rng, min: number, frac: number): string[] {
  const uniq = Array.from(new Set(ids));
  const n = scareCount(uniq.length, min, frac);
  return rng.shuffle(uniq.slice()).slice(0, n);
}

/**
 * Efek jumpscare terhadap pemain. Satu instance = satu efek pada satu waktu: start() ditolak bila masih aktif (slow/blur tidak menumpuk).
 * Waktu memakai jam dinding (ms) yang diberikan pemanggil, jadi 'tepat 1,5 detik' tidak bergantung pada frame rate.
 *  - slow: pengali kecepatan; = slowMul selama [0, slowMs) lalu LANGSUNG 1 (kecepatan semula).
 *  - blur: 0..1; naik dalam rampMs, bertahan sampai slowMs, lalu pulih halus dalam fadeMs.
 */
export class ScareFx {
  slow = 1;
  blur = 0;
  active = false;
  private t0 = 0;
  constructor(public slowMs = 1500, public slowMul = 0.4, public rampMs = 90, public fadeMs = 700, public blurMax = 1) {}

  get totalMs(): number { return this.slowMs + this.fadeMs; }

  start(nowMs: number): boolean {
    if (this.active) return false;
    this.active = true; this.t0 = nowMs;
    this.update(nowMs);
    return true;
  }

  update(nowMs: number): void {
    if (!this.active) return;
    const e = Math.max(0, nowMs - this.t0);
    if (e >= this.totalMs) { this.reset(); return; }
    this.slow = e < this.slowMs ? this.slowMul : 1;
    const k = e < this.rampMs ? smooth(e / this.rampMs) : e < this.slowMs ? 1 : 1 - smooth((e - this.slowMs) / this.fadeMs);
    this.blur = k * this.blurMax;
  }

  /** Pulihkan semuanya (ganti run / unmount): kecepatan normal, penglihatan jernih. */
  reset(): void { this.active = false; this.slow = 1; this.blur = 0; this.t0 = 0; }
}

export interface ScpFrame {
  visible: boolean;
  lunge: number;   // 0..1 progres terjang keluar locker
  raise: number;   // 0..1 lengan terangkat (dari lurus di sisi badan) ke posisi menjemput
  close: number;   // 0..1 lengan menutup (memeluk)
  lean: number;    // sudut condong badan ke depan (radian)
  shake: number;   // amplitudo getar halus (radian)
}

/** Garis waktu satu jumpscare (detik sejak SCP muncul). Mulai mendadak, terjang cepat, memeluk, lalu selesai (dur). */
export function scpTimeline(t: number, dur: number): ScpFrame {
  const lunge = 1 - Math.pow(1 - clamp01(t / 0.3), 3);
  return {
    visible: t >= 0 && t < dur,
    lunge,
    raise: smooth((t - 0.03) / 0.32),
    close: smooth((t - dur * 0.55) / (dur * 0.3)),
    lean: 0.1 + 0.22 * lunge,
    shake: t > 0.3 ? 0.02 : 0,
  };
}

/** Arah (ruang model: +Z = depan, +Y = atas, +X = sisi kanan model; dicerminkan untuk sisi kiri) tiap ruas lengan pada kunci pose. */
export const ARM_KEYS = {
  upperOpen: [0.62, 0.25, 0.74] as const, upperClose: [0.5, 0.2, 0.85] as const,
  foreOpen: [0.28, 0.12, 0.95] as const, foreClose: [-0.62, 0.05, 0.78] as const,
  head: [0, 0.85, 0.5] as const,
};

/** Locker/lemari menurut definisi game (sama dengan titik sembunyi): furniture bertipe Locker atau Cabinet (lemari pakaian dua pintu). */
export function scpEligibleType(type: string | undefined): boolean { return type === 'Locker' || type === 'Cabinet'; }
