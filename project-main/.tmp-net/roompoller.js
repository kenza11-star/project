"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomPoller = exports.realPollClock = exports.PUMP_MS = exports.STUCK_MS = exports.POLL_MS = void 0;
exports.POLL_MS = 1500;
exports.STUCK_MS = 8000;
exports.PUMP_MS = 500;
exports.realPollClock = { now: () => Date.now(), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h) };
const codeOf = (e) => (e && typeof e === 'object' && 'code' in e ? String(e.code) : '');
const msgOf = (e) => (e instanceof Error && e.message ? e.message : 'Gagal sinkron dengan server');
class RoomPoller {
    constructor(d) {
        this.d = d;
        this.seq = 0;
        this.applied = 0;
        this.startedAt = 0;
        this.lastPollAt = -1e9;
        this.inflight = false;
        this.misses = 0;
        this.rejoined = false;
        this.lastSig = '';
        this.stopped = false;
        this.finished = false;
        this.timer = null;
        this.lastServerTime = 0;
        this.polls = 0; // jumlah request yang dimulai (untuk tes)
        this.clock = d.clock ?? exports.realPollClock;
    }
    start() { this.timer = this.clock.setInterval(() => this.pump(false), exports.PUMP_MS); this.pump(true); }
    stop() { this.stopped = true; if (this.timer != null)
        this.clock.clearInterval(this.timer); this.timer = null; }
    kick() { this.misses = 0; this.pump(true); }
    dead() { return this.stopped || this.finished; }
    finish(fn) { if (this.dead())
        return; this.finished = true; fn(); }
    pump(force) {
        if (this.dead())
            return;
        const now = this.clock.now();
        if (this.inflight && now - this.startedAt < exports.STUCK_MS)
            return; // sedang berjalan normal
        const gap = this.misses ? Math.min(5000, exports.POLL_MS * (1 + this.misses)) : exports.POLL_MS; // backoff saat server bermasalah
        if (!force && !this.inflight && now - this.lastPollAt < gap)
            return;
        this.lastPollAt = now;
        void this.poll();
    }
    async poll() {
        const my = ++this.seq;
        this.polls++;
        this.inflight = true;
        this.startedAt = this.clock.now();
        const room = this.d.room;
        try {
            const s = await this.d.fetchState(room.roomId);
            if (this.dead() || my < this.applied)
                return;
            // Snapshot yang lebih TUA menurut jam server (mis. instance serverless lain yang lambat) tidak boleh menimpa yang sudah diterapkan.
            const st = s.server_time ? Date.parse(s.server_time) : NaN;
            if (Number.isFinite(st)) {
                if (st < this.lastServerTime - 1500) {
                    this.d.onDiag?.('stale_snapshot_dropped', { server_time: s.server_time });
                    return;
                }
                this.lastServerTime = st;
            }
            this.applied = my;
            this.misses = 0;
            this.rejoined = false;
            this.d.onErr(null);
            const sig = JSON.stringify([s.status, s.host_id, s.max_players, s.members, s.online_count, s.can_start, s.dbg]);
            if (sig !== this.lastSig) {
                this.lastSig = sig;
                this.d.onView(s);
                this.d.onDiag?.('view', { online: s.online_count ?? s.members.filter((m) => m.online).length, members: s.members.length, status: s.status, server_time: s.server_time, backend: s.backend, build: s.build, via: s.via });
            }
            if (s.status === 'closed') {
                this.finish(() => this.d.onGone('Room ditutup.'));
                return;
            }
            if (s.status === 'playing') {
                this.finish(() => this.d.onPlaying({ ...room, status: 'playing', slot: s.members.find((m) => m.id === this.d.selfId)?.slot ?? room.slot, hostId: s.host_id }));
                return;
            }
        }
        catch (e) {
            if (this.dead() || my < this.applied)
                return;
            this.applied = my;
            const c = codeOf(e);
            this.d.onDiag?.('poll_error', { code: c || 'network', msg: msgOf(e).slice(0, 120) });
            if (c === 'room_closed') {
                this.finish(() => this.d.onGone('Room ditutup.'));
                return;
            }
            if (c === 'not_member') {
                // Kursi terlepas (mis. koneksi lama putus): coba gabung ulang SEKALI sebelum menyerah.
                if (!this.rejoined) {
                    this.rejoined = true;
                    this.d.onDiag?.('rejoin', { code: room.code });
                    try {
                        await this.d.rejoin(room.code);
                    }
                    catch (e2) {
                        this.finish(() => this.d.onGone(e2 instanceof Error && e2.message ? e2.message : 'Kamu keluar dari room.'));
                        return;
                    }
                }
                else {
                    this.finish(() => this.d.onGone('Kamu tidak lagi ada di room ini.'));
                    return;
                }
            }
            else {
                this.misses++;
                this.d.onErr(c === 'unauthorized' ? 'Sesi login bermasalah' : msgOf(e));
            }
        }
        finally {
            if (my === this.seq)
                this.inflight = false;
        }
    }
}
exports.RoomPoller = RoomPoller;
