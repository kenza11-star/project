// Protokol sinkronisasi monster (murni, tanpa three/DOM). Dikirim lewat transport room yang sudah ada (Supabase Realtime broadcast);
// TIDAK ada perubahan API route / skema database / env. Otoritas = pemain online dengan slot terendah (bukan server): hanya otoritas
// yang menjalankan AI & memvalidasi tangkapan; klien lain hanya menerima snapshot dan menginterpolasi.
import { MON_STATES, type MonAnim, type MonState } from './monster';

export interface MonSnapMsg { v: 1; t: 'm'; e: number; s: number; x: number; z: number; yw: number; st: number; tg: string; sp: number; wp: number; lv?: number; os?: number }
/** dg = 1: tangkapan ini akan diikuti seretan (TAHAP 2); pesan versi lama tanpa field ini = tanpa seretan. */
/** cx/cz/cl (TAHAP 4, opsional): lokasi kejadian (posisi monster saat menangkap + lantai) supaya semua klien memutar suara di titik yang SAMA; pesan lama tanpa field ini tetap valid. */
export interface MonCatchMsg { v: 1; t: 'mc'; e: number; s: number; id: string; dg?: 0 | 1; cx?: number; cz?: number; cl?: number; sl?: number }   // sl = slot penjara untuk korban (STAGE 2), dipilih otoritas
/** Kejadian tangkapan yang sudah lolos validasi/dedupe, diteruskan ke lapisan audio. x/z = NaN bila lokasi tidak diketahui (pesan lama & monster belum terlihat). */
export interface CatchInfo { key: string; id: string; x: number; z: number; level: number; drag: boolean }
export type MonMsg = MonSnapMsg | MonCatchMsg;

