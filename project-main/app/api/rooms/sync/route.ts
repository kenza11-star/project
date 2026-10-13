import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, withFallback } from '@/lib/server/rooms';
import { syncViaTables } from '@/lib/server/roomsFallback';
import { validRoomId } from '@/lib/net/roomrules';
import { sanitizeState } from '@/lib/net/protocol';
import { sanitizeWorldMsg } from '@/lib/net/worldsync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/sync {roomId, state?, world?, since, need}
// Relai Postgres untuk gameplay: menyimpan posisi/event milik pemanggil (divalidasi ulang di server), menandai pemanggil hidup,
// lalu mengembalikan status room + anggota online + posisi pemain lain + event dunia baru -- semua dalam SATU round-trip.
// Dipakai bersama Supabase Realtime: Realtime = jalur cepat; relai ini = jalur yang selalu tersedia (dan sumber daftar pemain online).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-sync:' + user.uid, 900, 60_000, false); // ~15 req/dtk; lapis memori saja (frekuensi tinggi)
  const b = await readJson(req, 49_152);
  if (!validRoomId(b.roomId)) throw new HttpError(400, 'invalid');
  const since = typeof b.since === 'number' && Number.isFinite(b.since) ? Math.max(-1, Math.floor(b.since)) : -1;
  let state: unknown = null;
  if (b.state != null) { state = sanitizeState(b.state); if (!state) throw new HttpError(400, 'invalid'); }
  const world: unknown[] = [];
  if (Array.isArray(b.world)) for (const w of b.world.slice(0, 12)) { const m = sanitizeWorldMsg(w); if (m && m.ev.length) world.push(m); }
  const roomId = b.roomId;
  return json(await withFallback('sync',
    () => rpc<unknown>('relay_sync', { p_uid: user.uid, p_room: roomId, p_state: state, p_world: world.length ? world : null, p_since: since, p_need: b.need === true }),
    () => syncViaTables(user.uid, roomId, state, world, since, b.need === true)));
});
