// Penempatan furniture acak yang valid + pembagian isi container (key/loot). Logika murni (tanpa three.js).
import { CollisionWorld, type Obb, type ObbIn, type Rect } from './collision';
import type { Rng } from './rng';
import type { Room } from './mapdata';

export type FurnKind = 'table' | 'shelf' | 'desk' | 'cabinet' | 'locker' | 'crate' | 'box';
// ox/oz = pusat kotak relatif origin visual (lokal). front/back = jangkauan ayunan bagian yang terbuka (pintu/laci/tutup) di luar badan; hanya untuk validasi.
export interface FurnDef { kind: FurnKind; w: number; d: number; wall: boolean; weight: number; ox: number; oz: number; front: number; back: number }
// Ukuran awal sesuai furniture bawaan backrooms_full.glb (lebar x kedalaman, meter); nilai pasti diukur dari GLB (applyFootprints). Depan = +Z lokal.
// table=DiningTable, shelf=Bookshelf, desk=Desk (2 laci), cabinet=Cabinet (2 pintu), locker=Locker, crate=FilingCabinet (laci), box=StorageCabinet (4 pintu)
export const FURN_DEFS: Record<FurnKind, FurnDef> = {
  table: { kind: 'table', w: 1.6, d: 0.9, wall: true, weight: 2, ox: 0, oz: 0, front: 0, back: 0 },
  shelf: { kind: 'shelf', w: 1.2, d: 0.35, wall: true, weight: 2, ox: 0, oz: 0, front: 0, back: 0 },
  desk: { kind: 'desk', w: 1.5, d: 0.7, wall: true, weight: 1.5, ox: 0, oz: 0, front: 0.45, back: 0 },
  cabinet: { kind: 'cabinet', w: 1.2, d: 0.65, wall: true, weight: 2, ox: 0, oz: 0, front: 0.65, back: 0 },
  locker: { kind: 'locker', w: 0.7, d: 0.6, wall: true, weight: 1, ox: 0, oz: 0, front: 0.4, back: 0 },
  crate: { kind: 'crate', w: 0.46, d: 0.62, wall: true, weight: 1.5, ox: 0, oz: 0, front: 0.45, back: 0 },
  box: { kind: 'box', w: 0.9, d: 0.45, wall: true, weight: 1.5, ox: 0, oz: 0, front: 0.45, back: 0 },
};
/** Pakai footprint EXACT hasil ukur GLB (kotak collision = kotak visual; +1 cm toleransi). Tanpa data ukur, nilai bawaan dipakai. */
export function applyFootprints(m: Record<string, { w: number; d: number; ox?: number; oz?: number }>): void {
  for (const k of Object.keys(m)) {
    const d = FURN_DEFS[k as FurnKind]; if (!d) continue;
    d.w = Math.ceil(m[k].w * 100) / 100 + 0.01; d.d = Math.ceil(m[k].d * 100) / 100 + 0.01;
    d.ox = m[k].ox ?? 0; d.oz = m[k].oz ?? 0;
  }
}
/** Offset dunia dari pusat kotak ke origin visual (untuk memposisikan mesh agar tepat di dalam kotak collision). */
export function visualOffset(kind: FurnKind, yaw: number): { x: number; z: number } {
  const d = FURN_DEFS[kind], c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: -(d.ox * c + d.oz * s), z: -(-d.ox * s + d.oz * c) };
}
export const SEARCHABLE: FurnKind[] = ['desk', 'cabinet', 'locker', 'crate', 'box'];

export interface Placement {
  id: string; kind: FurnKind; x: number; z: number; yaw: number; hx: number; hz: number; // x,z = PUSAT kotak collision
  vx: number; vz: number; // offset pusat kotak -> origin mesh (posisi mesh = x+vx, z+vz)
  ax: number; az: number; // titik akses di depan
}

const CELL = 0.1;

export class NavGrid {
  readonly cw: CollisionWorld; readonly W: number; readonly H: number; readonly x0: number; readonly z0: number;
  readonly wallOnly: Uint8Array; readonly occ: Uint8Array; readonly inf: Uint8Array;
  readonly r: number; readonly fixed: ObbIn[];
  private vis: Uint8Array; private queue: Int32Array;
  reachCount = 0;

