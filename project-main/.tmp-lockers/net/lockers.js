"use strict";
// Sistem loker/lemari multiplayer: aturan bersama (logika murni, tanpa three/react/server; dites di scripts/test-lockers.js).
//
// Aturan: maksimal 1 pemain per loker, dan 1 pemain hanya boleh memegang 1 loker. KEPUTUSAN ada di SERVER (fungsi SQL locker_op, jalur cadangan
// tabel, atau relay blitz.cloud) -- klien hanya meminta (`enter` / `exit` / `release`) dan menerima snapshot `lockers` { lockerId: uidPemilik }.
// Klaim dianggap HIDUP bila: (1) pemegang masih anggota room yang ONLINE (keluar / disconnect = lepas), dan (2) lease belum habis
// (klaim harus diperbarui tiap LOCKER_RENEW_MS selama pemain bersembunyi; jaring pengaman bila permintaan `exit` hilang).
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockerP2P = exports.LOCKER_API_TIMEOUT_MS = exports.LOCKER_SERVER_RETRY_MS = exports.LOCKER_P2P_SETTLE_MS = exports.LOCKER_P2P_TTL_MS = exports.LOCKER_P2P_BEAT_MS = exports.isLockerMsg = exports.LOCKER_POKE = exports.sameLockers = exports.lockerKeyOf = exports.validLockerId = exports.isLockerAction = exports.LockerError = exports.LOCKER_ID_RE = exports.MAX_LOCKER_ENTRIES = exports.LOCKER_RENEW_MS = exports.LOCKER_LEASE_S = void 0;
exports.sanitizeLockers = sanitizeLockers;
exports.liveClaims = liveClaims;
exports.sanitizeLockerP2P = sanitizeLockerP2P;
exports.LOCKER_LEASE_S = 40; // harus sama dengan interval '40 seconds' di SQL (supabase/migration_v5_lockers.sql) dan relay
exports.LOCKER_RENEW_MS = 10000; // penyewa memperbarui klaim tiap ini selama bersembunyi (< lease)
exports.MAX_LOCKER_ENTRIES = 16; // batas ukuran snapshot yang diterima klien (maks 6 pemain x 1 loker; sisanya buangan)
exports.LOCKER_ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;
/** Galat bisnis (jawaban sah server, bukan kegagalan): dipetakan ke kode API yang sama dengan fungsi SQL (raise exception 'not_member', dst). */
class LockerError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}
exports.LockerError = LockerError;
const isLockerAction = (v) => v === 'enter' || v === 'exit' || v === 'release';
exports.isLockerAction = isLockerAction;
const validLockerId = (v) => typeof v === 'string' && exports.LOCKER_ID_RE.test(v);
exports.validLockerId = validLockerId;
/** Id loker = id kompartemen pertama furniture itu (satu furniture multi-pintu = SATU loker). `#` (pemisah kompartemen) tidak lolos ID_RE -> `:`. */
const lockerKeyOf = (id) => String(id).replace(/#/g, ':').replace(/[^A-Za-z0-9_.:@-]/g, '_').slice(0, 64);
exports.lockerKeyOf = lockerKeyOf;
/** Snapshot dari jaringan TIDAK dipercaya: id & uid divalidasi, ukuran dibatasi. null = bukan snapshot. */
function sanitizeLockers(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(raw)) {
        if (!(0, exports.validLockerId)(k) || typeof v !== 'string' || v.length === 0 || v.length > 128)
            continue;
        if (++n > exports.MAX_LOCKER_ENTRIES)
            break;
        out[k] = v;
    }
    return out;
}
const sameLockers = (a, b) => {
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => b[k] === a[k]);
};
exports.sameLockers = sameLockers;
/**
 * Aturan "klaim hidup" (HARUS sama dengan room_lockers_view() di SQL dan liveLockers() di relay):
 * pemegang ada di `onlineIds` (anggota room yang online menurut aturan room_view) DAN renewed_at < LOCKER_LEASE_S.
 * Mengembalikan peta klaim hidup + daftar id loker yang basi (boleh dihapus). Bila ada dua baris untuk satu loker (tidak seharusnya terjadi),
 * yang diperbarui paling baru menang dan sisanya dianggap basi.
 */
function liveClaims(rows, onlineIds, nowMs, leaseS = exports.LOCKER_LEASE_S) {
    const ts = (r) => (typeof r.renewed_at === 'number' ? r.renewed_at : Date.parse(r.renewed_at));
    const stale = [], fresh = [];
    for (const r of rows) {
        const t = ts(r);
        if (!onlineIds.has(r.user_id) || !Number.isFinite(t) || nowMs - t >= leaseS * 1000)
            stale.push(r);
        else
            fresh.push(r);
    }
    fresh.sort((a, b) => ts(a) - ts(b)); // yang paling baru diperbarui diproses terakhir -> menang
    const live = {}, winner = new Map();
    for (const r of fresh) {
        const prev = winner.get(r.locker_id);
        if (prev)
            stale.push(prev);
        winner.set(r.locker_id, r);
        live[r.locker_id] = r.user_id;
    }
    return { live, stale };
}
exports.LOCKER_POKE = { v: 1, t: 'lk' };
const isLockerMsg = (raw) => !!raw && typeof raw === 'object' && raw.t === 'lk';
exports.isLockerMsg = isLockerMsg;
// ---- Jalur cadangan peer-to-peer (dipakai LockerClient bila SERVER/tabel loker tidak tersedia; lewat pesan realtime room yang sudah ada) ----
// Tanpa jalur ini, server/tabel yang belum siap membuat SEMUA loker ditolak. Aturan P2P: pemegang menyiarkan `hold` tiap LOCKER_P2P_BEAT_MS;
// klaim peer dianggap hidup bila peer masih ada di roster online DAN beat terakhir < LOCKER_P2P_TTL_MS. Klaim serentak: uid terkecil menang.
exports.LOCKER_P2P_BEAT_MS = 3000;
exports.LOCKER_P2P_TTL_MS = 9000;
exports.LOCKER_P2P_SETTLE_MS = 250; // jendela tunggu klaim serentak sebelum dianggap berhasil
exports.LOCKER_SERVER_RETRY_MS = 15000; // setelah server gagal, jangan mencoba server lagi selama ini (hindari antrean macet)
exports.LOCKER_API_TIMEOUT_MS = 4000;
const lockerP2P = (a, k) => (k === undefined ? { v: 1, t: 'lk', a } : { v: 1, t: 'lk', a, k });
exports.lockerP2P = lockerP2P;
/** Pesan P2P dari jaringan TIDAK dipercaya: aksi & id divalidasi. null = bukan pesan P2P (mis. colekan biasa). */
function sanitizeLockerP2P(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    if (r.t !== 'lk' || (r.a !== 'claim' && r.a !== 'hold' && r.a !== 'rel'))
        return null;
    if (r.k === undefined || r.k === null)
        return r.a === 'rel' ? { a: r.a, k: null } : null;
    return (0, exports.validLockerId)(r.k) ? { a: r.a, k: r.k } : null;
}
