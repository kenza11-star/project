// KLIEN (browser). Firebase Authentication. Hanya memakai konfigurasi publik NEXT_PUBLIC_*; modul firebase dimuat dinamis supaya
// bundel awal tidak membesar dan tidak error bila belum dikonfigurasi.
import { publicEnv, firebaseClientConfigured } from '@/lib/config/env';

type FbAuth = import('firebase/auth').Auth;
let authP: Promise<FbAuth> | null = null;

export function getFirebaseAuth(): Promise<FbAuth> {
  if (!firebaseClientConfigured()) return Promise.reject(new Error('firebase_not_configured'));
  if (!authP) authP = (async () => {
    const [{ getApp, getApps, initializeApp }, { getAuth, browserLocalPersistence, setPersistence }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app = getApps().length ? getApp() : initializeApp(publicEnv.firebase);
    const auth = getAuth(app);
    try { await setPersistence(auth, browserLocalPersistence); } catch { /* tetap jalan dengan persistence bawaan */ }
    return auth;
  })();
  return authP;
}

/** Tunggu status auth awal dipulihkan (Firebase memulihkan sesi dari penyimpanan lokal secara async). */
export async function currentFirebaseUser() {
  const auth = await getFirebaseAuth();
  await auth.authStateReady();
  return auth.currentUser;
}

/** ID token terbaru untuk Authorization header API dan untuk Supabase (Third-Party Auth). null bila belum login. */
export async function currentIdToken(forceRefresh = false): Promise<string | null> {
  try { const u = await currentFirebaseUser(); return u ? await u.getIdToken(forceRefresh) : null; } catch { return null; }
}
