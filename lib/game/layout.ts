// Penempatan furniture acak yang valid + pembagian isi container (key/loot). Logika murni (tanpa three.js).
import { CollisionWorld, type Obb, type ObbIn, type Rect } from './collision';
import type { Rng } from './rng';
import type { Room } from './mapdata';

export type FurnKind = 'table' | 'shelf' | 'desk' | 'cabinet' | 'locker' | 'crate' | 'box';
export interface FurnDef { kind: FurnKind; w: number; d: number; wall: boolean; weight: number }
// Ukuran sesuai prefab di GLB (lebar x kedalaman, meter). Depan = +Z lokal.
export const FURN_DEFS: Record<FurnKind, FurnDef> = {
  table: { kind: 'table', w: 1.2, d: 0.7, wall: true, weight: 2 },
  shelf: { kind: 'shelf', w: 1.61, d: 0.51, wall: true, weight: 2 },
  desk: { kind: 'desk', w: 1.5, d: 0.7, wall: true, weight: 1.5 },
  cabinet: { kind: 'cabinet', w: 1.0, d: 0.45, wall: true, weight: 2 },
  locker: { kind: 'locker', w: 0.45, d: 0.45, wall: true, weight: 1 },
  crate: { kind: 'crate', w: 0.8, d: 0.6, wall: false, weight: 1.5 },
  box: { kind: 'box', w: 0.6, d: 0.5, wall: false, weight: 1.5 },
};
export const SEARCHABLE: FurnKind[] = ['desk', 'cabinet', 'locker', 'crate', 'box'];

export interface Placement {
  id: string; kind: FurnKind; x: number; z: number; yaw: number; hx: number; hz: number;
  ax: number; az: number; // titik akses di depan
}

const CELL = 0.1;

export class NavGrid {
  readonly cw: CollisionWorld; readonly W: number; readonly H: number; readonly x0: number; readonly z0: number;
  readonly wallOnly: Uint8Array; readonly occ: Uint8Array; readonly inf: Uint8Array;
  readonly r: number;
  private vis: Uint8Array; private queue: Int32Array;
  reachCount = 0;

  constructor(cw: CollisionWorld, level: number, fixed: ObbIn[], radiusCells = 3) {
    this.cw = cw; this.W = cw.W; this.H = cw.H; this.x0 = cw.x0; this.z0 = cw.z0; this.r = radiusCells;
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

export function generateFurniture(nav: NavGrid, rng: Rng, o: LayoutOpts): Placement[] {
  const rooms = o.rooms.filter((r) => !(o.forbiddenRoomTypes ?? ['exit', 'ladder']).includes(r.type));
  const areas = rooms.map((r) => (r.rect.maxx - r.rect.minx) * (r.rect.maxz - r.rect.minz));
  const base = nav.flood(o.spawn.x, o.spawn.z);
  const must = o.mustReach.filter((p) => nav.reached(p.x, p.z, p.rad ?? 0.25)); // hanya yang memang terjangkau di awal
  const placed: Placement[] = [];
  // urutan jenis: satu dari tiap jenis utama dulu (meja, lemari, laci, crate, rak), sisanya acak berbobot
  const queue: FurnKind[] = ['table', 'cabinet', 'desk', 'crate', 'shelf'];
  const kinds = Object.values(FURN_DEFS).map((d) => [d.kind, d.weight] as [FurnKind, number]);
  let attempts = 0; const maxA = o.maxAttempts ?? 900;

  while (placed.length < o.count && attempts < maxA) {
    attempts++;
    if (queue.length && attempts % 80 === 0) queue.shift(); // jenis wajib yang tak muat dilewati agar tidak macet
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
      const dist: number[] = [];
      for (let k = 0; k < 4; k++) {
        let d = 0; while (d < 6) { const [i, j] = nav.cellOf(px + DIRS[k][0] * d, pz + DIRS[k][1] * d); if (nav.wallOnly[j * nav.W + i]) break; d += 0.05; }
        dist.push(d); if (d < bd) { bd = d; best = k; }
      }
      if (best < 0 || bd >= 6) continue;
      const wx = DIRS[best][0], wz = DIRS[best][1]; // arah ke dinding
      const fx = -wx, fz = -wz;                       // arah depan
      const gap = 0.03;
      const wallDist = bd - 0.05; // jarak ke permukaan dinding
      cx = px + wx * (wallDist - def.d / 2 - gap);
      cz = pz + wz * (wallDist - def.d / 2 - gap);
      yaw = Math.atan2(fx, fz);
    } else {
      yaw = (Math.floor(rng.next() * 4) * Math.PI) / 2 + rng.range(-0.15, 0.15);
    }
    const ob: ObbIn = { id: 'cand', cx, cz, hx: def.w / 2, hz: def.d / 2, yaw, level: 0, kind };
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    // 1) tidak menimpa dinding / furniture lain (margin kecil)
    if (nav.hits(nav.occ, ob, 0.1)) continue;
    // 2) bebas-bebas: tidak dekat spawn / pintu / exit / tangga
    let bad = false;
    for (const k of o.keepouts) { if (CollisionWorld.distToObb({ cx, cz, hx: ob.hx, hz: ob.hz, cos: cosY, sin: sinY }, k.x, k.z) < k.r) { bad = true; break; } }
    if (bad) continue;
    // 3) furniture berdiri bebas butuh jarak dari dinding agar tidak menyempitkan jalan
    if (!def.wall && nav.hits(nav.wallOnly, ob, 0.55)) continue;
    // 4) titik akses (depan; crate/box boleh dari sisi mana saja) harus terjangkau
    const dd = def.d / 2 + 0.7, ww = def.w / 2 + 0.7;
    const loc: [number, number][] = def.wall ? [[0, dd]] : [[0, dd], [0, -dd], [ww, 0], [-ww, 0]];
    const sides = loc.map(([lx, lz]) => [cx + lx * cosY + lz * sinY, cz - lx * sinY + lz * cosY] as [number, number]);
    // coba tempatkan, lalu cek konektivitas
    const u = nav.addObb(ob, 0.05);
    const n = nav.flood(o.spawn.x, o.spawn.z);
    let ok = n > 0 && n >= base * 0.97;
    if (ok) for (const m of must) if (!nav.reached(m.x, m.z, m.rad ?? 0.25)) { ok = false; break; }
    let acc: [number, number] | undefined;
    if (ok && SEARCHABLE.includes(kind)) { acc = sides.find(([x, z]) => nav.reached(x, z, 0.15)); ok = !!acc; }
    if (!ok) { nav.undo(u); continue; }
    const front = acc ?? sides[0];
    placed.push({ id: `R${placed.length + 1}_${kind}`, kind, x: cx, z: cz, yaw, hx: ob.hx, hz: ob.hz, ax: front[0], az: front[1] });
    if (queue.length) queue.shift();
  }
  nav.flood(o.spawn.x, o.spawn.z);
  return placed;
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