  constructor(cw: CollisionWorld, level: number, fixed: ObbIn[], radiusCells = 3) {
    this.cw = cw; this.W = cw.W; this.H = cw.H; this.x0 = cw.x0; this.z0 = cw.z0; this.r = radiusCells; this.fixed = fixed.filter((o) => o.level === level);
    this.wallOnly = cw.solid[level].slice();
    this.occ = this.wallOnly.slice();
    this.inf = new Uint8Array(this.W * this.H);
    this.vis = new Uint8Array(this.W * this.H);
    this.queue = new Int32Array(this.W * this.H);
    const w = cw.walk[level];
    if (w) { // area di luar mezzanine dianggap padat
      for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
        const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
        if (x < w.minx || x > w.maxx || z < w.minz || z > w.maxz) { this.occ[j * this.W + i] = 1; this.wallOnly[j * this.W + i] = 1; }
      }
    }
    for (const o of fixed) if (o.level === level) this.addObb(o, 0.05); // margin agar benda tipis (partisi) tetap terdeteksi
    // inflasi penuh sekali
    this.inf.fill(0);
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) if (this.occ[j * this.W + i]) this.mark(this.inf, i, j, null);
  }

  private mark(arr: Uint8Array, i: number, j: number, undo: number[] | null) {
    const r = this.r;
    for (let dj = -r; dj <= r; dj++) { const jj = j + dj; if (jj < 0 || jj >= this.H) continue;
      for (let di = -r; di <= r; di++) { const ii = i + di; if (ii < 0 || ii >= this.W) continue; const k = jj * this.W + ii; if (!arr[k]) { arr[k] = 1; if (undo) undo.push(k); } } }
  }

  cellOf(x: number, z: number): [number, number] { return [Math.floor((x - this.x0) / CELL), Math.floor((z - this.z0) / CELL)]; }
  center(i: number, j: number): [number, number] { return [this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL]; }

  /** Tandai OBB ke grid. Mengembalikan daftar sel yang berubah (untuk undo). */
  addObb(o: ObbIn, margin: number): { occ: number[]; inf: number[] } {
    const cos = Math.cos(o.yaw), sin = Math.sin(o.yaw), rad = Math.hypot(o.hx, o.hz) + margin;
    const [i0, j0] = this.cellOf(o.cx - rad, o.cz - rad), [i1, j1] = this.cellOf(o.cx + rad, o.cz + rad);
    const undoOcc: number[] = [], undoInf: number[] = [];
    for (let j = Math.max(0, j0); j <= Math.min(this.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.W - 1, i1); i++) {
      const [x, z] = this.center(i, j);
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin) {
        const k = j * this.W + i;
        if (!this.occ[k]) { this.occ[k] = 1; undoOcc.push(k); }
        this.mark(this.inf, i, j, undoInf);
      }
    }
    return { occ: undoOcc, inf: undoInf };
  }
  undo(u: { occ: number[]; inf: number[] }) { for (const k of u.occ) this.occ[k] = 0; for (const k of u.inf) this.inf[k] = 0; }

  /** Apakah OBB (dengan margin) menyentuh sel di grid `g`? */
  hits(g: Uint8Array, o: ObbIn, margin: number): boolean {
    const cos = Math.cos(o.yaw), sin = Math.sin(o.yaw), rad = Math.hypot(o.hx, o.hz) + margin;
    const [i0, j0] = this.cellOf(o.cx - rad, o.cz - rad), [i1, j1] = this.cellOf(o.cx + rad, o.cz + rad);
    for (let j = Math.max(0, j0); j <= Math.min(this.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.W - 1, i1); i++) {
      if (!g[j * this.W + i]) continue;
      const [x, z] = this.center(i, j);
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin) return true;
    }
    return false;
  }

  /** Flood fill dari titik awal pada grid terinflasi (pemain berradius ~0.3). */
  flood(sx: number, sz: number): number {
    const { W, H, inf, vis, queue } = this;
    vis.fill(0);
    const [si, sj] = this.cellOf(sx, sz);
    const s = sj * W + si;
    if (inf[s]) { this.reachCount = 0; return 0; }
    let qh = 0, qt = 0; queue[qt++] = s; vis[s] = 1;
    while (qh < qt) {
      const k = queue[qh++], i = k % W, j = (k - i) / W;
      if (i > 0 && !vis[k - 1] && !inf[k - 1]) { vis[k - 1] = 1; queue[qt++] = k - 1; }
      if (i < W - 1 && !vis[k + 1] && !inf[k + 1]) { vis[k + 1] = 1; queue[qt++] = k + 1; }
      if (j > 0 && !vis[k - W] && !inf[k - W]) { vis[k - W] = 1; queue[qt++] = k - W; }
      if (j < H - 1 && !vis[k + W] && !inf[k + W]) { vis[k + W] = 1; queue[qt++] = k + W; }
    }
    this.reachCount = qt;
    return qt;
  }
  /** Titik (atau sel di sekitarnya, radius `rad`) terjangkau pada flood terakhir? */
  reached(x: number, z: number, rad = 0.25): boolean {
    const [ci, cj] = this.cellOf(x, z), n = Math.ceil(rad / CELL);
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
      if (this.vis[j * this.W + i]) return true;
    }
    return false;
  }
  isReachedCell(i: number, j: number) { return this.vis[j * this.W + i] === 1; }
}

