// HANYA SERVER. Validasi identitas di backend: setiap endpoint yang butuh login memanggil requireUser().
import 'server-only';
import { adminAuth } from './firebaseAdmin';
import { HttpError } from './http';

export interface AuthedUser { uid: string; email: string | null; claims: Record<string, unknown> }

export async function requireUser(req: Request): Promise<AuthedUser> {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h);
  if (!m) throw new HttpError(401, 'unauthorized');
  try {
    const t = await adminAuth().verifyIdToken(m[1]); // memeriksa tanda tangan, kedaluwarsa, audience (project), issuer
    return { uid: t.uid, email: t.email ?? null, claims: t as unknown as Record<string, unknown> };
  } catch (e) {
    if (e instanceof HttpError) throw e; // mis. 503 not_configured
    const x = e as { code?: string; name?: string; message?: string };
    console.error('[auth] verifikasi token gagal:', x.code || x.name || 'unknown', String(x.message || '').slice(0, 160)); // log server saja; tidak memuat token/kunci
    throw new HttpError(401, 'unauthorized');
  }
}
