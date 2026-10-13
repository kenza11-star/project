import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, backendId } from '@/lib/server/rooms';
import { validRoomId } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uidOk = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{5}$/.test(v);

// GET /api/invites -> {incoming: [{id,uid,name,created_at}], outgoing: [{id,uid,status}]}. Identitas dari token.
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('invites-list:' + user.uid, 60, 60_000, false);
  return json(await rpc<unknown>('list_invites', { p_uid: user.uid }));
});

// POST /api/invites {action:'send', uid, roomId} | {action:'accept'|'decline', inviteId}
// send   : hanya ke TEMAN, dari anggota room yang masih menunggu, room belum penuh. Disimpan di database -> muncul di akun penerima.
// accept : penerima masuk ke room itu (diputuskan atomik di SQL); jawaban berisi data room untuk langsung membuka ruang tunggu.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('invites-act:' + user.uid, 30, 60_000);
  const b = await readJson(req);
  switch (b.action) {
    case 'send':
      if (!uidOk(b.uid) || !validRoomId(b.roomId)) throw new HttpError(400, 'invalid', 'UID atau room tidak valid.');
      return json(await rpc<unknown>('send_invite', { p_uid: user.uid, p_to_public_id: b.uid, p_room: b.roomId }));
    case 'accept': case 'decline': {
      if (!validRoomId(b.inviteId)) throw new HttpError(400, 'invalid');
      const r = await rpc<{ status: string; room?: Record<string, unknown> }>('respond_invite', { p_uid: user.uid, p_invite: b.inviteId, p_accept: b.action === 'accept' });
      if (r.room) {
        const x = r.room;
        return json({ status: r.status, room: { roomId: x.room_id, code: x.code, seed: Number(x.seed), maxPlayers: x.max_players, status: x.status, slot: x.slot, hostId: x.host_id, backend: backendId() } });
      }
      return json({ status: r.status });
    }
    default: throw new HttpError(400, 'invalid');
  }
});
