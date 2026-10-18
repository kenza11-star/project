"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimit = exports.CatchLedger = exports.MonsterReplica = exports.isMonsterMsg = void 0;
exports.sanitizeMonsterMsg = sanitizeMonsterMsg;
exports.electAuthority = electAuthority;
// Protokol sinkronisasi monster (murni, tanpa three/DOM). Dikirim lewat transport room yang sudah ada (Supabase Realtime broadcast);
// TIDAK ada perubahan API route / skema database / env. Otoritas = pemain online dengan slot terendah (bukan server): hanya otoritas
// yang menjalankan AI & memvalidasi tangkapan; klien lain hanya menerima snapshot dan menginterpolasi.
const monster_1 = require("../game/monster");
const isMonsterMsg = (raw) => { const t = raw?.t; return t === 'm' || t === 'mc'; };
exports.isMonsterMsg = isMonsterMsg;
const fin = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
/** Validasi ketat pesan masuk (tak dipercaya): bentuk, tipe, batas nilai, panjang string. */
function sanitizeMonsterMsg(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    if (r.v !== 1 || !int(r.e, 1e9) || !int(r.s, 2147483647))
        return null;
    if (r.t === 'm') {
        if (!fin(r.x, 500) || !fin(r.z, 500) || !fin(r.yw, 20) || !int(r.st, monster_1.MON_STATES.length - 1) || typeof r.tg !== 'string' || r.tg.length > 64 || !fin(r.sp, 20) || !int(r.wp, 64))
            return null;
        return { v: 1, t: 'm', e: r.e, s: r.s, x: r.x, z: r.z, yw: r.yw, st: r.st, tg: r.tg, sp: r.sp, wp: r.wp };
    }
    if (r.t === 'mc') {
        if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64)
            return null;
        return { v: 1, t: 'mc', e: r.e, s: r.s, id: r.id };
    }
    return null;
}
/** Otoritas = pemain online dengan slot terendah (termasuk diri sendiri); seri -> id terkecil. Konsisten di semua klien yang rostrnya sama. */
function electAuthority(selfId, selfSlot, peers) {
    let best = { id: selfId, slot: selfSlot };
    for (const p of peers)
        if (p.online && (p.slot < best.slot || (p.slot === best.slot && p.id < best.id)))
            best = { id: p.id, slot: p.slot };
    return best.id;
}
const wrapPi = (a) => { while (a > Math.PI)
    a -= 2 * Math.PI; while (a < -Math.PI)
    a += 2 * Math.PI; return a; };
/** Replika di klien non-otoritas: menerima snapshot (monoton per epoch/seq), interpolasi 120 ms di belakang, ekstrapolasi maks 250 ms. */
class MonsterReplica {
    constructor() {
        this.epoch = 0;
        this.seq = -1;
        this.lastRecv = -1e9;
        this.buf = [];
    }
    /** true bila snapshot dipakai (lebih baru). */
    push(m, nowMs) {
        if (m.e < this.epoch || (m.e === this.epoch && m.s <= this.seq))
            return false;
        if (m.e > this.epoch)
            this.buf.length = 0;
        this.epoch = m.e;
        this.seq = m.s;
        this.lastRecv = nowMs;
        this.buf.push({ t: nowMs, m });
        if (this.buf.length > 12)
            this.buf.shift();
        return true;
    }
    sample(nowMs) {
        const b = this.buf;
        if (!b.length)
            return null;
        const rt = nowMs - 120;
        let a = b[0], c = b[b.length - 1];
        for (let i = 0; i < b.length - 1; i++)
            if (b[i].t <= rt && b[i + 1].t >= rt) {
                a = b[i];
                c = b[i + 1];
                break;
            }
        const last = b[b.length - 1];
        let x, z, yaw, m = last.m;
        if (rt >= last.t) {
            const dt = Math.min((rt - last.t) / 1000, 0.25), sp = last.m.sp, vx = Math.sin(last.m.yw) * sp, vz = Math.cos(last.m.yw) * sp;
            const mv = last.m.st === 5 ? 0 : 1;
            x = last.m.x + vx * dt * mv;
            z = last.m.z + vz * dt * mv;
            yaw = last.m.yw;
        }
        else if (rt <= b[0].t) {
            x = b[0].m.x;
            z = b[0].m.z;
            yaw = b[0].m.yw;
            m = b[0].m;
        }
        else {
            const k = (rt - a.t) / Math.max(1, c.t - a.t);
            x = a.m.x + (c.m.x - a.m.x) * k;
            z = a.m.z + (c.m.z - a.m.z) * k;
            yaw = a.m.yw + wrapPi(c.m.yw - a.m.yw) * k;
            m = k < 0.5 ? a.m : c.m;
        }
        const st = monster_1.MON_STATES[m.st], sp = m.sp;
        return { x, z, yaw, state: st, targetId: m.tg, speed: sp, anim: st === 'catch' ? 'grab' : sp > 2.4 ? 'run' : sp > 0.3 ? 'walk' : 'idle', stale: nowMs - this.lastRecv > 3000, epoch: this.epoch };
    }
}
exports.MonsterReplica = MonsterReplica;
/** Mencegah tangkapan ganda dari pesan duplikat (pengiriman ulang) -> jumpscare hanya sekali per kejadian. */
class CatchLedger {
    constructor() {
        this.seen = new Map();
    }
    /** true bila pesan ini baru (belum pernah diproses). */
    accept(m, nowMs) {
        for (const [k, t] of this.seen)
            if (nowMs - t > 30000)
                this.seen.delete(k);
        const key = m.e + ':' + m.s + ':' + m.id;
        if (this.seen.has(key))
            return false;
        this.seen.set(key, nowMs);
        return true;
    }
}
exports.CatchLedger = CatchLedger;
/** Pembatas laju pesan masuk per pengirim (anti-banjir). */
class RateLimit {
    constructor(max = 40, windowMs = 1000) {
        this.max = max;
        this.windowMs = windowMs;
        this.b = new Map();
    }
    allow(id, nowMs) { const e = this.b.get(id); if (!e || nowMs - e.t > this.windowMs) {
        this.b.set(id, { t: nowMs, n: 1 });
        return true;
    } return ++e.n <= this.max; }
}
exports.RateLimit = RateLimit;
