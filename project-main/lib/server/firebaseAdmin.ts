// HANYA SERVER. Firebase Admin: verifikasi ID token & klaim. Kunci privat tidak pernah meninggalkan modul ini.
import 'server-only';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { firebaseAdminReady, serverEnv } from './env';
import { HttpError } from './http';

let app: App | undefined;
export function adminAuth(): Auth {
  const e = serverEnv();
  if (!firebaseAdminReady(e)) throw new HttpError(503, 'not_configured', 'Firebase Admin belum dikonfigurasi di server.');
  if (!app) app = getApps()[0] ?? initializeApp({ credential: cert({ projectId: e.firebaseProjectId, clientEmail: e.firebaseClientEmail, privateKey: e.firebasePrivateKey }) });
  return getAuth(app);
}
