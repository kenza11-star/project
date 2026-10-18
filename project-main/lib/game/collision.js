"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollisionWorld = void 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function segDist2(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = clamp(t, 0, 1);
    const qx = ax + t * dx - px, qz = az + t * dz - pz;
    return qx * qx + qz * qz;
}
function distPointTri(px, pz, ax, az, bx, bz, cx, cz) {
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) > 1e-9) {
        const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
        const v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
        if (u >= 0 && v >= 0 && u + v <= 1)
            return 0;
    }
    return Math.sqrt(Math.min(segDist2(px, pz, ax, az, bx, bz), segDist2(px, pz, bx, bz, cx, cz), segDist2(px, pz, cx, cz, ax, az)));
}
class CollisionWorld {
    constructor(levels = 2) {
        this.cell = 0.1;
        this.x0 = -2;
        this.z0 = -2;
        this.W = 450;
        this.H = 450; // cakupan 45 x 45 m (map 38,4 x 38,4 m)
        this.obbs = [];
        this.solid = Array.from({ length: levels }, () => new Uint8Array(this.W * this.H));
        this.walk = Array.from({ length: levels }, () => null);
    }
    /** Rasterisasi segitiga (proyeksi XZ) ke grid solid. Segitiga tegak jadi garis tipis. */
    rasterTriangle(level, ax, az, bx, bz, cx, cz, thick = 0.05) {
        const g = this.solid[level], c = this.cell;
        const minx = Math.min(ax, bx, cx) - thick, maxx = Math.max(ax, bx, cx) + thick;
        const minz = Math.min(az, bz, cz) - thick, maxz = Math.max(az, bz, cz) + thick;
        const i0 = Math.max(0, Math.floor((minx - this.x0) / c)), i1 = Math.min(this.W - 1, Math.floor((maxx - this.x0) / c));
        const j0 = Math.max(0, Math.floor((minz - this.z0) / c)), j1 = Math.min(this.H - 1, Math.floor((maxz - this.z0) / c));
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const px = this.x0 + (i + 0.5) * c, pz = this.z0 + (j + 0.5) * c;
                if (distPointTri(px, pz, ax, az, bx, bz, cx, cz) <= thick)
                    g[j * this.W + i] = 1;
            }
    }
    /**
     * Rasterisasi mesh dinding: hanya segitiga yang menyentuh tinggi badan [yMin,yMax].
     * Segitiga di atas pintu (lintel) dan lantai/atap otomatis tidak ikut.
     */
    rasterMesh(level, pos, idx, m, yMin, yMax) {
        const n = idx ? idx.length : Math.floor(pos.length / 3);
        const v = (k, out) => {
            const i = idx ? idx[k] : k;
            const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
            out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
            out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        };
        const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
        for (let k = 0; k + 2 < n; k += 3) {
            v(k, a);
            v(k + 1, b);
            v(k + 2, c);
            const lo = Math.min(a[1], b[1], c[1]), hi = Math.max(a[1], b[1], c[1]);
            if (hi < yMin || lo > yMax)
                continue;
            this.rasterTriangle(level, a[0], a[2], b[0], b[2], c[0], c[2]);
        }
    }
    addObb(o) {
        const b = { ...o, enabled: true, cos: Math.cos(o.yaw), sin: Math.sin(o.yaw), rad: Math.hypot(o.hx, o.hz) };
        this.obbs.push(b);
        return b;
    }
    removeObb(o) { const i = this.obbs.indexOf(o); if (i >= 0)
        this.obbs.splice(i, 1); }
    /** Garis (x0,z0)->(x1,z1) menembus dinding (grid)? Dicek tiap 5 cm. Dipakai agar interaksi tidak tembus dinding. */
    segmentBlocked(x0, z0, x1, z1, level, r = 0.02) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.05));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (this.gridBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r, level))
                return true;
        }
        return false;
    }
    removeObbs(pred) {
        for (let i = this.obbs.length - 1; i >= 0; i--)
            if (pred(this.obbs[i]))
                this.obbs.splice(i, 1);
    }
    gridBlocked(x, z, r, level) {
        const g = this.solid[level], c = this.cell, W = this.W;
        const i0 = Math.floor((x - r - this.x0) / c), i1 = Math.floor((x + r - this.x0) / c);
        const j0 = Math.floor((z - r - this.z0) / c), j1 = Math.floor((z + r - this.z0) / c);
        for (let j = j0; j <= j1; j++) {
            if (j < 0 || j >= this.H)
                continue;
            for (let i = i0; i <= i1; i++) {
                if (i < 0 || i >= W || !g[j * W + i])
                    continue;
                const cx0 = this.x0 + i * c, cz0 = this.z0 + j * c;
                const qx = clamp(x, cx0, cx0 + c) - x, qz = clamp(z, cz0, cz0 + c) - z;
                if (qx * qx + qz * qz < r * r)
                    return true;
            }
        }
        return false;
    }
    /** Jarak terdekat titik (x,z) ke OBB; <0 tidak dipakai (0 jika di dalam). */
    static distToObb(o, x, z) {
        const dx = x - o.cx, dz = z - o.cz;
        const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
        const qx = lx - clamp(lx, -o.hx, o.hx), qz = lz - clamp(lz, -o.hz, o.hz);
        return Math.hypot(qx, qz);
    }
    obbBlocked(x, z, r, level) {
        for (const o of this.obbs) {
            if (!o.enabled || o.level !== level)
                continue;
            if (Math.abs(x - o.cx) > o.rad + r || Math.abs(z - o.cz) > o.rad + r)
                continue;
            if (CollisionWorld.distToObb(o, x, z) < r)
                return true;
        }
        return false;
    }
    blocked(x, z, r, level) {
        const w = this.walk[level];
        if (w && (x - r < w.minx || x + r > w.maxx || z - r < w.minz || z + r > w.maxz))
            return true;
        return this.gridBlocked(x, z, r, level) || this.obbBlocked(x, z, r, level);
    }
}
exports.CollisionWorld = CollisionWorld;
