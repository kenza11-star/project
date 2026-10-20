// KLIEN (browser). Anggota room dibaca lewat Supabase + RLS (hanya anggota room yang bisa membaca). Dipakai ruang tunggu & transport.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeName, type MemberInfo } from './protocol';
import { ROOM_STALE_SECONDS } from './roomrules';

export interface RoomSnapshot { status: 'waiting' | 'playing' | 'closed'; hostId: string; members: (MemberInfo & { host: boolean })[] }

export async function fetchRoomSnapshot(sb: SupabaseClient, roomId: string): Promise<RoomSnapshot | null> {
  const [r, m] = await Promise.all([
    sb.from('rooms').select('status,host_id').eq('id', roomId).maybeSingle(),
    sb.from('room_members').select('user_id,slot,last_seen,left_at,profiles(display_name)').eq('room_id', roomId),
  ]);
  if (r.error || m.error || !r.data) return null; // bukan anggota (RLS) / room tidak ada
  const cutoff = Date.now() - ROOM_STALE_SECONDS * 1000;
  const members = (m.data || [])
    .filter((x: any) => !x.left_at && new Date(x.last_seen).getTime() >= cutoff)
    .map((x: any) => ({ id: String(x.user_id), slot: Number(x.slot), name: sanitizeName(Array.isArray(x.profiles) ? x.profiles[0]?.display_name : x.profiles?.display_name), host: x.user_id === r.data!.host_id }))
    .sort((a, b) => a.slot - b.slot);
  return { status: r.data.status, hostId: r.data.host_id, members };
}
