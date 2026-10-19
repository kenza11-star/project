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
    }
    get selfId() { return this.o.selfId; }
    snapshot() { return { ...this.map }; }
    ownerOf(key) { return this.map[key] ?? null; }
    keyOf(uid) { for (const k of Object.keys(this.map))
        if (this.map[k] === uid)
            return k; return null; }
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
    /** Minta masuk loker. Galat jaringan/server = 'unavailable' (gagal-aman: pemain TIDAK masuk). */
    claim(key) {
        return this.enqueue(async () => {
            if (this.disposed)
                return { ok: false, reason: 'unavailable' };
            try {
                const r = await this.o.api({ locker: key, action: 'enter' });
                this.ingest(r);
                if (r.ok === true) {
                    this.o.poke?.();
                    return { ok: true };
                }
                return { ok: false, reason: 'occupied', owner: typeof r.owner === 'string' ? r.owner : null };
            }
            catch {
                return { ok: false, reason: 'unavailable' };
            }
        });
    }
    /** Lepas loker `key` (keluar) atau semua milik kita (key null: tertangkap / restart). Gagal -> diulang beberapa kali; sisanya ditutup lease/disconnect di server. */
    release(key) {
        if (key === null || this.holding?.key === key)
            this.stopHold();
        void this.enqueue(async () => {
            for (let i = 0;; i++) {
                try {
                    const r = await this.o.api(key === null ? { action: 'release' } : { locker: key, action: 'exit' });
                    this.ingest(r);
                    this.o.poke?.();
                    return;
                }
                catch {
                    if (this.disposed || i >= (this.o.releaseRetries ?? RELEASE_WAITS_MS.length))
                        return;
                    await new Promise((res) => { this.o.clock.setTimeout(res, RELEASE_WAITS_MS[Math.min(i, RELEASE_WAITS_MS.length - 1)]); });
                }
            }
        });
    }
    hold(key, onLost) {
        this.stopHold();
        this.holding = { key, onLost };
        this.timer = this.o.clock.setInterval(() => { void this.renew(key); }, lockers_1.LOCKER_RENEW_MS);
    }
    stopHold() {
        if (this.timer !== null)
            this.o.clock.clearInterval(this.timer);
        this.timer = null;
        this.holding = null;
    }
    renew(key) {
        return this.enqueue(async () => {
            if (this.disposed || this.holding?.key !== key)
                return; // sudah keluar saat giliran ini tiba
            try {
                const r = await this.o.api({ locker: key, action: 'enter' });
                this.ingest(r);
                const h = this.holding;
                if (r.ok !== true && h && h.key === key) {
                    this.stopHold();
                    h.onLost(typeof r.owner === 'string' ? r.owner : null);
                } // server memberi loker ini ke orang lain
            }
            catch { /* jaringan putus sesaat: coba lagi di tick berikut (lease 40 dtk, perbarui tiap 10 dtk) */ }
        });
    }
    dispose() { this.stopHold(); this.disposed = true; }
}
exports.LockerClient = LockerClient;
