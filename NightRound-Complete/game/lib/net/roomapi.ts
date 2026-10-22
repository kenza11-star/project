// KLIEN (browser). Pemanggil API room di Vercel. Semua memakai ID token Firebase; server yang memverifikasi & memutuskan.
import { currentIdToken } from '@/lib/auth/firebaseClient';
import { ROOM_ERROR_TEXT, type RoomErrorCode } from './roomrules';
import type { RoomSession, RoomStateView } from './roomtypes';
import type { LockerReply, LockerRequest } from './lockers';
export type { RoomSession, RoomStateView, RoomMemberView } from './roomtypes';

export class RoomApiError extends Error { constructor(public code: RoomErrorCode, message?: string, public status = 0, public detail = '') { super(message || ROOM_ERROR_TEXT[code]); } }

/** Batasi waktu tunggu sebuah promise. Di HP, token Firebase / fetch yang tertahan saat app di latar belakang bisa MENGGANTUNG selamanya. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let h: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<typeof TIMED_OUT>((r) => { h = setTimeout(() => r(TIMED_OUT), ms); })]).finally(() => clearTimeout(h));
}
const TIMED_OUT = Symbol('timeout');
const NET_ERR = 'Tidak bisa menghubungi server. Periksa koneksi.';

export async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, base = ''): Promise<T> {
  // Mengambil token juga diberi batas waktu (sebelumnya tidak): bila macet, seluruh polling ruang tunggu ikut macet diam-diam.
  const getToken = async (force = false) => { const t = await withTimeout(currentIdToken(force), 8_000); return t === TIMED_OUT ? null : t; };
  let token = await getToken();
  if (!token) throw new RoomApiError('unauthorized');
  // Timeout 10 dtk untuk request itu sendiri. cache: 'no-store' + header: jangan pernah memakai salinan lama (daftar pemain harus selalu segar).
  const send = (t: string) => {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 10_000);
    return fetch(base + path, { method, signal: ac.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body === undefined ? undefined : JSON.stringify(body) }).finally(() => clearTimeout(timer));
  };
  let res: Response;
  try { res = await send(token); } catch { throw new RoomApiError('server', NET_ERR); }
  if (res.status === 401) { token = await getToken(true); if (token) { try { res = await send(token); } catch { throw new RoomApiError('server', NET_ERR); } } }
  let j: any = null;
  try { j = await res.json(); } catch { j = null; }
  if (!res.ok) {
    const c = (j?.error?.code as RoomErrorCode) in ROOM_ERROR_TEXT ? (j.error.code as RoomErrorCode) : 'server';
    const detail = typeof j?.error?.detail === 'string' ? j.error.detail.slice(0, 120) : '';
    // Galat server dilengkapi kode HTTP + penyebab singkat dari server (mis. "PGRST202 function ... not found"): tidak lagi hanya "kesalahan di server".
    const base = j?.error?.message || ROOM_ERROR_TEXT[c];
    const msg = c === 'server' ? `${base} [HTTP ${res.status}${detail ? ' · ' + detail : ''}]` : base;
    throw new RoomApiError(c, msg, res.status, detail);
  }
  return j as T;
}

// ---- Failover: server utama (Vercel + Supabase) -> relay cadangan di blitz.cloud (NEXT_PUBLIC_RELAY_URL; kosong = tidak dipakai) ----
// Aturan: room yang dibuat/diikuti di server utama TETAP di server utama (tidak pindah di tengah jalan -> tidak ada split-brain). Room baru dibuat di relay
// hanya bila server utama gagal (galat server / jaringan). Gabung dengan kode: coba utama dulu, lalu relay bila "room tidak ditemukan" atau utama gagal.
const RELAY = (process.env.NEXT_PUBLIC_RELAY_URL || '').trim().replace(/\/+$/, '');
export const relayConfigured = () => !!RELAY;
type Backend = 'main' | 'relay';
const backendOf = new Map<string, Backend>();
const baseFor = (roomId: string) => (backendOf.get(roomId) === 'relay' ? RELAY : '');
const isServerFail = (e: unknown) => e instanceof RoomApiError && e.code === 'server';
const tag = (r: RoomSession, b: Backend): RoomSession => { backendOf.set(r.roomId, b); return { ...r, via: b }; };

export async function createRoom(maxPlayers: number): Promise<RoomSession> {
  try { return tag(await call<RoomSession>('/api/rooms', 'POST', { maxPlayers }), 'main'); }
  catch (e) {
    if (!RELAY || !isServerFail(e)) throw e;
    try { return tag(await call<RoomSession>('/api/rooms', 'POST', { maxPlayers }, RELAY), 'relay'); } catch { throw e; }
  }
}
export async function joinRoom(code: string): Promise<RoomSession> {
  let first: unknown;
  try { return tag(await call<RoomSession>('/api/rooms/join', 'POST', { code }), 'main'); }
  catch (e) {
    first = e;
    if (!RELAY || !(isServerFail(e) || (e instanceof RoomApiError && e.code === 'room_not_found'))) throw e;
  }
  try { return tag(await call<RoomSession>('/api/rooms/join', 'POST', { code }, RELAY), 'relay'); }
  catch (e2) {
    // Utama gagal + relay bilang tidak ada -> galat utama yang informatif. Utama bilang tidak ada + relay gagal -> "tidak ditemukan".
    if (isServerFail(first) && e2 instanceof RoomApiError && e2.code === 'room_not_found') throw first;
    if (first instanceof RoomApiError && first.code === 'room_not_found') throw first;
    throw e2;
  }
}
export const leaveRoom = (roomId: string) => call<{ left: boolean }>('/api/rooms/leave', 'POST', { roomId }, baseFor(roomId));
export const heartbeat = (roomId: string) => call<{ active: boolean }>('/api/rooms/heartbeat', 'POST', { roomId }, baseFor(roomId));
export const startRoom = (roomId: string) => call<{ status: string }>('/api/rooms/start', 'POST', { roomId }, baseFor(roomId));
export const saveDisplayName = (displayName: string) => call<{ displayName: string }>('/api/profile', 'PATCH', { displayName });

/** Tutup halaman: beri tahu server bahwa kita keluar (keepalive supaya tetap terkirim). Best-effort; heartbeat basi juga melepas slot dalam 120 dtk. */
export async function leaveRoomOnUnload(roomId: string) {
  try {
    const t = await currentIdToken(); if (!t) return;
    void fetch(baseFor(roomId) + '/api/rooms/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ roomId }) });
  } catch { /* abaikan */ }
}

// ---- v2: state room dari server, relai gameplay, undangan ----
export interface SyncRequest { roomId: string; state?: object | null; world?: object[]; since: number; need: boolean }
export interface SyncResponse extends RoomStateView { states: Record<string, unknown>; world: { id: number; from: string; msg: unknown }[]; cursor: number; need_relay: boolean; lockers?: Record<string, string> }

export const fetchRoomState = (roomId: string) => call<RoomStateView>('/api/rooms/state?roomId=' + encodeURIComponent(roomId) + '&_=' + Date.now(), 'GET', undefined, baseFor(roomId)); // `_` = pemecah cache (proxy/browser HP yang agresif)
export const syncRoom = (req: SyncRequest) => call<SyncResponse>('/api/rooms/sync', 'POST', req, baseFor(req.roomId));

/** Operasi loker/lemari ke server (otoritatif). Room di relay memakai relay yang sama dengan room-nya (tidak pernah pindah backend di tengah jalan). */
export const lockerCall = (roomId: string, req: LockerRequest) => call<LockerReply>('/api/rooms/locker', 'POST', { roomId, ...req }, baseFor(roomId));
