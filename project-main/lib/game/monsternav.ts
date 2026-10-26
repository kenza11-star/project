// Navigasi monster di satu lantai: grid kasar 0,2 m dari NavGrid (sel bebas & terjangkau dari titik awal), A* 8 arah berbiaya, penghalusan jalur.
// Murni (tanpa three/DOM): dites dengan GLB asli. Pintu TIDAK dianggap penghalang (monster membuka pintu saat menabrak, lihat MonsterEnv).
// v16: biaya langkah memuat (1) CLEARANCE: dekat dinding/furnitur lebih mahal -> jalur lewat TENGAH koridor/ruangan; (2) zona pintu: area di BALIK daun terbuka (kantong sisi engsel)
// sangat mahal, area sapuan daun mahal kecuali lorong tengah ambang, dan lewat ambang menyamping dari tengah dihukum -> pintu dilewati tepat di tengah celah. Penghalusan tidak boleh
// lebih dekat ke dinding / lebih dalam di zona pintu daripada jalur A* aslinya (tidak memotong sudut), dan sudut dijauhkan dari dinding (nudge).
import type { CollisionWorld, ObbIn } from './collision';
import * as CFG from './config';
import type { LeafGeom } from './door';
import { doorCenter, doorFrame, frameXY, inFunnel, inPocket, inSweep } from './doornav';
import { NavGrid } from './layout';
import type { Rng } from './rng';

export interface Pt { x: number; z: number }
/** Daun pintu yang relevan untuk satu lantai (geometri sama dengan World / LeafGeom). */
export type NavDoor = LeafGeom;
const FUNNEL_HALF = 0.3;   // lorong tengah ambang (m dari tengah) yang tetap murah di daerah sapuan