export interface LayoutOpts {
  rooms: Room[];
  spawn: { x: number; z: number };
  keepouts: { x: number; z: number; r: number }[]; // spawn, pintu, exit, tangga
  mustReach: { x: number; z: number; rad?: number }[]; // titik penting yang harus tetap terjangkau (rad = toleransi, default 0.25)
  count: number;
  forbiddenRoomTypes?: string[];
  maxAttempts?: number;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- validasi geometri ringan (OBB / SAT) ----------
type Box = { cx: number; cz: number; hx: number; hz: number; yaw: number };
const corners = (o: Box, m: number): [number, number][] => {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw), out: [number, number][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = sx * (o.hx + m), lz = sz * (o.hz + m); out.push([o.cx + lx * c + lz * s, o.cz - lx * s + lz * c]); }
  return out;
};
/** Dua kotak berputar bertumpuk (a diperbesar `m` meter di semua sisi)? SAT 2D. */
export function boxesOverlap(a: Box, b: Box, m = 0): boolean {
  const A = corners(a, m), B = corners(b, 0);
  for (const o of [a, b]) for (const ax of [[Math.cos(o.yaw), -Math.sin(o.yaw)], [Math.sin(o.yaw), Math.cos(o.yaw)]]) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const p of A) { const v = p[0] * ax[0] + p[1] * ax[1]; if (v < a0) a0 = v; if (v > a1) a1 = v; }
    for (const p of B) { const v = p[0] * ax[0] + p[1] * ax[1]; if (v < b0) b0 = v; if (v > b1) b1 = v; }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
/** Kotak badan + area ayunan (pintu lemari/locker, laci meja, tutup crate) sebagai satu kotak. Depan = +Z lokal. */
export function swingBox(kind: FurnKind, b: Box): Box {
  const d = FURN_DEFS[kind], sh = (d.front - d.back) / 2;
  return { cx: b.cx + Math.sin(b.yaw) * sh, cz: b.cz + Math.cos(b.yaw) * sh, hx: b.hx, hz: b.hz + (d.front + d.back) / 2, yaw: b.yaw };
}
const boxOf = (o: ObbIn): Box => ({ cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, yaw: o.yaw });

/** Koridor jalur utama: jalur terpendek (grid terinflasi, tanpa furniture acak) dari spawn ke tiap titik penting, dilebarkan `rad` meter. */
export function routeMask(nav: NavGrid, spawn: { x: number; z: number }, targets: { x: number; z: number; rad?: number }[], rad: number): Uint8Array {
  const { W, H, inf } = nav, mask = new Uint8Array(W * H), par = new Int32Array(W * H).fill(-2), q = new Int32Array(W * H);
  const [si, sj] = nav.cellOf(spawn.x, spawn.z), s0 = sj * W + si;
  if (inf[s0]) return mask;
  let qh = 0, qt = 0; q[qt++] = s0; par[s0] = -1;
  while (qh < qt) {
    const k = q[qh++], i = k % W;
    if (i > 0 && par[k - 1] === -2 && !inf[k - 1]) { par[k - 1] = k; q[qt++] = k - 1; }
    if (i < W - 1 && par[k + 1] === -2 && !inf[k + 1]) { par[k + 1] = k; q[qt++] = k + 1; }
    if (k >= W && par[k - W] === -2 && !inf[k - W]) { par[k - W] = k; q[qt++] = k - W; }
    if (k < W * (H - 1) && par[k + W] === -2 && !inf[k + W]) { par[k + W] = k; q[qt++] = k + W; }
  }
  const n = Math.ceil(rad / 0.1), stamp = (k: number) => {
    const i = k % W, j = (k - i) / W;
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) { if (di * di + dj * dj > n * n) continue; const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H) mask[jj * W + ii] = 1; }
  };
  for (const t of targets) {
    const [ci, cj] = nav.cellOf(t.x, t.z), m = Math.ceil((t.rad ?? 0.25) / 0.1);
    let best = -1, bd = 1e9;
    for (let dj = -m; dj <= m; dj++) for (let di = -m; di <= m; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const k = jj * W + ii; if (par[k] !== -2) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; } } }
    for (let k = best, guard = 0; k >= 0 && guard < 20000; k = par[k], guard++) stamp(k);
  }
  return mask;
}
const maskHits = (nav: NavGrid, g: Uint8Array, b: Box): boolean => nav.hits(g, { id: 'm', ...b, level: 0, kind: 'm' }, 0);

