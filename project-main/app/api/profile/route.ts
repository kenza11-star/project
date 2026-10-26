import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { validDisplayName } from '@/lib/net/roomrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Avatar: data-URL JPEG, maks 40 KB setelah decode (klien sudah memperkecil ke 256px). Divalidasi: tipe, base64, ukuran, tanda tangan JPEG.
const AVATAR_MAX = 40 * 1024;
const AVATAR_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
function validAvatar(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > Math.ceil(AVATAR_MAX / 3) * 4 + 40) return false;
  const m = AVATAR_RE.exec(v);
  if (!m) return false;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length > 4 && buf.length <= AVATAR_MAX && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// PATCH /api/profile {displayName?, avatar?}: hanya mengubah profil MILIK token yang diverifikasi (uid dari token, bukan dari body). avatar: null = hapus.
export const PATCH = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('profile:' + user.uid, 10, 60_000);
  const body = await readJson(req, 64 * 1024);
  const patch: Record<string, unknown> = {};
  if (body.displayName !== undefined || body.avatar === undefined) {
    if (!validDisplayName(body.displayName)) throw new HttpError(400, 'invalid', 'Display name harus 3-16 karakter (huruf, angka, spasi, _ . -).');
    patch.display_name = (body.displayName as string).trim();
  }
  if (body.avatar !== undefined) {
    if (body.avatar !== null && !validAvatar(body.avatar)) throw new HttpError(400, 'invalid', 'Foto profil harus JPEG maks 40 KB.');
    patch.avatar = body.avatar; patch.avatar_at = body.avatar === null ? null : new Date().toISOString();
  }
  const { data, error } = await supabaseAdmin().from('profiles').update(patch).eq('id', user.uid).select('display_name').maybeSingle();
  if (error) throw new Error('profile update: ' + error.message);
  if (!data) throw new HttpError(404, 'not_member', 'Profil belum dibuat. Masuk ulang.');
  return json({ displayName: data.display_name });
});

// POST /api/profile {inGame}: heartbeat presence (klien tiap 20 dtk). Mengisi last_seen; in_game = sedang di room yang berjalan. Hanya lapis memori (frekuensi tinggi).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('presence:' + user.uid, 8, 60_000, false);
  const body = await readJson(req);
  const { error } = await supabaseAdmin().from('profiles').update({ last_seen: new Date().toISOString(), in_game: body.inGame === true }).eq('id', user.uid);
  if (error) throw new Error('presence update: ' + error.message);
  return json({ ok: true });
});
