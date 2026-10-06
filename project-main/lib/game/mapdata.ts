// Membaca struktur map dari JSON glTF (tanpa three.js) supaya logikanya bisa dites terpisah.
// Map sudah membawa data: room, pintu, container (laci/lemari/locker/crate), spawn, exit, tangga.
import type { Rect, ObbIn } from './collision';

export type V3 = [number, number, number];
interface GNode { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: any }
export interface GltfJson {
  scene?: number; scenes: { nodes: number[] }[]; nodes: GNode[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

export interface Room { id: string; type: string; rect: Rect; height: number }
export interface DoorDesc {
  leaf: number; frame: number; name: string; type: 'door' | 'exit_door';
  cx: number; cz: number; yaw: number; nx: number; nz: number; level: number;
  locked: boolean; openAngle: number; openTime: number; closedObb: ObbIn;
}
export type ContainerKind = 'drawer' | 'cabinet' | 'locker' | 'crate' | 'box';
export interface ContainerDesc {
  id: string; label: string; kind: ContainerKind; level: number;
  rootIdx: number; parts: number[]; anchorIdx: number | null; anchorLocal: V3;
  bodyMin: V3; bodyMax: V3; searchTime: number;
  slideKey: boolean;   // true = laci geser (key muncul di posisi laci terbuka)
  keyLocal: V3;        // posisi key di ruang lokal furniture (anchor [+ geser] + sedikit naik)
  keyPos: V3;          // posisi key di dunia (untuk furniture bawaan map)
  ax: number; az: number; // titik akses (berdiri di depan)
}
export interface ColliderDesc { idx: number; name: string; obb: ObbIn; vis: ObbIn }
export interface MapData {
  rooms: Room[];
  spawn: { x: number; z: number; yaw: number; eye: number; radius: number };
  doors: DoorDesc[];
  containers: ContainerDesc[];
  colliders: ColliderDesc[];
  wallNodes: { idx: number; level: number }[];
  mezz: Rect | null;
  exit: { door: DoorDesc; trigger: Rect; insideX: number; insideZ: number };
  ladder: { idx: number; bottom: V3; top: V3 } | null;
  keyCandidateIdx: number[];
  worldPos: (idx: number) => V3;
  nodeName: (idx: number) => string;
}

// ---- matriks kecil (kolom-mayor, sama seperti three.js) ----
function compose(t?: number[], q?: number[], s?: number[]): number[] {
  const [x, y, z, w] = q ?? [0, 0, 0, 1]; const [sx, sy, sz] = s ?? [1, 1, 1]; const [tx, ty, tz] = t ?? [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
const pt = (m: number[], x: number, y: number, z: number): V3 => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const yawOf = (m: number[]) => Math.atan2(-m[2], m[0]);
const scaleOf = (m: number[]): V3 => [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];

/**
 * Koreksi kecil pada map: prop yang menutup lubang pintu digeser sedikit (x, z dalam meter).
 * Box_East_01 aslinya berdiri tepat di depan Door_East_SE sehingga hanya menyisakan celah ~5 cm.
 * Shelf_Office_01 berdiri 0,54 m di belakang Door_Office_East dan menutup seluruh lubang pintu (lebar 1,18 m).
 * Shelf_Dark_01 berdiri 0,6 m di belakang Door_StorageDark_West dan menyisakan celah ~0,28 m (pemain tidak muat).
 * Nilai geseran dicari dengan simulasi NavGrid pada map asli: koridor lurus 1,2 m di kedua sisi pintu bebas,
 * tidak menimpa dinding/prop lain, dan tidak menyegel area mana pun.
 */
export const PROP_NUDGES: Record<string, [number, number]> = {
  Box_East_01: [0.9, 0],
  Shelf_Office_01: [-1, 0],
  Shelf_Dark_01: [0, 0.85],
};

/** Terapkan PROP_NUDGES ke JSON glTF (sebelum extractMapData). Mengembalikan indeks node yang bergeser. */
export function applyPropNudges(j: GltfJson): number[] {
  const out: number[] = [];
  j.nodes.forEach((n, i) => {
    const d = n.name ? PROP_NUDGES[n.name] : undefined;
    if (!d || !n.translation) return;
    n.translation = [n.translation[0] + d[0], n.translation[1], n.translation[2] + d[1]];
    out.push(i);
  });
  return out;
}

/** Bounds (ruang lokal node) dari mesh node + semua anaknya yang bermesh. Hanya membaca JSON glTF; GLB tidak diubah. */
export function subtreeBounds(j: GltfJson, root: number): { mn: V3; mx: V3 } {
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  const visit = (i: number, m: number[], isRoot: boolean) => {
    const n = j.nodes[i];
    const L = isRoot ? m : mul(m, compose(n.translation, n.rotation, n.scale));
    if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (const x of [a.min![0], a.max![0]]) for (const y of [a.min![1], a.max![1]]) for (const z of [a.min![2], a.max![2]]) {
        const q = pt(L, x, y, z);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
      }
    }
    for (const c of n.children ?? []) visit(c, L, false);
  };
  visit(root, compose(), true);
  return { mn, mx };
}

/** Footprint exact (lebar x kedalaman + offset pusat, meter) per template furniture, diukur dari GLB. */
export function measureFootprints(j: GltfJson, templates: Record<string, string>): Record<string, { w: number; d: number; ox: number; oz: number }> {
  const out: Record<string, { w: number; d: number; ox: number; oz: number }> = {};
  for (const kind of Object.keys(templates)) {
    const i = j.nodes.findIndex((n) => n.name === templates[kind]);
    if (i < 0) continue;
    const { mn, mx } = subtreeBounds(j, i);
    if (!isFinite(mn[0])) continue;
    // kotak EXACT dari mesh (tidak simetris): ox/oz = pusat kotak relatif origin node (ruang lokal, depan = +Z)
    out[kind] = { w: mx[0] - mn[0], d: mx[2] - mn[2], ox: (mx[0] + mn[0]) / 2, oz: (mx[2] + mn[2]) / 2 };
  }
  return out;
}

const FURN = /^(Chair|Table|Shelf|Box|Pillar|Sink|Toilet|Stall|Desk|Cabinet|Locker|Crate)_/;
const KIND: Record<string, ContainerKind> = { Drawer: 'drawer', Cabinet: 'cabinet', Locker: 'locker', Crate: 'crate', Box: 'box' };

export function extractMapData(j: GltfJson): MapData {
  const N = j.nodes.length;
  const M: number[][] = new Array(N), parent: number[] = new Array(N).fill(-1), level: number[] = new Array(N).fill(0), path: string[][] = new Array(N);
  const walk = (i: number, pm: number[], lv: number, p: string[], par: number) => {
    const n = j.nodes[i];
    M[i] = mul(pm, compose(n.translation, n.rotation, n.scale));
    parent[i] = par; path[i] = p;
    const l2 = n.name === 'Level_1_Upper' ? 1 : lv; level[i] = l2;
    for (const c of n.children ?? []) walk(c, M[i], l2, [...p, n.name ?? ''], i);
  };
  const I4 = compose();
  const roots = j.scenes[j.scene ?? 0].nodes;
  for (const r of roots) walk(r, I4, 0, [], -1);

  const bounds = (mesh: number) => {
    const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of j.meshes[mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min![k]); mx[k] = Math.max(mx[k], a.max![k]); }
    }
    return { mn, mx };
  };
  // Bounds seluruh subtree (mesh induk + anak yang menonjol, mis. kotak di rak) dalam ruang lokal node i.
  const fullBounds = (i: number) => subtreeBounds(j, i);
  const obbOf = (i: number, id: string, kind: string, minHalf = 0, full = false): ObbIn => {
    const { mn, mx } = full ? fullBounds(i) : bounds(j.nodes[i].mesh!);
    const s = scaleOf(M[i]);
    const c = pt(M[i], (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
    return { id, cx: c[0], cz: c[2], hx: Math.max(minHalf, ((mx[0] - mn[0]) / 2) * s[0]), hz: Math.max(minHalf, ((mx[2] - mn[2]) / 2) * s[2]), yaw: yawOf(M[i]), level: level[i], kind };
  };
  const idxByName = (name: string) => j.nodes.findIndex((n) => n.name === name);
  const wp = (i: number): V3 => [M[i][12], M[i][13], M[i][14]];

  // rooms
  const rooms: Room[] = [];
  j.nodes.forEach((n, i) => {
    const b = n.extras?.bounds_xz;
    if (b && n.extras.room_id) rooms.push({ id: n.extras.room_id, type: n.extras.room_type, rect: { minx: b[0], minz: b[1], maxx: b[2], maxz: b[3] }, height: n.extras.ceiling_height ?? 2.8 });
  });

  // spawn
  const si = idxByName('Spawn_Player');
  const sp = wp(si), sx = j.nodes[si].extras ?? {};
  const fw = sx.forward ?? [0, 0, -1];
  const spawn = { x: sp[0], z: sp[2], yaw: Math.atan2(-fw[0], -fw[2]), eye: sx.eye_height ?? 1.65, radius: sx.radius ?? 0.3 };

  // doors
  const doors: DoorDesc[] = [];
  j.nodes.forEach((n, i) => {
    const it = n.extras?.interact;
    if (!it || (it.type !== 'door' && it.type !== 'exit_door')) return;
    const nm0 = n.name ?? '';
    const fi = idxByName(nm0.startsWith('Door_') ? nm0.replace(/^Door_/, 'DoorFrame_') : 'DoorFrame_' + nm0);
    const fpos = wp(fi >= 0 ? fi : i);
    const yaw = yawOf(M[i]);
    const alongX = Math.abs(Math.sin(yaw)) < 0.5; // daun sejajar sumbu X -> normal sumbu Z
    const o = obbOf(i, 'door:' + n.name, 'door', 0.12);
    doors.push({
      leaf: i, frame: fi, name: n.name ?? '', type: it.type, cx: fpos[0], cz: fpos[2], yaw,
      nx: alongX ? 0 : 1, nz: alongX ? 1 : 0, level: level[i], locked: !!it.locked,
      openAngle: it.open_angle_deg ?? 90, openTime: it.open_time ?? 0.7, closedObb: o,
    });
  });
  const exitDoor = doors.find((d) => d.type === 'exit_door')!;
  const ti = idxByName('Exit_Trigger_Escape'), tp = wp(ti), tsz: V3 = j.nodes[ti].extras?.size ?? [2, 2, 2];
  const trigger: Rect = { minx: tp[0] - tsz[0] / 2, maxx: tp[0] + tsz[0] / 2, minz: tp[2] - tsz[2] / 2, maxz: tp[2] + tsz[2] / 2 };
  // sisi dalam exit = sisi yang mengarah ke room Exit_Alcove
  const alc = rooms.find((r) => r.type === 'exit');
  let sgn = 1;
  if (alc) { const ccx = (alc.rect.minx + alc.rect.maxx) / 2, ccz = (alc.rect.minz + alc.rect.maxz) / 2; sgn = (ccx - exitDoor.cx) * exitDoor.nx + (ccz - exitDoor.cz) * exitDoor.nz >= 0 ? 1 : -1; }
  const exit = { door: exitDoor, trigger, insideX: exitDoor.cx + exitDoor.nx * sgn * 1.0, insideZ: exitDoor.cz + exitDoor.nz * sgn * 1.0 };

  // containers (grup per container_id)
  const cmap = new Map<string, number[]>();
  j.nodes.forEach((n, i) => { const it = n.extras?.interact; if (it?.type === 'container') { const a = cmap.get(it.container_id) ?? []; a.push(i); cmap.set(it.container_id, a); } });
  const containers: ContainerDesc[] = [];
  cmap.forEach((parts, id) => {
    const first = parts[0], it = j.nodes[first].extras.interact, root = parent[first];
    const rn = j.nodes[root];
    const { mn, mx } = bounds(rn.mesh!);
    const s = scaleOf(M[root]);
    let anchor: number | null = null;
    for (const c of rn.children ?? []) {
      const nm = j.nodes[c].name ?? '';
      if (nm === 'LootAnchor' || nm === (j.nodes[first].name ?? '') + '_LootAnchor') anchor = c;
    }
    const yaw = yawOf(M[root]);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const hz = ((mx[2] - mn[2]) / 2) * s[2];
    const ctr = pt(M[root], (mn[0] + mx[0]) / 2, 0, (mn[2] + mx[2]) / 2);
    const anchorLocal = (anchor != null ? (j.nodes[anchor].translation as V3) : [0, 0.3, 0]) as V3;
    const slideKey = it.open_type !== 'hinge';
    const sl: V3 = slideKey ? ((it.slide as V3) ?? [0, 0, 0]) : [0, 0, 0];
    const keyLocal: V3 = [anchorLocal[0] + sl[0], anchorLocal[1] + sl[1] + (slideKey ? 0.12 : 0.08), anchorLocal[2] + sl[2]];
    const kp = pt(M[root], keyLocal[0], keyLocal[1], keyLocal[2]);
    kp[1] = Math.max(kp[1], (level[first] === 1 ? 3 : 0) + 0.3); // sama dengan world.spawnKey
    containers.push({
      id, label: it.label, kind: KIND[it.label] ?? 'box', level: level[first],
      rootIdx: root, parts, anchorIdx: anchor, anchorLocal,
      bodyMin: mn, bodyMax: mx, searchTime: it.search_time ?? 1, slideKey, keyLocal, keyPos: kp,
      ax: ctr[0] + fx * (hz + 0.7), az: ctr[2] + fz * (hz + 0.7),
    });
  });
  // desk dengan 2 laci: access dari depan meja (sama untuk kedua laci)

  // collider tetap
  const colliders: ColliderDesc[] = [];
  j.nodes.forEach((n, i) => {
    if (n.mesh === undefined || !n.name) return;
    const par = path[i][path[i].length - 1];
    if (par !== 'Props' && par !== 'Interactive') return;
    if (n.name === 'Railing_Mezzanine') { const r = obbOf(i, n.name, 'rail', 0.15); colliders.push({ idx: i, name: n.name, obb: r, vis: r }); return; }
    // vis = kotak visual penuh (mesh induk + semua anak bermesh); obb = collider yang dipakai game
    if (FURN.test(n.name)) colliders.push({ idx: i, name: n.name, obb: obbOf(i, n.name, 'fixed', 0, true), vis: obbOf(i, n.name, 'fixed', 0, true) });
  });

  // dinding, mezzanine, tangga, kandidat key bawaan
  const wallNodes: { idx: number; level: number }[] = [];
  j.nodes.forEach((n, i) => { if (n.mesh !== undefined && /^Wall/.test(n.name ?? '')) wallNodes.push({ idx: i, level: level[i] }); });
  let mezz: Rect | null = null;
  const mi = idxByName('Floor_Mezzanine');
  if (mi >= 0) {
    const { mn, mx } = bounds(j.nodes[mi].mesh!);
    const a = pt(M[mi], mn[0], mn[1], mn[2]), b = pt(M[mi], mx[0], mx[1], mx[2]);
    mezz = { minx: Math.min(a[0], b[0]), maxx: Math.max(a[0], b[0]), minz: Math.min(a[2], b[2]), maxz: Math.max(a[2], b[2]) };
  }
  let ladder: MapData['ladder'] = null;
  j.nodes.forEach((n, i) => { const it = n.extras?.interact; if (it?.type === 'ladder') ladder = { idx: i, bottom: it.bottom, top: it.top }; });
  const keyCandidateIdx: number[] = [];
  j.nodes.forEach((n, i) => { if ((n.name ?? '').startsWith('Key_Candidate_')) keyCandidateIdx.push(i); });

  return { rooms, spawn, doors, containers, colliders, wallNodes, mezz, exit, ladder, keyCandidateIdx, worldPos: wp, nodeName: (i) => j.nodes[i].name ?? '' };
}