/** Dari sel yang BARU terinflasi oleh furniture: berapa yang sebenarnya masih bisa diinjak badan pemain (lingkaran r=0,3)? = celah sempit 0,6-0,7 m (potensi jebakan). */
function newSqueeze(nav: NavGrid, changed: number[]): number {
  let n = 0;
  for (const k of changed) {
    const i = k % nav.W, j = (k - i) / nav.W;
    if (i < 3 || j < 3 || i >= nav.W - 3 || j >= nav.H - 3) continue;
    let free = true;
    for (let dj = -3; dj <= 3 && free; dj++) for (let di = -3; di <= 3; di++) if (di * di + dj * dj <= 12 && nav.occ[(j + dj) * nav.W + i + di]) { free = false; break; }
    if (free) n++;
  }
  return n;
}

export function generateFurniture(nav: NavGrid, rng: Rng, o: LayoutOpts): Placement[] {
  const rooms = o.rooms.filter((r) => !(o.forbiddenRoomTypes ?? ['exit', 'ladder']).includes(r.type));
  const areas = rooms.map((r) => (r.rect.maxx - r.rect.minx) * (r.rect.maxz - r.rect.minz));
  const base = nav.flood(o.spawn.x, o.spawn.z);
  const must = o.mustReach.filter((p) => nav.reached(p.x, p.z, p.rad ?? 0.25)); // hanya yang memang terjangkau di awal
  const strictRoute = routeMask(nav, o.spawn, must, 0.45), softRoute = routeMask(nav, o.spawn, must, 0.3);
  const placed: Placement[] = [], placedBoxes: { b: Box; s: Box }[] = [];
  // urutan jenis: satu dari tiap jenis utama dulu (meja, lemari, laci, crate, rak), sisanya acak berbobot
  const queue: FurnKind[] = ['table', 'cabinet', 'desk', 'crate', 'shelf'];
  const kinds = Object.values(FURN_DEFS).map((d) => [d.kind, d.weight] as [FurnKind, number]);
  let attempts = 0; const maxA = o.maxAttempts ?? 1400;

  while (placed.length < o.count && attempts < maxA) {
    attempts++;
    const tier = attempts < maxA * 0.6 ? 0 : 1; // tier 1 = sedikit lebih longgar (koridor lebih sempit, tanpa cek celah) agar jumlah tetap terpenuhi
    if (queue.length && attempts % 100 === 0) queue.shift(); // jenis wajib yang tak muat dilewati agar tidak macet
    const kind = queue.length ? queue[0] : rng.weighted(kinds);
    const def = FURN_DEFS[kind];
    // pilih room berbobot luas
    let tot = 0; for (const a of areas) tot += a;
    let pick = rng.next() * tot, ri = 0;
    for (; ri < rooms.length - 1; ri++) { pick -= areas[ri]; if (pick <= 0) break; }
    const R = rooms[ri].rect;
    const px = rng.range(R.minx + 0.5, R.maxx - 0.5), pz = rng.range(R.minz + 0.5, R.maxz - 0.5);

    let cx = px, cz = pz, yaw = 0;
    if (def.wall) {
      // cari dinding terdekat lalu tempel punggung furniture ke dinding, hadap ke dalam ruangan
      let best = -1, bd = 9;
      for (let k = 0; k < 4; k++) {
        let d = 0; while (d < 6) { const [i, j] = nav.cellOf(px + DIRS[k][0] * d, pz + DIRS[k][1] * d); if (nav.wallOnly[j * nav.W + i]) break; d += 0.05; }
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0 || bd >= 6) continue;
      const wx = DIRS[best][0], wz = DIRS[best][1]; // arah ke dinding
      const gap = 0.03, wallDist = bd - 0.05;      // jarak ke permukaan dinding
      cx = px + wx * (wallDist - def.d / 2 - gap);
      cz = pz + wz * (wallDist - def.d / 2 - gap);
      yaw = Math.atan2(-wx, -wz);
    } else {
      yaw = (Math.floor(rng.next() * 4) * Math.PI) / 2 + rng.range(-0.15, 0.15);
    }
    const ob: ObbIn = { id: 'cand', cx, cz, hx: def.w / 2, hz: def.d / 2, yaw, level: 0, kind };
    const body = boxOf(ob), sw = swingBox(kind, body);
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    // 0) pusat harus di dalam area ruangan & kotak tidak keluar dari rect ruangan (tidak menembus ke ruang sebelah)
    if (cx < R.minx + 0.05 || cx > R.maxx - 0.05 || cz < R.minz + 0.05 || cz > R.maxz - 0.05) continue;
    // 1) badan tidak menimpa dinding / furniture bawaan / furniture acak lain (margin kecil); area ayunan juga bebas
    if (nav.hits(nav.occ, ob, 0.1)) continue;
    if (nav.hits(nav.occ, { ...ob, ...sw }, 0.02)) continue;
    // 2) cek SAT eksplisit (bukan grid) terhadap furniture bawaan & acak: badan beri jarak 8 cm, ayunan tak boleh menembus badan lain
    let bad = false;
    for (const f of nav.fixed) { if (f.kind === 'rail') continue; if (boxesOverlap(body, boxOf(f), 0.08) || boxesOverlap(sw, boxOf(f), 0)) { bad = true; break; } }
    if (bad) continue;
    for (const p of placedBoxes) if (boxesOverlap(body, p.b, 0.08) || boxesOverlap(sw, p.b, 0) || boxesOverlap(p.s, body, 0)) { bad = true; break; }
    if (bad) continue;
    // 3) bebas-bebas: tidak dekat spawn / pintu / exit / tangga (diukur dari area ayunan juga)
    for (const k of o.keepouts) {
      const sbx = { cx: sw.cx, cz: sw.cz, hx: sw.hx, hz: sw.hz, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) };
      if (CollisionWorld.distToObb(sbx, k.x, k.z) < k.r) { bad = true; break; }
    }
    if (bad) continue;
    // 4) jalur utama (spawn -> pintu -> key/container -> exit) tetap lebar: tidak boleh memotong koridor
    if (maskHits(nav, tier === 0 ? strictRoute : softRoute, sw)) continue;
    // 5) furniture berdiri bebas butuh jarak dari dinding agar tidak menyempitkan jalan
    if (!def.wall && nav.hits(nav.wallOnly, ob, 0.55)) continue;
    // 6) titik akses (depan; crate/box boleh dari sisi mana saja) harus terjangkau
    const dd = def.d / 2 + 0.7, ww = def.w / 2 + 0.7;
    const loc: [number, number][] = def.wall ? [[0, dd]] : [[0, dd], [0, -dd], [ww, 0], [-ww, 0]];
    const sides = loc.map(([lx, lz]) => [cx + lx * cosY + lz * sinY, cz - lx * sinY + lz * cosY] as [number, number]);
    // coba tempatkan, lalu cek konektivitas & celah jebakan
    const u = nav.addObb(ob, 0.05);
    let ok = !(tier === 0 && newSqueeze(nav, u.inf) > 3); // tidak membuat celah sempit yang bisa menjepit pemain (murah, sebelum flood)
    const n = ok ? nav.flood(o.spawn.x, o.spawn.z) : 0;
    ok = ok && n > 0 && n >= base * 0.97;
    if (ok) for (const m of must) if (!nav.reached(m.x, m.z, m.rad ?? 0.25)) { ok = false; break; }
    let acc: [number, number] | undefined;
    if (ok && SEARCHABLE.includes(kind)) { acc = sides.find(([x, z]) => nav.reached(x, z, 0.15)); ok = !!acc; }
    // furniture baru tidak boleh menutup titik akses (depan) furniture searchable yang SUDAH ditempatkan
    if (ok) for (const q of placed) if (SEARCHABLE.includes(q.kind) && !nav.reached(q.ax, q.az, 0.15)) { ok = false; break; }
    if (!ok) { nav.undo(u); continue; }
    const front = acc ?? sides[0], vo = visualOffset(kind, yaw);
    placed.push({ id: `R${placed.length + 1}_${kind}`, kind, x: cx, z: cz, yaw, hx: ob.hx, hz: ob.hz, vx: vo.x, vz: vo.z, ax: front[0], az: front[1] });
    placedBoxes.push({ b: body, s: sw });
    if (queue.length) queue.shift();
  }
  nav.flood(o.spawn.x, o.spawn.z);
  return placed;
}

