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
  turn?: number;   // kecepatan putar badan (rad/dtk, + = belok kiri); opsional: badan condong ke dalam tikungan, kepala mendahului
}
export interface PoseOut { rot: Record<BoneName, [number, number, number]>; hips: [number, number, number] }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pos = (x: number) => (x > 0 ? x : 0);
export const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Sudut ayun paha (rad) untuk intensitas langkah m, campuran lari r, jongkok cd. Dipakai computePose dan cycleLength (satu sumber kebenaran). */
export const legSwing = (m: number, r: number, cd: number) => lerp(0.42, 0.82, r) * m * (1 - 0.45 * cd);
/**
 * TAHAP 5: gaya jalan kaki-terkunci (stance foot lock). true = kaki tumpu diam di tanah selama fase tumpu (foot sliding ~0, dihitung lewat IK 2-tulang);
 * false (gait.ik = false) = sinusoid lama (kaki tumpu menyapu tidak seragam -> meluncur). Dipertahankan sebagai cadangan/pembanding.
 */
export const gait = { ik: true };
const frac = (x: number) => x - Math.floor(x);
const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const hs = (e0: number, e1: number, x: number) => smooth((x - e0) / (e1 - e0));
const dutyOf = (r: number) => lerp(0.62, 0.42, r);                 // porsi siklus kaki menapak: jalan 62% (ada fase dua kaki), lari 42% (ada fase melayang)
/** Panjang tapak (m): jarak kaki tumpu menyapu relatif pinggul selama satu fase tumpu. */
const strideOf = (b: Body, m: number, r: number, cd: number) => (0.72 + 0.22 * r) * m * (1 - 0.45 * cd) * ((b.thigh + b.shin) / 0.8);

/**
 * Jarak tempuh (m) per satu siklus langkah penuh (2 langkah) agar kaki tumpu TIDAK meluncur.
 * IK: kaki tumpu bergerak relatif pinggul sejauh S selama porsi `duty` siklus dengan kecepatan sama dengan kecepatan tanah -> siklus = S / duty.
 * Lama (sinusoid): kaki tumpu menyapu 2*L*sin(A) selama separuh siklus -> siklus = 4*L*sin(A).
 * Fase langkah dimajukan dengan jarak/siklus ini (bukan rumus kecepatan lama yang tidak mengikuti sudut ayun).
 */
export function cycleLength(b: Body, m: number, r: number, cd: number): number {
  if (gait.ik) return Math.max(0.15, strideOf(b, m, r, cd) / dutyOf(r));
  const A = Math.min(1.2, Math.max(0.05, legSwing(m, r, cd)));
  return Math.max(0.15, 4 * (b.thigh + b.shin) * 0.97 * Math.sin(A));
}

