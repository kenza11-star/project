"use strict";
// Sinkronisasi state dunia bersama (logika murni, tanpa three/react; dites di scripts/test-net.js).
//
// Cakupan: pintu yang dibuka/ditutup pemain, benda (soda/key) yang diambil, gembok yang dibuka, container berisi loot yang sudah digeledah.
// TIDAK dicakup (tetap lokal per pemain): kejadian acak (pintu dibanting, scare/SCP-106, lampu berkedip), win/lose, inventory.
//
// Model: tiap klien mengirim event saat aksi lokal, dan "digest" (seluruh perubahan sejak awal run) berkala + saat ada pemain baru,
// jadi pemain yang masuk terlambat / reconnect / kehilangan paket tetap konvergen. Merge-nya CRDT sederhana:
//  - taken / lock / cont: himpunan yang hanya bertambah (union), idempoten;
//  - door: last-writer-wins berdasarkan cap waktu ts (jam dinding; selisih jam antarperangkat bisa membuat dua toggle serentak berakhir berbeda
//    sesaat sampai digest berikutnya menyatukan - dapat diterima untuk pintu).
// Pesan jaringan TIDAK dipercaya: semua lewat sanitizeWorldMsg().
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldSync = exports.isWorldMsg = exports.MAX_WORLD_EVENTS = void 0;
exports.sanitizeWorldMsg = sanitizeWorldMsg;
exports.MAX_WORLD_EVENTS = 400;
const ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;
const isWorldMsg = (raw) => !!raw && typeof raw === 'object' && raw.t === 'w';
exports.isWorldMsg = isWorldMsg;
function sanitizeWorldMsg(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    if (r.v !== 1 || r.t !== 'w' || !Array.isArray(r.ev))
        return null;
    const out = [];
    for (const e of r.ev.slice(0, exports.MAX_WORLD_EVENTS)) {
        if (!e || typeof e !== 'object')
            continue;
        const x = e;
        if (x.k === 'door') {
            if (typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 1000 && (x.o === 0 || x.o === 1) && typeof x.ts === 'number' && Number.isFinite(x.ts))
                out.push({ k: 'door', i: x.i, o: x.o, ts: x.ts });
        }
        else if ((x.k === 'taken' || x.k === 'lock' || x.k === 'cont') && typeof x.id === 'string' && ID_RE.test(x.id))
            out.push({ k: x.k, id: x.id });
    }
    return { v: 1, t: 'w', ev: out };
}
class WorldSync {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.doors = new Map();
        this.sets = { taken: new Set(), lock: new Set(), cont: new Set() };
    }
    /** Aksi lokal: catat dan kembalikan pesan untuk dikirim (null = tidak ada perubahan / tidak perlu dikirim). */
    local(e) {
        if (e.k === 'door') {
            const prev = this.doors.get(e.i);
            if (prev && prev.o === e.o)
                return null;
            const ts = Math.max(this.now(), (prev?.ts ?? 0) + 1); // monoton per pintu
            this.doors.set(e.i, { o: e.o, ts });
            return { v: 1, t: 'w', ev: [{ k: 'door', i: e.i, o: e.o, ts }] };
        }
        const set = this.sets[e.k];
        if (set.has(e.id) || set.size >= exports.MAX_WORLD_EVENTS)
            return null;
        set.add(e.id);
        return { v: 1, t: 'w', ev: [{ k: e.k, id: e.id }] };
    }
    /** Seluruh perubahan sejauh ini (dikirim berkala dan saat ada pemain baru). null bila kosong. */
    digest() {
        const ev = [];
        for (const [i, d] of this.doors)
            ev.push({ k: 'door', i, o: d.o, ts: d.ts });
        for (const k of ['taken', 'lock', 'cont'])
            for (const id of this.sets[k])
                ev.push({ k, id });
        return ev.length ? { v: 1, t: 'w', ev: ev.slice(0, exports.MAX_WORLD_EVENTS) } : null;
    }
    /** Pesan dari pemain lain: validasi, gabungkan, dan kembalikan HANYA event yang benar-benar mengubah state (untuk diterapkan ke dunia). */
    receive(raw) {
        const m = sanitizeWorldMsg(raw);
        if (!m)
            return [];
        const eff = [];
        for (const e of m.ev) {
            if (e.k === 'door') {
                const prev = this.doors.get(e.i), ts = e.ts ?? 0;
                if (prev && prev.ts >= ts)
                    continue; // lebih lama / sama: abaikan
                this.doors.set(e.i, { o: e.o, ts });
                if (!prev || prev.o !== e.o)
                    eff.push({ k: 'door', i: e.i, o: e.o });
            }
            else {
                const set = this.sets[e.k];
                if (set.has(e.id) || set.size >= exports.MAX_WORLD_EVENTS)
                    continue;
                set.add(e.id);
                eff.push(e);
            }
        }
        return eff;
    }
    reset() { this.doors.clear(); this.sets.taken.clear(); this.sets.lock.clear(); this.sets.cont.clear(); }
}
exports.WorldSync = WorldSync;
