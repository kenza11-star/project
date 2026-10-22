// Sistem loker/lemari multiplayer: aturan bersama (logika murni, tanpa three/react/server; dites di scripts/test-lockers.js).
//
// Aturan: maksimal 1 pemain per loker, dan 1 pemain hanya boleh memegang 1 loker. KEPUTUSAN ada di SERVER (fungsi SQL locker_op, jalur cadangan
// tabel, atau relay blitz.cloud) -- klien hanya meminta (`enter` / `exit` / `release`) dan menerima snapshot `lockers` { lockerId: uidPemilik }.
// Klaim dianggap HIDUP bila: (1) pemegang masih anggota room yang ONLINE (keluar / disconnect = lepas), dan (2) lease belum habis
// (klaim harus diperbarui tiap LOCKER_RENEW_MS selama pemain bersembunyi; jaring pengaman bila permintaan `exit` hilang).

export const LOCKER_LEASE_S = 40;          // harus sama dengan interval '40 seconds' di SQL (supabase/migration_v5_lockers.sql) dan relay
export const LOCKER_RENEW_MS = 10_000;     // penyewa memperbarui klaim tiap ini selama bersembunyi (< lease)
export const MAX_LOCKER_ENTRIES = 16;      // batas ukuran snapshot yang diterima klien (maks 6 pemain x 1 loker; sisanya buangan)
export const LOCKER_ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;

/** Galat bisnis (jawaban sah server, bukan kegagalan): dipetakan ke kode API yang sama dengan fungsi SQL (raise exception 'not_member', dst). */
export class LockerError extends Error { constructor(public code: 'room_not_found' | 'room_closed' | 'not_member' | 'invalid') { super(code); } }

export type LockerAction = 'enter' | 'exit' | 'release';
export const isLockerAction = (v: unknown): v is LockerAction => v === 'enter' || v === 'exit' || v === 'release';
export const validLockerId = (v: unknown): v is string => typeof v === 'string' && LOCKER_ID_RE.test(v);

/** Id loker = id kompartemen pertama furniture itu (satu furniture multi-pintu = SATU loker). `#` (pemisah kompartemen) tidak lolos ID_RE -> `:`. */
export const lockerKeyOf = (id: string): string => String(id).replace(/#/g, ':').replace(/[^A-Za-z0-9_.:@-]/g, '_').slice(0, 64);

export type LockerMap = Record<string, string>; // lockerId -> uid pemilik (klaim hidup)

/** Balasan server untuk operasi loker. ok=false + reason 'occupied' = loker dipegang pemain lain (`owner`). `lockers` = snapshot otoritatif sesudah operasi. */
export interface LockerReply { ok: boolean; reason?: 'occupied' | null; owner?: string | null; lockers: LockerMap; server_time?: string }
export interface LockerRequest { locker?: string; action: LockerAction }

/** Snapshot dari jaringan TIDAK dipercaya: id & uid divalidasi, ukuran dibatasi. null = bukan snapshot. */
export function sanitizeLockers(raw: unknown): LockerMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: LockerMap = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validLockerId(k) || typeof v !== 'string' || v.length === 0 || v.length > 128) continue;
    if (++n > MAX_LOCKER_ENTRIES) break;
    out[k] = v;
  }
  return out;
}

export const sameLockers = (a: LockerMap, b: LockerMap): boolean => {
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => b[k] === a[k]);
};

export interface ClaimRow { locker_id: string; user_id: string; renewed_at: string | number }
/**
 * Aturan "klaim hidup" (HARUS sama dengan room_lockers_view() di SQL dan liveLockers() di relay):
 * pemegang ada di `onlineIds` (anggota room yang online menurut aturan room_view) DAN renewed_at < LOCKER_LEASE_S.
 * Mengembalikan peta klaim hidup + daftar id loker yang basi (boleh dihapus). Bila ada dua baris untuk satu loker (tidak seharusnya terjadi),
 * yang diperbarui paling baru menang dan sisanya dianggap basi.
 */
export function liveClaims(rows: ClaimRow[], onlineIds: Set<string>, nowMs: number, leaseS = LOCKER_LEASE_S): { live: LockerMap; stale: ClaimRow[] } {
  const ts = (r: ClaimRow) => (typeof r.renewed_at === 'number' ? r.renewed_at : Date.parse(r.renewed_at));
  const stale: ClaimRow[] = [], fresh: ClaimRow[] = [];
  for (const r of rows) {
    const t = ts(r);
    if (!onlineIds.has(r.user_id) || !Number.isFinite(t) || nowMs - t >= leaseS * 1000) stale.push(r); else fresh.push(r);
  }
  fresh.sort((a, b) => ts(a) - ts(b)); // yang paling baru diperbarui diproses terakhir -> menang
  const live: LockerMap = {}, winner = new Map<string, ClaimRow>();
  for (const r of fresh) { const prev = winner.get(r.locker_id); if (prev) stale.push(prev); winner.set(r.locker_id, r); live[r.locker_id] = r.user_id; }
  return { live, stale };
}

/** Pesan "colek" (hanya lewat jalur realtime, tanpa isi yang bisa dipalsukan): artinya "status loker berubah, segera sinkron ulang dari server". */
export interface LockerPoke { v: 1; t: 'lk' }
export const LOCKER_POKE: LockerPoke = { v: 1, t: 'lk' };
export const isLockerMsg = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'lk';

// ---- Jalur cadangan peer-to-peer (dipakai LockerClient bila SERVER/tabel loker tidak tersedia; lewat pesan realtime room yang sudah ada) ----
// Tanpa jalur ini, server/tabel yang belum siap membuat SEMUA loker ditolak. Aturan P2P: pemegang menyiarkan `hold` tiap LOCKER_P2P_BEAT_MS;
// klaim peer dianggap hidup bila peer masih ada di roster online DAN beat terakhir < LOCKER_P2P_TTL_MS. Klaim serentak: uid terkecil menang.
export const LOCKER_P2P_BEAT_MS = 3_000;
export const LOCKER_P2P_TTL_MS = 9_000;
export const LOCKER_P2P_SETTLE_MS = 250;   // jendela tunggu klaim serentak sebelum dianggap berhasil
export const LOCKER_SERVER_RETRY_MS = 15_000; // setelah server gagal, jangan mencoba server lagi selama ini (hindari antrean macet)
export const LOCKER_API_TIMEOUT_MS = 4_000;
export type LockerP2PAction = 'claim' | 'hold' | 'rel';
export interface LockerP2PMsg { v: 1; t: 'lk'; a: LockerP2PAction; k?: string }
export const lockerP2P = (a: LockerP2PAction, k?: string): LockerP2PMsg => (k === undefined ? { v: 1, t: 'lk', a } : { v: 1, t: 'lk', a, k });
/** Pesan P2P dari jaringan TIDAK dipercaya: aksi & id divalidasi. null = bukan pesan P2P (mis. colekan biasa). */
export function sanitizeLockerP2P(raw: unknown): { a: LockerP2PAction; k: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { t?: unknown; a?: unknown; k?: unknown };
  if (r.t !== 'lk' || (r.a !== 'claim' && r.a !== 'hold' && r.a !== 'rel')) return null;
  if (r.k === undefined || r.k === null) return r.a === 'rel' ? { a: r.a, k: null } : null;
  return validLockerId(r.k) ? { a: r.a, k: r.k } : null;
}