/** Lintasan telapak relatif pinggul pada titik siklus u (0 = tumit menyentuh tanah): tumpu = garis lurus ke belakang (kecepatan tanah); ayun = Hermite berkecepatan sama di kedua ujung (tanpa patah). */
function footPath(u: number, duty: number, S: number, lift: number): { x: number; y: number } {
  if (u < duty) return { x: S / 2 - S * (u / duty), y: 0 };
  const w = (u - duty) / (1 - duty), m0 = -S * (1 - duty) / duty, w2 = w * w, w3 = w2 * w;
  const x = (2 * w3 - 3 * w2 + 1) * (-S / 2) + (w3 - 2 * w2 + w) * m0 + (-2 * w3 + 3 * w2) * (S / 2) + (w3 - w2) * m0;
  return { x, y: lift * Math.sin(Math.PI * w) };
}

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
  const A = legSwing(m, r, cd);
  const tn = Math.max(-3, Math.min(3, p.turn || 0));
  const K = lerp(0.85, 1.5, r) * m * (1 - 0.3 * cd);
  const L1 = b.thigh, L2 = b.shin, LL = L1 + L2;

  // ---- sinusoid lama (cadangan, GAIT_IK=false) ----
  const legOld = (s: number, c: number) => {
    const th1 = A * s + cd * 1.3 + air * 0.55;
    const bend = K * pos(c) + m * 0.08 + 0.35 * m * pos(-s) + cd * 1.8 + air * 1.1;
    const th2 = th1 - bend;
    const foot = th2 * 0.85 + 0.45 * m * pos(-s) - 0.2 * m * pos(c) + air * 0.9;
    return { th1, bend, th2, foot, drop: b.thigh * (1 - Math.cos(th1)) + b.shin * (1 - Math.cos(th2)), fz: b.thigh * Math.sin(th1) + b.shin * Math.sin(th2) };
  };
  // ---- kaki terkunci: telapak mengikuti footPath, sudut paha/lutut dari IK dua tulang. Tinggi pinggul = busur terendah yang masih terjangkau kedua kaki
  //      (y_kaki + sqrt(jangkauan^2 - x_kaki^2), digabung soft-min) dikurangi sebagian (kappa) supaya pinggul tidak terlalu naik-turun; selalu <= batas jangkauan -> telapak tumpu tidak pernah tertarik lepas ----
  const duty = dutyOf(r), S = strideOf(b, m, r, cd), half = S / 2, sc = 0.17 * cd;
  const dd = LL * (1 - Math.min(1, m) * (0.008 + 0.03 * r));                       // jangkauan kaki tumpu (sedikit menekuk saat melangkah; lurus saat diam)
  const hg = Math.sqrt(Math.max(dd * dd - half * half, 0.09 * LL * LL)), hMax = dd * (1 - 0.003 * Math.min(1, m));
  const psi = frac(p.phase / (2 * Math.PI)), uL = frac(psi - 0.25), uR = frac(psi + 0.25); // kaki kiri paling depan (tumit menyentuh) saat phase = PI/2, seperti sinusoid lama -> lengan/torsi tetap sefase
  const lift = (0.045 + 0.075 * r) * m * (1 - 0.3 * cd) * (LL / 0.8);
  const fpL = footPath(uL, duty, S, lift), fpR = footPath(uR, duty, S, lift);
  const arc = (fp: { x: number; y: number }) => fp.y + Math.sqrt(Math.max(dd * dd - (fp.x + sc) * (fp.x + sc), 0.09 * LL * LL));
  const aL = arc(fpL), aR = arc(fpR), a0 = Math.min(aL, aR), softMin = a0 - Math.log(1 + Math.exp(-80 * Math.abs(aL - aR))) / 80 + Math.LN2 / 80; // +ln2/80: dua nilai sama -> persis nilai itu (pose diam tidak bergeser)
  const kappa = lerp(0.65, 0.4, r), runDip = 0.04 * r * m * (0.5 + 0.5 * Math.cos(4 * Math.PI * (uL - duty / 2)));
  const Hh = hg + kappa * (Math.min(softMin, hMax) - hg) - runDip - cd * 0.43 * LL;
  const legIK = (u: number, fp: { x: number; y: number }) => {
    let dx = fp.x + sc, dy = Math.max(0.05 * LL, Hh - fp.y), d = Math.hypot(dx, dy);
    const dMax = LL, dMin = Math.abs(L1 - L2) + 0.02 * LL;
    const dc = clampN(d, dMin, dMax);
    if (d > 1e-9 && dc !== d) { const k = dc / d; dx *= k; dy *= k; d = dc; }
    const ca = clampN((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), kk = clampN((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    const th1 = Math.atan2(dx, dy) + Math.acos(ca) + air * 0.55, bend = Math.PI - Math.acos(kk) + air * 1.1, th2 = th1 - bend;
    const toeOff = hs(duty - 0.16, duty, u) * (1 - hs(duty, duty + 0.14, u)), touch = hs(0.82, 1, u) + (1 - hs(0, 0.1, u));
    const foot = th2 * 0.85 + 0.45 * m * toeOff - 0.2 * m * touch + air * 0.9;
    const drop = L1 * (1 - Math.cos(th1)) + L2 * (1 - Math.cos(th2));
    return { th1, bend, th2, foot, drop: drop - fp.y, fz: L1 * Math.sin(th1) + L2 * Math.sin(th2) };
  };
  const ik = gait.ik, lL = ik ? legIK(uL, fpL) : legOld(sL, cL), lR = ik ? legIK(uR, fpR) : legOld(sR, cR);
  const ground = 1 - Math.min(1, air * 3);
  const yRoot = -Math.min(lL.drop, lR.drop) * ground + p.lift;
  const zRoot = ik ? -sc : -(lL.fz + lR.fz) / 2 * lerp(0.5, 1, Math.min(1, cd * 1.5));
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
      chest: [chestX, twist, 0.015 * Math.sin(ph * 0.5) - 0.035 * tn * m],
      neck: [neckX, 0, 0],
      head: [headCompX + 0.03 * Math.sin(ph * 0.9) - 0.02 * br, p.lookY - twist * 0.6 + 0.05 * Math.sin(ph * 0.7) + 0.05 * tn, 0.02 * Math.sin(ph * 0.6)],
      armL: arm(sL, 0, 1), foreL: fore(sL, 0), handL: [-0.12, 0, 0],
      armR: arm(sR, 1, -1), foreR: fore(sR, 1), handR: [-0.12, 0, 0],
      legL: [-lL.th1, 0, 0], shinL: [lL.bend, 0, 0], footL: [lL.foot, 0, 0],
      legR: [-lR.th1, 0, 0], shinR: [lR.bend, 0, 0], footR: [lR.foot, 0, 0],
    },
  };
}
