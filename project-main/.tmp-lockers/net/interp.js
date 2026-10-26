"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotBuffer = exports.DEJITTER_MAX_LAG_MS = exports.DEJITTER_GAIN = exports.DEJITTER_MAX_GAP_MS = exports.GAP_RESET_MS = exports.MAX_EXTRAPOLATE_MS = exports.INTERP_DELAY_MS = void 0;
const protocol_1 = require("./protocol");
exports.INTERP_DELAY_MS = 140; // TAHAP 5: 120 -> 140 (kirim 10 Hz = 100 ms; sisa 40 ms menyerap jitter jaringan HP sebelum terpaksa ekstrapolasi)
exports.MAX_EXTRAPOLATE_MS = 250;
exports.GAP_RESET_MS = 1500;
exports.DEJITTER_MAX_GAP_MS = 250; // jeda antar paket lebih besar dari ini = pemain berhenti/keepalive: pakai waktu terima apa adanya
exports.DEJITTER_GAIN = 0.3; // seberapa cepat garis waktu halus mengejar waktu terima nyata (0..1)
exports.DEJITTER_MAX_LAG_MS = 90; // garis waktu halus tidak boleh tertinggal/mendahului waktu terima lebih dari ini
const wrap = (a) => { while (a > Math.PI)
    a -= 2 * Math.PI; while (a < -Math.PI)
    a += 2 * Math.PI; return a; };
const lerp = (a, b, k) => a + (b - a) * k;
class SnapshotBuffer {
    /** `dejitter` = false mengembalikan perilaku lama (waktu terima mentah); dipakai tes pembanding dan sebagai tombol darurat. */
    constructor(cap = 24, dejitter = true) {
        this.cap = cap;
        this.dejitter = dejitter;
        this.q = [];
        this.ival = protocol_1.SEND_INTERVAL_MS; // perkiraan selang antar paket (EMA), dipakai untuk meratakan jitter waktu terima
    }
    get size() { return this.q.length; }
    get last() { return this.q.length ? this.q[this.q.length - 1].s : null; }
    clear() { this.q = []; this.ival = protocol_1.SEND_INTERVAL_MS; }
    /**
     * `t` = waktu terima di klien ini (ms, monoton). Urutan dijaga: waktu tidak boleh mundur.
     * Waktu terima mengandung jitter jaringan (paket "bergerombol"/telat) -> kecepatan hasil interpolasi bergelombang = gerak patah-patah.
     * Karena pengirim mengirim teratur, tiap paket diberi waktu HALUS: prediksi = waktu paket sebelumnya + selang rata-rata, ditarik pelan ke waktu terima nyata
     * (rentang dibatasi). Jeda besar (berhenti/keepalive/reconnect) memakai waktu terima apa adanya.
     */
    push(s, t) {
        const prev = this.q[this.q.length - 1];
        if (prev && t < prev.raw)
            t = prev.raw;
        if (prev && t - prev.raw > exports.GAP_RESET_MS)
            this.q = []; // jeda panjang (reconnect/tab di background): jangan meluncur dari posisi lama
        const p = this.q[this.q.length - 1];
        let ts = t;
        if (p) {
            const gap = t - p.raw;
            if (this.dejitter && gap <= exports.DEJITTER_MAX_GAP_MS) {
                this.ival += (Math.max(40, Math.min(200, gap)) - this.ival) * 0.1;
                const pred = p.t + this.ival;
                ts = pred + (t - pred) * exports.DEJITTER_GAIN;
                ts = Math.max(t - exports.DEJITTER_MAX_LAG_MS, Math.min(t + exports.DEJITTER_MAX_LAG_MS, ts));
                if (ts <= p.t)
                    ts = p.t + 1; // tetap menaik ketat (pembagi interpolasi tidak nol)
            }
        }
        this.q.push({ t: ts, raw: t, s });
        if (this.q.length > this.cap)
            this.q.shift();
    }
    /** Keadaan terinterpolasi pada waktu `now` - INTERP_DELAY_MS. null bila belum ada data. */
    sample(now) {
        const q = this.q;
        if (!q.length)
            return null;
        const rt = now - exports.INTERP_DELAY_MS;
        const out = (a, x, y, z, yaw, pitch, speed, b) => ({ x, y, z, yaw, pitch, speed, gait: (b ?? a).gait, crouch: (b ?? a).crouch, hide: (b ?? a).hide, ...((b ?? a).cg ? { cg: true } : {}), ...((b ?? a).bd !== undefined ? { bd: (b ?? a).bd } : {}), ...((b ?? a).rc ? { rc: true } : {}), ...((b ?? a).es ? { es: true } : {}), level: (b ?? a).level, model: (b ?? a).model });
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
