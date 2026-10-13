import { handle, json, rateLimit } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc } from '@/lib/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/social -> {friends, invites} dalam satu panggilan (polling lobby tiap beberapa detik: permintaan teman + undangan main masuk).
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('social-poll:' + user.uid, 60, 60_000, false);
  const [friends, invites] = await Promise.all([
    rpc<unknown[]>('list_friends', { p_uid: user.uid }),
    rpc<{ incoming: unknown[]; outgoing: unknown[] }>('list_invites', { p_uid: user.uid }),
  ]);
  return json({ friends, invites });
});
