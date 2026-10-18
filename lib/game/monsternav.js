"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonsterNav = void 0;
const CFG = __importStar(require("./config"));
const layout_1 = require("./layout");
class MonsterNav {
    constructor(cw, level, fixed, seed) {
        this.ids = [];
        const nav = new layout_1.NavGrid(cw, level, fixed);
        this.reachFine = nav.flood(seed.x, seed.z);
        const vis = nav.vis, fine = cw.cell, k = 2;
        this.cell = k * fine;
        this.W = Math.ceil(cw.W / k);
        this.H = Math.ceil(cw.H / k);
        this.x0 = cw.x0;
        this.z0 = cw.z0;
        this.ok = new Uint8Array(this.W * this.H);
        const solid = cw.solid[level], r = Math.ceil((CFG.MONSTER_RADIUS + 0.03) / fine), c = k >> 1;
        // NavGrid hanya menginflasi furnitur (OBB); dinding dihitung di sini: tidak ada sel dinding dalam radius badan monster dari pusat sel
        const clearOfWalls = (ci, cj) => { for (let dj = -r; dj <= r; dj++)
            for (let di = -r; di <= r; di++) {
                if (di * di + dj * dj > r * r)
                    continue;
                const i = ci + di, j = cj + dj;
                if (i < 0 || j < 0 || i >= cw.W || j >= cw.H || solid[j * cw.W + i])
                    return false;
            } return true; };
        for (let j = 0; j < this.H; j++)
            for (let i = 0; i < this.W; i++) {
                const ci = i * k + c, cj = j * k + c;
                if (ci < cw.W && cj < cw.H && vis[cj * cw.W + ci] === 1 && clearOfWalls(ci, cj)) {
                    this.ok[j * this.W + i] = 1;
                    this.ids.push(j * this.W + i);
                }
            }
        this.count = this.ids.length;
    }
    cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
    center(id) { const i = id % this.W, j = (id - i) / this.W; return { x: this.x0 + (i + 0.5) * this.cell, z: this.z0 + (j + 0.5) * this.cell }; }
    isOk(x, z) { const [i, j] = this.cellOf(x, z); return i >= 0 && j >= 0 && i < this.W && j < this.H && this.ok[j * this.W + i] === 1; }
    /** Sel bebas terdekat (cincin) dalam radius maxR; null bila tidak ada. */
    snap(x, z, maxR = 4) {
        if (this.isOk(x, z))
            return { x, z };
        const [ci, cj] = this.cellOf(x, z), R = Math.ceil(maxR / this.cell);
        let best = -1, bd = 1e9;
        for (let r = 1; r <= R; r++) {
            for (let dj = -r; dj <= r; dj++)
                for (let di = -r; di <= r; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r)
                        continue;
                    const i = ci + di, j = cj + dj;
                    if (i < 0 || j < 0 || i >= this.W || j >= this.H || !this.ok[j * this.W + i])
                        continue;
                    const d = di * di + dj * dj;
                    if (d < bd) {
                        bd = d;
                        best = j * this.W + i;
                    }
                }
            if (best >= 0)
                return this.center(best);
        }
        return null;
    }
    randomPoint(rng) { return this.center(this.ids[Math.floor(rng.next() * this.ids.length)]); }
    lineClear(ax, az, bx, bz) {
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (!this.isOk(ax + (bx - ax) * t, az + (bz - az) * t))
                return false;
        }
        return true;
    }
    /** A* 8 arah (tanpa memotong sudut) lalu penghalusan garis pandang. Mengembalikan titik jalan (tanpa titik awal) atau null. */
    path(sx, sz, gx, gz) {
        const s = this.snap(sx, sz, 2), g = this.snap(gx, gz, 4);
        if (!s || !g)
            return null;
        const [si, sj] = this.cellOf(s.x, s.z), [gi, gj] = this.cellOf(g.x, g.z), W = this.W, N = W * this.H;
        const gs = new Float32Array(N).fill(1e9), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap = [], fs = new Float32Array(N);
        const h = (i, j) => { const dx = Math.abs(i - gi), dj = Math.abs(j - gj); return (dx + dj) + (Math.SQRT2 - 2) * Math.min(dx, dj); };
        const push = (id) => { heap.push(id); let k = heap.length - 1; while (k > 0) {
            const p = (k - 1) >> 1;
            if (fs[heap[p]] <= fs[heap[k]])
                break;
            [heap[p], heap[k]] = [heap[k], heap[p]];
            k = p;
        } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) {
            heap[0] = last;
            let k = 0;
            for (;;) {
                let l = 2 * k + 1, r = l + 1, m = k;
                if (l < heap.length && fs[heap[l]] < fs[heap[m]])
                    m = l;
                if (r < heap.length && fs[heap[r]] < fs[heap[m]])
                    m = r;
                if (m === k)
                    break;
                [heap[m], heap[k]] = [heap[k], heap[m]];
                k = m;
            }
        } return top; };
        const s0 = sj * W + si, g0 = gj * W + gi;
        gs[s0] = 0;
        fs[s0] = h(si, sj);
        push(s0);
        const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
        let found = false, guard = 0;
        while (heap.length && guard++ < 150000) {
            const cur = pop();
            if (closed[cur])
                continue;
            closed[cur] = 1;
            if (cur === g0) {
                found = true;
                break;
            }
            const ci = cur % W, cj = (cur - ci) / W;
            for (const [di, dj, c] of D) {
                const ni = ci + di, nj = cj + dj;
                if (ni < 0 || nj < 0 || ni >= W || nj >= this.H)
                    continue;
                const nid = nj * W + ni;
                if (!this.ok[nid] || closed[nid])
                    continue;
                if (di && dj && (!this.ok[cj * W + ni] || !this.ok[nj * W + ci]))
                    continue;
                const ng = gs[cur] + c;
                if (ng < gs[nid]) {
                    gs[nid] = ng;
                    par[nid] = cur;
                    fs[nid] = ng + h(ni, nj);
                    push(nid);
                }
            }
        }
        if (!found)
            return null;
        const cells = [];
        for (let c = g0; c !== -1; c = par[c])
            cells.push(this.center(c));
        cells.reverse();
        cells[0] = { x: s.x, z: s.z };
        cells[cells.length - 1] = { x: g.x, z: g.z };
        const out = [];
        let a = 0; // penghalusan: loncat ke titik terjauh yang masih terlihat
        while (a < cells.length - 1) {
            let b = cells.length - 1;
            while (b > a + 1 && !this.lineClear(cells[a].x, cells[a].z, cells[b].x, cells[b].z))
                b--;
            out.push(cells[b]);
            a = b;
        }
        return out;
    }
}
exports.MonsterNav = MonsterNav;
