// SCP-106 jumpscare locker (logika murni, tanpa three.js supaya bisa dites di Node: scripts/test-scare.js).
// Isi: (1) pemilihan locker/lemari pemicu per run, (2) solver pose tulang, (3) timeline animasi jumpscare.
// scp-106.glb punya skeleton (57 tulang) TANPA animasi bawaan, jadi geraknya dibuat dari transformasi tulang di sini.
import type { Rng } from './rng';

// ------------------------------------------------------------------ pemilihan locker pemicu
export interface PickOpts { min: number; frac: number; max: number }
/**
 * Pilih locker/lemari pemicu dari daftar id furniture yang memenuhi syarat.
 *  - jumlah = round(n * frac) dibatasi [min, max]; bila kandidat <= min, sisakan minimal 1 yang normal (tidak pernah SEMUA locker jadi pemicu)
 *  - tanpa duplikat; urutan acak dari rng (rng turunan seed run, tidak mengubah urutan RNG furniture/key/event)
 */
export function pickScareLockers(ids: string[], rng: Rng, o: PickOpts): string[] {
  const uniq = Array.from(new Set(ids));
  const n = uniq.length;
  if (n <= 1) return [];
  let k = Math.max(o.min, Math.min(o.max, Math.round(n * o.frac)));
  if (k >= n) k = n - 1;
  return rng.shuffle(uniq.slice()).slice(0, k);
}

// ------------------------------------------------------------------ kuaternion (x,y,z,w)
export type Q = [number, number, number, number];
export const QI: Q = [0, 0, 0, 1];
export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qinv = (a: Q): Q => { const n = a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] || 1; return [-a[0] / n, -a[1] / n, -a[2] / n, a[3] / n]; };
export const qaxis = (ax: number, ay: number, az: number, deg: number): Q => {
  const h = (deg * Math.PI) / 360, s = Math.sin(h), l = Math.hypot(ax, ay, az) || 1;
  return [(ax / l) * s, (ay / l) * s, (az / l) * s, Math.cos(h)];
};
export const qnorm = (a: Q): Q => { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; };
export const qrot = (q: Q, v: [number, number, number]): [number, number, number] => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};

// ------------------------------------------------------------------ solver pose
/** Satu tulang pada pose istirahat. Urutan array WAJIB induk-sebelum-anak. */
export interface BoneRest { name: string; parent: number; q: Q; rootQ?: Q }
/** Rotasi `deg` derajat mengelilingi `axis` di RUANG MODEL (x = lebar, y = atas, z = depan model), dipasang pada tulang `bone` dan ikut diwarisi anak-anaknya. */
export interface PoseOp { bone: string; axis: [number, number, number]; deg: number }

/**
 * Hitung rotasi lokal baru semua tulang. Op tiap tulang dikomposisi berurutan di ruang model (op berikutnya dipasang SESUDAH op sebelumnya).
 * newLocal = inv(parentWorld) * D * parentWorld * restLocal, dengan D = rotasi gabungan ruang-model. Tulang tanpa op = pose istirahat.
 */
export function solvePose(rest: BoneRest[], ops: PoseOp[]): Q[] {
  const byBone = new Map<string, PoseOp[]>();
  for (const o of ops) { const a = byBone.get(o.bone) ?? []; a.push(o); byBone.set(o.bone, a); }
  const W: Q[] = new Array(rest.length), out: Q[] = new Array(rest.length);
  for (let i = 0; i < rest.length; i++) {
    const b = rest[i];
    const pw: Q = b.parent < 0 ? (b.rootQ ?? QI) : W[b.parent];
    const list = byBone.get(b.name);
    if (!list) { out[i] = b.q; W[i] = qnorm(qmul(pw, b.q)); continue; }
    let D: Q = QI;
    for (const o of list) D = qmul(qaxis(o.axis[0], o.axis[1], o.axis[2], o.deg), D);
    const nw = qnorm(qmul(D, qmul(pw, b.q)));
    W[i] = nw; out[i] = qnorm(qmul(qinv(pw), nw));
  }
  return out;
}

// ------------------------------------------------------------------ nama tulang scp-106.glb (diperiksa dari skeleton aslinya)
const S = '_106_2_skeleton';
const n = (s: string) => s + S;
export const BONE = {
  hips: n('Bone'), spine1: n('Bone_001'), spine2: n('Bone_002'), neck: n('Bone_003'),
  headBase: n('Bone_021'), head: n('Bone_022'),
  shoulderA: n('Bone_004'), elbowA: n('Bone_005'),   // lengan sisi +x model
  shoulderB: n('Bone_024'), elbowB: n('Bone_025'),   // lengan sisi -x model
  fingersA: ['Bone_006', 'Bone_009', 'Bone_012', 'Bone_015', 'Bone_018'].map(n),
  fingersB: ['Bone_026', 'Bone_034', 'Bone_035', 'Bone_036', 'Bone_037'].map(n),
  hipA: n('Bone_030'), hipB: n('Bone_038'),
};
export const REQUIRED_BONES: string[] = [BONE.hips, BONE.spine1, BONE.spine2, BONE.neck, BONE.headBase, BONE.shoulderA, BONE.elbowA, BONE.shoulderB, BONE.elbowB, ...BONE.fingersA, ...BONE.fingersB];

export const SCP_SCALE = 0.275; // model asli ~6,34 unit tinggi -> ~1,74 m (muat di dalam locker setinggi ~1,76 m)

