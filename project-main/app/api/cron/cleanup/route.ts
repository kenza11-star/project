import { timingSafeEqual } from 'node:crypto';
import { handle, json, HttpError } from '@/lib/server/http';
import { rpc } from '@/lib/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cron/cleanup. Dipanggil Vercel Cron (vercel.json). Vercel otomatis mengirim "Authorization: Bearer $CRON_SECRET".
// Tanpa CRON_SECRET di server, endpoint ini MATI (503) supaya tidak bisa dipicu sembarang orang.
export const GET = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) throw new HttpError(503, 'not_configured', 'CRON_SECRET belum diatur (minimal 16 karakter).');
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/, ''));
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, 'unauthorized');
  return json(await rpc<unknown>('cleanup_rooms', {}));
});