export class MonsterNav {
  // grid kasar = 2 x sel collision (0,2 m): celah pintu (lebar bebas ~0,5 m setelah jarak aman badan) tetap terbaca
  readonly cell: number; readonly W: number; readonly H: number; readonly x0: number; readonly z0: number;
  readonly ok: Uint8Array; readonly count: number; readonly reachFine: number;
  /** clearance (m) dari tengah sel kasar ke dinding/furnitur terdekat; mult = pengali biaya langkah (>= 1); extra = bagian zona pintu dari mult; pocket = 1 di balik daun terbuka. */
  readonly clr: Float32Array; readonly mult: Float32Array; readonly extra: Float32Array; readonly pocket: Uint8Array;
  readonly doors: readonly NavDoor[];
  private fine: Float32Array; private readonly fW: number; private readonly fCell: number;
  private ids: number[] = [];
  private readonly cw: CollisionWorld; private readonly level: number;
  constructor(cw: CollisionWorld, level: number, fixed: ObbIn[], seed: Pt, doors: readonly NavDoor[] = []) {
    this.cw = cw; this.level = level; this.doors = doors;
    const nav = new NavGrid(cw, level, fixed); this.reachFine = nav.flood(seed.x, seed.z);
    const vis = (nav as unknown as { vis: Uint8Array }).vis, fine = cw.cell, k = 2; this.cell = k * fine; this.fCell = fine; this.fW = cw.W;
    this.W = Math.ceil(cw.W / k); this.H = Math.ceil(cw.H / k); this.x0 = cw.x0; this.z0 = cw.z0; this.ok = new Uint8Array(this.W * this.H);
    const N = this.W * this.H; this.clr = new Float32Array(N); this.mult = new Float32Array(N).fill(1); this.extra = new Float32Array(N); this.pocket = new Uint8Array(N);
    this.fine = MonsterNav.distanceField(nav.occ, cw.W, cw.H, fine);
    const solid = cw.solid[level], r = Math.ceil((CFG.MONSTER_RADIUS + 0.03) / fine), c = k >> 1;
    // NavGrid hanya menginflasi furnitur (OBB); dinding dihitung di sini: tidak ada sel dinding dalam radius badan monster dari pusat sel
    const clearOfWalls = (ci: number, cj: number) => { for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (di * di + dj * dj > r * r) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= cw.W || j >= cw.H || solid[j * cw.W + i]) return false; } return true; };
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const ci = i * k + c, cj = j * k + c, id = j * this.W + i;
      if (ci < cw.W && cj < cw.H) this.clr[id] = this.fine[cj * cw.W + ci];
      if (ci < cw.W && cj < cw.H && vis[cj * cw.W + ci] === 1 && clearOfWalls(ci, cj)) this.ok[id] = 1;
    }
    // biaya clearance
    const P = CFG.MONSTER_NAV_CLEAR_PREF, Wt = CFG.MONSTER_NAV_CLEAR_W;
    for (let id = 0; id < N; id++) { const f = Math.max(0, (P - this.clr[id]) / P); this.mult[id] = 1 + Wt * f * f; }
    this.applyDoors(doors);
    for (let id = 0; id < N; id++) if (this.ok[id] && !this.pocket[id]) this.ids.push(id);   // titik acak (patroli / seret) tidak pernah di balik daun pintu
    this.count = this.ok.reduce((a, v) => a + v, 0);
  }

  /** Transformasi jarak (chamfer 3-4-ish, 8 tetangga) dari sel padat ke tiap sel, dalam meter (dari tepi sel padat). */
  private static distanceField(occ: Uint8Array, W: number, H: number, cell: number): Float32Array {
    const INF = 1e6, d = new Float32Array(W * H), S = Math.SQRT2;
    for (let i = 0; i < d.length; i++) d[i] = occ[i] ? 0 : INF;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; let v = d[k]; if (v === 0) continue;
      if (i > 0 && d[k - 1] + 1 < v) v = d[k - 1] + 1;
      if (j > 0) { if (d[k - W] + 1 < v) v = d[k - W] + 1; if (i > 0 && d[k - W - 1] + S < v) v = d[k - W - 1] + S; if (i < W - 1 && d[k - W + 1] + S < v) v = d[k - W + 1] + S; }
      d[k] = v;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i; let v = d[k]; if (v === 0) continue;
      if (i < W - 1 && d[k + 1] + 1 < v) v = d[k + 1] + 1;
      if (j < H - 1) { if (d[k + W] + 1 < v) v = d[k + W] + 1; if (i < W - 1 && d[k + W + 1] + S < v) v = d[k + W + 1] + S; if (i > 0 && d[k + W - 1] + S < v) v = d[k + W - 1] + S; }
      d[k] = v;
    }
    for (let i = 0; i < d.length; i++) d[i] = d[i] >= INF ? 9 : Math.max(0, (d[i] - 0.5) * cell);
    return d;
  }

  /** Biaya zona pintu ke grid kasar: kantong balik-daun, sapuan daun (kecuali lorong tengah), dan lorong ambang. Statis (tidak bergantung keadaan pintu). */
  private applyDoors(doors: readonly NavDoor[]) {
    const R = CFG.MONSTER_RADIUS;
    for (const g of doors) {
      const f = doorFrame(g), reach = g.len + 1.4, i0 = Math.max(0, Math.floor((g.hingeX - reach - this.x0) / this.cell)), i1 = Math.min(this.W - 1, Math.floor((g.hingeX + reach - this.x0) / this.cell));
      const j0 = Math.max(0, Math.floor((g.hingeZ - reach - this.z0) / this.cell)), j1 = Math.min(this.H - 1, Math.floor((g.hingeZ + reach - this.z0) / this.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const id = j * this.W + i; if (!this.ok[id]) continue;
        const c = this.center(id), q = frameXY(g, c.x, c.z, f); let e = 0;
        if (inPocket(g, c.x, c.z, 0.15, f)) { this.pocket[id] = 1; e += CFG.MONSTER_NAV_POCKET_COST; }
        else if (inSweep(g, c.x, c.z, R, f) && !inFunnel(g, c.x, c.z, FUNNEL_HALF, f)) e += CFG.MONSTER_NAV_SWEEP_COST;
        if (Math.abs(q.v) < 0.6 && q.u > -0.25 && q.u < g.len + 0.25) { const lat = Math.abs(q.u - g.len / 2) / (g.len / 2); e += CFG.MONSTER_NAV_DOOR_FUNNEL * lat * lat; }   // ambang: tengah celah paling murah
        if (e > 0) { this.extra[id] += e; this.mult[id] += e; }
      }
    }
  }

  cellOf(x: number, z: number): [number, number] { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
  idOf(x: number, z: number): number { const [i, j] = this.cellOf(x, z); return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i; }
  center(id: number): Pt { const i = id % this.W, j = (id - i) / this.W; return { x: this.x0 + (i + 0.5) * this.cell, z: this.z0 + (j + 0.5) * this.cell }; }
  isOk(x: number, z: number): boolean { const [i, j] = this.cellOf(x, z); return i >= 0 && j >= 0 && i < this.W && j < this.H && this.ok[j * this.W + i] === 1; }
  /** Di balik daun pintu terbuka (kantong sisi engsel)? Titik seperti ini bukan tujuan yang layak. */
  isPocket(x: number, z: number): boolean { const id = this.idOf(x, z); return id >= 0 && this.pocket[id] === 1; }
  /** Jarak (m) titik ke dinding/furnitur terdekat (grid halus 0,1 m). */
  clearAt(x: number, z: number): number { const i = Math.floor((x - this.x0) / this.fCell), j = Math.floor((z - this.z0) / this.fCell); if (i < 0 || j < 0 || i >= this.fW || j * this.fW + i >= this.fine.length) return 0; return this.fine[j * this.fW + i]; }
  /** Tambahan biaya zona pintu di titik (0 = bebas). */
  extraAt(x: number, z: number): number { const id = this.idOf(x, z); return id < 0 ? 0 : this.extra[id]; }
  /** Sel bebas terdekat (cincin) dalam radius maxR; null bila tidak ada. */
  snap(x: number, z: number, maxR = 4): Pt | null {
    if (this.isOk(x, z)) return { x, z };
    const [ci, cj] = this.cellOf(x, z), R = Math.ceil(maxR / this.cell); let best = -1, bd = 1e9;
    for (let r = 1; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.W || j >= this.H || !this.ok[j * this.W + i]) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = j * this.W + i; }
      }
      if (best >= 0) return this.center(best);
    }
    return null;
  }
  randomPoint(rng: Rng): Pt { return this.center(this.ids[Math.floor(rng.next() * this.ids.length)]); }
  lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      // sel kasar saja tidak cukup: memotong sudut kusen pintu (celah ~0,5 m) membuat monster menabrak dinding -> cek juga grid dinding dengan radius badan
      if (!this.isOk(x, z) || this.cw.gridBlocked(x, z, CFG.MONSTER_RADIUS + 0.1, this.level)) return false;   // +10 cm: jangan memotong sudut kusen pintu
    }
    return true;
  }
  /** lineClear + syarat penghalusan: tidak lebih dekat ke dinding dari minClr, tidak lebih dalam di zona pintu dari maxExtra, tidak di kantong, tidak di sel terhalang sementara. */
  private lineOk(ax: number, az: number, bx: number, bz: number, minClr: number, maxExtra: number, avoid?: ReadonlySet<number>): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, id = this.idOf(x, z);
      if (id < 0 || !this.ok[id] || this.pocket[id] || this.extra[id] > maxExtra || this.clearAt(x, z) < minClr || (avoid && avoid.has(id))) return false;
      if (this.cw.gridBlocked(x, z, CFG.MONSTER_RADIUS + 0.1, this.level)) return false;
    }
    return true;
  }
  /** Jalur titik-jalan pada pengali biaya; `avoid` = sel kasar yang ditandai terhalang sementara (diabaikan dekat titik awal/tujuan agar tidak buntu). */
  path(sx: number, sz: number, gx: number, gz: number, avoid?: ReadonlySet<number>): Pt[] | null {
    const s = this.snap(sx, sz, 2), g = this.snap(gx, gz, 4); if (!s || !g) return null;
    const [si, sj] = this.cellOf(s.x, s.z), [gi, gj] = this.cellOf(g.x, g.z), W = this.W, N = W * this.H;
    const gs = new Float32Array(N).fill(1e9), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap: number[] = [], fs = new Float32Array(N);
    const h = (i: number, j: number) => { const dx = Math.abs(i - gi), dj = Math.abs(j - gj); return (dx + dj) + (Math.SQRT2 - 2) * Math.min(dx, dj); };   // biaya >= 1 per langkah: tetap admissible
    const push = (id: number) => { heap.push(id); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (fs[heap[p]] <= fs[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && fs[heap[l]] < fs[heap[m]]) m = l; if (r < heap.length && fs[heap[r]] < fs[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const s0 = sj * W + si, g0 = gj * W + gi; gs[s0] = 0; fs[s0] = h(si, sj); push(s0);
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    const near = (i: number, j: number) => (Math.abs(i - si) <= 2 && Math.abs(j - sj) <= 2) || (Math.abs(i - gi) <= 2 && Math.abs(j - gj) <= 2);
    let found = false, guard = 0;
    while (heap.length && guard++ < 200000) {
      const cur = pop(); if (closed[cur]) continue; closed[cur] = 1; if (cur === g0) { found = true; break; }
      const ci = cur % W, cj = (cur - ci) / W, mc = this.mult[cur];
      for (const [di, dj, c] of D) {
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.H) continue; const nid = nj * W + ni; if (!this.ok[nid] || closed[nid]) continue;
        if (di && dj && (!this.ok[cj * W + ni] || !this.ok[nj * W + ci])) continue;
        if (avoid && avoid.has(nid) && !near(ni, nj)) continue;
        const ng = gs[cur] + c * 0.5 * (mc + this.mult[nid]); if (ng < gs[nid]) { gs[nid] = ng; par[nid] = cur; fs[nid] = ng + h(ni, nj); push(nid); }
      }
    }
    if (!found) return null;
    const ids: number[] = []; for (let c = g0; c !== -1; c = par[c]) ids.push(c); ids.reverse();
    const cells: Pt[] = ids.map((c) => this.center(c)); cells[0] = { x: s.x, z: s.z }; cells[cells.length - 1] = { x: g.x, z: g.z };
    // penghalusan: loncat ke titik terjauh yang masih terlihat, TETAPI tidak boleh lebih dekat ke dinding / lebih dalam di zona pintu daripada jalur A* di antaranya (tidak memotong sudut)
    const out: Pt[] = []; let a = 0; const SPAN = 45;
    while (a < cells.length - 1) {
      let b = Math.min(cells.length - 1, a + SPAN);
      while (b > a + 1) {
        let minC = 9, maxE = 0; for (let q = a; q <= b; q++) { const id = ids[q]; if (this.clr[id] < minC) minC = this.clr[id]; if (this.extra[id] > maxE) maxE = this.extra[id]; }
        if (this.lineOk(cells[a].x, cells[a].z, cells[b].x, cells[b].z, Math.max(CFG.MONSTER_RADIUS + 0.03, Math.min(CFG.MONSTER_NAV_CLEAR_PREF * 0.9, minC) - 0.06), maxE + 0.01, avoid) && this.lineClear(cells[a].x, cells[a].z, cells[b].x, cells[b].z)) break;
        b--;
      }
      out.push(cells[b]); a = b;
    }
    this.nudge(s, out, avoid);
    return this.doorCenters(s, out);
  }

  /** Geser titik sudut (bukan titik akhir) menjauh dari dinding bila ada titik dalam 0,3 m yang lebih lapang dan kedua ruasnya tetap sah: tikungan tidak menyerempet dinding / furnitur. */
  private nudge(start: Pt, pts: Pt[], avoid?: ReadonlySet<number>) {
    const P = CFG.MONSTER_NAV_CLEAR_PREF;
    for (let i = 0; i < pts.length - 1; i++) {
      const prev = i === 0 ? start : pts[i - 1], p = pts[i], next = pts[i + 1], c0 = this.clearAt(p.x, p.z); if (c0 >= P * 0.8) continue;
      let best: Pt | null = null, bc = c0 + 0.05;
      for (const rr of [0.15, 0.3]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, q = { x: p.x + Math.sin(a) * rr, z: p.z + Math.cos(a) * rr }, cq = this.clearAt(q.x, q.z);
        if (cq <= bc || !this.isOk(q.x, q.z) || this.isPocket(q.x, q.z) || this.extraAt(q.x, q.z) > this.extraAt(p.x, p.z) + 0.01) continue;
        const floor = Math.max(CFG.MONSTER_RADIUS + 0.03, Math.min(P * 0.9, c0, this.clearAt(prev.x, prev.z), this.clearAt(next.x, next.z)) - 0.06), mx = Math.max(this.extraAt(p.x, p.z), this.extraAt(prev.x, prev.z), this.extraAt(next.x, next.z)) + 0.01;
        if (this.lineOk(prev.x, prev.z, q.x, q.z, floor, mx, avoid) && this.lineOk(q.x, q.z, next.x, next.z, floor, mx, avoid)) { best = q; bc = cq; }
      }
      if (best) pts[i] = best;
    }
  }

  /** Ruas yang memotong garis ambang pintu tidak di tengah: sisipkan titik antara (tegak lurus, tepat di tengah celah) supaya pintu dilewati lewat TENGAH ambang, bukan menyerempet daun / kusen. */
  private doorCenters(start: Pt, pts: Pt[]): Pt[] {
    if (!this.doors.length) return pts;
    for (const g of this.doors) {
      const f = doorFrame(g), c = doorCenter(g, f);
      for (let i = pts.length - 1; i >= 0; i--) {
        const a = i === 0 ? start : pts[i - 1], b = pts[i];
        const pa = (a.x - g.hingeX) * f.nx + (a.z - g.hingeZ) * f.nz, pb = (b.x - g.hingeX) * f.nx + (b.z - g.hingeZ) * f.nz;
        if (!(pa * pb < 0)) continue;
        const t = pa / (pa - pb), qx = a.x + (b.x - a.x) * t, qz = a.z + (b.z - a.z) * t, along = (qx - g.hingeX) * f.lx + (qz - g.hingeZ) * f.lz;
        if (along < -0.1 || along > g.len + 0.1 || Math.abs(along - g.len / 2) <= 0.1) continue;
        const sg = pb > pa ? 1 : -1, ins: Pt[] = [];
        for (const k of [-0.5, 0, 0.5]) { const q = { x: c.x + f.nx * sg * k, z: c.z + f.nz * sg * k }; if (this.isOk(q.x, q.z)) ins.push(q); else if (k === 0) { ins.length = 0; break; } }
        if (ins.length) pts.splice(i, 0, ...ins);
      }
    }
    return pts;
  }
}