// ---------- kasur (ruang tidur / istirahat) ----------
export interface BedPlacement { id: string; x: number; z: number; yaw: number; hx: number; hz: number; room: string; sides: [number, number][] }
export const BED_SIZE = { w: 1.0, d: 2.05 }; // lebar (x lokal) x panjang (z lokal); kepala di -z (menempel dinding), kaki di +z
export const BED_ROOMS: { types: string[]; count: number }[] = [{ types: ['break'], count: 2 }, { types: ['admin', 'docs', 'tech', 'meeting', 'kitchen'], count: 1 }]; // ruang istirahat (2 kasur) + satu ruang lain sebagai kamar tidur

/**
 * Menempatkan kasur: kepala menempel dinding, minimal satu sisi panjang bisa dijangkau (untuk merangkak ke kolong), tidak menutup pintu /
 * jalur utama / spawn / tangga / titik penting, tidak membuat celah jebakan. Dipanggil SEBELUM furniture acak dengan RNG terpisah
 * (urutan RNG furniture & seed tidak berubah). Percobaan dibatasi; kasur yang tak muat dilewati.
 */
export function generateBeds(nav: NavGrid, rng: Rng, o: { rooms: Room[]; spawn: { x: number; z: number }; keepouts: { x: number; z: number; r: number }[]; mustReach: { x: number; z: number; rad?: number }[]; maxAttempts?: number; stats?: Record<string, number> }): BedPlacement[] {
  const rej = (k: string) => { if (o.stats) o.stats[k] = (o.stats[k] ?? 0) + 1; };
  const out: BedPlacement[] = [], boxes: Box[] = [];
  const base = nav.flood(o.spawn.x, o.spawn.z);
  const must = o.mustReach.filter((p) => nav.reached(p.x, p.z, p.rad ?? 0.25));
  const route = routeMask(nav, o.spawn, must, 0.45);
  const hx = BED_SIZE.w / 2, hz = BED_SIZE.d / 2;
  for (const spec of BED_ROOMS) {
    const rooms = o.rooms.filter((r) => spec.types.includes(r.type));
    if (!rooms.length) continue;
    let made = 0, attempts = 0;
    while (made < spec.count && attempts++ < (o.maxAttempts ?? 340)) {
      const rm = rooms[Math.floor(rng.next() * rooms.length)], R = rm.rect;
      const px = rng.range(R.minx + 0.8, R.maxx - 0.8), pz = rng.range(R.minz + 0.8, R.maxz - 0.8);
      let best = -1, bd = 9; // dinding terdekat dari titik uji: kepala kasur menempel ke sana
      for (let k = 0; k < 4; k++) {
        let d = 0; while (d < 6) { const [i, j] = nav.cellOf(px + DIRS[k][0] * d, pz + DIRS[k][1] * d); if (nav.wallOnly[j * nav.W + i]) break; d += 0.05; }
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0 || bd >= 6) { rej('wall'); continue; }
      const wx = DIRS[best][0], wz = DIRS[best][1], wallDist = bd - 0.05, gap = 0.04;
      const cx = px + wx * (wallDist - hz - gap), cz = pz + wz * (wallDist - hz - gap), yaw = Math.atan2(-wx, -wz);
      if (cx < R.minx + 0.05 || cx > R.maxx - 0.05 || cz < R.minz + 0.05 || cz > R.maxz - 0.05) { rej('rect'); continue; }
      const ob: ObbIn = { id: 'cand', cx, cz, hx, hz, yaw, level: 0, kind: 'bed' };
      const body = boxOf(ob), wide = { ...body, hx: hx + 0.6 }; // + ruang merangkak di kedua sisi panjang
      if (nav.hits(nav.occ, ob, 0.1)) { rej('occ'); continue; }
      let bad = false;
      for (const f of nav.fixed) { if (f.kind === 'rail') continue; if (boxesOverlap(body, boxOf(f), 0.1)) { bad = true; break; } }
      if (bad) { rej('fixed'); continue; }
      for (const b of boxes) if (boxesOverlap(wide, b, 0.3)) { bad = true; break; }
      if (bad) { rej('bed'); continue; }
      for (const k of o.keepouts) { const sbx = { cx: wide.cx, cz: wide.cz, hx: wide.hx, hz: wide.hz, cos: Math.cos(yaw), sin: Math.sin(yaw) }; if (CollisionWorld.distToObb(sbx, k.x, k.z) < k.r) { bad = true; break; } }
      if (bad) { rej('keepout'); continue; }
      if (maskHits(nav, route, wide)) { rej('route'); continue; }
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw), off = hx + 0.55;
      const sides = ([[off, 0], [-off, 0]] as [number, number][]).map(([lx, lz]) => [cx + lx * cosY + lz * sinY, cz - lx * sinY + lz * cosY] as [number, number]);
      const u = nav.addObb(ob, 0.05);
      let ok = newSqueeze(nav, u.inf) <= 3;
      const n = ok ? nav.flood(o.spawn.x, o.spawn.z) : 0;
      ok = ok && n > 0 && n >= base * 0.97;
      if (ok) for (const m of must) if (!nav.reached(m.x, m.z, m.rad ?? 0.25)) { ok = false; break; }
      const reach = ok ? sides.filter(([x, z]) => nav.reached(x, z, 0.15)) : [];
      if (!ok || !reach.length) { rej(ok ? 'noside' : 'flood'); nav.undo(u); continue; }
      out.push({ id: `Bed${out.length + 1}`, x: cx, z: cz, yaw, hx, hz, room: rm.type, sides: reach });
      boxes.push(wide); made++;
    }
  }
  nav.flood(o.spawn.x, o.spawn.z);
  return out;
}

