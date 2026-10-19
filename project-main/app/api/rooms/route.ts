import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, roomOut, roomLog, type RoomInfo } from '@/lib/server/rooms';
import { generateRoomCode, validMaxPlayers } from '@/lib/net/roomrules';
import { randomInt } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms {maxPlayers: 2..4} -> membuat room; pembuat = host & slot 0. Seed dunia dibuat server (sama untuk semua anggota).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-create:' + user.uid, 6, 60_000);
  const body = await readJson(req);
  if (!validMaxPlayers(body.maxPlayers)) throw new HttpError(400, 'invalid', 'Jumlah pemain harus 2-4.');
  for (let i = 0; i < 6; i++) {
    try {
      const r = await rpc<RoomInfo>('create_room', { p_uid: user.uid, p_code: generateRoomCode((n) => randomInt(n)), p_max: body.maxPlayers, p_seed: randomInt(1, 2 ** 31) });
      roomLog('create', { uid: user.uid, roomId: r.room_id, code: r.code, members: 1, status: r.status, result: 'ok' });
      return json(roomOut(r), 201);
    } catch (e) { if ((e as { code?: string }).code !== '23505') throw e; } // kode bentrok: coba kode lain
  }
  throw new HttpError(500, 'server');
});
