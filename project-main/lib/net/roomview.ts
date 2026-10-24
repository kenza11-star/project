// Logika murni perakitan snapshot room dari baris tabel (dipakai jalur cadangan server bila fungsi SQL room_state/relay_sync gagal; dites di scripts/test-fallback.js).
// Aturan HARUS sama dengan room_view() di SQL: waiting = online 90 dtk / kursi 300 dtk; playing = online 30 dtk / kursi 120 dtk.
import { ROOM_ONLINE_SECONDS, ROOM_STALE_SECONDS, ROOM_WAITING_ONLINE_SECONDS, ROOM_WAITING_SEAT_SECONDS } from './roomrules';

export interface RoomRow { id: string; code: string; status: 'waiting' | 'playing' | 'closed'; host_id: string; max_players: number; seed: number | string }
export interface MemberRow { user_id: string; slot: number; last_seen: string; left_at: string | null; profiles?: { display_name?: string | null } | { display_name?: string | null }[] | null }

export const onlineSeconds = (status: string) => (status === 'waiting' ? ROOM_WAITING_ONLINE_SECONDS : ROOM_ONLINE_SECONDS);
export const seatSeconds = (status: string) => (status === 'waiting' ? ROOM_WAITING_SEAT_SECONDS : ROOM_STALE_SECONDS);

const nameOf = (p: MemberRow['profiles']) => (Array.isArray(p) ? p[0]?.display_name : p?.display_name) || 'Player';

export function buildView(room: RoomRow, rows: MemberRow[], nowMs: number) {
  const seat = seatSeconds(room.status) * 1000, on = onlineSeconds(room.status) * 1000;
  const members = rows
    .filter((m) => !m.left_at && nowMs - new Date(m.last_seen).getTime() < seat)
    .sort((a, b) => a.slot - b.slot)
    .map((m) => ({ id: String(m.user_id), slot: Number(m.slot), name: nameOf(m.profiles), host: m.user_id === room.host_id, online: nowMs - new Date(m.last_seen).getTime() < on }));
  return { room_id: room.id, code: room.code, status: room.status, host_id: room.host_id, max_players: Number(room.max_players), seed: Number(room.seed), members, active: true };
}

export interface WorldRow { id: number | string; user_id: string; msg: unknown }
/** Mengikuti relay_sync di SQL: since<0 -> ambil ekor 60 id terakhir; kursor maju ke id terbesar yang dikirim, atau ke id terbesar di room bila tidak ada event baru. */
export function pickWorld(rows: WorldRow[], maxId: number, sinceIn: number, selfId: string) {
  let since = Number.isFinite(sinceIn) ? Math.floor(sinceIn) : -1;
  if (since < 0) since = Math.max(0, maxId - 60);
  const mine = rows.filter((r) => Number(r.id) > since && r.user_id !== selfId).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, 100);
  const world = mine.map((r) => ({ id: Number(r.id), from: r.user_id, msg: r.msg }));
  const cursor = world.length ? world[world.length - 1].id : Math.max(since, maxId);
  return { world, cursor, since };
}

// ---- Ringkasan dihitung SERVER (satu sumber kebenaran) ----
export interface ViewMeta { backend: string; build: string; nowMs?: number }
export interface RawView { status: string; members: { online?: boolean }[]; max_players: number; [k: string]: unknown }
/** Menambahkan jumlah pemain aktif, can_start, waktu server, id backend & build ke snapshot (dari RPC SQL, cadangan tabel, maupun relay).
 *  Klien memakai angka ini langsung: host dan joiner membaca nilai YANG SAMA dari room yang sama. */
export function finalizeView<T extends RawView>(v: T, meta: ViewMeta): T & { online_count: number; member_count: number; can_start: boolean; server_time: string; backend: string; build: string } {
  const members = Array.isArray(v.members) ? v.members : [];
  const online = members.filter((m) => m && m.online === true).length;
  return { ...v, members, online_count: online, member_count: members.length, can_start: v.status === 'waiting' && online >= 2, server_time: new Date(meta.nowMs ?? Date.now()).toISOString(), backend: meta.backend, build: meta.build };
}
