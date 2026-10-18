import { handle, json, rateLimit } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc } from '@/lib/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// GET /api/social -> {friends, invites} dalam satu panggilan (polling lobby tiap beberapa detik: permintaan teman + undangan main masuk).
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('social-poll:' + user.uid, 60, 60_000, false);
  // allSettled: bila fungsi undangan di database bermasalah (mis. migrasi SQL belum dijalankan), daftar teman tetap sampai ke klien dan
  // klien diberi tahu lewat invitesFailed -- bukan gagal diam-diam seperti sebelumnya.
  const [f, i] = await Promise.allSettled([
    rpc<unknown[]>('list_friends', { p_uid: user.uid }),
    rpc<{ incoming: unknown[]; outgoing: unknown[] }>('list_invites', { p_uid: user.uid }),
  ]);
  if (f.status === 'rejected') throw f.reason;
  if (i.status === 'rejected') {
    console.error('[social] list_invites gagal:', i.reason instanceof Error ? i.reason.message : 'unknown');
    return json({ friends: f.value, invites: { incoming: [], outgoing: [] }, invitesFailed: true });
  }
  return json({ friends: f.value, invites: i.value, invitesFailed: false });
});
