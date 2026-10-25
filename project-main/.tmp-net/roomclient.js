"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = exports.backoffMs = exports.realClock = void 0;
// RoomClient: state machine sisi klien untuk satu room multiplayer (logika murni, transport disuntikkan; dites di scripts/test-net.js).
//
// Tanggung jawab: daftar pemain remote (maks MAX_ROOM_PLAYERS-1), pesan masuk divalidasi, interpolasi per pemain, pengiriman posisi lokal
// 10 Hz (+ keepalive), pemain masuk/keluar, dan RECONNECT otomatis dengan backoff. TIDAK bergantung pada pause menu: pengiriman berjalan dari timer
// sendiri, jadi membuka menu di game tidak menghentikan pengiriman posisi (pemain lain tidak melihat kita freeze).
const worldsync_1 = require("./worldsync");
const monsterproto_1 = require("./monsterproto");
const lockers_1 = require("./lockers");
const protocol_1 = require("./protocol");
const voicemsg_1 = require("./voicemsg");
const interp_1 = require("./interp");
exports.realClock = {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h),
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h),
};
const backoffMs = (attempt, rand = Math.random) => Math.min(10000, 500 * 2 ** Math.min(attempt, 5)) + Math.floor(rand() * 300);
exports.backoffMs = backoffMs;
const CHAT_TTL_MS = 8000;
class RoomClient {
    constructor(opts) {
        this.opts = opts;
        this.status = 'idle';
        this.t = null;
        this.members = new Map();
        this.online = new Set();
        this.peers = new Map();
        this.local = null;
        this.lastSent = null;
        this.lastSentAt = -1e9;
        this.seq = 0;
        this.timer = null;
        this.retryTimer = null;
        this.attempt = 0;
        this.gen = 0; // generasi koneksi: callback dari transport lama diabaikan
        this.subs = new Set();
        this.droppedInvalid = 0;
        this.droppedFlood = 0;
        this.clampedMoves = 0;
        // ---- loker/lemari (lib/net/lockers.ts): status DIPUTUSKAN server; klien hanya menerima snapshot dan saling mencolek agar sinkron cepat ----
        this.lockerFns = new Set();
        this.lastPokeIn = -1e9;
        // ---- jalur cadangan P2P loker (lockers.ts): pesan klaim/hold/rel antar-pemain lewat realtime ----
        this.lockerMsgFns = new Set();
        // ---- event dunia ----
        this.worldFns = new Set();
        // ---- monster (lantai atas): snapshot/tangkapan dari otoritas. Hanya lewat jalur realtime (tidak melewati API server) ----
        this.monFns = new Set();
        // ---- chat (ikut state; lihat protocol.ts) ----
        this.chatFns = new Set();
        this.chatOut = [];
        this.chatSeq = 0;
        this.lastChatAt = -1e9;
        // ---- voice: sinyal WebRTC lewat jalur realtime ----
        this.rtcFns = new Set();
        // ---- status mic: broadcast {t:'mic',on} saat berubah + kirim ulang ke peer baru / setelah reconnect (tanpa polling) ----
        this.remoteMic = new Map();
        this.micFns = new Set();
        this.localMic = false;
        this.clock = opts.clock ?? exports.realClock;
        this.rand = opts.rand ?? Math.random;
        this.ep = 1 + Math.floor(this.rand() * 2 ** 30);
    }
    onChange(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    emit() { this.subs.forEach((f) => { try {
        f();
    }
    catch { /* pendengar tidak boleh merusak klien */ } }); }
    setStatus(s) { if (this.status !== s) {
        this.status = s;
        this.emit();
    } }
    async start() {
        if (this.status !== 'idle')
            return;
        this.setStatus('connecting');
        this.timer = this.clock.setInterval(() => this.tick(), protocol_1.SEND_INTERVAL_MS);
        await this.connect(false);
    }
    async connect(isRetry) {
        const gen = ++this.gen;
        try {
            if (isRetry && this.opts.beforeReconnect)
                await this.opts.beforeReconnect();
            if (this.status === 'closed' || gen !== this.gen)
                return;
            const t = this.opts.factory();
            this.t = t;
            const live = () => gen === this.gen && this.status !== 'closed';
            await t.open({
                onStatus: (s) => { if (live() && s === 'disconnected')
                    this.lost(); },
                onOnline: (ids) => { if (live())
                    this.setOnline(ids); },
                onMembers: (m) => { if (live())
                    this.setMembers(m); },
                onState: (from, raw) => { if (live())
                    this.recv(from, raw); },
                onLockers: (m, t) => { if (live())
                    for (const f of [...this.lockerFns]) {
                        try {
                            f(m, t);
                        }
                        catch { /* pendengar tidak boleh merusak klien */ }
                    } },
            });
            if (!live())
                return;
            this.attempt = 0;
            this.lastSentAt = -1e9; // kirim posisi segera setelah tersambung (juga setelah reconnect)
            this.setStatus('online');
            if (this.localMic)
                this.sendMic(); // reconnect: peer lain mungkin sudah menghapus status mic kita
        }
        catch {
            if (this.status !== 'closed' && gen === this.gen)
                this.lost();
        }
    }
    lost() {
        if (this.status === 'closed')
            return;
        this.gen++; // abaikan callback koneksi lama
        const old = this.t;
        this.t = null;
        old?.close().catch(() => { });
        this.setStatus('reconnecting');
        if (this.retryTimer)
            return;
        const wait = (0, exports.backoffMs)(this.attempt++, this.rand);
        this.retryTimer = this.clock.setTimeout(() => { this.retryTimer = null; void this.connect(true); }, wait);
    }
    async stop() {
        this.setStatus('closed');
        this.gen++;
        if (this.timer)
            this.clock.clearInterval(this.timer);
        this.timer = null;
        if (this.retryTimer)
            this.clock.clearTimeout(this.retryTimer);
        this.retryTimer = null;
        const t = this.t;
        this.t = null;
        this.peers.clear();
        this.remoteMic.clear();
        try {
            await t?.close();
        }
        catch { /* abaikan */ }
        this.emit();
    }
    // ---- anggota & presence ----
    setMembers(list) {
        this.members.clear();
        for (const m of list)
            if (m && typeof m.id === 'string')
                this.members.set(m.id, { id: m.id, name: (0, protocol_1.sanitizeName)(m.name), slot: Math.max(0, Math.min(protocol_1.MAX_ROOM_PLAYERS - 1, m.slot | 0)) });
        this.rebuild();
    }
    setOnline(ids) { this.online = new Set(ids.filter((x) => typeof x === 'string')); this.rebuild(); }
    /** Remote = anggota sah ∩ online, bukan diri sendiri, urut slot, maksimal MAX_ROOM_PLAYERS-1. */
    rebuild() {
        const want = [...this.members.values()].filter((m) => m.id !== this.opts.selfId && this.online.has(m.id)).sort((a, b) => a.slot - b.slot).slice(0, protocol_1.MAX_ROOM_PLAYERS - 1);
        let changed = false;
        for (const id of [...this.peers.keys()])
            if (!want.some((w) => w.id === id)) {
                this.peers.delete(id);
                this.remoteMic.delete(id);
                changed = true;
            }
        for (const w of want) {
            const p = this.peers.get(w.id);
            if (!p) {
                this.peers.set(w.id, { info: w, buf: new interp_1.SnapshotBuffer(), ep: -1, seq: -1, lastRecv: this.clock.now(), chatI: -1 });
                changed = true;
                if (this.localMic)
                    this.sendMic();
            }
            else if (p.info.name !== w.name || p.info.slot !== w.slot) {
                p.info = w;
                changed = true;
            }
        }
        if (changed)
            this.emit();
    }
    // ---- pesan masuk ----
    recv(from, raw) {
        if (from === this.opts.selfId)
            return;
        const p = this.peers.get(from);
        if ((0, voicemsg_1.isMicMsg)(raw)) {
            if (!p && !this.members.has(from))
                return;
            if (this.micOf(from) !== raw.on) {
                this.remoteMic.set(from, raw.on);
                for (const f of [...this.micFns]) {
                    try {
                        f();
                    }
                    catch { /* abaikan */ }
                }
            }
            return;
        } // status mic pemain lain (voicemsg.ts)
        if ((0, voicemsg_1.isRtcMsg)(raw)) {
            if (!p && !this.members.has(from))
                return;
            const m = raw;
            if (m.to === this.opts.selfId)
                for (const f of [...this.rtcFns]) {
                    try {
                        f(from, m);
                    }
                    catch { /* abaikan */ }
                }
            return;
        } // sinyal voice (WebRTC): hanya untuk penerima yang dituju; tetap diterima walau presence belum sampai (anggota sah)
        if (!p)
            return; // bukan anggota sah / belum online
        if ((0, lockers_1.isLockerMsg)(raw)) {
            if (typeof raw.a === 'string') {
                for (const f of [...this.lockerMsgFns]) {
                    try {
                        f(from, raw);
                    }
                    catch { /* pendengar tidak boleh merusak klien */ }
                }
            }
            else
                this.pokedBy();
            return;
        } // "colek": status loker berubah -> sinkron ulang dari server (isi pesan tidak dipercaya, tidak ada isi)
        if ((0, worldsync_1.isWorldMsg)(raw)) {
            for (const f of this.worldFns)
                f(from, raw);
            return;
        } // event dunia (worldsync.ts): divalidasi penerima
        if ((0, monsterproto_1.isMonsterMsg)(raw)) {
            for (const f of this.monFns)
                f(from, raw);
            return;
        } // monster (monstersync.ts): divalidasi penerima; hanya otoritas yang dipercaya
        const s = (0, protocol_1.sanitizeState)(raw);
        if (!s) {
            this.droppedInvalid++;
            return;
        }
        if (s.ep === p.ep && s.seq <= p.seq)
            return; // duplikat / terlambat
        if (s.ep !== p.ep) {
            p.buf.clear();
            p.chatI = -1;
        } // pengirim reconnect/refresh: mulai buffer baru
        const now = this.clock.now();
        if (s.ep === p.ep && now - p.lastRecv < protocol_1.MIN_RECV_GAP_MS) {
            this.droppedFlood++;
            return;
        } // banjir pesan
        const prev = s.ep === p.ep ? p.buf.last : null;
        let st = s;
        if (prev) {
            const c = (0, protocol_1.clampStep)(prev, s, now - p.lastRecv);
            st = c.state;
            if (c.clamped)
                this.clampedMoves++;
        }
        p.ep = s.ep;
        p.seq = s.seq;
        p.lastRecv = now;
        if (s.cm)
            for (const c of s.cm)
                if (c.i > p.chatI) {
                    p.chatI = c.i;
                    this.pushChat({ id: p.info.id, name: p.info.name, text: c.t, self: false, at: Date.now() });
                }
        p.buf.push(st, p.lastRecv);
    }
    onLockers(fn) { this.lockerFns.add(fn); return () => { this.lockerFns.delete(fn); }; }
    /** Beri tahu pemain lain bahwa status loker berubah (hanya jalur realtime; tanpa isi). */
    sendLockerPoke() { if (this.status !== 'online' || !this.t)
        return false; try {
        this.t.send(lockers_1.LOCKER_POKE);
    }
    catch {
        return false;
    } return true; }
    onLockerMsg(fn) { this.lockerMsgFns.add(fn); return () => { this.lockerMsgFns.delete(fn); }; }
    sendLockerMsg(msg) { if (this.status !== 'online' || !this.t)
        return false; try {
        this.t.send(msg);
    }
    catch {
        return false;
    } return true; }
    /** Id pemain remote yang sedang online di roster (anggota sah ∩ online). */
    peerIds() { return [...this.peers.keys()]; }
    /** Minta transport sinkron ke server sekarang. */
    requestSync() { try {
        this.t?.syncNow?.();
    }
    catch { /* abaikan */ } }
    pokedBy() { const now = this.clock.now(); if (now - this.lastPokeIn < 300)
        return; this.lastPokeIn = now; this.requestSync(); } // dibatasi: colekan beruntun tidak membanjiri server
    /** Daftarkan penerima event dunia dari pemain lain. Mengembalikan fungsi untuk berhenti. */
    onWorld(fn) { this.worldFns.add(fn); return () => { this.worldFns.delete(fn); }; }
    /** Kirim event dunia ke room. false bila belum online (event tetap tercatat di WorldSync dan ikut digest berikutnya). */
    sendWorld(msg) { if (this.status !== 'online' || !this.t)
        return false; this.t.send(msg); return true; }
    onMonster(fn) { this.monFns.add(fn); return () => { this.monFns.delete(fn); }; }
    sendMonster(msg) { if (this.status !== 'online' || !this.t)
        return false; this.t.send(msg); return true; }
    get selfId() { return this.opts.selfId; }
    /** Jumlah pemain remote yang sedang tercatat (untuk memicu digest saat ada yang baru masuk). */
    peerCount() { return this.peers.size; }
    onChat(fn) { this.chatFns.add(fn); return () => { this.chatFns.delete(fn); }; }
    pushChat(e) { for (const f of [...this.chatFns]) {
        try {
            f(e);
        }
        catch { /* abaikan */ }
    } }
    /** Kirim chat. false = kosong / terlalu cepat (anti-spam 0,8 dtk). */
    sendChat(raw, selfName) {
        const t = (0, protocol_1.sanitizeChatText)(raw), now = this.clock.now();
        if (!t || now - this.lastChatAt < 800)
            return false;
        this.lastChatAt = now;
        this.chatOut.push({ i: ++this.chatSeq, t, at: now });
        if (this.chatOut.length > 3)
            this.chatOut.shift();
        this.pushChat({ id: this.opts.selfId, name: selfName, text: t, self: true, at: Date.now() });
        return true;
    }
    onRtc(fn) { this.rtcFns.add(fn); return () => { this.rtcFns.delete(fn); }; }
    micOf(id) { return this.remoteMic.get(id) === true; }
    onMic(fn) { this.micFns.add(fn); return () => { this.micFns.delete(fn); }; }
    setMic(on) { if (on === this.localMic)
        return; this.localMic = on; this.sendMic(); }
    sendMic() { if (this.status !== 'online' || !this.t)
        return false; if (this.t.canSignal && !this.t.canSignal())
        return false; try {
        this.t.send({ t: 'mic', on: this.localMic });
    }
    catch {
        return false;
    } return true; }
    sendRtc(msg) { if (this.status !== 'online' || !this.t)
        return false; if (this.t.canSignal && !this.t.canSignal())
        return false; try {
        this.t.send(msg);
    }
    catch {
        return false;
    } return true; }
    // ---- pengiriman ----
    setLocal(s) { this.local = s; }
    tick() {
        if (this.status !== 'online' || !this.t || !this.local)
            return;
        const now = this.clock.now();
        this.chatOut = this.chatOut.filter((c) => now - c.at < CHAT_TTL_MS);
        const cur = this.chatOut.length ? { ...this.local, cm: this.chatOut.map((c) => ({ i: c.i, t: c.t })) } : (({ cm: _cm, ...rest }) => rest)(this.local);
        if (!(0, protocol_1.stateChanged)(this.lastSent, cur) && now - this.lastSentAt < protocol_1.KEEPALIVE_MS)
            return;
        const msg = { v: protocol_1.PROTOCOL_VERSION, ep: this.ep, seq: ++this.seq, ...cur };
        try {
            this.t.send(msg);
        }
        catch {
            return;
        }
        this.lastSent = { ...cur };
        this.lastSentAt = now;
    }
    // ---- baca untuk renderer ----
    get remoteCount() { return this.peers.size; }
    /** Dipanggil tiap frame render. */
    sample(now = this.clock.now()) {
        const out = [];
        for (const p of this.peers.values()) {
            const s = p.buf.sample(now);
            if (s)
                out.push({ id: p.info.id, name: p.info.name, slot: p.info.slot, stale: now - p.lastRecv > protocol_1.STALE_MS, state: s });
        }
        return out;
    }
    /** Daftar pemain untuk HUD/menu: remote yang online (walau belum ada data posisi). */
    roster() {
        const now = this.clock.now();
        return [...this.peers.values()].map((p) => ({ id: p.info.id, name: p.info.name, slot: p.info.slot, stale: now - p.lastRecv > protocol_1.STALE_MS }));
    }
}
exports.RoomClient = RoomClient;
