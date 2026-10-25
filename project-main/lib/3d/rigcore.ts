// Auto-rig murni matematika (tanpa three.js): cari titik sendi dari bentuk mesh statis lalu hitung bobot skin.
// Dipisah supaya bisa diuji di Node. Konvensi: model menghadap +Z, Y ke atas, sisi "L" = +X.
export type V3 = [number, number, number];
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR'] as const;
export type BoneName = (typeof BONES)[number];
export interface RigBone { name: BoneName; parent: BoneName | null; head: V3; tail: V3; radius: number; side: number }
export interface Rig { bones: RigBone[]; H: number; minY: number; cx: number; armDown: [number, number]; foreFwd: [number, number]; thigh: number; shin: number; armsFound: boolean }

type Pred = (x: number, y: number, z: number) => boolean;
function centroid(P: ArrayLike<number>, pred: Pred): V3 | null {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (pred(x, y, z)) { sx += x; sy += y; sz += z; n++; }
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function buildRig(P: ArrayLike<number>): Rig {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const H = maxY - minY;
  if (!(H > 1e-6) || P.length < 300) throw new Error('mesh terlalu kecil untuk auto-rig');
  const cx = (minX + maxX) / 2, czAll = (minZ + maxZ) / 2;
  const Y = (f: number) => minY + f * H;
  const zAt = (f: number) => centroid(P, (x, y) => Math.abs(x - cx) < 0.1 * H && Math.abs(y - Y(f)) < 0.02 * H)?.[2] ?? czAll;

  const bones: RigBone[] = [];
  const add = (name: BoneName, parent: BoneName | null, head: V3, tail: V3, r: number, side = 0) =>
    bones.push({ name, parent, head, tail, radius: r * H, side });

  // ---- tulang belakang ----
  const sp = (f: number): V3 => [cx, Y(f), zAt(f)];
  add('hips', null, sp(0.5), sp(0.565), 0.1);
  add('spine', 'hips', sp(0.565), sp(0.66), 0.095);
  add('chest', 'spine', sp(0.66), sp(0.765), 0.105);
  add('neck', 'chest', sp(0.765), sp(0.83), 0.035);
  add('head', 'neck', sp(0.83), [cx, maxY, zAt(0.92)], 0.065);

  // ---- lengan ----
  const armDown: [number, number] = [0, 0], foreFwd: [number, number] = [0, 0];
  let armsFound = true;
  ([['L', 1], ['R', -1]] as const).forEach(([tag, sgn], k) => {
    const sx = cx + sgn * 0.115 * H;
    const sz = centroid(P, (x, y) => Math.abs(x - sx) < 0.03 * H && Math.abs(y - Y(0.757)) < 0.03 * H)?.[2] ?? zAt(0.74);
    const S: V3 = [sx, Y(0.757), sz];
    const inArm: Pred = (x, y) => sgn * (x - cx) > 0.13 * H && y > Y(0.35) && y < Y(0.86);
    let maxd = 0, cnt = 0;
    for (let i = 0; i < P.length; i += 3) if (inArm(P[i], P[i + 1], P[i + 2])) {
      cnt++; const d = len(sub([P[i], P[i + 1], P[i + 2]], S)); if (d > maxd) maxd = d;
    }
    let E: V3, W: V3, T: V3;
    if (cnt < 80 || maxd < 0.2 * H) { // lengan sudah menggantung / tidak terdeteksi: pakai proporsi standar
      armsFound = false;
      E = [S[0] + sgn * 0.01 * H, S[1] - 0.17 * H, S[2]]; W = [S[0] + sgn * 0.015 * H, S[1] - 0.33 * H, S[2] + 0.01 * H]; T = [W[0], S[1] - 0.43 * H, W[2]];
    } else {
      T = centroid(P, (x, y, z) => inArm(x, y, z) && len(sub([x, y, z], S)) > 0.96 * maxd)!;
      const L = len(sub(T, S)), u = sub(T, S).map((q) => q / L) as V3;
      const seg = (a: number, b: number) => centroid(P, (x, y, z) => { if (!inArm(x, y, z)) return false; const t = dot(sub([x, y, z], S), u) / L; return t >= a && t <= b; });
      E = seg(0.44, 0.54) ?? [S[0] + u[0] * 0.5 * L, S[1] + u[1] * 0.5 * L, S[2] + u[2] * 0.5 * L];
      W = seg(0.8, 0.88) ?? [S[0] + u[0] * 0.84 * L, S[1] + u[1] * 0.84 * L, S[2] + u[2] * 0.84 * L];
    }
    const ua = sub(E, S);
    armDown[k] = Math.atan2(Math.abs(ua[0]), -ua[1]); // sudut lengan atas dari garis lurus ke bawah (bidang XY)
    { // seberapa condong ke depan lengan bawah setelah lengan atas diturunkan (untuk meluruskan tangan yang menjorok)
      const fx = Math.abs(W[0] - E[0]), fy = W[1] - E[1], fz = W[2] - E[2], a = armDown[k];
      const y2 = fx * Math.sin(-a) + fy * Math.cos(-a);
      foreFwd[k] = Math.max(0, Math.min(1.2, Math.atan2(fz, -y2)));
    }
    add(('arm' + tag) as BoneName, 'chest', S, E, 0.032, sgn);
    add(('fore' + tag) as BoneName, ('arm' + tag) as BoneName, E, W, 0.027, sgn);
    add(('hand' + tag) as BoneName, ('fore' + tag) as BoneName, W, T, 0.03, sgn);
  });

  // ---- kaki ----
  let thigh = 0, shin = 0;
  ([['L', 1], ['R', -1]] as const).forEach(([tag, sgn]) => {
    const near = (x: number) => Math.abs(x - cx) < 0.3 * H && sgn * (x - cx) > 0.005 * H;
    const slab = (f: number, w: number) => centroid(P, (x, y) => near(x) && Math.abs(y - Y(f)) < w * H);
    const hip = slab(0.47, 0.02) ?? [cx + sgn * 0.057 * H, Y(0.47), czAll];
    const knee = slab(0.27, 0.02) ?? [hip[0], Y(0.27), hip[2]];
    const ankle = slab(0.065, 0.015) ?? [knee[0], Y(0.065), knee[2]];
    const hipJ: V3 = [hip[0], Y(0.495), hip[2]];
    let tz = -Infinity;
    for (let i = 0; i < P.length; i += 3) if (P[i + 1] < Y(0.06) && near(P[i]) && P[i + 2] > tz) tz = P[i + 2];
    const tx = centroid(P, (x, y, z) => y < Y(0.06) && near(x) && z > tz - 0.02 * H)?.[0] ?? ankle[0];
    const toe: V3 = [tx, Y(0.022), tz - 0.01 * H];
    add(('leg' + tag) as BoneName, 'hips', hipJ, knee, 0.052, sgn);
    add(('shin' + tag) as BoneName, ('leg' + tag) as BoneName, knee, ankle, 0.038, sgn);
    add(('foot' + tag) as BoneName, ('shin' + tag) as BoneName, ankle, toe, 0.035, sgn);
    if (!thigh) { thigh = len(sub(hipJ, knee)); shin = len(sub(knee, ankle)); }
  });

  // urutan harus: induk sebelum anak
  const depth = (n: string | null): number => { if (!n) return 0; const b = bones.find((q) => q.name === n)!; return 1 + depth(b.parent); };
  bones.sort((a, b) => depth(a.name) - depth(b.name));
  return { bones, H, minY, cx, armDown, foreFwd, thigh, shin, armsFound };
}

function segDist(x: number, y: number, z: number, a: V3, b: V3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t), z - (a[2] + abz * t));
}

// Bobot skin: kedekatan ke tiap tulang (dinormalisasi radius), sisi kiri/kanan dipisah, ambil 4 terkuat.
export function skinWeights(P: ArrayLike<number>, rig: Rig): { index: Uint16Array; weight: Float32Array } {
  const n = P.length / 3, nb = rig.bones.length;
  const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
  const w = new Float64Array(nb);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    for (let j = 0; j < nb; j++) {
      const b = rig.bones[j];
      const rn = Math.max(segDist(x, y, z, b.head, b.tail) / b.radius, 0.05);
      let q = 1 / (rn * rn * rn * rn);
      if (b.side !== 0 && b.side * (x - rig.cx) < -0.012 * rig.H) q *= 1e-4;
      w[j] = q;
    }
    const top: number[] = [];
    for (let k = 0; k < 4; k++) {
      let best = -1;
      for (let j = 0; j < nb; j++) if (top.indexOf(j) < 0 && (best < 0 || w[j] > w[best])) best = j;
      top.push(best);
    }
    let s = 0; for (const j of top) s += w[j];
    for (let k = 0; k < 4; k++) { index[i * 4 + k] = top[k]; weight[i * 4 + k] = w[top[k]] / s; }
  }
  return { index, weight };
}
