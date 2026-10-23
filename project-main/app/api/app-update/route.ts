import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/server/http';
import { supabaseAdmin } from '@/lib/server/supabaseAdmin';
import { serverEnv } from '@/lib/server/env';
import { isNewer, parseVer } from '@/lib/net/appupdate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// GET /api/app-update?v=1.0.0 (tanpa auth pemain). Notifikasi tidak wajib: SEMUA kegagalan dijawab 200 {update:false} agar klien diam.
// url = link website download bila diisi admin (download_url), kalau tidak, URL publik APK.
// Cache memori 60 dtk per instance (hanya hasil RPC, bukan per-klien).
type Notice = { version: string; notes: string[]; apk_path: string; message: string | null; download_url?: string | null } | null;
let cache: { at: number; n: Notice } | null = null;
const none = () => NextResponse.json({ update: false }, { headers: { 'Cache-Control': 'no-store' } });
const publicApkUrl = (path: string) => serverEnv().supabaseUrl.replace(/\/+$/, '') + '/storage/v1/object/public/app-files/' + path.split('/').map(encodeURIComponent).join('/');

export async function GET(req: Request): Promise<Response> {
  try {
    const v = new URL(req.url).searchParams.get('v');
    if (!parseVer(v)) return none();
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    await rateLimit('appupdate:' + ip, 20, 60_000);
    if (!cache || Date.now() - cache.at > 60_000) {
      const { data, error } = await supabaseAdmin().rpc('get_update_notice');
      if (error) return none();
      cache = { at: Date.now(), n: Array.isArray(data) && data[0] ? data[0] : null };
    }
    const n = cache.n;
    if (!n || !/^releases\/[0-9a-f]{16}\/apk\.apk$/.test(n.apk_path) || !isNewer(n.version, v)) return none();
    return NextResponse.json({ update: true, version: n.version, notes: Array.isArray(n.notes) ? n.notes : [], message: n.message || '', url: /^https:\/\//.test(n.download_url || '') ? n.download_url : publicApkUrl(n.apk_path) }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch { return none(); }
}
