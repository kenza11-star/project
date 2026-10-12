// HANYA SERVER. Klien Supabase dengan service-role key (melewati RLS). Dipakai SETELAH requireUser() lolos; jangan pernah dikirim ke browser.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv, supabaseAdminReady } from './env';
import { HttpError } from './http';

let client: SupabaseClient | undefined;
export function supabaseAdmin(): SupabaseClient {
  const e = serverEnv();
  if (!supabaseAdminReady(e)) throw new HttpError(503, 'not_configured', 'Supabase belum dikonfigurasi di server.');
  if (!client) client = createClient(e.supabaseUrl, e.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
