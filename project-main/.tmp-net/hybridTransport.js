"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HybridTransport = exports.RT_RETRY_MS = exports.RT_SILENCE_MS = exports.PUSH_SLOW_MS = exports.SLOW_MS = exports.FAST_MS = void 0;
const worldsync_1 = require("./worldsync");
const monsterproto_1 = require("./monsterproto");
const lockers_1 = require("./lockers");
exports.FAST_MS = 250; // relai cepat: ada penerima tanpa Realtime
exports.SLOW_MS = 1500; // relai lambat: semua sehat (juga heartbeat + daftar online)
exports.PUSH_SLOW_MS = 1000; // pengirim yang sehat tetap mengisi relai minimal 1x/dtk
exports.RT_SILENCE_MS = 3500; // peer online tapi tidak ada pesan Realtime selama ini -> Realtime dianggap tidak mengantar
exports.RT_RETRY_MS = 15000;
const MAX_FAILS = 3; // sync gagal berturut-turut -> putus (RoomClient akan sambung ulang)
const WORLD_QUEUE_MAX = 30;
class HybridTransport {
    constructor(d) {
        this.d = d;
        this.ev = null;
        this.closed = false;
        this.rt = null;
        this.rtUp = false;
        this.rtTimer = null;
        this.loop = null;
        this.lastRt = new Map();
        this.latest = null;
        this.latestSeq = -1;
        this.pushedSeq = -1;
        this.pushedAt = -1e9;
        this.worldQ = [];
        this.since = -1;
        this.fails = 0;
        this.needRelay = false; // server: ada anggota lain yang membutuhkan relai cepat
        this.degraded = false; // kita sendiri tidak menerima Realtime dari peer online
        this.online = new Set();
        this.inflight = false;
        this.again = false; // ada colekan saat sinkron sedang berjalan: ulangi segera setelah selesai
    }
    /** Untuk diagnostik/HUD/tes. */
    get realtimeUp() { return this.rtUp; }
    get mode() { return this.degraded || this.needRelay ? 'fast' : 'slow'; }
    async open(ev) {
        this.ev = ev;
        this.closed = false;
        this.fails = 0;
        this.since = -1;
        ev.onStatus('connecting');
        await this.once(); // sync pertama: gagal (bukan anggota / jaringan) -> melempar, RoomClient menjadwalkan sambung ulang
        if (this.closed)
            return;
        ev.onStatus('connected');
        this.schedule();
        void this.tryRealtime();
    }
    send(msg) {
        if (this.closed)
            return;
        if ((0, lockers_1.isLockerMsg)(msg)) {
            if (this.rtUp) {
                try {
                    this.rt?.send(msg);
                }
                catch { /* tanpa realtime: pemain lain memperbarui lewat relai (<= 1,5 dtk) */ }
            }
            return;
        } // colekan loker: hanya realtime, tidak masuk antrean relai
        if ((0, monsterproto_1.isMonsterMsg)(msg)) {
            if (this.rtUp) {
                try {
                    this.rt?.send(msg);
                }
                catch { /* jalur realtime putus: monster tidak tersinkron (pengikut menyembunyikannya), state pemain tidak terganggu */ }
            }
            return;
        } // bukan state pemain & bukan event dunia: jangan masuk antrean relai
        if ((0, worldsync_1.isWorldMsg)(msg)) {
            if (this.worldQ.length >= WORLD_QUEUE_MAX)
                this.worldQ.shift();
            this.worldQ.push(msg);
        }
        else {
            this.latest = msg;
            this.latestSeq = Number(msg.seq ?? -1);
        }
        if (this.rtUp) {
            try {
                this.rt?.send(msg);
            }
            catch { /* relai tetap membawa */ }
        }
    }
    /** Sinkron ke server sekarang (colekan loker dari pemain lain). Bila sedang sinkron, diulang sekali setelah selesai. */
    syncNow() {
        if (this.closed)
            return;
        if (this.inflight) {
            this.again = true;
            return;
        }
        if (this.loop) {
            this.d.clock.clearTimeout(this.loop);
            this.loop = null;
        }
        void this.cycle();
    }
    async close() {
        this.closed = true;
        if (this.loop)
            this.d.clock.clearTimeout(this.loop);
        this.loop = null;
        if (this.rtTimer)
            this.d.clock.clearTimeout(this.rtTimer);
        this.rtTimer = null;
        const rt = this.rt;
        this.rt = null;
        this.rtUp = false;
        try {
            await rt?.close();
        }
        catch { /* abaikan */ }
    }
    // ---- Realtime (opsional) ----
    async tryRealtime() {
        if (this.closed || this.rtUp)
            return;
        let t = null;
        try {
            t = this.d.realtime();
        }
        catch {
            t = null;
        }
        if (!t)
            return;
        this.rt = t;
        try {
            await t.open({
                onStatus: (s) => { if (this.rt !== t)
                    return; if (s === 'disconnected') {
                    this.rtUp = false;
                    this.retryRealtimeLater();
                } },
                onOnline: () => { },
                onMembers: () => { },
                onState: (from, raw) => { if (this.closed || this.rt !== t)
                    return; this.lastRt.set(from, this.d.clock.now()); this.ev?.onState(from, raw); },
            });
            if (this.closed || this.rt !== t) {
                await t.close().catch(() => { });
                return;
            }
            this.rtUp = true;
        }
        catch {
            this.rtUp = false;
            try {
                await t.close();
            }
            catch { /* abaikan */ }
            if (this.rt === t)
                this.rt = null;
            this.retryRealtimeLater();
        }
    }
    retryRealtimeLater() {
        if (this.closed || this.rtTimer)
            return;
        const old = this.rt;
        this.rt = null;
        void old?.close().catch(() => { });
        this.rtTimer = this.d.clock.setTimeout(() => { this.rtTimer = null; void this.tryRealtime(); }, exports.RT_RETRY_MS);
    }
    // ---- relai ----
    schedule() {
        if (this.closed || this.loop)
            return;
        const wait = this.mode === 'fast' ? exports.FAST_MS : exports.SLOW_MS;
        this.loop = this.d.clock.setTimeout(() => { this.loop = null; void this.cycle(); }, wait);
    }
    async cycle() {
        if (this.closed)
            return;
        try {
            await this.once();
            this.fails = 0;
        }
        catch (e) {
            const code = e?.code;
            if (code === 'not_member' || code === 'room_closed' || code === 'unauthorized' || ++this.fails >= MAX_FAILS) {
                this.ev?.onStatus('disconnected');
                return; // berhenti: RoomClient menutup transport ini dan menyambung ulang
            }
        }
        if (this.again && !this.closed) {
            this.again = false;
            if (this.loop) {
                this.d.clock.clearTimeout(this.loop);
                this.loop = null;
            }
            void this.cycle();
            return;
        }
        this.schedule();
    }
    async once() {
        if (this.inflight)
            return;
        this.inflight = true;
        try {
            const now = this.d.clock.now();
            const push = this.latest && this.latestSeq !== this.pushedSeq && (this.mode === 'fast' || now - this.pushedAt >= exports.PUSH_SLOW_MS);
            const world = this.mode === 'fast' ? this.worldQ.splice(0, 8) : (this.worldQ.length = 0, []); // sehat: event sudah lewat Realtime; digest 4 dtk menutup celah
            const req = { roomId: this.d.roomId, state: push ? this.latest : null, world, since: this.since, need: this.degraded };
            let res;
            try {
                res = await this.d.sync(req);
            }
            catch (e) {
                if (world.length)
                    this.worldQ.unshift(...world);
                throw e;
            }
            if (this.closed)
                return;
            if (push) {
                this.pushedSeq = this.latestSeq;
                this.pushedAt = now;
            }
            this.since = res.cursor;
            this.needRelay = !!res.need_relay;
            if (res.status === 'closed') {
                const e = new Error('room_closed');
                e.code = 'room_closed';
                throw e;
            }
            const members = res.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot }));
            const onlineIds = res.members.filter((m) => m.online).map((m) => m.id);
            this.online = new Set(onlineIds);
            this.ev?.onMembers(members);
            this.ev?.onOnline(onlineIds);
            if (res.lockers !== undefined) {
                const lk = (0, lockers_1.sanitizeLockers)(res.lockers);
                if (lk)
                    this.ev?.onLockers?.(lk, res.server_time ? Date.parse(res.server_time) : NaN);
            } // snapshot otoritatif dari server
            for (const [uid, st] of Object.entries(res.states || {}))
                if (uid !== this.d.selfId)
                    this.ev?.onState(uid, st);
            for (const w of res.world || [])
                if (w.from !== this.d.selfId)
                    this.ev?.onState(w.from, w.msg);
            // sehatkah Realtime kita? (hanya bermakna bila ada peer online lain)
            const t = this.d.clock.now();
            this.degraded = onlineIds.some((id) => id !== this.d.selfId && t - (this.lastRt.get(id) ?? -1e9) > exports.RT_SILENCE_MS);
        }
        finally {
            this.inflight = false;
        }
    }
}
exports.HybridTransport = HybridTransport;
