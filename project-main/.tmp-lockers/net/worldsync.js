"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldSync = exports.isWorldMsg = exports.MAX_WORLD_EVENTS = void 0;
exports.sanitizeWorldMsg = sanitizeWorldMsg;
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
const mission_1 = require("./mission");
const isPzSnap = (x) => {
    if (!x || typeof x !== 'object')
        return false;
    const o = x;
    const int = (k, lo, hi) => typeof o[k] === 'number' && Number.isInteger(o[k]) && o[k] >= lo && o[k] <= hi;
    return int('v', 0, 1000000) && int('a', 0, 5) && int('b', 0, 31) && int('c', 0, 215) && int('d', 0, 5) && int('f', 0, 31) && (o.g === undefined || int('g', 0, 2999));
};
exports.MAX_WORLD_EVENTS = 400;
const ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;
const cn = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 500; // koordinat dunia yang masuk akal (= WORLD_LIMIT di protocol.ts)
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
        if (x.k === 'pdoor') {
            if ((x.id === 0 || x.id === 1) && (x.o === 0 || x.o === 1))
                out.push({ k: 'pdoor', id: x.id, o: x.o });
        }
        else if (x.k === 'door') {
            if (typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 1000 && (x.o === 0 || x.o === 1) && typeof x.ts === 'number' && Number.isFinite(x.ts))
                out.push({ k: 'door', i: x.i, o: x.o, ts: x.ts });
        }
        else if ((x.k === 'taken' || x.k === 'lock' || x.k === 'cont') && typeof x.id === 'string' && ID_RE.test(x.id))
            out.push({ k: x.k, id: x.id });
        else if ((x.k === 'mission' || x.k === 'mreq') && (0, mission_1.isMissionId)(x.id))
            out.push({ k: x.k, id: x.id });
        else if (x.k === 'sw') {
            if (typeof x.v === 'number' && Number.isInteger(x.v) && x.v >= 0 && x.v <= 1000000 && typeof x.p === 'number' && Number.isInteger(x.p) && x.p >= 0 && x.p <= 5 && (x.r === 0 || x.r === 1))
                out.push({ k: 'sw', v: x.v, p: x.p, r: x.r });
        }
        else if (x.k === 'pz') {
            if (isPzSnap(x) && (x.r === 0 || x.r === 1) && typeof x.lp === 'number' && Number.isInteger(x.lp) && x.lp >= 0 && x.lp <= 40)
                out.push({ k: 'pz', v: x.v, a: x.a, b: x.b, c: x.c, d: x.d, f: x.f, g: x.g ?? 0, r: x.r, lp: x.lp });
        }
        else if (x.k === 'pzreq') {
            if ((x.t === 0 || x.t === 1 || x.t === 2 || x.t === 3 || x.t === 4) && typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 5)
                out.push({ k: 'pzreq', t: x.t, i: x.i });
        }
        else if (x.k === 'swreq' && typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 5)
            out.push({ k: 'swreq', i: x.i });
        else if (x.k === 'rreq') {
            if (typeof x.v === 'string' && ID_RE.test(x.v) && (x.o === 0 || x.o === 1))
                out.push({ k: 'rreq', v: x.v, o: x.o });
        }
        else if (x.k === 'ping') {
            if (cn(x.x) && cn(x.y) && cn(x.z) && (x.l === 0 || x.l === 1))
                out.push({ k: 'ping', x: x.x, y: x.y, z: x.z, l: x.l });
        }
        else if (x.k === 'shout') {
            if (cn(x.x) && cn(x.z) && (x.l === 0 || x.l === 1))
                out.push({ k: 'shout', x: x.x, z: x.z, l: x.l });
        }
        else if (x.k === 'rs') {
            if (typeof x.v === 'string' && ID_RE.test(x.v) && typeof x.p === 'number' && Number.isInteger(x.p) && x.p >= 0 && x.p <= 1000 && typeof x.n === 'number' && Number.isInteger(x.n) && x.n >= 0 && x.n <= 8)
                out.push({ k: 'rs', v: x.v, p: x.p, n: x.n });
        }
        else if (x.k === 'rok') {
            if (typeof x.v === 'string' && ID_RE.test(x.v) && typeof x.q === 'number' && Number.isInteger(x.q) && x.q >= 0 && x.q <= 1000000)
                out.push({ k: 'rok', v: x.v, q: x.q });
        }
    }
    return { v: 1, t: 'w', ev: out };
}
class WorldSync {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.doors = new Map();
        this.pz = null; // state ruangan puzzle terbaru (LWW berdasarkan versi dari host)
        this.sw = null; // state puzzle saklar terbaru (LWW berdasarkan versi dari host)
        this.sets = { taken: new Set(), lock: new Set(), cont: new Set(), mission: new Set() };
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
        if (e.k === 'mreq')
            return { v: 1, t: 'w', ev: [{ k: 'mreq', id: e.id }] };
        if (e.k === 'pzreq')
            return { v: 1, t: 'w', ev: [{ k: 'pzreq', t: e.t, i: e.i }] };
        if (e.k === 'pz') {
            if (this.pz && e.v <= this.pz.v)
                return null;
            this.pz = { v: e.v, a: e.a, b: e.b, c: e.c, d: e.d, f: e.f, g: e.g ?? 0 };
            return { v: 1, t: 'w', ev: [e] };
        }
        if (e.k === 'swreq')
            return { v: 1, t: 'w', ev: [{ k: 'swreq', i: e.i }] };
        if (e.k === 'pdoor')
            return { v: 1, t: 'w', ev: [{ k: 'pdoor', id: e.id, o: e.o }] };
        if (e.k === 'rreq' || e.k === 'rs' || e.k === 'rok' || e.k === 'ping' || e.k === 'shout')
            return { v: 1, t: 'w', ev: [e] }; // STAGE 3: sekali jalan, tidak disimpan (bukan bagian digest)
        if (e.k === 'sw') {
            if (this.sw && e.v <= this.sw.v)
                return null;
            this.sw = { v: e.v, p: e.p };
            return { v: 1, t: 'w', ev: [e] };
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
        for (const k of ['taken', 'lock', 'cont', 'mission'])
            for (const id of this.sets[k])
                ev.push({ k, id });
        if (this.pz)
            ev.push({ k: 'pz', ...this.pz, r: 0, lp: 0 });
        if (this.sw)
            ev.push({ k: 'sw', v: this.sw.v, p: this.sw.p, r: 0 }); // r=0: pemain terlambat tidak membunyikan alarm lama
        return ev.length ? { v: 1, t: 'w', ev: ev.slice(0, exports.MAX_WORLD_EVENTS) } : null;
    }
    /** Pesan dari pemain lain: validasi, gabungkan, dan kembalikan HANYA event yang benar-benar mengubah state (untuk diterapkan ke dunia). */
    /** `fromHost`: pengirim adalah host room. Event 'mission' dari non-host DIBUANG (host = otoritas status misi). */
    receive(raw, fromHost = true) {
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
            else if (e.k === 'pz') {
                if (!fromHost || (this.pz && e.v <= this.pz.v))
                    continue;
                this.pz = { v: e.v, a: e.a, b: e.b, c: e.c, d: e.d, f: e.f, g: e.g ?? 0 };
                eff.push(e);
            }
            else if (e.k === 'rs' || e.k === 'rok') {
                if (fromHost)
                    eff.push(e); // STAGE 3: hanya host yang menentukan; tidak digabung
            }
            else if (e.k === 'mreq' || e.k === 'swreq' || e.k === 'pzreq' || e.k === 'rreq' || e.k === 'ping' || e.k === 'shout' || e.k === 'pdoor') {
                eff.push(e); // dikerjakan host saja (World.applyNet); tidak digabung
            }
            else if (e.k === 'sw') {
                if (!fromHost || (this.sw && e.v <= this.sw.v))
                    continue; // hanya host yang menentukan; versi lama/sama diabaikan
                this.sw = { v: e.v, p: e.p };
                eff.push(e);
            }
            else {
                if (e.k === 'mission' && !fromHost)
                    continue;
                const set = this.sets[e.k];
                if (set.has(e.id) || set.size >= exports.MAX_WORLD_EVENTS)
                    continue;
                set.add(e.id);
                eff.push(e);
            }
        }
        return eff;
    }
    reset() { this.doors.clear(); this.sets.taken.clear(); this.sets.lock.clear(); this.sets.cont.clear(); this.sets.mission.clear(); this.sw = null; this.pz = null; }
}
exports.WorldSync = WorldSync;
