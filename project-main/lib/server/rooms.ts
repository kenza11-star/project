// HANYA SERVER. Pemanggilan fungsi SQL room (SECURITY DEFINER, hanya service_role) + pemetaan error ke kode API.
import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { HttpError, diagOf } from './http';
import { createHash } from 'crypto';
import type { RoomErrorCode } from '@/lib/net/roomrules';
import { finalizeView, type RawView } from '@/lib/net/roomview';
import { serverEnv } from './env';

const STATUS: Partial<Record<RoomErrorCode, number>> = { room_not_found: 404, room_full: 409, room_closed: 410, room_started: 409, not_host: 403, not_member: 403, not_ready: 409, not_friend: 403, invite_gone: 410, rate_limited: 429, invalid: 400 };
const KNOWN = new Set(Object.keys(STATUS));

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) {
    const msg = (error.message || '').trim();
    if (KNOWN.has(msg)) throw new HttpError(STATUS[msg as RoomErrorCode]!, msg as RoomErrorCode);
    const e = new Error(`rpc ${fn}: ${error.code ?? ''} ${msg}`) as Error & { code?: string };
    e.code = error.code; throw e;
  }
  return data as T;
}
export interface RoomInfo { room_id: string; code: string; seed: number; max_players: number; status: 'waiting' | 'playing' | 'closed'; slot: number; host_id: string }
/** Sidik jari backend (hash host URL Supabase; BUKAN rahasia, tidak bisa dibalik). Dua deployment Vercel yang memakai database sama menghasilkan nilai sama. */
export const backendId = () => createHash('sha256').update(serverEnv().supabaseUrl.replace(/\/+$/, '').toLowerCase()).digest('hex').slice(0, 8);
/** Id build deployment ini (commit Vercel). Dua HP yang memakai build berbeda = salah satunya membuka deployment lama. */
export const buildId = () => (process.env.NEXT_PUBLIC_BUILD_ID || 'dev').slice(0, 12);
export const roomOut = (r: RoomInfo) => ({ roomId: r.room_id, code: r.code, seed: Number(r.seed), maxPlayers: r.max_players, status: r.status, slot: r.slot, hostId: r.host_id, backend: backendId() });
/** Snapshot room final untuk klien: jumlah pemain aktif, can_start, waktu server, backend & build dihitung di SERVER. */
export const finalView = <T extends RawView>(v: T) => finalizeView(v, { backend: backendId(), build: buildId() });

// Log diagnostik (hanya server; tanpa token/kunci). UID dipendekkan. Log 'state' hanya saat jumlah online berubah supaya tidak membanjiri.
const short = (u: string) => (u.length > 8 ? u.slice(0, 4) + '…' + u.slice(-3) : u);
const lastOnline = new Map<string, number>();
export function roomLog(op: string, f: { uid?: string; roomId?: string; code?: string; online?: number; members?: number; status?: string; via?: string; result?: string }) {
  try { console.info('[room]', JSON.stringify({ op, ...f, uid: f.uid ? short(f.uid) : undefined, backend: backendId(), build: buildId(), t: new Date().toISOString() })); } catch { /* log tidak boleh menggagalkan request */ }
}
export function logStateChange(uid: string, v: { room_id?: string; code?: string; online_count: number; member_count: number; status: string; via?: string }) {
  const k = String(v.room_id), prev = lastOnline.get(k);
  if (prev === v.online_count) return;
  lastOnline.set(k, v.online_count); if (lastOnline.size > 500) lastOnline.delete(lastOnline.keys().next().value as string);
  roomLog('state', { uid, roomId: v.room_id, code: v.code, online: v.online_count, members: v.member_count, status: v.status, via: v.via });
}

/** Jalur utama (fungsi SQL) dulu; bila gagal karena galat TAK TERDUGA (bukan jawaban sah seperti not_member), pakai jalur cadangan tabel.
 *  Bila cadangan juga gagal: lempar galat ASLI (supaya diagnosisnya menunjuk penyebab sebenarnya). */
export async function withFallback<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await primary(); }
  catch (e) {
    if (e instanceof HttpError) throw e; // jawaban sah dari SQL (not_member, room_closed...) atau 503 not_configured
    console.error(`[rooms] ${label}: fungsi SQL gagal, memakai cadangan tabel:`, diagOf(e));
    try { return await fallback(); }
    catch (e2) { if (e2 instanceof HttpError) throw e2; console.error(`[rooms] ${label}: cadangan juga gagal:`, diagOf(e2)); throw e; }
  }
}