/** Titik lantai bebas & terjangkau untuk item kecil (Almond Water). Panggil setelah furniture ditempatkan. */
export function pickFreeSpots(nav: NavGrid, rng: Rng, count: number, spawn: { x: number; z: number }, minSpawnDist: number, avoid: { x: number; z: number; r: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let tries = 0;
  while (out.length < count && tries++ < 4000) {
    const i = Math.floor(rng.range(0, nav.W)), j = Math.floor(rng.range(0, nav.H));
    if (!nav.isReachedCell(i, j)) continue;
    const [x, z] = nav.center(i, j);
    if (Math.hypot(x - spawn.x, z - spawn.z) < minSpawnDist) continue;
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) continue;
    // minimal 0.5 m dari dinding/furniture
    let free = true;
    for (let dj = -5; dj <= 5 && free; dj++) for (let di = -5; di <= 5; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nav.W || jj >= nav.H) continue; if (nav.occ[jj * nav.W + ii]) { free = false; break; } }
    if (free) out.push({ x, z });
  }
  return out;
}

// ---------- isi container ----------
export type Content = { type: 'key'; key: string } | { type: 'loot'; item: string; text?: string } | { type: 'empty' };
export interface ContainerSlot { id: string; x: number; z: number; level: number }

export const NOTE_TEXTS = [
  'Jangan ikuti lampu yang berkedip. Mereka tidak menuntunmu keluar.',
  'Aku sudah menghitung tiga puluh pintu. Pintu ketiga puluh satu selalu ada di belakangku.',
  'Kunci ada di tempat yang tidak kamu periksa dua kali.',
  'Dengung itu semakin keras kalau kamu diam. Jalan terus.',
  'Pintu merah hanya terbuka untuk yang membawa semuanya.',
  'Kalau lantainya basah, jangan menunduk.',
];

