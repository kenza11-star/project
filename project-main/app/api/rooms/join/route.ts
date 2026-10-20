import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, roomOut, roomLog, type RoomInfo } from '@/lib/server/rooms';
import { normalizeRoomCode } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms/join {code}. Idempoten: anggota yang sama (reconnect) mendapat slot yang sama. Kapasitas dicek atomik di SQL (row lock).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-join:' + user.uid, 20, 60_000); // juga menyulitkan menebak kode
  const code = normalizeRoomCode((await readJson(req)).code);
  if (!code) throw new HttpError(400, 'invalid', 'Kode room tidak valid.');
  let r: RoomInfo;
  try { r = await rpc<RoomInfo>('join_room', { p_uid: user.uid, p_code: code }); }
  catch (e) { roomLog('join', { uid: user.uid, code, result: e instanceof HttpError ? e.code : 'error' }); throw e; }
  roomLog('join', { uid: user.uid, roomId: r.room_id, code: r.code, status: r.status, result: 'ok' }); // idempoten: join berulang = slot sama, tidak ada baris ganda (diatur SQL)
  return json(roomOut(r));
});
