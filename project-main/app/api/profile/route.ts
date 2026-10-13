import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { validDisplayName } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/profile {displayName}: hanya mengubah profil MILIK token yang diverifikasi (uid dari token, bukan dari body).
export const PATCH = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('profile:' + user.uid, 10, 60_000);
  const body = await readJson(req);
  if (!validDisplayName(body.displayName)) throw new HttpError(400, 'invalid', 'Display name harus 3-16 karakter (huruf, angka, spasi, _ . -).');
  const { data, error } = await supabaseAdmin().from('profiles').update({ display_name: (body.displayName as string).trim() }).eq('id', user.uid).select('display_name').maybeSingle();
  if (error) throw new Error('profile update: ' + error.message);
  if (!data) throw new HttpError(404, 'not_member', 'Profil belum dibuat. Masuk ulang.');
  return json({ displayName: data.display_name });
});
