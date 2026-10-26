import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, roomLog } from '@/lib/server/rooms';
import { validRoomId } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms/leave {roomId}. Identitas dari token; peran/keanggotaan diperiksa di SQL.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-leave:' + user.uid, 60, 60_000);
  const roomId = (await readJson(req)).roomId;
  if (!validRoomId(roomId)) throw new HttpError(400, 'invalid');
  const r = await rpc<unknown>('leave_room', { p_uid: user.uid, p_room: roomId });
  roomLog('leave', { uid: user.uid, roomId, result: 'ok' });
  return json(r);
});