/**
 * Pilih container acak (menyebar & jauh dari spawn) untuk tiap key (satu key per warna/ID, tanpa duplikat).
 * Caller hanya memberi slot yang SUDAH terbukti terjangkau. Key diutamakan di lantai 0 (tanpa tangga).
 * Sisanya kosong / loot; minimal `minBatteries` container non-key berisi battery.
 */
export function assignContents(slots: ContainerSlot[], rng: Rng, keyIds: readonly string[], spawn: { x: number; z: number }, minBatteries = 0): Map<string, Content> {
  const res = new Map<string, Content>();
  const keys = keyIds.length;
  const floor0 = slots.filter((s) => s.level === 0);
  const pool = rng.shuffle((floor0.length >= keys ? floor0 : slots).slice());
  const chosen: ContainerSlot[] = [];
  for (const spread of [7, 4, 0]) {
    chosen.length = 0;
    for (const s of pool) {
      if (chosen.length >= keys) break;
      if (Math.hypot(s.x - spawn.x, s.z - spawn.z) < 5) continue;
      if (chosen.some((c) => c.level === s.level && Math.hypot(c.x - s.x, c.z - s.z) < spread)) continue;
      chosen.push(s);
    }
    if (chosen.length >= keys) break;
  }
  for (const s of pool) { if (chosen.length >= keys) break; if (!chosen.includes(s)) chosen.push(s); }
  const picked = rng.shuffle(chosen.slice(0, keys)); // warna dibagi acak ke container terpilih
  const keyAt = new Map<string, string>();
  picked.forEach((s, i) => keyAt.set(s.id, keyIds[i]));
  const loot: ContainerSlot[] = [];
  for (const s of slots) {
    const k = keyAt.get(s.id);
    if (k) { res.set(s.id, { type: 'key', key: k }); continue; }
    if (rng.chance(0.5)) { res.set(s.id, { type: 'empty' }); loot.push(s); continue; }
    const item = rng.weighted<string>([['battery', 35], ['medkit', 12], ['note', 23], ['almond_water', 30]]);
    res.set(s.id, item === 'note' ? { type: 'loot', item, text: rng.pick(NOTE_TEXTS) } : { type: 'loot', item });
    loot.push(s);
  }
  // jamin jumlah battery minimum (ubah slot non-key yang bukan battery)
  const isBat = (s: ContainerSlot) => { const c = res.get(s.id); return !!c && c.type === 'loot' && c.item === 'battery'; };
  let have = loot.filter(isBat).length;
  for (const s of rng.shuffle(loot.slice())) { if (have >= minBatteries) break; if (!isBat(s)) { res.set(s.id, { type: 'loot', item: 'battery' }); have++; } }
  return res;
}

