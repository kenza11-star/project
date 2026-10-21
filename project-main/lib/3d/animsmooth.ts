// Penghalusan gerak karakter (logika murni, tanpa three/react; dites di scripts/test-animsmooth.js).
//
// Masalah yang diselesaikan (TAHAP 5):
//  - pemain remote: posisi/arah datang ~10 Hz dengan jitter -> diikuti oleh "pengikut" (low-pass bebas-frame-rate) lalu kecepatan DIUKUR
//    dari gerak yang benar-benar digambar, bukan dari selisih antar paket. Siklus langkah mengikuti JARAK tempuh, jadi kaki tidak meluncur.
//  - arah badan: mengikuti arah gerak (bukan arah kamera mentah), berputar di tempat hanya bila menoleh jauh (deadzone), kepala menoleh ke arah bidik.
//  - semua pelunakan memakai damp() = 1 - exp(-k*dt): hasil sama di 30/60/120 FPS (rumus lama min(1, dt*k) bergantung frame rate).

export const TAU = Math.PI * 2;
/** Bungkus sudut ke (-PI, PI]. */
export const wrapAngle = (a: number): number => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Faktor interpolasi bebas-frame-rate: nilai += (target - nilai) * damp(k, dt). k = 1/detik (makin besar makin cepat). */
export const damp = (k: number, dt: number): number => 1 - Math.exp(-Math.max(0, k) * Math.max(0, dt));
/** Sudut menuju target secara eksponensial, dengan batas kecepatan putar (rad/dtk) opsional. */
export function dampAngle(cur: number, target: number, k: number, dt: number, maxRate = 1e9): number {
  let d = wrapAngle(target - cur) * damp(k, dt);
  const lim = maxRate * Math.max(0, dt);
  if (d > lim) d = lim; else if (d < -lim) d = -lim;
  return cur + d;
}

export interface FollowOpts {
  posK: number;      // kekakuan pengikut posisi horizontal (1/dtk). Makin besar makin dekat ke target, makin kecil makin halus
  yK: number;        // idem untuk tinggi (tangga)
  velK: number;      // penghalus kecepatan terukur
  snapDist: number;  // target lebih jauh dari ini dalam satu langkah = teleport/respawn -> langsung pindah, tanpa meluncur
  faceOn: number;    // kecepatan (m/dtk) mulai menghadap arah gerak
  faceOff: number;   // kecepatan berhenti menghadap arah gerak (histeresis)
  idleDead: number;  // selisih arah bidik-badan (rad) yang memicu putar di tempat
  maxLook: number;   // batas tengok kepala dari badan (rad)
}
export const DEFAULT_FOLLOW: FollowOpts = { posK: 16, yK: 14, velK: 9, snapDist: 3, faceOn: 0.55, faceOff: 0.3, idleDead: 0.75, maxLook: 1.1 };

export interface FollowOut {
  x: number; y: number; z: number; yaw: number;
  speed: number;     // m/dtk, terukur dari gerak yang digambar (sudah dihaluskan)
  dist: number;      // jarak horizontal yang ditempuh pada langkah ini (m) -> memajukan fase langkah
  turn: number;      // kecepatan putar badan (rad/dtk), dihaluskan
  look: number;      // tengok kepala relatif badan (rad)
  snapped: boolean;
}

/**
 * Pengikut pemain remote. Input tiap frame: target posisi (sudah diinterpolasi jaringan), arah bidik (yaw dunia untuk model).
 * Output: pose digambar yang halus + kecepatan/jarak/putaran terukur. Tidak bergantung pada three.
 */
export class PuppetFollower {
  x = 0; y = 0; z = 0; yaw = 0;
  started = false;
  private vx = 0; private vz = 0; private tw = 0; private lk = 0;
  private faceMove = false; private turning = false;
  readonly out: FollowOut = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, dist: 0, turn: 0, look: 0, snapped: false };
  readonly o: FollowOpts;
  constructor(opt: Partial<FollowOpts> = {}) { this.o = { ...DEFAULT_FOLLOW, ...opt }; }

  reset() { this.started = false; this.vx = this.vz = this.tw = this.lk = 0; this.faceMove = this.turning = false; }

  snap(x: number, y: number, z: number, yaw: number) {
    this.x = x; this.y = y; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.tw = this.lk = 0; this.faceMove = this.turning = false; this.started = true;
    return this.fill(0, true);
  }

  private fill(dist: number, snapped: boolean): FollowOut {
    const o = this.out;
    o.x = this.x; o.y = this.y; o.z = this.z; o.yaw = this.yaw; o.speed = Math.hypot(this.vx, this.vz);
    o.dist = dist; o.turn = this.tw; o.look = this.lk; o.snapped = snapped;
    return o;
  }

  step(dt: number, tx: number, ty: number, tz: number, lookYaw: number): FollowOut {
    if (!this.started) return this.snap(tx, ty, tz, lookYaw);
    dt = clamp(dt, 0, 0.25);
    if (dt < 1e-4) return this.fill(0, false); // frame ganda / dt nol: jangan bagi dengan nol, pose tetap
    if (!Number.isFinite(tx + ty + tz + lookYaw)) return this.fill(0, false);
    if (Math.hypot(tx - this.x, tz - this.z) > this.o.snapDist) return this.snap(tx, ty, tz, lookYaw);
    const ox = this.x, oz = this.z, oyaw = this.yaw, a = damp(this.o.posK, dt);
    this.x += (tx - this.x) * a; this.z += (tz - this.z) * a;
    this.y += (ty - this.y) * damp(this.o.yK, dt);
    const mx = this.x - ox, mz = this.z - oz, dist = Math.hypot(mx, mz), kv = damp(this.o.velK, dt);
    this.vx += (mx / dt - this.vx) * kv; this.vz += (mz / dt - this.vz) * kv;
    const sp = Math.hypot(this.vx, this.vz);
    this.faceMove = this.faceMove ? sp > this.o.faceOff : sp > this.o.faceOn;
    if (this.faceMove) {
      this.turning = false;
      this.yaw = dampAngle(this.yaw, Math.atan2(this.vx, this.vz), 10, dt, 9);   // badan menghadap arah jalan (tanpa animasi strafe/mundur, kaki tidak meluncur menyamping)
    } else {
      const diff = wrapAngle(lookYaw - this.yaw);
      if (!this.turning && Math.abs(diff) > this.o.idleDead) this.turning = true;
      else if (this.turning && Math.abs(diff) < 0.1) this.turning = false;
      if (this.turning) this.yaw = dampAngle(this.yaw, lookYaw, 6, dt, 5);     // putar di tempat hanya bila menoleh jauh
    }
    this.tw += (wrapAngle(this.yaw - oyaw) / dt - this.tw) * damp(10, dt);
    if (!this.turning && !this.faceMove) this.tw *= 1 - damp(12, dt);          // diam & tidak berputar: bleed ke nol, tanpa gemetar
    const want = clamp(wrapAngle(lookYaw - this.yaw), -this.o.maxLook, this.o.maxLook);
    this.lk += (want - this.lk) * damp(12, dt);
    return this.fill(dist, false);
  }
}