/** Sama dengan lib/net/monsterproto.ts (disalin agar lib/game & lib/net tetap bisa dikompilasi terpisah; test memastikan keduanya konsisten). */
export const isMonsterMsg = (raw: unknown): boolean => { const t = (raw as { t?: unknown } | null)?.t; return t === 'm' || t === 'mc'; };
const fin = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
/** Validasi ketat pesan masuk (tak dipercaya): bentuk, tipe, batas nilai, panjang string. */
export function sanitizeMonsterMsg(raw: unknown): MonMsg | null {
  if (!raw || typeof raw !== 'object') return null; const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !int(r.e, 1e9) || !int(r.s, 2147483647)) return null;
  if (r.t === 'm') {
    if (!fin(r.x, 500) || !fin(r.z, 500) || !fin(r.yw, 20) || !int(r.st, MON_STATES.length - 1) || typeof r.tg !== 'string' || r.tg.length > 64 || !fin(r.sp, 20) || !int(r.wp, 64)) return null;
    const lv = r.lv === undefined ? 1 : r.lv, os = r.os === undefined ? 0 : r.os;   // lantai & status di tangga (pesan versi lama tanpa field ini = lantai atas)
    if (!int(lv, 1) || !int(os, 1)) return null;
    return { v: 1, t: 'm', e: r.e, s: r.s, x: r.x, z: r.z, yw: r.yw, st: r.st, tg: r.tg, sp: r.sp, wp: r.wp, lv, os };
  }
  if (r.t === 'mc') {
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
    const out: MonCatchMsg = { v: 1, t: 'mc', e: r.e, s: r.s, id: r.id, dg: r.dg === 1 ? 1 : 0 };
    if (r.cx !== undefined || r.cz !== undefined || r.cl !== undefined) { if (!fin(r.cx, 500) || !fin(r.cz, 500) || !int(r.cl, 1)) return null; out.cx = r.cx; out.cz = r.cz; out.cl = r.cl; }   // lokasi: semua-atau-tidak-sama-sekali, batas ketat
    if (r.sl !== undefined) { if (!int(r.sl, 15)) return null; out.sl = r.sl; }
    return out;
  }
  return null;
}
export interface PeerInfo { id: string; slot: number; online: boolean }
/** Otoritas = pemain online dengan slot terendah (termasuk diri sendiri); seri -> id terkecil. Konsisten di semua klien yang rostrnya sama. */
export function electAuthority(selfId: string, selfSlot: number, peers: readonly PeerInfo[]): string {
  let best = { id: selfId, slot: selfSlot };
  for (const p of peers) if (p.online && (p.slot < best.slot || (p.slot === best.slot && p.id < best.id))) best = { id: p.id, slot: p.slot };
  return best.id;
}
export interface MonSample { x: number; z: number; yaw: number; state: MonState; targetId: string; speed: number; anim: MonAnim; stale: boolean; epoch: number; level: number; onStairs: boolean }
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
/** Replika di klien non-otoritas: menerima snapshot (monoton per epoch/seq), interpolasi 120 ms di belakang, ekstrapolasi maks 250 ms. */
export class MonsterReplica {
  epoch = 0; seq = -1; lastRecv = -1e9; private buf: { t: number; m: MonSnapMsg }[] = [];
  /** true bila snapshot dipakai (lebih baru). */
  push(m: MonSnapMsg, nowMs: number): boolean {
    if (m.e < this.epoch || (m.e === this.epoch && m.s <= this.seq)) return false;
    if (m.e > this.epoch) this.buf.length = 0;
    this.epoch = m.e; this.seq = m.s; this.lastRecv = nowMs; this.buf.push({ t: nowMs, m }); if (this.buf.length > 12) this.buf.shift(); return true;
  }
  sample(nowMs: number): MonSample | null {
    const b = this.buf; if (!b.length) return null; const rt = nowMs - 120; let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
    const last = b[b.length - 1]; let x: number, z: number, yaw: number, m = last.m;
    if (rt >= last.t) { const dt = Math.min((rt - last.t) / 1000, 0.25), sp = last.m.sp, vx = Math.sin(last.m.yw) * sp, vz = Math.cos(last.m.yw) * sp; const mv = last.m.st === 5 ? 0 : 1; x = last.m.x + vx * dt * mv; z = last.m.z + vz * dt * mv; yaw = last.m.yw; }
    else if (rt <= b[0].t) { x = b[0].m.x; z = b[0].m.z; yaw = b[0].m.yw; m = b[0].m; }
    else { const k = (rt - a.t) / Math.max(1, c.t - a.t); x = a.m.x + (c.m.x - a.m.x) * k; z = a.m.z + (c.m.z - a.m.z) * k; yaw = a.m.yw + wrapPi(c.m.yw - a.m.yw) * k; m = k < 0.5 ? a.m : c.m; }
    const st = MON_STATES[m.st], sp = m.sp;
    return { x, z, yaw, state: st, targetId: m.tg, speed: sp, anim: st === 'catch' ? 'grab' : st === 'drag' ? 'drag' : sp > 2.4 ? 'run' : sp > 0.3 ? 'walk' : 'idle', stale: nowMs - this.lastRecv > 3000, epoch: this.epoch, level: m.lv ?? 1, onStairs: (m.os ?? 0) === 1 };
  }
}
/** Mencegah tangkapan ganda dari pesan duplikat (pengiriman ulang) -> jumpscare hanya sekali per kejadian. */
export class CatchLedger {
  private seen = new Map<string, number>();
  /** true bila pesan ini baru (belum pernah diproses). */
  accept(m: MonCatchMsg, nowMs: number): boolean {
    for (const [k, t] of this.seen) if (nowMs - t > 30000) this.seen.delete(k);
    const key = m.e + ':' + m.s + ':' + m.id; if (this.seen.has(key)) return false; this.seen.set(key, nowMs); return true;
  }
}
/** Pembatas laju pesan masuk per pengirim (anti-banjir). */
export class RateLimit {
  private b = new Map<string, { t: number; n: number }>();
  constructor(private max = 40, private windowMs = 1000) {}
  allow(id: string, nowMs: number): boolean { const e = this.b.get(id); if (!e || nowMs - e.t > this.windowMs) { this.b.set(id, { t: nowMs, n: 1 }); return true; } return ++e.n <= this.max; }
}