export interface PoseParams {
  open: number;   // 0..1: lengan dari menggantung -> terentang ke depan (siap memeluk)
  hug: number;    // 0..1: lengan menutup ke dalam (memeluk)
  lean: number;   // 0..1: badan condong ke depan
  head: number;   // 0..1: kepala miring menunduk ke arah pemain
  claw: number;   // 0..1: jari menekuk
  shake: number;  // amplitudo getar (derajat)
  t: number;      // waktu (detik) untuk fase getar
}

/** Pose "ingin memeluk pemain": kedua lengan diangkat ke depan & terbuka lebar, siku menekuk ke dalam, badan & kepala condong ke arah pemain. */
export function hugOps(p: PoseParams): PoseOp[] {
  const ops: PoseOp[] = [];
  const o = p.open, h = p.hug, sh = p.shake;
  const tr = (f: number, ph: number) => Math.sin(p.t * f + ph) * sh;
  ops.push({ bone: BONE.spine1, axis: [1, 0, 0], deg: 16 * p.lean + tr(23, 0.3) * 0.25 });
  ops.push({ bone: BONE.spine2, axis: [1, 0, 0], deg: 11 * p.lean });
  ops.push({ bone: BONE.headBase, axis: [1, 0, 0], deg: 20 * p.head + tr(31, 1.1) * 0.3 });
  ops.push({ bone: BONE.headBase, axis: [0, 0, 1], deg: 13 * p.head + tr(19, 2.0) * 0.5 });
  for (const sg of [1, -1] as const) {
    const sho = sg > 0 ? BONE.shoulderA : BONE.shoulderB, elb = sg > 0 ? BONE.elbowA : BONE.elbowB, fin = sg > 0 ? BONE.fingersA : BONE.fingersB;
    // lengan atas: angkat ke depan, lalu buka keluar; saat memeluk, buka mengecil
    ops.push({ bone: sho, axis: [1, 0, 0], deg: -82 * o + tr(27, sg) * 0.6 });
    ops.push({ bone: sho, axis: [0, 1, 0], deg: sg * (34 * o - 20 * h) });
    // siku: menekuk ke dalam (makin dalam saat memeluk) + sedikit terangkat
    ops.push({ bone: elb, axis: [0, 1, 0], deg: -sg * (30 * o + 38 * h) });
    ops.push({ bone: elb, axis: [1, 0, 0], deg: -14 * o });
    // jari menekuk seperti mencakar
    for (const f of fin) ops.push({ bone: f, axis: [1, 0, 0], deg: 38 * p.claw + tr(41, sg + 3) * 0.5 });
  }
  return ops;
}

// ------------------------------------------------------------------ timeline jumpscare
export interface ScpFrame {
  visible: boolean;
  fwd: number;      // meter ke depan dari titik muncul (searah depan locker/arah pemain)
  lift: number;     // meter ke atas (getar ringan)
  side: number;     // meter ke samping (getar ringan)
  scale: number;    // pengali skala (denyut kecil saat muncul)
  pose: PoseParams;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const eo3 = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const sm = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/**
 * Posisi & pose SCP pada waktu t (detik) dari total `dur`. `lunge` = jarak terjang ke depan (m).
 * Fase: muncul mendadak di dalam locker (0-0.10) -> menerjang & merentangkan lengan (0.10-0.34) -> mendekat sambil bergetar (0.34-0.80) -> lengan menutup memeluk (0.55-0.95) -> hilang seketika di `dur`.
 * Di luar [0, dur) tidak terlihat (tidak ada sisa model di dunia).
 */
export function scpFrame(t: number, dur: number, lunge: number): ScpFrame {
  const k = dur / 1.25; // semua fase diskalakan terhadap durasi
  const T = t / k;
  const vis = t >= 0 && t < dur;
  const L = Math.max(0, lunge);
  const lungeK = eo3((T - 0.10) / 0.24);
  const creep = clamp01((T - 0.34) / 0.66);
  const shakeAmp = vis ? (T < 0.34 ? 2.0 : 3.5 + 3 * creep) : 0;
  const open = 0.12 + 0.88 * eo3((T - 0.10) / 0.2);
  const hug = sm((T - 0.55) / 0.40);
  const snap = T > 1.0 ? 1 : 0; // dentakan terakhir tepat sebelum hilang
  const jx = Math.sin(T * 61) * 0.012 * (T > 0.34 ? 1 : 0.4), jy = Math.sin(T * 47 + 1) * 0.01 * (T > 0.34 ? 1 : 0.4);
  return {
    visible: vis,
    fwd: L * lungeK + 0.14 * creep + 0.05 * snap,
    lift: jy, side: jx,
    scale: T < 0.10 ? 0.94 + 0.06 * sm(T / 0.10) : 1 + 0.035 * snap,
    pose: {
      open, hug,
      lean: 0.35 + 0.65 * eo3((T - 0.10) / 0.3),
      head: 0.25 + 0.75 * eo3((T - 0.12) / 0.3),
      claw: 0.2 + 0.8 * eo3((T - 0.15) / 0.3),
      shake: shakeAmp, t,
    },
  };
}

/** Yaw (rad) SCP menghadap pemain, tetapi tidak berputar lebih dari `maxTurn` dari arah depan locker (tidak menembus badan locker). */
export function scpYaw(frontYaw: number, fromX: number, fromZ: number, px: number, pz: number, maxTurn = 1.0): number {
  const want = Math.atan2(px - fromX, pz - fromZ);
  let d = want - frontYaw;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return frontYaw + Math.max(-maxTurn, Math.min(maxTurn, d));
}

/** Jarak terjang: SCP berhenti >= `stop` m di depan kamera pemain, maksimal `maxLunge`. */
export function scpLunge(distToPlayer: number, stop = 0.7, maxLunge = 1.1): number {
  return Math.max(0, Math.min(maxLunge, distToPlayer - stop));
}
