// KLIEN (browser). Supabase dengan kunci anon + ID token Firebase (Third-Party Auth). RLS memakai klaim `sub` = Firebase UID.
// Kunci anon/publishable memang publik; yang melindungi data adalah RLS (supabase/schema.sql), bukan kerahasiaan kunci.
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, supabaseClientConfigured } from '@/lib/config/env';
import { currentIdToken } from '@/lib/auth/firebaseClient';

let client: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseClientConfigured()) return Promise.reject(new Error('supabase_not_configured'));
  if (!client) client = (async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      accessToken: async () => (await currentIdToken()) ?? '',  // dipanggil tiap kali token dibutuhkan (REST & Realtime); Firebase menyegarkan otomatis
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  })();
  return client;
}
/** Dipanggil saat logout: lepaskan klien supaya tidak ada token lama di koneksi Realtime. */
export async function resetSupabase(): Promise<void> {
  const c = client; client = null;
  try { await (await c)?.removeAllChannels(); } catch { /* abaikan */ }
}
