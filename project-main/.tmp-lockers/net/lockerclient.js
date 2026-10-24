"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockerClient = void 0;
// Klien loker sisi pemain lokal (logika murni; API & jam disuntikkan; dites di scripts/test-lockers.js).
//
// Tanggung jawab: (1) menyimpan snapshot klaim loker TERBARU dari server (urut jam server, snapshot lama dibuang), (2) meminta klaim/lepas ke server
// secara BERURUTAN (antrean: klaim -> lepas -> klaim tidak pernah tertukar), (3) memperbarui lease selama pemain bersembunyi dan memberi tahu bila
// server ternyata memberi loker itu ke orang lain, (4) mengulang permintaan lepas yang gagal. TIDAK memutuskan siapa boleh masuk: itu server.
const lockers_1 = require("./lockers");
const RELEASE_WAITS_MS = [500, 1000, 2000];
class LockerClient {
    constructor(o) {
        this.o = o;
        this.map = {};
        this.at = -Infinity; // jam server snapshot yang sedang dipakai
        this.chain = Promise.resolve();
        this.holding = null;
        this.timer = null;
        this.disposed = false;
        this.droppedStale = 0;
        this.downUntil = -Infinity; // server dianggap tidak tersedia sampai jam ini (pakai P2P)
        this.p2pMine = null;
        this.p2pLostTo = null;
        this.peerClaims = new Map();
        this.beat = null;
        this.srvKeys = new Set(); // loker yang kita klaim LEWAT SERVER dan belum dilepas (harus dilepas di server juga walau server sedang 'down')
    }
    get selfId() { return this.o.selfId; }
    snapshot() { return { ...this.map }; }
    /** Pemilik loker: snapshot server dulu, lalu klaim P2P yang masih hidup (peer ada di roster & beat terbaru), lalu klaim P2P kita sendiri. */
    ownerOf(key) {
        const s = this.map[key];
        if (s)
            return s;
        const p = this.peerOwner(key);
        if (p)
            return p;
        return this.p2pMine?.held && this.p2pMine.key === key ? this.o.selfId : null;
    }
    keyOf(uid) {
        for (const k of Object.keys(this.map))
            if (this.map[k] === uid)
                return k;
        for (const k of this.peerClaims.keys())
            if (this.peerOwner(k) === uid)
                return k;
        return uid === this.o.selfId && this.p2pMine?.held ? this.p2pMine.key : null;
    }
    /** Snapshot dari /sync atau balasan operasi. Snapshot dengan jam server LEBIH LAMA dari yang sudah dipakai dibuang (tanpa jam = diterima). */
    apply(raw, serverMs) {
        if (this.disposed)
            return;
        const m = (0, lockers_1.sanitizeLockers)(raw);
        if (!m)
            return;
        if (Number.isFinite(serverMs)) {
            if (serverMs < this.at) {
                this.droppedStale++;
                return;
            }
            this.at = serverMs;
        }
        if ((0, lockers_1.sameLockers)(this.map, m))
            return;
        this.map = m;
        try {
            this.o.onChange?.();
        }
        catch { /* abaikan */ }
    }
    ingest(r) { this.apply(r.lockers, r.server_time ? Date.parse(r.server_time) : NaN); }
    enqueue(fn) {
        const p = this.chain.then(fn, fn);
        this.chain = p.then(() => undefined, () => undefined);
        return p;
    }
    nowMs() { return this.o.clock.now ? this.o.clock.now() : Date.now(); }
    serverDown() { return this.nowMs() < this.downUntil; }
    markDown() { this.downUntil = this.nowMs() + lockers_1.LOCKER_SERVER_RETRY_MS; }
    /** Panggil API dengan batas waktu: server menggantung tidak boleh menyumbat antrean. */
    callApi(req) {
        return new Promise((resolve, reject) => {
            let done = false;
            const h = this.o.clock.setTimeout(() => { if (!done) {
                done = true;
                reject(new Error('timeout'));
            } }, this.o.apiTimeoutMs ?? lockers_1.LOCKER_API_TIMEOUT_MS);
            this.o.api(req).then((r) => { if (!done) {
                done = true;
                this.o.clock.clearTimeout(h);
                resolve(r);
            } }, (e) => { if (!done) {
                done = true;
                this.o.clock.clearTimeout(h);
                reject(e);
            } });
        });
    }
    /** Minta masuk loker. Server memutuskan; bila server/tabel tidak tersedia -> jalur P2P (TIDAK pernah menolak semua loker). */
    claim(key) {
        return this.enqueue(async () => {
            if (this.disposed)
                return { ok: false, reason: 'unavailable' };
            if (!this.serverDown()) {
                try {
                    const r = await this.callApi({ locker: key, action: 'enter' });
                    this.ingest(r);
                    if (r.ok === true) {
                        this.p2pMine = null;
                        this.srvKeys.add(key);
                        this.announce('hold', key);
                        this.o.poke?.();
                        return { ok: true };
                    }
                    return { ok: false, reason: 'occupied', owner: typeof r.owner === 'string' ? r.owner : null };
                }
                catch {
                    this.markDown();
                }
            }
            return this.claimP2P(key);
        });
    }
    // ---- jalur cadangan peer-to-peer ----
    p2pPeers() { try {
        return (this.o.p2p?.peers() ?? []).filter((x) => x !== this.o.selfId);
    }
    catch {
        return [];
    } }
    announce(a, k) { try {
        this.o.p2p?.send((0, lockers_1.lockerP2P)(a, k));
    }
    catch { /* abaikan */ } }
    peerOwner(key) {
        const pc = this.peerClaims.get(key);
        if (!pc)
            return null;
        if (this.nowMs() - pc.at >= lockers_1.LOCKER_P2P_TTL_MS || !this.p2pPeers().includes(pc.uid))
            return null; // beat berhenti / pemain hilang dari roster = kosong
        return pc.uid;
    }
    async claimP2P(key) {
        const taken = this.peerOwner(key) ?? (this.map[key] && this.map[key] !== this.o.selfId && this.p2pPeers().includes(this.map[key]) ? this.map[key] : null);
        if (taken)
            return { ok: false, reason: 'occupied', owner: taken };
        this.p2pLostTo = null;
        this.p2pMine = { key, held: false, since: this.nowMs() };
        for (const k of [...this.peerClaims.keys()])
            if (this.peerClaims.get(k)?.uid === this.o.selfId)
                this.peerClaims.delete(k);
        this.announce('claim', key);
        if (this.p2pPeers().length > 0)
            await new Promise((res) => { this.o.clock.setTimeout(res, lockers_1.LOCKER_P2P_SETTLE_MS); }); // tunggu klaim serentak
        if (this.disposed) {
            this.p2pMine = null;
            return { ok: false, reason: 'unavailable' };
        }
        const m = this.p2pMine;
        if (!m || m.key !== key)
            return { ok: false, reason: 'occupied', owner: this.p2pLostTo };
        m.held = true;
        m.since = this.nowMs();
        this.announce('hold', key);
        return { ok: true };
    }
    /** Pesan P2P dari pemain lain (`from` = identitas dari saluran, bukan isi pesan). */
    onPeerMsg(from, raw) {
        if (this.disposed || from === this.o.selfId)
            return;
        const m = (0, lockers_1.sanitizeLockerP2P)(raw);
        if (!m)
            return;
        let changed = false;
        if (m.a === 'rel') {
            for (const [k, v] of [...this.peerClaims])
                if (v.uid === from && (m.k === null || m.k === k)) {
                    this.peerClaims.delete(k);
                    changed = true;
                }
        }
        else if (m.k) {
            const k = m.k, mine = this.p2pMine && this.p2pMine.key === k ? this.p2pMine : null;
            const holdingServer = this.holding?.key === k && !mine; // dipegang lewat server: kita pemegang mapan
            if (mine || holdingServer) {
                const established = holdingServer || (mine.held && this.nowMs() - mine.since >= lockers_1.LOCKER_P2P_SETTLE_MS);
                const peerWins = !established && from < this.o.selfId;
                if (!peerWins) {
                    this.announce('hold', k);
                    return;
                } // kita menang / sudah mapan: peer akan mengalah setelah melihat `hold` kita
                // peer menang (klaim serentak, uid lebih kecil): kita mengalah
                const wasHeld = mine.held;
                this.p2pMine = null;
                this.p2pLostTo = from;
                this.peerClaims.set(k, { uid: from, at: this.nowMs() });
                if (wasHeld) {
                    const h = this.holding;
                    if (h && h.key === k) {
                        this.stopHold();
                        try {
                            h.onLost(from);
                        }
                        catch { /* abaikan */ }
                    }
                }
                changed = true;
            }
            else {
                for (const [kk, v] of [...this.peerClaims])
                    if (v.uid === from && kk !== k) {
                        this.peerClaims.delete(kk);
                        changed = true;
                    } // 1 pemain = 1 loker
                const prev = this.peerClaims.get(k);
                this.peerClaims.set(k, { uid: from, at: this.nowMs() });
                if (!prev || prev.uid !== from)
                    changed = true;
            }
        }
        if (changed) {
            try {
                this.o.onChange?.();
            }
            catch { /* abaikan */ }
        }
    }
    /** Lepas loker `key` (keluar) atau semua milik kita (key null: tertangkap / restart). Gagal -> diulang beberapa kali; sisanya ditutup lease/disconnect di server. */
    release(key) {
        if (key === null || this.holding?.key === key)
            this.stopHold();
        if (key === null || this.p2pMine?.key === key)
            this.p2pMine = null;
        this.announce('rel', key ?? undefined); // P2P: langsung (tidak menunggu antrean server)
        const viaServer = key === null ? this.srvKeys.size > 0 : this.srvKeys.has(key);
        if (key === null)
            this.srvKeys.clear();
        else
            this.srvKeys.delete(key);
        void this.enqueue(async () => {
            for (let i = 0;; i++) {
                if (this.disposed || (i === 0 && !viaServer && this.serverDown()))
                    return; // tak pernah klaim di server & server down: cukup P2P (jangan menyumbat antrean)
                try {
                    const r = await this.callApi(key === null ? { action: 'release' } : { locker: key, action: 'exit' });
                    this.ingest(r);
                    this.o.poke?.();
                    return;
                }
                catch {
                    if (this.disposed || i >= (this.o.releaseRetries ?? RELEASE_WAITS_MS.length)) {
                        this.markDown();
                        return;
                    }
                    await new Promise((res) => { this.o.clock.setTimeout(res, RELEASE_WAITS_MS[Math.min(i, RELEASE_WAITS_MS.length - 1)]); });
                }
            }
        });
    }
    hold(key, onLost) {
        this.stopHold();
        this.holding = { key, onLost };
        this.timer = this.o.clock.setInterval(() => { void this.renew(key); }, lockers_1.LOCKER_RENEW_MS);
        if (this.o.p2p) {
            this.announce('hold', key);
            this.beat = this.o.clock.setInterval(() => { if (this.holding?.key === key)
                this.announce('hold', key); }, lockers_1.LOCKER_P2P_BEAT_MS);
        }
    }
    stopHold() {
        if (this.timer !== null)
            this.o.clock.clearInterval(this.timer);
        if (this.beat !== null)
            this.o.clock.clearInterval(this.beat);
        this.timer = null;
        this.beat = null;
        this.holding = null;
    }
    renew(key) {
        return this.enqueue(async () => {
            if (this.disposed || this.holding?.key !== key)
                return; // sudah keluar saat giliran ini tiba
            if (this.serverDown())
                return; // mode P2P: kehidupan klaim dijaga beat `hold`
            try {
                const r = await this.callApi({ locker: key, action: 'enter' });
                this.ingest(r);
                const h = this.holding;
                if (r.ok !== true && h && h.key === key) {
                    this.stopHold();
                    h.onLost(typeof r.owner === 'string' ? r.owner : null);
                } // server memberi loker ini ke orang lain
            }
            catch {
                this.markDown(); /* server gagal: beralih ke P2P; dicoba lagi setelah LOCKER_SERVER_RETRY_MS */
            }
        });
    }
    dispose() { if (this.p2pMine || this.holding)
        this.announce('rel'); this.stopHold(); this.p2pMine = null; this.peerClaims.clear(); this.disposed = true; }
}
exports.LockerClient = LockerClient;
