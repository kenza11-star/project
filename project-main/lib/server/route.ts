import 'server-only';
import { json, handle } from '@/lib/server/http';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { firebaseAdminReady, serverEnv, supabaseAdminReady } from '@/lib/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hanya melaporkan APAKAH variabel terisi (true/false), tidak pernah nilainya. "configured" belum berarti "valid":
// validitas baru terbukti lewat login + room sungguhan.
export const GET = handle(async () => {
  const e = serverEnv();
  // Uji apakah kredensial Admin BISA dibaca (format kunci privat, email, project id). Hanya melaporkan kode galat singkat, tidak pernah nilainya.
  let firebaseAdminInit: string = 'skipped';
  if (firebaseAdminReady(e)) {
    try { adminAuth(); firebaseAdminInit = 'ok'; }
    catch (err) { const x = err as { code?: string; name?: string }; firebaseAdminInit = 'error:' + (x.code || x.name || 'unknown'); }
  }
  const pid = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  return json({
    firebaseAdminInit,
    projectIdsMatch: !!pid && pid === e.firebaseProjectId, // FIREBASE_PROJECT_ID harus sama dengan NEXT_PUBLIC_FIREBASE_PROJECT_ID
    firebaseClient: !!(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    firebaseAdmin: firebaseAdminReady(e),
    supabaseClient: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServer: supabaseAdminReady(e),
  });
});
