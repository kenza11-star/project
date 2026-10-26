// Pembagian dinding map (F1_Walls/F2_Walls) menjadi bagian-bagian bertekstur berbeda per RUANGAN. Logika murni (tanpa three.js) -> bisa dites di Node dengan GLB asli.
//
// Gaya (sinkron antar ruangan):
//   koridor/lobi         : kayu papan gelap (planks) di bawah, plester lembap di atas
//   kantor/arsip/dapur   : panel kayu (panels) di bawah, plester lembap di atas
//   ruang teknis/server  : beton retak penuh
//   ruang tangga         : bata gelap penuh (menyambung dengan bata di koridor penjara)
//   sisi luar bangunan   : beton retak
// Dinding bawah (wainscot) setinggi WAINSCOT_H dari lantai. Segitiga dinding yang panjang (sampai 36 m, melintasi banyak ruangan) dipotong tepat di batas ruangan
// dan di tinggi wainscot, jadi tiap potongan berada di satu ruangan. Luas permukaan terjaga (hanya dipotong, tidak digeser).

export type WallZone = 'planks' | 'panels' | 'plaster' | 'concrete' | 'brick';
export const WALL_ZONES: readonly WallZone[] = ['planks', 'panels', 'plaster', 'concrete', 'brick'];
export interface RoomLite { type: string; level: number; rect: { minx: number; minz: number; maxx: number; maxz: number } }
export interface WallPart { zone: WallZone; pos: number[]; nor: number[]; uv: number[] }

export const WAINSCOT_H = 1.15;
/** Ukuran 1 tile tekstur di dunia (meter). panels: 5 baris papan -> 2 baris persis setinggi wainscot. */
export const ZONE_TILE: Record<WallZone, number> = { planks: 2.0, panels: 2.875, plaster: 2.4, concrete: 2.6, brick: 1.1 };

interface Style { lower: WallZone | null; upper: WallZone }
const STYLE: Record<string, Style> = {};
const put = (types: string[], s: Style) => { for (const t of types) STYLE[t] = s; };
put(['hub', 'svce', 'svcw', 'perpus'], { lower: 'planks', upper: 'plaster' });
put(['admin', 'meeting', 'docs', 'kantor', 'arsip', 'archive', 'penyimpanan', 'break', 'kitchen'], { lower: 'panels', upper: 'plaster' });
put(['tech', 'server', 'vault', 'utilitas', 'locker', 'lockerroom', 'lab', 'hidden1', 'hidden2'], { lower: null, upper: 'concrete' });
put(['ladder'], { lower: null, upper: 'brick' });
const OUTSIDE: Style = { lower: null, upper: 'concrete' };
export const roomStyle = (type: string | undefined): Style => (type && STYLE[type]) || OUTSIDE;

type V = [number, number, number];
function clip(poly: V[], axis: 0 | 1 | 2, v: number): [V[], V[]] {
  const lo: V[] = [], hi: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = a[axis] - v, db = b[axis] - v;
    if (da <= 0) lo.push(a);
    if (da >= 0) hi.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db), p: V = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; lo.push(p); hi.push(p); }
  }
  return [lo, hi];
}
function area(p: V[]): number {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < p.length; i++) {
    const ux = p[i][0] - p[0][0], uy = p[i][1] - p[0][1], uz = p[i][2] - p[0][2], vx = p[i + 1][0] - p[0][0], vy = p[i + 1][1] - p[0][1], vz = p[i + 1][2] - p[0][2];
    ax += uy * vz - uz * vy; ay += uz * vx - ux * vz; az += ux * vy - uy * vx;
  }
  return 0.5 * Math.hypot(ax, ay, az);
}

/**
 * pos = posisi DUNIA (xyz), idx = indeks segitiga (null = berurutan), nor = normal per-vertex (atau null -> normal muka).
 * levelY(l) = tinggi lantai level l (0/1). Mengembalikan bagian per zona (posisi dunia, normal, UV dalam tile).
 */
