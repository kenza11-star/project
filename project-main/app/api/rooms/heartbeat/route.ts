import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, withFallback } from '@/lib/server/rooms';
import { heartbeatViaTables } from '@/lib/server/roomsFallback';
import { validRoomId } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms/heartbeat {roomId}. Identitas dari token; peran/keanggotaan diperiksa di SQL.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-heartbeat:' + user.uid, 60, 60_000, false);
  const roomId = (await readJson(req)).roomId;
  if (!validRoomId(roomId)) throw new HttpError(400, 'invalid');
  return json(await withFallback('heartbeat', () => rpc<unknown>('heartbeat_room', { p_uid: user.uid, p_room: roomId }), () => heartbeatViaTables(user.uid, roomId)));
});
