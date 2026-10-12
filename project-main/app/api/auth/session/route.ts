import { handle, json, rateLimit, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { emailToUsername } from '@/lib/auth/identity';
import { randomInt } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/session  (Authorization: Bearer <Firebase ID token>)
// Idempoten. Dipanggil klien setelah register/login/restore:
//  1) memverifikasi token di server,
//  2) memastikan klaim kustom role=authenticated (syarat Supabase Third-Party Auth agar RLS memakai role `authenticated`),
//  3) membuat/memuat baris profil di Supabase (public_id 5 digit unik).
// `refreshToken: true` = klaim baru saja dipasang; klien harus memanggil getIdToken(true) agar token berisi klaim itu.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  rateLimit('session:' + user.uid, 20, 60_000);
  const username = emailToUsername(user.email);
  if (!username) throw new HttpError(403, 'unauthorized', 'Akun ini bukan akun game.');

  let refreshToken = false;
  if (user.claims.role !== 'authenticated') {
    const auth = adminAuth();
    const rec = await auth.getUser(user.uid);
    await auth.setCustomUserClaims(user.uid, { ...(rec.customClaims || {}), role: 'authenticated' });
    refreshToken = true;
  }

  const sb = supabaseAdmin();
  const sel = () => sb.from('profiles').select('id,public_id,username,display_name').eq('id', user.uid).maybeSingle();
  let { data: p, error } = await sel();
  if (error) throw new Error('profiles select: ' + error.message);
  for (let i = 0; !p && i < 8; i++) {
    const publicId = String(randomInt(10000, 100000));
    const ins = await sb.from('profiles').insert({ id: user.uid, public_id: publicId, username, display_name: username.slice(0, 16).padEnd(3, '_') }).select('id,public_id,username,display_name').single();
    if (!ins.error) { p = ins.data; break; }
    if (ins.error.code === '23505') { // bentrok unik: public_id, username, atau race pada id yang sama
      const again = await sel();
      if (again.data) { p = again.data; break; }
      continue;
    }
    throw new Error('profiles insert: ' + ins.error.message);
  }
  if (!p) throw new HttpError(409, 'server', 'Gagal membuat profil. Coba lagi.');
  return json({ uid: p.id, publicId: p.public_id, username: p.username, displayName: p.display_name, refreshToken });
});
