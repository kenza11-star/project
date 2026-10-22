// Penempatan Soda NORVIX (logika murni, tanpa three.js; dites terhadap GLB asli di scripts/test-soda.js).
// Soda TIDAK lagi diletakkan di lantai. Sumber posisi (semuanya permukaan nyata):
//  1. titik `ItemSpawn` bawaan map: slot "surface" di meja/meja kerja/resepsionis, slot "shelf" di rak StorageShelf (papan rak),
//  2. permukaan meja/meja kerja furniture ACAK (tinggi tabletop diukur dari bounds mesh template),
//  3. di dalam laci/lemari lewat isi container (world.ts: spawnSodaIn, tinggi dasar diukur dengan raycast ke dasar container).
import type { Rng } from './rng';
import { subtreeBounds, type GltfJson, type V3 } from './mapdata';
import { LEVEL_Y } from './config';

export const SODA_ITEM = 'soda';
export type SodaKind = 'table' | 'shelf' | 'rand-table';
export interface SodaSpot { id: string; kind: SodaKind; host: string; x: number; y: number; z: number; level: number }

const SURFACE_HOSTS = /^(Desk|DiningTable|MeetingTable|LabTable|ReceptionDesk)$/;
/** Papan rak bawaan: ItemSpawn dibuat 1 mm di atas papan. Soda ditanam 1 mm (kontak tanpa celah/tembus). */
const SHELF_SINK = 0.001;
const levelOfY = (y: number) => (y > LEVEL_Y[1] - 0.5 ? 1 : 0);

/** Titik soda bawaan map. y = permukaan nyata: tabletop (bounds mesh meja) atau papan rak. */
export function authoredSodaSpots(j: GltfJson, worldPos: (i: number) => V3): SodaSpot[] {
  const byName = new Map<string, number>();
  j.nodes.forEach((n, i) => { if (n.name) byName.set(n.name, i); });
  const topCache = new Map<number, number>();
  const out: SodaSpot[] = [];
  j.nodes.forEach((n, i) => {
    const e = n.extras; if (!e || e.type !== 'ItemSpawn' || typeof e.container !== 'string') return;
    const h = byName.get(e.container); if (h == null) return;
    const ht: string = j.nodes[h].extras?.type ?? '';
    const p = worldPos(i);
    if (e.slot === 'surface' && SURFACE_HOSTS.test(ht)) {
      let top = topCache.get(h);
      if (top == null) { top = worldPos(h)[1] + subtreeBounds(j, h).mx[1]; topCache.set(h, top); }
      out.push({ id: `soda_${n.name ?? i}`, kind: 'table', host: e.container, x: p[0], y: top, z: p[2], level: levelOfY(top) });
    } else if (e.slot === 'shelf' && ht === 'StorageShelf') {
      const y = p[1] - SHELF_SINK;
      out.push({ id: `soda_${n.name ?? i}`, kind: 'shelf', host: e.container, x: p[0], y, z: p[2], level: levelOfY(y) });
    }
  });
  return out;
}

/** Titik acak di atas tabletop furniture acak (meja / meja kerja). margin menjaga kaleng (r = 3,3 cm) jauh dari tepi. */
export function randomSurfaceSpot(
  p: { id: string; x: number; z: number; yaw: number; vx: number; vz: number },
  fp: { w: number; d: number; ox: number; oz: number }, top: number, rng: Rng, margin = 0.14,
): SodaSpot {
  const lx = fp.ox + rng.range(-1, 1) * Math.max(0, fp.w / 2 - margin);
  const lz = fp.oz + rng.range(-1, 1) * Math.max(0, fp.d / 2 - margin);
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { id: `soda_${p.id}`, kind: 'rand-table', host: p.id, x: p.x + p.vx + lx * c + lz * s, y: top, z: p.z + p.vz - lx * s + lz * c, level: 0 };
}

export interface ChooseOpts {
  tables: number; shelves: number;               // jumlah maksimum per jenis
  spawn: { x: number; z: number }; minSpawnDist: number; minGap: number;
  reachable: (s: SodaSpot) => boolean;           // terjangkau pemain (flood-fill) & valid
}
/** Pilih titik soda: acak, terjangkau, jauh dari spawn, saling berjarak; kekurangan satu jenis ditutup jenis lain. */
export function chooseSodaSpots(cands: SodaSpot[], rng: Rng, o: ChooseOpts): SodaSpot[] {
  const ok = (s: SodaSpot) => Math.hypot(s.x - o.spawn.x, s.z - o.spawn.z) >= o.minSpawnDist && o.reachable(s);
  const pool = (k: (s: SodaSpot) => boolean) => rng.shuffle(cands.filter((s) => k(s) && ok(s)));
  const tab = pool((s) => s.kind !== 'shelf'), shf = pool((s) => s.kind === 'shelf');
  const chosen: SodaSpot[] = [];
  const far = (s: SodaSpot) => chosen.every((c) => c.level !== s.level || Math.hypot(c.x - s.x, c.z - s.z) >= o.minGap);
  const take = (list: SodaSpot[], n: number) => { for (const s of list) { if (n <= 0) break; if (far(s)) { chosen.push(s); n--; } } return n; };
  let lackT = take(tab, o.tables), lackS = take(shf, o.shelves);
  if (lackT > 0) take(shf, lackT); // jenis yang kurang digantikan jenis lain (jumlah total tetap)
  if (lackS > 0) take(tab, lackS);
  return chosen;
}