// ---------- audit akhir penempatan furniture (dipakai GameWorld.generate & tes) ----------
/**
 * Memeriksa ulang SEMUA furniture acak terhadap dinding (grid), furniture bawaan, sesama furniture acak, serta area bebas (spawn, exit, tangga,
 * ayunan pintu, ambang pintu — semuanya sudah ada di `keepouts`). Mengembalikan daftar pelanggaran (kosong = valid).
 * Badan dikecilkan 6 cm terhadap grid dinding karena grid dinding sudah menebalkan permukaan ~5 cm.
 */
export function auditPlacements(cw: CollisionWorld, fixed: ObbIn[], placed: Placement[], keepouts: { x: number; z: number; r: number }[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i], body: Box = { cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw }, sw = swingBox(p.kind, body);
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw), hx = Math.max(0.01, p.hx - 0.06), hz = Math.max(0.01, p.hz - 0.06);
    let wall = false;
    for (let a = 0; a <= 4 && !wall; a++) for (let b = 0; b <= 4; b++) {
      const lx = -hx + (2 * hx * a) / 4, lz = -hz + (2 * hz * b) / 4;
      if (cw.gridBlocked(p.x + lx * c + lz * s, p.z - lx * s + lz * c, 0.0, 0)) { wall = true; break; }
    }
    if (wall) bad.push(`${p.id}: menembus dinding`);
    for (const f of fixed) { if (f.level !== 0 || f.kind === 'rail') continue; if (boxesOverlap(body, f, 0)) { bad.push(`${p.id}: menimpa ${f.id}`); break; } }
    for (let j = i + 1; j < placed.length; j++) { const q = placed[j]; if (boxesOverlap(body, { cx: q.x, cz: q.z, hx: q.hx, hz: q.hz, yaw: q.yaw }, 0)) bad.push(`${p.id}: menimpa ${q.id}`); }
    const sbx = { cx: sw.cx, cz: sw.cz, hx: sw.hx, hz: sw.hz, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) };
    for (const k of keepouts) if (CollisionWorld.distToObb(sbx, k.x, k.z) < k.r) { bad.push(`${p.id}: di area bebas (${k.x.toFixed(1)},${k.z.toFixed(1)})`); break; }
  }
  return bad;
}
