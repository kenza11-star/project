"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onlineMemberIds = onlineMemberIds;
exports.readLockersViaTables = readLockersViaTables;
exports.lockerOpViaTables = lockerOpViaTables;
// Operasi loker lewat TABEL (jalur cadangan bila fungsi SQL locker_op gagal) -- klien Supabase DISUNTIKKAN, jadi logikanya dites di
// scripts/test-lockers.js dengan tabel tiruan yang menegakkan kunci unik yang sama dengan Postgres.
//
// Atomisitas tanpa transaksi: tabel room_lockers punya PRIMARY KEY (room_id, locker_id) dan UNIQUE (room_id, user_id). Dua pemain yang
// mengklaim loker yang sama bersamaan -> INSERT kedua ditolak database (kode 23505) -> dijawab `occupied`. Tidak ada celah cek-lalu-tulis.
const lockers_1 = require("./lockers");
const roomview_1 = require("./roomview");
const iso = (ms) => new Date(ms).toISOString();
const fail = (what, e) => {
    const x = (e && typeof e === 'object' ? e : {});
    const err = new Error(`lockers ${what}: ${String(x.code ?? '')} ${String(x.message ?? '').slice(0, 100)}`);
    if (typeof x.code === 'string')
        err.code = x.code;
    throw err;
};
/** Anggota yang ONLINE (aturan sama dengan room_view: bukan left, last_seen < jendela online sesuai status room). */
function onlineMemberIds(status, members, nowMs) {
    const win = (0, roomview_1.onlineSeconds)(status) * 1000, out = new Set();
    for (const m of members)
        if (!m.left_at && nowMs - Date.parse(m.last_seen) < win)
            out.add(String(m.user_id));
    return out;
}
/** Hanya baca: snapshot klaim hidup (untuk jalur sync). Tabel belum ada (migrasi v5 belum jalan) -> undefined, sync tetap berjalan. */
async function readLockersViaTables(sb, roomId, onlineIds, nowMs = Date.now()) {
    const r = await sb.from('room_lockers').select('locker_id,user_id,renewed_at').eq('room_id', roomId);
    if (r.error)
        return undefined;
    return (0, lockers_1.liveClaims)((r.data || []), onlineIds, nowMs).live;
}
async function lockerOpViaTables(sb, a) {
    const now = a.nowMs ?? Date.now();
    const room = await sb.from('rooms').select('id,status').eq('id', a.roomId).maybeSingle();
    if (room.error)
        fail('rooms', room.error);
    if (!room.data)
        throw new lockers_1.LockerError('room_not_found');
    if (room.data.status === 'closed')
        throw new lockers_1.LockerError('room_closed');
    const mem = await sb.from('room_members').select('user_id,left_at,last_seen').eq('room_id', a.roomId);
    if (mem.error)
        fail('room_members', mem.error);
    const members = (mem.data || []);
    const me = members.find((m) => m.user_id === a.uid && !m.left_at);
    if (!me)
        throw new lockers_1.LockerError('not_member');
    // permintaan ini = bukti pemain hidup (sama dengan SQL: last_seen diperbarui sebelum klaim dihitung)
    const touch = await sb.from('room_members').update({ last_seen: iso(now) }).eq('room_id', a.roomId).eq('user_id', a.uid).is('left_at', null);
    if (touch.error)
        fail('touch', touch.error);
    me.last_seen = iso(now);
    const online = onlineMemberIds(room.data.status, members, now);
    const readLive = async () => {
        const c = await sb.from('room_lockers').select('locker_id,user_id,renewed_at').eq('room_id', a.roomId);
        if (c.error)
            fail('room_lockers', c.error);
        const { live, stale } = (0, lockers_1.liveClaims)((c.data || []), online, now);
        // hapus HANYA baris basi yang persis sama (pemilik + loker): klaim baru yang masuk bersamaan tidak ikut terhapus
        for (const s of stale) {
            const d = await sb.from('room_lockers').delete().eq('room_id', a.roomId).eq('locker_id', s.locker_id).eq('user_id', s.user_id);
            if (d.error)
                fail('purge', d.error);
        }
        return live;
    };
    let live = await readLive();
    let ok = true, owner = null;
    if (a.action === 'enter') {
        const locker = a.locker;
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
            const cur = live[locker];
            if (cur && cur !== a.uid) {
                ok = false;
                owner = cur;
                done = true;
                break;
            }
            // satu pemain = satu loker: lepas loker lain milik sendiri dulu
            const rel = await sb.from('room_lockers').delete().eq('room_id', a.roomId).eq('user_id', a.uid).neq('locker_id', locker);
            if (rel.error)
                fail('release-other', rel.error);
            for (const k of Object.keys(live))
                if (live[k] === a.uid && k !== locker)
                    delete live[k];
            if (cur === a.uid) { // sudah milik sendiri: perbarui lease
                const up = await sb.from('room_lockers').update({ renewed_at: iso(now) }).eq('room_id', a.roomId).eq('locker_id', locker).eq('user_id', a.uid);
                if (up.error)
                    fail('renew', up.error);
                done = true;
                break;
            }
            const ins = await sb.from('room_lockers').insert({ room_id: a.roomId, locker_id: locker, user_id: a.uid, claimed_at: iso(now), renewed_at: iso(now) });
            if (!ins.error) {
                live[locker] = a.uid;
                done = true;
                break;
            }
            if (String(ins.error.code) !== '23505')
                fail('insert', ins.error);
            // Kunci unik menolak: pemain lain menang balapan (atau ada baris sendiri dari permintaan ganda). Baca ulang lalu putuskan di putaran berikut.
            live = await readLive();
        }
        if (!done)
            fail('claim', { code: 'contention' }); // tidak pernah melaporkan sukses/ditolak tanpa kepastian
    }
    else if (a.action === 'exit') {
        const d = await sb.from('room_lockers').delete().eq('room_id', a.roomId).eq('locker_id', a.locker).eq('user_id', a.uid);
        if (d.error)
            fail('exit', d.error);
        if (live[a.locker] === a.uid)
            delete live[a.locker];
    }
    else {
        const d = await sb.from('room_lockers').delete().eq('room_id', a.roomId).eq('user_id', a.uid);
        if (d.error)
            fail('release', d.error);
        for (const k of Object.keys(live))
            if (live[k] === a.uid)
                delete live[k];
    }
    return { ok, reason: ok ? null : 'occupied', owner: ok ? null : owner, lockers: live, server_time: iso(Date.now()), via: 'tables' };
}
