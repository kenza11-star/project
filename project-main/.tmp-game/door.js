"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leafTouches = exports.doorBlocksAt = exports.ease = exports.DOOR_REACH = exports.OPEN_FREE_FRAC = void 0;
exports.leafPose = leafPose;
exports.applyPose = applyPose;
exports.leafDist = leafDist;
exports.sweepHitsPlayer = sweepHitsPlayer;
exports.swingPoints = swingPoints;
// Logika pintu murni (tanpa three.js): pose daun pintu di sekitar engsel, collision mengikuti sudut, dan cek sapuan terhadap pemain.
// Engsel = origin node pintu di GLB (daun memanjang sepanjang +Z lokal). Rotasi tambahan memutar daun di sekitar engsel (bukan dari tengah).
const collision_1 = require("./collision");
/** Daun dianggap menutup bukaan selama sudut < ambang ini (0..1 dari sudut buka). Lewat ambang, bukaan cukup lebar dilewati pemain (radius 0,3). */
exports.OPEN_FREE_FRAC = 0.7;
exports.DOOR_REACH = 2.0;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
exports.ease = ease;
/** Pose OBB daun pada fraksi sudut a (0 = tertutup, 1 = terbuka penuh). */
function leafPose(g, a) {
    const yaw = g.yaw + g.openRad * a;
    const dx = Math.sin(yaw), dz = Math.cos(yaw); // +Z lokal setelah rotasi Y
    return { cx: g.hingeX + dx * g.len / 2, cz: g.hingeZ + dz * g.len / 2, hx: g.half, hz: g.len / 2, yaw };
}
/** Salin pose ke OBB collision (cos/sin ikut diperbarui). */
function applyPose(o, g, a) {
    const p = leafPose(g, a);
    o.cx = p.cx;
    o.cz = p.cz;
    o.hx = p.hx;
    o.hz = p.hz;
    o.yaw = p.yaw;
    o.cos = Math.cos(p.yaw);
    o.sin = Math.sin(p.yaw);
    o.rad = Math.hypot(p.hx, p.hz);
}
/** Jarak lingkaran pemain (x,z) ke daun pada fraksi a. < r = menembus. */
function leafDist(g, a, x, z) {
    const p = leafPose(g, a);
    return collision_1.CollisionWorld.distToObb({ cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, cos: Math.cos(p.yaw), sin: Math.sin(p.yaw) }, x, z);
}
/** Collision pintu mengikuti sudut daun: menghalangi selama daun masih menutup bukaan. */
const doorBlocksAt = (a) => a < exports.OPEN_FREE_FRAC;
exports.doorBlocksAt = doorBlocksAt;
/**
 * Daun tidak boleh menembus pemain: apakah gerak dari fraksi a0 ke a1 menyapu tubuh pemain (lingkaran r)? Dicek di beberapa titik antara.
 * Dipakai tiap frame: bila true, pintu berhenti di sudut sekarang dan lanjut setelah pemain menyingkir.
 */
function sweepHitsPlayer(g, a0, a1, px, pz, r) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.08));
    for (let i = 1; i <= n; i++)
        if (leafDist(g, a0 + ((a1 - a0) * i) / n, px, pz) < r)
            return true;
    return false;
}
/** Apakah daun (di sudut a) menyentuh pemain? */
const leafTouches = (g, a, px, pz, r) => leafDist(g, a, px, pz) < r;
exports.leafTouches = leafTouches;
/** Titik-titik di area sapuan daun (untuk keepout furniture): sepanjang daun pada beberapa sudut. */
function swingPoints(g) {
    const out = [];
    for (const a of [0, 0.33, 0.66, 1]) {
        const yaw = g.yaw + g.openRad * a;
        for (const t of [0.3, 0.65, 1.0])
            out.push({ x: g.hingeX + Math.sin(yaw) * g.len * t, z: g.hingeZ + Math.cos(yaw) * g.len * t });
    }
    return out;
}
