// KLIEN (browser). AuthProvider berbasis Firebase Auth (email/password internal dari username) + validasi identitas di backend (/api/auth/session).
import type { AuthProvider, AuthResult, AuthUser, AuthErrorCode } from './types';
import { usernameToEmail } from './identity';
import { getFirebaseAuth, currentFirebaseUser } from './firebaseClient';

const fail = (code: AuthErrorCode, message: string, field?: string): AuthResult => ({ ok: false, code, message, field });

function mapFirebaseError(e: unknown, mode: 'login' | 'register'): AuthResult {
  const code = String((e as { code?: string })?.code || '');
  switch (code) {
    case 'auth/email-already-in-use': return fail('taken', 'Username sudah dipakai.', 'username');
    case 'auth/weak-password': return fail('invalid', 'Password terlalu lemah.', 'password');
    case 'auth/invalid-email': return fail('invalid', 'Username tidak valid.', 'username');
    case 'auth/user-not-found': case 'auth/wrong-password': case 'auth/invalid-credential': case 'auth/invalid-login-credentials':
      return fail('invalid', 'Username atau password salah.');
    case 'auth/too-many-requests': return fail('rate_limited', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
    case 'auth/network-request-failed': return fail('network', 'Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    case 'auth/operation-not-allowed': return fail('unavailable', 'Login Email/Password belum diaktifkan di Firebase Console (Authentication > Sign-in method).');
    case 'auth/user-disabled': return fail('invalid', 'Akun dinonaktifkan.');
    case 'firebase_not_configured': return fail('unavailable', 'Firebase belum dikonfigurasi.');
    default: return fail('unknown', mode === 'login' ? 'Gagal masuk. Coba lagi.' : 'Gagal mendaftar. Coba lagi.');
  }
}

interface SessionRes { uid: string; publicId: string; username: string; displayName: string; refreshToken: boolean }

/** Verifikasi token di server, pasang klaim role, buat/muat profil. Setelah klaim baru dipasang, token dipaksa diperbarui. */
async function establish(user: import('firebase/auth').User): Promise<AuthUser> {
  const call = async (token: string) => fetch('/api/auth/session', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  let res = await call(await user.getIdToken());
  if (res.status === 401) res = await call(await user.getIdToken(true));
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw Object.assign(new Error(j?.error?.message || 'session_failed'), { status: res.status });
  }
  const s = (await res.json()) as SessionRes;
  if (s.refreshToken) await user.getIdToken(true); // supaya token membawa klaim role=authenticated (diperlukan RLS Supabase)
  return { id: s.publicId, name: s.username, uid: s.uid, displayName: s.displayName };
}

export const firebaseProvider: AuthProvider = {
  available: true,
  async register({ username, password }) {
    let created: import('firebase/auth').User | null = null;
    try {
      const auth = await getFirebaseAuth();
      const { createUserWithEmailAndPassword } = await import('firebase/auth');
      created = (await createUserWithEmailAndPassword(auth, usernameToEmail(username), password)).user;
      return { ok: true, user: await establish(created) };
    } catch (e) {
      if (created) { // akun Firebase terbuat tetapi profil gagal dibuat: hapus supaya username tidak "terkunci" tanpa profil
        try { await created.delete(); } catch { /* biarkan; login berikutnya akan mencoba membuat profil lagi */ }
        return fail('unknown', (e as Error).message === 'session_failed' ? 'Server akun belum siap. Coba lagi nanti.' : (e as Error).message || 'Gagal membuat profil.');
      }
      return mapFirebaseError(e, 'register');
    }
  },
  async login({ username, password }) {
    try {
      const auth = await getFirebaseAuth();
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const u = (await signInWithEmailAndPassword(auth, usernameToEmail(username), password)).user;
      try { return { ok: true, user: await establish(u) }; }
      catch (e) { return fail('unknown', (e as Error).message || 'Server akun belum siap. Coba lagi nanti.'); }
    } catch (e) { return mapFirebaseError(e, 'login'); }
  },
  async logout() {
    try { const auth = await getFirebaseAuth(); const { signOut } = await import('firebase/auth'); await signOut(auth); } catch { /* sesi lokal tetap dibersihkan oleh pemanggil */ }
  },
  async restore() {
    try { const u = await currentFirebaseUser(); return u ? await establish(u) : null; } catch { return null; }
  },
};
