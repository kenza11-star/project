import { handle, json, rateLimit, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc } from '@/lib/server/rooms';
import { validRoomId } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/rooms/state?roomId=... -> status, host, dan daftar anggota room (nama, slot, online) dibaca SERVER-SIDE (service_role).
// Dipakai ruang tunggu. Sekaligus heartbeat: memanggilnya menandai pemanggil "hidup". Tidak bergantung pada RLS/JWT di browser.
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-state:' + user.uid, 240, 60_000, false);
  const roomId = new URL(req.url).searchParams.get('roomId');
  if (!validRoomId(roomId)) throw new HttpError(400, 'invalid');
  return json(await rpc<unknown>('room_state', { p_uid: user.uid, p_room: roomId }));
});
