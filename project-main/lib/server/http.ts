// HANYA SERVER. Pembungkus handler route: error terstruktur, tanpa membocorkan detail internal, rate limit sederhana.
import 'server-only';
import { NextResponse } from 'next/server';
import { ROOM_ERROR_TEXT, type RoomErrorCode } from '@/lib/net/roomrules';

export class HttpError extends Error {
  constructor(public status: number, public code: RoomErrorCode, message?: string) { super(message || ROOM_ERROR_TEXT[code]); }
}
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
      console.error('[api] error tak terduga:', e instanceof Error ? e.message : 'unknown'); // detail hanya di log server
      return json({ error: { code: 'server', message: ROOM_ERROR_TEXT.server } }, 500);
    }
  };
}

export async function readJson(req: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413 as number, 'invalid');
  let text = '';
  try { text = await req.text(); } catch { throw new HttpError(400, 'invalid'); }
  if (text.length > maxBytes) throw new HttpError(413, 'invalid');
  try { const v = JSON.parse(text || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* jatuh ke error */ }
  throw new HttpError(400, 'invalid');
}

// Rate limit per kunci (uid) di memori instance. Best-effort: instance serverless berbeda tidak berbagi memori.
// Perlindungan yang kuat (mis. Vercel Firewall / Upstash) perlu ditambahkan bila game dipublikasikan luas.
const hits = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); throw new HttpError(429, 'rate_limited'); }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}
