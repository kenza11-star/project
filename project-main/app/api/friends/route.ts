import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc } from '@/lib/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Pesan khusus teman (kode error SQL dipakai ulang: room_not_found = UID tak ada, room_full = batas 100, not_member = bukan penerima, invalid = diri sendiri)
const FRIEND_TEXT: Record<string, string> = {
  room_not_found: 'UID tidak ditemukan.', room_full: 'Daftar teman penuh (maks 100).',
  not_member: 'Tidak ada permintaan yang bisa dijawab.', invalid: 'Itu UID kamu sendiri.',
};
async function friendRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try { return await rpc<T>(fn, args); }
  catch (e) { if (e instanceof HttpError && FRIEND_TEXT[e.code ?? '']) throw new HttpError(e.status, e.code as never, FRIEND_TEXT[e.code ?? '']); throw e; }
}
const uidOk = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{5}$/.test(v);

// GET /api/friends -> daftar teman + permintaan (masuk/keluar) dengan status (presence) + versi avatar `av`. Identitas dari token.
// GET /api/friends?avatars=12345,23456 -> {avatars:{uid:dataUrl}} untuk teman (diterima) itu saja; klien memanggilnya hanya bila `av` berubah.
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('friends-list:' + user.uid, 30, 60_000, false);
  const q = new URL(req.url).searchParams.get('avatars');
  if (q !== null) {
    const ids = q.split(',').filter(uidOk).slice(0, 10);
    return json({ avatars: ids.length ? await rpc<Record<string, string>>('friend_avatars', { p_uid: user.uid, p_ids: ids }) : {} });
  }
  return json({ friends: await rpc<unknown[]>('list_friends', { p_uid: user.uid }) });
});

// POST /api/friends {uid, action: request|accept|decline|remove}. "uid" = UID 5 digit lawan (bukan Firebase UID).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('friends-act:' + user.uid, 30, 60_000);
  const b = await readJson(req);
  if (!uidOk(b.uid)) throw new HttpError(400, 'invalid', 'UID harus 5 digit angka.');
  switch (b.action) {
    case 'request': return json(await friendRpc<unknown>('request_friend', { p_uid: user.uid, p_public_id: b.uid }));
    case 'accept': return json(await friendRpc<unknown>('respond_friend', { p_uid: user.uid, p_other_public_id: b.uid, p_accept: true }));
    case 'decline': return json(await friendRpc<unknown>('respond_friend', { p_uid: user.uid, p_other_public_id: b.uid, p_accept: false }));
    case 'remove': return json(await rpc<unknown>('remove_friend', { p_uid: user.uid, p_other_public_id: b.uid }));
    default: throw new HttpError(400, 'invalid');
  }
});
