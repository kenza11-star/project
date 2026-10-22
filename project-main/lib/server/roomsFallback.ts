// HANYA SERVER. JALUR CADANGAN room: bila fungsi SQL (room_state / heartbeat_room / relay_sync) gagal karena sebab apa pun
// (migrasi belum dijalankan, fungsi rusak/ganda, galat internal), server membaca/menulis TABEL langsung lewat service_role.
// Hasilnya berbentuk sama dengan fungsi SQL, jadi klien tidak tahu bedanya. Peran/keanggotaan tetap diperiksa di sini.
import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { HttpError, diagOf } from './http';
import { buildView, pickWorld, type MemberRow, type RoomRow } from '@/lib/net/roomview';
import { LockerError, type LockerAction, type LockerReply } from '@/lib/net/lockers';
import { lockerOpViaTables, readLockersViaTables } from '@/lib/net/lockersTables';

const iso = (ms: number) => new Date(ms).toISOString();
const fail = (what: string, e: unknown): never => { throw new Error(`fallback ${what}: ${diagOf(e)}`); };

async function loadView(roomId: string) {
  const sb = supabaseAdmin();
  const [r, m] = await Promise.all([
    sb.from('rooms').select('id,code,status,host_id,max_players,seed').eq('id', roomId).maybeSingle(),
    sb.from('room_members').select('user_id,slot,last_seen,left_at,profiles(display_name)').eq('room_id', roomId),
  ]);
  if (r.error) fail('rooms', r.error);
  if (m.error) fail('room_members', m.error);
  if (!r.data) throw new HttpError(404, 'room_not_found');
  return buildView(r.data as unknown as RoomRow, (m.data || []) as unknown as MemberRow[], Date.now());
}

/** Tandai anggota hidup. Mengembalikan jumlah baris yang cocok (0 = bukan anggota aktif). */
async function touch(uid: string, roomId: string, needRelay?: boolean): Promise<number> {
  const sb = supabaseAdmin(), now = Date.now();
  const patch: Record<string, unknown> = { last_seen: iso(now) };
  if (needRelay !== undefined) patch.relay_until = needRelay ? iso(now + 6000) : null;
  let res = await sb.from('room_members').update(patch).eq('room_id', roomId).eq('user_id', uid).is('left_at', null).select('user_id');
  if (res.error && needRelay !== undefined && String(res.error.code) === '42703') { // kolom relay_until belum ada (migrasi v2 belum jalan): lanjut tanpa
    res = await sb.from('room_members').update({ last_seen: iso(now) }).eq('room_id', roomId).eq('user_id', uid).is('left_at', null).select('user_id');
  }
  if (res.error) fail('touch', res.error);
  return res.data?.length ?? 0;
}

export async function stateViaTables(uid: string, roomId: string) {
  if ((await touch(uid, roomId)) === 0) throw new HttpError(403, 'not_member');
  return { ...(await loadView(roomId)), via: 'tables' };
}

export async function heartbeatViaTables(uid: string, roomId: string) {
  return { active: (await touch(uid, roomId)) > 0, via: 'tables' };
}

export async function syncViaTables(uid: string, roomId: string, state: unknown, world: unknown[], since: number, need: boolean) {
  const sb = supabaseAdmin();
  if ((await touch(uid, roomId, need)) === 0) throw new HttpError(403, 'not_member');
  if (state && typeof state === 'object') {
    const { error } = await sb.from('room_pos').upsert({ room_id: roomId, user_id: uid, state, updated_at: iso(Date.now()) }, { onConflict: 'room_id,user_id' });
    if (error) fail('room_pos', error);
  }
  if (world.length) {
    const { error } = await sb.from('room_world').insert(world.slice(0, 12).map((msg) => ({ room_id: roomId, user_id: uid, msg })));
    if (error) fail('room_world', error);
  }
  const top = await sb.from('room_world').select('id').eq('room_id', roomId).order('id', { ascending: false }).limit(1);
  if (top.error) fail('room_world max', top.error);
  const maxId = Number(top.data?.[0]?.id ?? 0);
  const start = since < 0 ? Math.max(0, maxId - 60) : Math.floor(since);
  const [w, p, n, view] = await Promise.all([
    sb.from('room_world').select('id,user_id,msg').eq('room_id', roomId).gt('id', start).neq('user_id', uid).order('id', { ascending: true }).limit(100),
    sb.from('room_pos').select('user_id,state').eq('room_id', roomId).neq('user_id', uid).gt('updated_at', iso(Date.now() - 15_000)),
    sb.from('room_members').select('user_id').eq('room_id', roomId).neq('user_id', uid).is('left_at', null).gt('relay_until', iso(Date.now())).limit(1),
    loadView(roomId),
  ]);
  if (w.error) fail('world', w.error);
  if (p.error) fail('pos', p.error);
  const picked = pickWorld((w.data || []) as { id: number; user_id: string; msg: unknown }[], maxId, since, uid);
  const states: Record<string, unknown> = {};
  for (const r of p.data || []) states[String((r as { user_id: string }).user_id)] = (r as { state: unknown }).state;
  const needRelay = !n.error && (n.data?.length ?? 0) > 0; // kolom relay_until tidak ada -> anggap tidak perlu relai cepat
  const onlineIds = new Set<string>(view.members.filter((m) => m.online).map((m) => m.id as string));
  const lockers = await readLockersViaTables(sb, roomId, onlineIds); // undefined bila tabel room_lockers belum ada (migrasi v5): sync tetap jalan
  return { ...view, states, world: picked.world, cursor: picked.cursor, need_relay: needRelay, via: 'tables', ...(lockers ? { lockers } : {}) };
}

const LOCKER_HTTP: Record<LockerError['code'], number> = { room_not_found: 404, room_closed: 410, not_member: 403, invalid: 400 };
/** Operasi loker lewat tabel (cadangan locker_op). Jawaban sah (bukan anggota, room tutup) -> HttpError; selain itu galat asli dilempar. */
export async function lockerViaTables(uid: string, roomId: string, locker: string | null, action: LockerAction): Promise<LockerReply & { via: 'tables' }> {
  try { return await lockerOpViaTables(supabaseAdmin(), { uid, roomId, locker: locker ?? undefined, action }); }
  catch (e) { if (e instanceof LockerError) throw new HttpError(LOCKER_HTTP[e.code], e.code); throw e; }
}
