// HANYA SERVER. Pemanggilan fungsi SQL room (SECURITY DEFINER, hanya service_role) + pemetaan error ke kode API.
import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { HttpError } from './http';
import type { RoomErrorCode } from '@/lib/net/roomrules';

const STATUS: Partial<Record<RoomErrorCode, number>> = { room_not_found: 404, room_full: 409, room_closed: 410, not_host: 403, not_member: 403, invalid: 400 };
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
export const roomOut = (r: RoomInfo) => ({ roomId: r.room_id, code: r.code, seed: Number(r.seed), maxPlayers: r.max_players, status: r.status, slot: r.slot, hostId: r.host_id });
