"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compose = compose;
exports.mul = mul;
exports.partMatrix = partMatrix;
exports.partBox = partBox;
exports.partBlocked = partBlocked;
exports.openLimit = openLimit;
exports.partDist = partDist;
// Pose & ruang bebas bagian furniture yang bergerak (pintu lemari/locker, laci) — logika murni (tanpa three.js).
// Dipakai runtime (matriks dunia dari three.js) dan tes (matriks dari JSON GLB) supaya hasilnya sama.
// Tujuan: bagian yang terbuka tidak boleh menembus dinding / furniture lain, dan collision laci/pintu terbuka mengikuti pose nyata.
const collision_1 = require("./collision");
const layout_1 = require("./layout");
const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qaxis = (ax, ang) => { const l = Math.hypot(ax[0], ax[1], ax[2]) || 1, s = Math.sin(ang / 2) / l; return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };
function compose(t, q, s) {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++)
                s += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = s;
        }
    return o;
}
/** Matriks dunia bagian pada fraksi buka e (0..1), sama persis dengan yang dilakukan GameWorld.setOpen. */
function partMatrix(rootM, g, e) {
    if (g.hinge)
        return mul(rootM, compose(g.p0, qmul(g.q0, qaxis(g.axis, g.angle * e)), g.s));
    return mul(rootM, compose([g.p0[0] + g.slide[0] * e, g.p0[1] + g.slide[1] * e, g.p0[2] + g.slide[2] * e], g.q0, g.s));
}
/** OBB bagian (proyeksi XZ + rentang tinggi) dari matriks dunia & bounds lokalnya. */
function partBox(M, g) {
    const mid = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, (g.mn[2] + g.mx[2]) / 2];
    const cx = M[0] * mid[0] + M[4] * mid[1] + M[8] * mid[2] + M[12], cy = M[1] * mid[0] + M[5] * mid[1] + M[9] * mid[2] + M[13], cz = M[2] * mid[0] + M[6] * mid[1] + M[10] * mid[2] + M[14];
    const sx = Math.hypot(M[0], M[1], M[2]), sy = Math.hypot(M[4], M[5], M[6]), sz = Math.hypot(M[8], M[9], M[10]);
    const hy = ((g.mx[1] - g.mn[1]) / 2) * sy;
    return { cx, cz, hx: ((g.mx[0] - g.mn[0]) / 2) * sx, hz: ((g.mx[2] - g.mn[2]) / 2) * sz, yaw: Math.atan2(-M[2], M[0]), y0: cy - hy, y1: cy + hy };
}
/** Kotak sedikit dikecilkan (2 cm lebar, 4 cm panjang) agar sentuhan engsel/tepi dengan badan tetangga tidak dianggap menembus. */
const shrunk = (b) => ({ cx: b.cx, cz: b.cz, hx: Math.max(0.005, b.hx - 0.02), hz: Math.max(0.01, b.hz - 0.04), yaw: b.yaw });
/** Bagian (pose M) menembus dinding (grid) atau furniture lain (selain `selfId`)? */
function partBlocked(cw, level, b, selfId) {
    const s = shrunk(b), c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    const nx = Math.max(1, Math.ceil((2 * s.hx) / 0.1)), nz = Math.max(1, Math.ceil((2 * s.hz) / 0.1));
    for (let i = 0; i <= nx; i++)
        for (let j = 0; j <= nz; j++) {
            const lx = -s.hx + (2 * s.hx * i) / nx, lz = -s.hz + (2 * s.hz * j) / nz;
            if (cw.gridBlocked(s.cx + lx * c + lz * n, s.cz - lx * n + lz * c, 0.03, level))
                return true;
        }
    for (const o of cw.obbs) {
        if (!o.enabled || o.level !== level || o.id === selfId || o.kind === 'door' || o.kind === 'part')
            continue;
        if (Math.abs(o.cx - s.cx) > o.rad + Math.hypot(s.hx, s.hz) || Math.abs(o.cz - s.cz) > o.rad + Math.hypot(s.hx, s.hz))
            continue;
        if ((0, layout_1.boxesOverlap)(s, o, 0))
            return true;
    }
    return false;
}
/**
 * Bukaan terbesar (0, .25, .5, .75, 1) tempat SEMUA bagian container tidak menembus dinding/furniture lain.
 * Container dengan hasil kecil tidak dipakai sebagai lokasi key; sisanya terbuka sebagian (tidak pernah menembus).
 */
function openLimit(cw, level, rootM, parts, selfId) {
    for (const e of [1, 0.75, 0.5, 0.25]) {
        let ok = true;
        for (const g of parts)
            if (partBlocked(cw, level, partBox(partMatrix(rootM, g, e), g), selfId)) {
                ok = false;
                break;
            }
        if (ok)
            return e;
    }
    return 0;
}
/** Jarak pemain (lingkaran r) ke bagian yang terbuka penuh; < r = tumpang tindih (jangan aktifkan collision agar tidak menjebak). */
function partDist(b, x, z) {
    return collision_1.CollisionWorld.distToObb({ cx: b.cx, cz: b.cz, hx: b.hx, hz: b.hz, cos: Math.cos(b.yaw), sin: Math.sin(b.yaw) }, x, z);
}
