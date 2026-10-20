// HANYA SERVER. Rahasia dibaca dari environment Vercel (tanpa awalan NEXT_PUBLIC_, jadi tidak pernah masuk bundel browser).
import 'server-only';

export interface ServerEnv {
  firebaseProjectId: string; firebaseClientEmail: string; firebasePrivateKey: string;
  supabaseUrl: string; supabaseServiceRoleKey: string;
}
export function serverEnv(): ServerEnv {
  return {
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Vercel menyimpan baris baru kunci privat sebagai literal "\n" bila ditempel satu baris; kembalikan ke newline asli.
    firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}
export const firebaseAdminReady = (e = serverEnv()) => !!(e.firebaseProjectId && e.firebaseClientEmail && e.firebasePrivateKey);
export const supabaseAdminReady = (e = serverEnv()) => !!(e.supabaseUrl && e.supabaseServiceRoleKey);
