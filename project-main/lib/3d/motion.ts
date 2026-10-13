// Gerak tubuh prosedural (jalan, lari, lompat, jongkok, idle) sebagai fungsi murni: input parameter -> rotasi tiap tulang.
// Semua tulang rest-nya sejajar sumbu dunia, rotasi Euler urutan XYZ. Model menghadap +Z; rx negatif = ayun ke depan.
import type { BoneName } from './rigcore';

export interface Body { thigh: number; shin: number; armDown: [number, number]; foreFwd: [number, number] } // panjang dalam meter dunia
export interface PoseIn {
  t: number; seed: number;
  phase: number;   // fase siklus langkah (rad)
  gait: number;    // 0..1 intensitas langkah
  run: number;     // 0..1 campuran lari
  crouch: number;  // 0..1 kedalaman jongkok
  air: number;     // 0..1 melayang (kaki ditekuk)
  armsUp: number;  // -1..1 lengan ayun naik (+) / ke belakang (-)
  lookY: number;   // putar kepala
  lift: number;    // tinggi lompat (m)
}
export interface PoseOut { rot: Record<BoneName, [number, number, number]>; hips: [number, number, number] }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pos = (x: number) => (x > 0 ? x : 0);
export const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export const JUMP_TIME = 1.34;
// Garis waktu lompat: antisipasi (jongkok) -> tolak -> melayang -> mendarat (menyerap).
export function jumpState(t: number): { crouch: number; air: number; armsUp: number; lift: number; done: boolean } {
  const T0 = 0.3, T1 = 0.38, T2 = 1.0, T3 = JUMP_TIME;
  if (t >= T3) return { crouch: 0, air: 0, armsUp: 0, lift: 0, done: true };
  if (t < T0) { const u = smooth(t / T0); return { crouch: 0.85 * u, air: 0, armsUp: -0.45 * u, lift: 0, done: false }; }
  if (t < T1) { const u = smooth((t - T0) / (T1 - T0)); return { crouch: 0.85 * (1 - u), air: 0, armsUp: lerp(-0.45, 0.6, u), lift: 0, done: false }; }
  if (t < T2) {
    const u = (t - T1) / (T2 - T1), s = Math.sin(Math.PI * u);
    return { crouch: 0, air: Math.pow(s, 0.8), armsUp: lerp(0.6, 0.9, s) * (1 - 0.6 * smooth((u - 0.7) / 0.3)), lift: 0.55 * 4 * u * (1 - u), done: false };
  }
  const u = (t - T2) / (T3 - T2);
  return { crouch: 0.7 * Math.sin(Math.PI * u), air: 0, armsUp: 0.25 * (1 - u), lift: 0, done: false };
}

export function computePose(b: Body, p: PoseIn): PoseOut {
  const m = p.gait, r = p.run, cd = p.crouch, air = p.air;
  const ph = p.t + p.seed, br = Math.sin(ph * 1.7);
  const sL = Math.sin(p.phase), cL = Math.cos(p.phase), sR = -sL, cR = -cL;
  const A = lerp(0.42, 0.82, r) * m * (1 - 0.45 * cd);
  const K = lerp(0.85, 1.5, r) * m * (1 - 0.3 * cd);

  const leg = (s: number, c: number) => {
    const th1 = A * s + cd * 1.3 + air * 0.55;
    const bend = K * pos(c) + m * 0.08 + 0.35 * m * pos(-s) + cd * 1.8 + air * 1.1;
    const th2 = th1 - bend;
    const foot = th2 * 0.85 + 0.45 * m * pos(-s) - 0.2 * m * pos(c) + air * 0.9;
    return { th1, bend, th2, foot, drop: b.thigh * (1 - Math.cos(th1)) + b.shin * (1 - Math.cos(th2)), fz: b.thigh * Math.sin(th1) + b.shin * Math.sin(th2) };
  };
  const lL = leg(sL, cL), lR = leg(sR, cR);
  const ground = 1 - Math.min(1, air * 3);
  const yRoot = -Math.min(lL.drop, lR.drop) * ground + p.lift;
  const zRoot = -(lL.fz + lR.fz) / 2 * lerp(0.5, 1, Math.min(1, cd * 1.5));
  const bob = 0.012 * Math.sin(ph * 0.35);

  const twist = 0.1 * m * (1 + 0.9 * r) * sL;
  const lean = 0.03 + 0.22 * r * m + 0.12 * air;
  const crouchLean = 0.35 * cd;
  const spineX = lean * 0.5 + crouchLean, chestX = lean * 0.5 + crouchLean + 0.02 * br, neckX = 0.1 * cd;

  const Aarm = lerp(0.55, 0.95, r) * m;
  const abd = 0.1 * (1 - 0.8 * r * m); // lengan sedikit membuka saat diam, merapat saat lari
  const armRz = (side: number, k: 0 | 1) => side * (-(b.armDown[k] - abd) + 0.03 * Math.sin(ph * 1.1 + k));
  const arm = (s: number, k: 0 | 1, side: number): [number, number, number] => [
    Aarm * s - 0.5 * cd - 2.4 * p.armsUp + 0.05 * Math.sin(ph * 0.9 + k * 1.3),
    0,
    armRz(side, k),
  ];
  const fore = (s: number, k: 0 | 1): [number, number, number] => [
    b.foreFwd[k] * 0.75 - (lerp(0.18, 1.55, r) * m + 0.15 * (1 - m) + 0.12 * br * 0.2 + 0.35 * m * pos(-s) + 0.15 * cd + 0.4 * Math.abs(p.armsUp)), 0, 0,
  ];
  const headCompX = -(spineX + chestX + neckX) * 0.7;

  return {
    hips: [0.012 * Math.sin(ph * 0.35), yRoot + bob * 0.2, zRoot],
    rot: {
      hips: [0, -0.7 * twist, 0.012 * Math.sin(ph * 0.45) + 0.04 * m * sL],
      spine: [spineX, 0.3 * twist + 0.03 * Math.sin(ph * 0.4), 0],
      chest: [chestX, twist, 0.015 * Math.sin(ph * 0.5)],
      neck: [neckX, 0, 0],
      head: [headCompX + 0.03 * Math.sin(ph * 0.9) - 0.02 * br, p.lookY - twist * 0.6 + 0.05 * Math.sin(ph * 0.7), 0.02 * Math.sin(ph * 0.6)],
      armL: arm(sL, 0, 1), foreL: fore(sL, 0), handL: [-0.12, 0, 0],
      armR: arm(sR, 1, -1), foreR: fore(sR, 1), handR: [-0.12, 0, 0],
      legL: [-lL.th1, 0, 0], shinL: [lL.bend, 0, 0], footL: [lL.foot, 0, 0],
      legR: [-lR.th1, 0, 0], shinR: [lR.bend, 0, 0], footR: [lR.foot, 0, 0],
    },
  };
}
