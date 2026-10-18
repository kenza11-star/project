"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotBuffer = exports.GAP_RESET_MS = exports.MAX_EXTRAPOLATE_MS = exports.INTERP_DELAY_MS = void 0;
exports.INTERP_DELAY_MS = 120;
exports.MAX_EXTRAPOLATE_MS = 250;
exports.GAP_RESET_MS = 1500;
const wrap = (a) => { while (a > Math.PI)
    a -= 2 * Math.PI; while (a < -Math.PI)
    a += 2 * Math.PI; return a; };
const lerp = (a, b, k) => a + (b - a) * k;
class SnapshotBuffer {
    constructor(cap = 24) {
        this.cap = cap;
        this.q = [];
    }
    get size() { return this.q.length; }
    get last() { return this.q.length ? this.q[this.q.length - 1].s : null; }
    clear() { this.q = []; }
    /** `t` = waktu terima di klien ini (ms, monoton). Urutan dijaga: waktu tidak boleh mundur. */
    push(s, t) {
        const prev = this.q[this.q.length - 1];
        if (prev && t < prev.t)
            t = prev.t;
        if (prev && t - prev.t > exports.GAP_RESET_MS)
            this.q = []; // jeda panjang (reconnect/tab di background): jangan meluncur dari posisi lama
        this.q.push({ t, s });
        if (this.q.length > this.cap)
            this.q.shift();
    }
    /** Keadaan terinterpolasi pada waktu `now` - INTERP_DELAY_MS. null bila belum ada data. */
    sample(now) {
        const q = this.q;
        if (!q.length)
            return null;
        const rt = now - exports.INTERP_DELAY_MS;
        const out = (a, x, y, z, yaw, pitch, speed, b) => ({ x, y, z, yaw, pitch, speed, gait: (b ?? a).gait, crouch: (b ?? a).crouch, hide: (b ?? a).hide, ...((b ?? a).cg ? { cg: true } : {}), level: (b ?? a).level, model: (b ?? a).model });
        if (rt <= q[0].t) {
            const s = q[0].s;
            return out(s, s.x, s.y, s.z, s.yaw, s.pitch, 0);
        }
        for (let i = q.length - 1; i > 0; i--) {
            const a = q[i - 1], b = q[i];
            if (rt >= a.t && rt <= b.t) {
                const dt = Math.max(1, b.t - a.t), k = (rt - a.t) / dt;
                const sp = Math.hypot(b.s.x - a.s.x, b.s.z - a.s.z) / (dt / 1000);
                return out(a.s, lerp(a.s.x, b.s.x, k), lerp(a.s.y, b.s.y, k), lerp(a.s.z, b.s.z, k), a.s.yaw + wrap(b.s.yaw - a.s.yaw) * k, lerp(a.s.pitch, b.s.pitch, k), sp, b.s);
            }
        }
        // lewat snapshot terakhir: ekstrapolasi pendek (maks MAX_EXTRAPOLATE_MS), lalu kembali halus ke titik terakhir yang diketahui (tanpa "pop")
        const b = q[q.length - 1], a = q.length > 1 ? q[q.length - 2] : null;
        const over = rt - b.t;
        if (!a || b.t - a.t < 1 || b.t - a.t > 500)
            return out(b.s, b.s.x, b.s.y, b.s.z, b.s.yaw, b.s.pitch, 0);
        const dt = (b.t - a.t) / 1000, vx = (b.s.x - a.s.x) / dt, vz = (b.s.z - a.s.z) / dt;
        const fade = over <= exports.MAX_EXTRAPOLATE_MS ? 1 : Math.exp(-(over - exports.MAX_EXTRAPOLATE_MS) / 300);
        const ext = Math.min(over, exports.MAX_EXTRAPOLATE_MS) / 1000 * fade;
        return out(b.s, b.s.x + vx * ext, b.s.y, b.s.z + vz * ext, b.s.yaw, b.s.pitch, Math.hypot(vx, vz) * (over <= exports.MAX_EXTRAPOLATE_MS ? 1 : fade));
    }
}
exports.SnapshotBuffer = SnapshotBuffer;
