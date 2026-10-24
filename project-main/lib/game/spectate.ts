// STAGE 4 -- kamera penonton untuk pemain 'bound' (online). Logika murni (tanpa three/react; dites di scripts/test-spectate.js).
// Penonton hanya mengikuti rekan berstatus 'play' (online, tidak tertangkap/bound/lolos). Tanpa rekan = tetap di kamera penjara.

export type SpecMode = 'third' | 'first';
export interface SpecState { x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean; cg?: boolean; bd?: number; es?: boolean; level: number }
export interface SpecView { id: string; name: string; slot: number; stale: boolean; state: SpecState }
export interface SpecPose { x: number; y: number; z: number; yaw: number; pitch: number }

export const EYE_STAND = 1.65, EYE_DUCK = 1.0;   // sama dengan EYE / EYE_CROUCH di PlayScene

/** Rekan yang boleh ditonton: online, belum tertangkap (cg), tidak digantung (bd), belum lolos (es). */
export const specEligible = (v: SpecView): boolean => !v.stale && !v.state.cg && v.state.bd === undefined && !v.state.es;

/** Id rekan yang bisa ditonton, urut slot (lalu id) supaya L/R konsisten di semua klien. */
export function specIds(views: SpecView[]): string[] {
  return views.filter(specEligible).sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((v) => v.id);
}

/** Pilih target: pertahankan `cur` bila masih valid; kalau tidak, ambil yang berikutnya dari posisi lama (`order` = urutan sebelumnya) atau yang pertama. '' = tidak ada. */
export function specPick(ids: string[], cur: string, order: string[] = []): string {
  if (!ids.length) return '';
  if (ids.includes(cur)) return cur;
  const at = order.indexOf(cur);
  if (at >= 0) for (let i = 1; i <= order.length; i++) { const c = order[(at + i) % order.length]; if (ids.includes(c)) return c; }
  return ids[0];
}

/** Geser target ke kiri (-1) / kanan (+1), melingkar. */
export function specCycle(ids: string[], cur: string, dir: 1 | -1): string {
  if (!ids.length) return '';
  const i = ids.indexOf(cur);
  if (i < 0) return ids[dir > 0 ? 0 : ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

export const wrapAngle = (a: number): number => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Pose kepala/mata rekan (sumber kamera orang pertama dan titik asal raycast anti-tembus). */
export const specHead = (s: SpecState): SpecPose => ({ x: s.x, y: s.y + (s.crouch ? EYE_DUCK : EYE_STAND), z: s.z, yaw: s.yaw, pitch: s.pitch });

/** Arah dari kepala ke kamera orang ketiga (ternormalisasi: di belakang rekan, sedikit naik) dan panjang penuhnya. */
export function specDir(head: SpecPose, dist: number, up: number): { x: number; y: number; z: number; len: number } {
  const fx = -Math.sin(head.yaw), fz = -Math.cos(head.yaw);             // arah depan rekan (kamera menghadap -Z saat yaw 0)
  const len = Math.hypot(dist, up) || 1;
  return { x: (-fx * dist) / len, y: up / len, z: (-fz * dist) / len, len };
}

/**
 * Pose kamera untuk jarak `d` dari kepala (0 = orang pertama persis di mata rekan; len penuh = orang ketiga).
 * Arah pandang dan sudut miring ikut berpindah mulus antara dua mode sesuai d/len.
 */
export function specCamPose(head: SpecPose, d: number, dist: number, up: number): SpecPose {
  const o = specDir(head, dist, up), f = Math.max(0, Math.min(1, d / o.len));
  const p3 = Math.max(-0.5, Math.min(0.5, head.pitch * 0.7)) - Math.atan2(up, dist) * 0.8;   // orang ketiga: ikut mendongak rekan, sedikit menunduk ke kepala
  return { x: head.x + o.x * d, y: head.y + o.y * d, z: head.z + o.z * d, yaw: head.yaw, pitch: head.pitch + (p3 - head.pitch) * f };
}

/** Anti-tembus: tarik kamera maju bila `hitDist` (jarak head -> penghalang, null = bebas) lebih pendek dari `len`. Hasil di antara [minDist, len]. */
export function clipDist(len: number, hitDist: number | null, pad: number, minDist: number): number {
  if (hitDist === null || hitDist >= len + pad) return len;
  return Math.max(Math.min(minDist, len), Math.min(len, hitDist - pad));
}

/** Haluskan pose (eksponensial, bebas frame rate). */
export function smoothPose(cur: SpecPose, tgt: SpecPose, dt: number, rate: number): SpecPose {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return { x: cur.x + (tgt.x - cur.x) * k, y: cur.y + (tgt.y - cur.y) * k, z: cur.z + (tgt.z - cur.z) * k, yaw: cur.yaw + wrapAngle(tgt.yaw - cur.yaw) * k, pitch: cur.pitch + (tgt.pitch - cur.pitch) * k };
}

export const poseDist = (a: SpecPose, b: SpecPose): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Cooldown berbasis jam yang disuntik (detik). */
export class Cooldown {
  private until = 0;
  constructor(private secs: number) {}
  ready(now: number): boolean { return now >= this.until; }
  left(now: number): number { return Math.max(0, this.until - now); }
  fire(now: number): boolean { if (now < this.until) return false; this.until = now + this.secs; return true; }
  reset() { this.until = 0; }
}
