import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, roomOut, type RoomInfo } from '@/lib/server/rooms';
import { normalizeRoomCode } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/join {code}. Idempoten: anggota yang sama (reconnect) mendapat slot yang sama. Kapasitas dicek atomik di SQL (row lock).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-join:' + user.uid, 20, 60_000); // juga menyulitkan menebak kode
  const code = normalizeRoomCode((await readJson(req)).code);
  if (!code) throw new HttpError(400, 'invalid', 'Kode room tidak valid.');
  return json(roomOut(await rpc<RoomInfo>('join_room', { p_uid: user.uid, p_code: code })));
});
