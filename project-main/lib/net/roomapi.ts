// KLIEN (browser). Pemanggil API room di Vercel. Semua memakai ID token Firebase; server yang memverifikasi & memutuskan.
import { currentIdToken } from '@/lib/auth/firebaseClient';
import { ROOM_ERROR_TEXT, type RoomErrorCode } from './roomrules';

export interface RoomSession { roomId: string; code: string; seed: number; maxPlayers: number; status: 'waiting' | 'playing' | 'closed'; slot: number; hostId: string }
export class RoomApiError extends Error { constructor(public code: RoomErrorCode, message?: string) { super(message || ROOM_ERROR_TEXT[code]); } }

export async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<T> {
  let token = await currentIdToken();
  if (!token) throw new RoomApiError('unauthorized');
  const send = (t: string) => fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body === undefined ? undefined : JSON.stringify(body) });
  let res: Response;
  try { res = await send(token); } catch { throw new RoomApiError('server', 'Tidak bisa menghubungi server. Periksa koneksi.'); }
  if (res.status === 401) { token = await currentIdToken(true); if (token) { try { res = await send(token); } catch { throw new RoomApiError('server', 'Tidak bisa menghubungi server. Periksa koneksi.'); } } }
  const j = await res.json().catch(() => null);
  if (!res.ok) { const c = (j?.error?.code as RoomErrorCode) in ROOM_ERROR_TEXT ? (j.error.code as RoomErrorCode) : 'server'; throw new RoomApiError(c, j?.error?.message); }
  return j as T;
}

export const createRoom = (maxPlayers: number) => call<RoomSession>('/api/rooms', 'POST', { maxPlayers });
export const joinRoom = (code: string) => call<RoomSession>('/api/rooms/join', 'POST', { code });
export const leaveRoom = (roomId: string) => call<{ left: boolean }>('/api/rooms/leave', 'POST', { roomId });
export const heartbeat = (roomId: string) => call<{ active: boolean }>('/api/rooms/heartbeat', 'POST', { roomId });
export const startRoom = (roomId: string) => call<{ status: string }>('/api/rooms/start', 'POST', { roomId });
export const saveDisplayName = (displayName: string) => call<{ displayName: string }>('/api/profile', 'PATCH', { displayName });

/** Tutup halaman: beri tahu server bahwa kita keluar (keepalive supaya tetap terkirim). Best-effort; heartbeat basi juga melepas slot dalam 120 dtk. */
export async function leaveRoomOnUnload(roomId: string) {
  try {
    const t = await currentIdToken(); if (!t) return;
    void fetch('/api/rooms/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ roomId }) });
  } catch { /* abaikan */ }
}
