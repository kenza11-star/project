import { json, handle } from '@/lib/server/http';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { firebaseAdminReady, serverEnv, supabaseAdminReady } from '@/lib/server/env';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { diagOf } from '@/lib/server/http';

const ZERO = '00000000-0000-0000-0000-000000000000';
// Jawaban "sah" (fungsi ADA, hanya menolak data uji) = salah satu kode galat bisnis. Fungsi hilang = PGRST202 / 42883.
const BUSINESS = new Set(['not_member', 'room_not_found', 'invalid', 'room_closed']);
/** Probe tanpa efek samping (uid uji tidak punya profil -> semua fungsi menolak sebelum menulis apa pun). Hanya melaporkan "ok" atau kode galat singkat. */
async function probeDb(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let sb; try { sb = supabaseAdmin(); } catch (e) { return { supabase: 'error:' + diagOf(e) }; }
  for (const t of ['profiles', 'rooms', 'room_members', 'room_pos', 'room_world', 'friendships', 'game_invites']) {
    try { const r = await sb.from(t).select('*', { head: true, count: 'exact' }).limit(1); out['table:' + t] = r.error ? 'error:' + diagOf(r.error) : 'ok'; }
    catch (e) { out['table:' + t] = 'error:' + diagOf(e); }
  }
  const fns: [string, Record<string, unknown>][] = [
    ['room_state', { p_uid: 'probe', p_room: ZERO }], ['heartbeat_room', { p_uid: 'probe', p_room: ZERO }],
    ['relay_sync', { p_uid: 'probe', p_room: ZERO, p_state: null, p_world: null, p_since: -1, p_need: false }],
    ['join_room', { p_uid: 'probe', p_code: 'AAAAAA' }], ['send_invite', { p_uid: 'probe', p_to_public_id: '00000', p_room: ZERO }],
    ['list_invites', { p_uid: 'probe' }], ['rate_hit', { p_key: 'probe', p_limit: 1000000, p_window_ms: 1000 }],
  ];
  for (const [fn, args] of fns) {
    try { const r = await sb.rpc(fn, args); out['fn:' + fn] = !r.error || BUSINESS.has((r.error.message || '').trim()) ? 'ok' : 'error:' + diagOf(r.error); }
    catch (e) { out['fn:' + fn] = 'error:' + diagOf(e); }
  }
  return out;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
  const db = supabaseAdminReady(e) ? await probeDb() : { supabase: 'not_configured' };
  return json({
    db, // "ok" = ada & bisa dipakai; "error:..." = penyebab nyata galat server (mis. fungsi SQL belum dibuat -> jalankan migration_v2 & v3)
    firebaseAdminInit,
    projectIdsMatch: !!pid && pid === e.firebaseProjectId, // FIREBASE_PROJECT_ID harus sama dengan NEXT_PUBLIC_FIREBASE_PROJECT_ID
    firebaseClient: !!(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    firebaseAdmin: firebaseAdminReady(e),
    supabaseClient: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServer: supabaseAdminReady(e),
  });
});
