import { handle, json, rateLimit, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, withFallback, finalView, logStateChange } from '@/lib/server/rooms';
import { stateViaTables } from '@/lib/server/roomsFallback';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { validRoomId } from '@/lib/net/roomrules';
import type { RawView } from '@/lib/net/roomview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// GET /api/rooms/state?roomId=... -> status, host, dan daftar anggota room (nama, slot, online) dibaca SERVER-SIDE (service_role).
// Dipakai ruang tunggu. Sekaligus heartbeat: memanggilnya menandai pemanggil "hidup". Tidak bergantung pada RLS/JWT di browser.
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-state:' + user.uid, 240, 60_000, false);
  const roomId = new URL(req.url).searchParams.get('roomId');
  if (!validRoomId(roomId)) throw new HttpError(400, 'invalid');
  const raw = await withFallback('state', () => rpc<RawView>('room_state', { p_uid: user.uid, p_room: roomId }), () => stateViaTables(user.uid, roomId) as Promise<RawView>);
  const view = finalView(raw);
  logStateChange(user.uid, view as never);
  // DIAGNOSTIK SEMENTARA: baca baris anggota pemanggil langsung dari tabel SESUDAH panggilan di atas, lalu kirim ke layar.
  let dbg = '';
  try {
    const { data, error } = await supabaseAdmin().from('room_members').select('last_seen,left_at').eq('room_id', roomId).eq('user_id', user.uid).maybeSingle();
    dbg = error ? 'dberr ' + String(error.code || '') : data ? 'seen ' + Math.round((Date.now() - new Date(data.last_seen).getTime()) / 1000) + 's' + (data.left_at ? ' LEFT' : '') : 'BUKAN ANGGOTA';
  } catch { dbg = 'dbgfail'; }
  return json({ ...view, dbg: dbg + ' · uid ' + user.uid.slice(0, 4) + '…' + user.uid.slice(-3) });
});
