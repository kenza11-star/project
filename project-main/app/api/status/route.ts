import { json, handle } from '@/lib/server/http';
import { firebaseAdminReady, serverEnv, supabaseAdminReady } from '@/lib/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hanya melaporkan APAKAH variabel terisi (true/false), tidak pernah nilainya. "configured" belum berarti "valid":
// validitas baru terbukti lewat login + room sungguhan.
export const GET = handle(async () => {
  const e = serverEnv();
  return json({
    firebaseClient: !!(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    firebaseAdmin: firebaseAdminReady(e),
    supabaseClient: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServer: supabaseAdminReady(e),
  });
});
