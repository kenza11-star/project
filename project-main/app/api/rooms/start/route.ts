import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, roomLog } from '@/lib/server/rooms';
import { validRoomId } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms/start {roomId}. Identitas dari token; peran/keanggotaan diperiksa di SQL.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-start:' + user.uid, 60, 60_000);
  const roomId = (await readJson(req)).roomId;
  if (!validRoomId(roomId)) throw new HttpError(400, 'invalid');
  try { const r = await rpc<{ status?: string; players?: number }>('start_room', { p_uid: user.uid, p_room: roomId }); roomLog('start', { uid: user.uid, roomId, online: r.players, status: r.status, result: 'ok' }); return json(r); }
  catch (e) { roomLog('start', { uid: user.uid, roomId, result: e instanceof HttpError ? e.code : 'error' }); throw e; }
});