export function splitWalls(pos: ArrayLike<number>, nor: ArrayLike<number> | null, idx: ArrayLike<number> | null, rooms: RoomLite[], levelY: (l: number) => number): WallPart[] {
  const parts = new Map<WallZone, WallPart>();
  const part = (z: WallZone) => { let p = parts.get(z); if (!p) { p = { zone: z, pos: [], nor: [], uv: [] }; parts.set(z, p); } return p; };
  // batas ruangan per level & sumbu (potongan di sepanjang dinding)
  const cutsX: number[][] = [[], []], cutsZ: number[][] = [[], []];
  for (const r of rooms) { const l = r.level === 1 ? 1 : 0; cutsX[l].push(r.rect.minx, r.rect.maxx); cutsZ[l].push(r.rect.minz, r.rect.maxz); }
  const uniq = (a: number[]) => Array.from(new Set(a.map((v) => Math.round(v * 1000) / 1000))).sort((p, q) => p - q);
  for (let l = 0; l < 2; l++) { cutsX[l] = uniq(cutsX[l]); cutsZ[l] = uniq(cutsZ[l]); }
  const roomAt = (x: number, z: number, level: number): RoomLite | null => {
    let best: RoomLite | null = null, ba = Infinity;
    for (const r of rooms) {
      if ((r.level === 1 ? 1 : 0) !== level) continue;
      const q = r.rect; if (x < q.minx || x > q.maxx || z < q.minz || z > q.maxz) continue;
      const a = (q.maxx - q.minx) * (q.maxz - q.minz); if (a < ba) { ba = a; best = r; }
    }
    return best;
  };
  const n = idx ? idx.length : pos.length / 3;
  const get = (k: number): V => { const i = (idx ? idx[k] : k) * 3; return [pos[i], pos[i + 1], pos[i + 2]]; };
  const gn = (k: number): V => { const i = (idx ? idx[k] : k) * 3; return nor ? [nor[i], nor[i + 1], nor[i + 2]] : [0, 0, 0]; };
  const emit = (poly: V[], zone: WallZone, nv: V, axisH: 0 | 2 | -1, base: number) => {
    if (poly.length < 3 || area(poly) < 1e-7) return;
    const P = part(zone), t = ZONE_TILE[zone];
    const push = (v: V) => {
      P.pos.push(v[0], v[1], v[2]); P.nor.push(nv[0], nv[1], nv[2]);
      if (axisH === -1) P.uv.push(v[0] / t, v[2] / t);                       // horizontal (lantai/atap/ujung): bidang xz
      else P.uv.push(v[axisH] / t, (v[1] - base) / t);                       // vertikal: sepanjang dinding x tinggi dari lantai
    };
    for (let i = 1; i + 1 < poly.length; i++) { push(poly[0]); push(poly[i]); push(poly[i + 1]); }
  };
  for (let k = 0; k + 2 < n; k += 3) {
    const a = get(k), b = get(k + 1), c = get(k + 2);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; const fl = Math.hypot(fx, fy, fz); if (fl < 1e-9) continue; fx /= fl; fy /= fl; fz /= fl;
    const na = gn(k), nb = gn(k + 1), nc = gn(k + 2);
    let nv: V = nor ? [(na[0] + nb[0] + nc[0]) / 3, (na[1] + nb[1] + nc[1]) / 3, (na[2] + nb[2] + nc[2]) / 3] : [fx, fy, fz];
    const nl = Math.hypot(nv[0], nv[1], nv[2]) || 1; nv = [nv[0] / nl, nv[1] / nl, nv[2] / nl];
    const cy = (a[1] + b[1] + c[1]) / 3, level = cy > levelY(1) - 0.3 ? 1 : 0, base = levelY(level);
    if (Math.abs(fy) > 0.5) { emit([a, b, c], 'concrete', nv, -1, base); continue; }         // sisi atas/bawah dinding
    const axisH: 0 | 2 = Math.abs(fx) >= Math.abs(fz) ? 2 : 0, cuts = axisH === 2 ? cutsZ[level] : cutsX[level];
    const lo = Math.min(a[axisH], b[axisH], c[axisH]), hi = Math.max(a[axisH], b[axisH], c[axisH]);
    let pieces: V[][] = [[a, b, c]];
    for (const cv of cuts) {
      if (cv <= lo + 1e-4 || cv >= hi - 1e-4) continue;
      const next: V[][] = [];
      for (const p of pieces) {
        let mn = Infinity, mx = -Infinity; for (const v of p) { if (v[axisH] < mn) mn = v[axisH]; if (v[axisH] > mx) mx = v[axisH]; }
        if (cv <= mn + 1e-6 || cv >= mx - 1e-6) { next.push(p); continue; }
        const [l1, h1] = clip(p, axisH, cv); if (l1.length >= 3) next.push(l1); if (h1.length >= 3) next.push(h1);
      }
      pieces = next;
    }
    const cutY = base + WAINSCOT_H;
    for (const p of pieces) {
      let cx = 0, cz = 0, pyMin = Infinity, pyMax = -Infinity; for (const v of p) { cx += v[0]; cz += v[2]; if (v[1] < pyMin) pyMin = v[1]; if (v[1] > pyMax) pyMax = v[1]; }
      cx /= p.length; cz /= p.length;
      const r = roomAt(cx + fx * 0.25, cz + fz * 0.25, level), st = roomStyle(r?.type);
      if (!st.lower) { emit(p, st.upper, nv, axisH, base); continue; }
      if (pyMax <= cutY + 1e-5) emit(p, st.lower, nv, axisH, base);
      else if (pyMin >= cutY - 1e-5) emit(p, st.upper, nv, axisH, base);
      else { const [lw, up] = clip(p, 1, cutY); emit(lw, st.lower, nv, axisH, base); emit(up, st.upper, nv, axisH, base); }
    }
  }
  return WALL_ZONES.filter((z) => parts.has(z)).map((z) => parts.get(z)!);
}
