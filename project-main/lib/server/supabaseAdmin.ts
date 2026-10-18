// HANYA SERVER. Klien Supabase dengan service-role key (melewati RLS). Dipakai SETELAH requireUser() lolos; jangan pernah dikirim ke browser.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv, supabaseAdminReady } from './env';
import { HttpError } from './http';

let client: SupabaseClient | undefined;
export function supabaseAdmin(): SupabaseClient {
  const e = serverEnv();
  if (!supabaseAdminReady(e)) throw new HttpError(503, 'not_configured', 'Supabase belum dikonfigurasi di server.');
  if (!client) client = createClient(e.supabaseUrl, e.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // PENTING: Next.js 14 menyimpan jawaban fetch dan memakainya ulang. Tanpa ini, panggilan ke database (yang isinya selalu sama tiap polling)
    // dijawab dari simpanan, fungsi SQL tidak pernah dijalankan: last_seen tidak bergerak dan daftar pemain membeku.
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}
