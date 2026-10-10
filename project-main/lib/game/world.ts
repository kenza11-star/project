import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, type Obb, type ObbIn } from './collision';
import { extractMapData, measureFootprints, panelCentres, indexNodesByName, type MapData, type GltfJson, type DoorDesc } from './mapdata';
import { NavGrid, applyFootprints, swingBox, boxesOverlap, generateFurniture, generateBeds, BED_SIZE, pickFreeSpots, assignContents, auditPlacements, SEARCHABLE, type Placement, type BedPlacement, type Content, type FurnKind, type ContainerSlot } from './layout';
import { movePlayer, floorTarget, canStandAt, type StairDef } from './stairs';
import { fitChair } from './chairfit';
import { applyPose, leafDist, leafTouches, sweepHitsPlayer, doorBlocksAt, ease, DOOR_REACH, swingPoints, type LeafGeom } from './door';
import { openLimit, partBox, partMatrix, partDist, type PartGeom } from './swing';
import { InteractionSystem, type Interactable } from './interaction';
import { makeRng, newSeed, type Rng } from './rng';
import { itemLabel, type PlayerState } from './inventory';
import { KEY_DEFS, KEY_IDS, keyDef, type KeyId } from './keys';
import { EventScheduler, type EventType } from './events';
import { LightFx } from './lightfx';
import { MaterialUpgrade } from './materials';
import { ContainerState } from './container';
import { planShift, planRoomState } from './roomstate';
import { planDecor, extractWallPlanes, type DecorItem, type DecorKind } from './decor';
import { findSafeSpawn, slotProblem, validateRun, type SlotInfo } from './validate';
import type { AudioManager, Handle } from './audio';
import type { SfxName } from './sfx';
import * as CFG from './config';

// Konteks yang diberikan ke tiap interaksi: pemain yang sedang bermain (inventory MILIK pemain itu) + callback UI.
export interface GameCtx {
  player: PlayerState;
  say: (msg: string, ms?: number) => void;
  changed: () => void; // inventory/UI berubah
}

export const levelY = (level: number) => CFG.LEVEL_Y[level] ?? 0;

// Furniture acak = salinan furniture bawaan backrooms_full.glb (crate -> FilingCabinet, box -> StorageCabinet; keduanya searchable)
export const TEMPLATE: Record<FurnKind, string> = {
  table: 'DiningTable_01', shelf: 'Bookshelf_01', desk: 'Desk_01', cabinet: 'Cabinet_01',
  locker: 'Locker_01', crate: 'FilingCabinet_01', box: 'StorageCabinet_01',
};
const SKIP_OCCLUDER = /^(F\d_CeilingLights|ExitSign_|Roof)/;
const NO_CAST_MATS = new Set(['carpet', 'ceiling', 'light', 'exit_sign']); // lantai/plafon menerima bayangan tapi tidak perlu menjadi caster (hemat shadow pass)
const TILE_ROOMS = /^(kitchen|utilitas|svce|svcw|tech|server|lab|vault)$/;

interface PartRT {
  obj: THREE.Object3D; hinge: boolean; p0: THREE.Vector3; q0: THREE.Quaternion;
  slide: THREE.Vector3; axis: THREE.Vector3; angle: number;
  geom: PartGeom;          // data murni (pose & bounds lokal) untuk validasi ruang bebas
  ob: Obb | null;          // collision bagian saat terbuka penuh (laci keluar / pintu lemari terbuka)
}
interface ContainerRT {
  id: string; label: string; level: number; random: boolean;
  rawId: string; primary: boolean; group: ContainerRT[]; // 1 pintu/laci = 1 ContainerRT (state & animasi sendiri); group = semua kompartemen furniture yang sama
  root: THREE.Object3D; parts: PartRT[]; anchor: THREE.Vector3; slideKey: boolean;
  ax: number; az: number; openTime: number; searchTime: number;
  sfx: 'drawer' | 'cabinet' | 'locker' | 'lid';
  cs: ContainerState; content: Content | null;
  usable: boolean;   // punya bagian yang bisa dibuka + mesh yang bisa dibidik + ruang buka cukup (syarat jadi lokasi key)
  baseUsable: boolean; openMax: number; // openMax: bukaan terbesar (0..1) tanpa menembus dinding/furniture lain
  partPending: boolean; // collision bagian terbuka menunggu pemain menyingkir (tidak pernah menjebak)
  keyRt: PickupRT | null; by: GameCtx | null; it: Interactable<GameCtx>;
}
/** Titik sembunyi: di dalam locker/lemari (berdiri, pintu menutup, mengintip lewat celah) atau di kolong kasur (merangkak). */
interface HideSpotRT { id: string; kind: 'locker' | 'bed'; level: number; random: boolean; rt?: ContainerRT; bed?: BedPlacement }
type HidePhase = 'open' | 'enter' | 'close' | 'hidden' | 'reopen' | 'leave' | 'crawl-in' | 'crawl-out';
interface HideRun {
  spot: HideSpotRT; phase: HidePhase; t: number;
  from: { x: number; y: number; z: number; yaw: number }; to: { x: number; y: number; z: number; yaw: number };
  exit: { x: number; z: number } | null; side: number; eyeStand: number;
}
/** Tampilan kamera saat bersembunyi (dibaca PlayScene tiap frame; objek dipakai ulang, tanpa alokasi). */
export interface HideView {
  active: boolean; x: number; y: number; z: number; yaw: number; kind: 'locker' | 'bed';
  alpha: number;                     // 0..1 kekuatan masker celah (layar gelap dengan celah intip)
  look: 'ease' | 'limited';          // ease: kamera diarahkan ke yaw tujuan; limited: pemain boleh menoleh terbatas
  limYaw: number; pitchMin: number; pitchMax: number; phase: HidePhase;
}
/** Bagian engsel kecil non-container: tutup ventilasi (flap A/B satu ventilasi bergerak bersama) & tuas generator. Tanpa collision (kecil / menempel dinding). */
interface FlapRT {
  id: string; objs: { obj: THREE.Object3D; q0: THREE.Quaternion; axis: THREE.Vector3; rad: number }[];
  t: number; target: 0 | 1; it: Interactable<GameCtx>; sfx: 'cabinet' | 'click'; time: number;
}
interface DoorRT {
  d: DoorDesc; obj: THREE.Object3D; q0: THREE.Quaternion; t: number; target: 0 | 1; obb: Obb;
  unlocked: boolean; it: Interactable<GameCtx>;
  leaf: LeafGeom;     // geometri daun untuk collision (tebal)
  vis: LeafGeom;      // geometri daun tipis untuk cek sapuan terhadap pemain
  pend: boolean;      // collision menunggu pemain keluar dari ambang (tidak menjebak)
  closedSfx: boolean; // suara tutup sudah diputar untuk siklus ini
}
interface PickupRT { group: THREE.Group; taken: boolean; base: number; it: Interactable<GameCtx> }
interface LockRT { id: KeyId; group: THREE.Group; opened: boolean; fall: number; p0: THREE.Vector3; it: Interactable<GameCtx> }
interface MovingRT { obj: THREE.Object3D; p: Placement; obb: Obb; x0: number; z0: number; dx: number; dz: number; t: number; dur: number; h: Handle | null }
interface EntityRT { x0: number; z0: number; x1: number; z1: number; t: number; dur: number; steps: Handle | null; whisper: Handle | null }
interface LightSrc { pos: THREE.Vector3; color: THREE.Color; intensity: number; range: number; flicker: boolean; chance: number }

export interface RunInfo { seed: number; furniture: number; keyContainers: string[]; keyAt: Record<string, string>; containers: number; attempts?: number }

const smooth = (t: number) => t * t * (3 - 2 * t);
const dev = process.env.NODE_ENV !== 'production'; // log diagnostik hanya di development

export class GameWorld {
  readonly scene: THREE.Scene;
  readonly root: THREE.Object3D;
  readonly md: MapData;
  readonly cw = new CollisionWorld(2);
  readonly ix = new InteractionSystem<GameCtx>(CFG.REACH);
  spawn: MapData['spawn'];   // titik spawn aktif (sudah divalidasi aman; bisa digeser dari titik bawaan map)
  run: RunInfo = { seed: 0, furniture: 0, keyContainers: [], keyAt: {}, containers: 0 };
  audio: AudioManager | null = null;
  /** 0..1: pengali cahaya lampu map (event lampu mati). Dibaca PlayScene untuk ambient. */
  lightMul = 1;
  /** 0..1: redupnya lampu terdekat (kedip / lampu mati lokal). Dibaca PlayScene untuk ambient. */
  lightDim = 1;

  /** Geometri tangga yang dijalani pemain (tanpa teleport). */
  get stair(): StairDef | null { return this.md.stair; }

  private nodeObj = new Map<number, THREE.Object3D>();
  private nodeByName = new Map<string, THREE.Object3D>();
  private templates: Partial<Record<FurnKind, THREE.Object3D>> = {};
  private matByName = new Map<string, THREE.Material>();
  private reach1 = new Set<string>(); // container lantai 2 yang terjangkau dari tangga (statis)
  private doors: DoorRT[] = [];
  private flaps: FlapRT[] = [];
  private hideMap = new Map<Interactable<GameCtx>, HideSpotRT>();
  private hr: HideRun | null = null;
  readonly hv: HideView = { active: false, x: 0, y: 0, z: 0, yaw: 0, kind: 'locker', alpha: 0, look: 'ease', limYaw: 0.5, pitchMin: -0.25, pitchMax: 0.2, phase: 'hidden' };
  private camPos = new THREE.Vector3();
  private bedMats: { wood: THREE.Material; mat: THREE.Material; pillow: THREE.Material; blanket: THREE.Material } | null = null;
  private bedGeo: Record<string, THREE.BufferGeometry> | null = null;
  beds: BedPlacement[] = [];
  private fixedContainers: ContainerRT[] = [];
  private randomContainers: ContainerRT[] = [];
  private pickups: PickupRT[] = [];
  private randomObjs: THREE.Object3D[] = [];
  private active = new Set<ContainerRT>();
  private pickGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12);
  private pickMat = new THREE.MeshStandardMaterial({ color: 0xe8d070, emissive: 0x6a5418, roughness: 0.6 });
  private pickHitGeo = new THREE.SphereGeometry(0.32, 8, 6);
  private pickHitMat = new THREE.MeshBasicMaterial({ visible: false });
  private fixedObbs: ObbIn[] = [];
  private keepouts: { x: number; z: number; r: number }[] = [];
  private must: { x: number; z: number; rad?: number }[] = [];
  private placements: Placement[] = [];
  private lightSrcs: LightSrc[] = [];
  private lightBase: { i: number; f: boolean; c: number }[] = [];
  private roomMul: Partial<Record<DecorKind, number>> = {};
  private pool: { light: THREE.PointLight; src: LightSrc | null; idx: number; dimUntil: number; dimDepth: number; next: number; gain: number; leaving: boolean }[] = [];
  private fx = new LightFx();
  private matUp = new MaterialUpgrade();
  private nearIdx: number[] = [];
  private lastEm = 1;
  private lightT = 0;
  private ladderBottom = new THREE.Vector3();
  private ladderTop = new THREE.Vector3();
  private exitRt: DoorRT | null = null;
  private clock = 0;
  private poolInit = false;
  // ---- locker scare ----
  private scareSeed = 0; private scareFired = new Set<string>(); private scareN = 0; private scareLast = -1e9; private scarePending = false;
  private scareRt: { t: number; dur: number; x: number; z: number; ry: number; fy: number } | null = null;
  private tmpQ = new THREE.Quaternion();
  private upAxis = new THREE.Vector3(0, 1, 0);

  // key / gembok exit
  private keyGeos: THREE.BufferGeometry[] = [];
  private keyMats = {} as Record<string, THREE.MeshStandardMaterial>;
  private keyHitGeo = new THREE.SphereGeometry(0.3, 8, 6);
  private locks: LockRT[] = [];
  private lockHw: THREE.Group | null = null;
  private chainMesh: THREE.InstancedMesh | null = null;
  private chainFall = 0;
  private hwGeos: THREE.BufferGeometry[] = [];
  private hwMats: THREE.Material[] = [];

  // environmental storytelling (dekor ringan; satu InstancedMesh per jenis, dibuat ulang tiap run)
  private decorMeshes: THREE.InstancedMesh[] = [];
  private batchGeos: THREE.BufferGeometry[] = [];
  private chairGeos: THREE.BufferGeometry[] = []; // geometri kursi custom (dibuat di swapChairs; material ikut dibuang lewat root)
  private chairMat: THREE.MeshStandardMaterial | null = null;
  private decorOwn: THREE.BufferGeometry[] = [];
  private decorOwn2: THREE.Material[] = [];
  private decorSrc: Partial<Record<'stain' | 'box' | 'pipe' | 'exit', { geo: THREE.BufferGeometry; mat: THREE.Material }>> = {};
  private decorGeo: Partial<Record<'paper' | 'can' | 'vent' | 'extinguisher' | 'warning', THREE.BufferGeometry>> = {};
  private decorMat: Partial<Record<'paper' | 'vc', THREE.Material>> = {};
  private planesX: number[] = [];
  private planesZ: number[] = [];

  // event horor & suara
  private sched: EventScheduler | null = null;
  private evRng = makeRng(1);
  private timers: { at: number; fn: () => void }[] = [];
  private nav: NavGrid | null = null;
  private baseReach = 0;
  private mustOk: { x: number; z: number; rad?: number }[] = [];
  private accessPts: { x: number; z: number }[] = [];
  private bo: { steps: [number, number][]; i: number; t: number } | null = null;
  private fixtureMats: { m: THREE.MeshStandardMaterial; base: number }[] = [];
  private moving: MovingRT | null = null;
  private ent: THREE.Group | null = null;
  private entMat: THREE.MeshBasicMaterial | null = null;
  private entRt: EntityRT | null = null;
  private buzzHooks: THREE.Vector3[] = [];
  private distHooks: THREE.Vector3[] = [];
  private buzzVoices: { h: Handle | null; hook: number }[] = [{ h: null, hook: -1 }, { h: null, hook: -1 }];
  private ambH: Handle | null = null;
  private audioT = 0;
  private distT = 0;

  private constructor(scene: THREE.Scene, root: THREE.Object3D, md: MapData) {
    this.scene = scene; this.root = root; this.md = md; this.spawn = md.spawn;
  }

  // ------------------------------------------------------------------ load
  static async load(scene: THREE.Scene, onProgress?: (p: number) => void): Promise<GameWorld> {
    // kursi custom dimuat paralel dengan map; bila gagal (file hilang/rusak) kursi bawaan map tetap dipakai
    const chairP: Promise<any> = new Promise((res) => { new GLTFLoader().load(CFG.CHAIR_URL, res, undefined, () => res(null)); });
    const gltf: any = await new Promise((res, rej) => {
      new GLTFLoader().load(CFG.MAP_URL, res, (e: ProgressEvent) => { if (e.total) onProgress?.(e.loaded / e.total); }, rej);
    });
    const chairG = await chairP;
    const json = gltf.parser.json as GltfJson;
    applyFootprints(measureFootprints(json, TEMPLATE)); // footprint furniture acak = bounds nyata GLB (termasuk bagian yang menonjol)
    const md = extractMapData(json);
    const w = new GameWorld(scene, gltf.scene, md);
    w.build(gltf, json, chairG);
    return w;
  }

  private build(gltf: any, json: GltfJson, chairG: any = null) {
    const { scene, root, md, cw } = this;
    // peta node-glTF -> objek three
    // AKAR MASALAH pintu/locker/laci "tidak bisa dibuka": GLTFLoader (three 0.164) membagi SATU objek `associations` ke semua klon mesh yang
    // berbagi geometri, sehingga `.nodes` hanya menyisakan indeks node TERAKHIR -> 538 dari 540 node interaktif di map ini (semua pintu,
    // locker, laci, lemari bersama-pakai mesh) tidak punya objek three dan tidak pernah didaftarkan ke sistem interaksi.
    // Pemetaan sekarang lewat NAMA NODE (unik di glTF; GLTFLoader menaruh nama aslinya di userData.name), bukan `associations`.
    root.traverse((o: any) => {
      const nm: string | undefined = (o.userData && typeof o.userData.name === 'string' ? o.userData.name : undefined) ?? o.name;
      if (nm && !this.nodeByName.has(nm)) this.nodeByName.set(nm, o);
      if (o.name && !this.nodeByName.has(o.name)) this.nodeByName.set(o.name, o);
    });
    indexNodesByName(json.nodes, this.nodeByName).forEach((o, i) => this.nodeObj.set(i, o));
    if (dev) { // sanity: setiap node interaktif/bergerak harus punya objek three
      const miss = json.nodes.filter((n: any, i: number) => (n.extras?.interact || n.extras?.type === 'door') && !this.nodeObj.has(i)).length;
      if (miss) console.warn(`[game] ${miss} node interaktif tanpa objek three`);
    }
    // extras `interact` turunan (normalizeMap) disalin ke userData objek three (GLTFLoader hanya menyalin extras asli)
    json.nodes.forEach((n: any, i) => { const it = n.extras?.interact; const o = this.nodeObj.get(i); if (it && o) (o.userData as any).interact = it; });
    this.swapChairs(json, chairG); // kursi bawaan map -> model custom (collision tidak berubah; lihat chairfit.ts)
    // template furniture acak: salinan utuh sebelum batching statis
    for (const k of Object.keys(TEMPLATE) as FurnKind[]) { const o = this.nodeByName.get(TEMPLATE[k]); if (o) { const c = o.clone(true); c.visible = true; this.templates[k] = c; } }
    scene.add(root);
    root.updateMatrixWorld(true);

    // textures: ringan di HP
    const seenMat = new Set<any>();
    root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      if (CFG.SHADOWS && !SKIP_OCCLUDER.test(o.name || '') && !(o.userData as any)?.type?.startsWith?.('Lights')) { o.castShadow = !NO_CAST_MATS.has((o.material as THREE.Material)?.name); o.receiveShadow = true; }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (seenMat.has(m)) continue; seenMat.add(m); this.matUp.apply(m); if (m.map) m.map.anisotropy = 2; if (m.name && !this.matByName.has(m.name)) this.matByName.set(m.name, m); if (m.name === 'light' && m.emissive) this.fixtureMats.push({ m, base: m.emissiveIntensity ?? 1 }); }
    });

    // ---- lampu: ganti lampu titik GLB dengan pool kecil (jauh lebih ringan) ----
    // map tidak membawa lampu titik: satu sumber per panel langit-langit (dikelompokkan dari mesh panel emisif), dipilih dinamis oleh pool kecil
    const lights: any[] = [];
    this.buzzHooks = [];
    root.traverse((o: any) => {
      if (!o.isMesh || (o.userData as any)?.type !== 'Lights') return;
      const g = o.geometry as THREE.BufferGeometry;
      for (const q of panelCentres(g.attributes.position.array, g.index ? g.index.array : null, o.matrixWorld.elements)) this.lightSrcs.push({ pos: new THREE.Vector3(q[0], q[1] - 0.3, q[2]), color: new THREE.Color(0xffe6b4), intensity: 26 * CFG.LIGHT_SCALE, range: 7.5, flicker: false, chance: 0.3 });
    });
    this.lightSrcs.forEach((s, i) => { if (i % 7 === 0) this.buzzHooks.push(s.pos.clone()); });
    this.fx.setCount(this.lightSrcs.length);
    this.lightBase = this.lightSrcs.map((s) => ({ i: s.intensity, f: s.flicker, c: s.chance })); // kondisi asli (variasi per run dimulai dari sini)
    for (const l of lights) l.parent?.remove(l);
    for (let i = 0; i < CFG.LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffe6b4, 0, 8, 2);
      scene.add(light);
      this.pool.push({ light, src: null, idx: -1, dimUntil: 0, dimDepth: 0.12, next: 0, gain: 0, leaving: false });
    }

    // ---- collision: dinding dari mesh map (hanya setinggi badan; atas pintu/lantai/atap diabaikan) ----
    const pX = new Set<number>(), pZ = new Set<number>();
    for (const wn of md.wallNodes) {
      const obj = this.nodeObj.get(wn.idx);
      if (!obj) continue;
      const base = levelY(wn.level);
      obj.traverse((m: any) => {
        if (!m.isMesh) return;
        const g = m.geometry;
        cw.rasterMesh(wn.level, g.attributes.position.array, g.index ? g.index.array : null, m.matrixWorld.elements, base + 0.25, base + 2.0);
        if (wn.level === 0) extractWallPlanes(g.attributes.position.array, g.index ? g.index.array : null, m.matrixWorld.elements, pX, pZ); // permukaan dinding asli untuk dekor
      });
    }
    this.planesX = Array.from(pX); this.planesZ = Array.from(pZ);
    cw.walk[0] = { ...md.floor0 }; // pemain tidak bisa keluar dari pelat lantai 1 (mis. lewat pintu exit yang terbuka)
    if (md.mezz) cw.walk[1] = { ...md.mezz };
    for (const c of md.colliders) cw.addObb(c.obb);
    this.fixedObbs = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]); // pintu exit disegel untuk nav

    // ---- keepout & titik wajib terjangkau untuk furniture acak ----
    this.keepouts.push({ x: md.spawn.x, z: md.spawn.z, r: 2.6 });
    this.keepouts.push({ x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 });
    if (md.ladder) this.keepouts.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
    this.must.push({ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 });
    if (md.stair) for (let u = 0; u <= md.stair.run + 1.2; u += 1.2) this.keepouts.push({ x: md.stair.bx + md.stair.sgn * u, z: md.stair.zc, r: 2.0 }); // seluruh ruang tangga (lintasan, sisi, kolong) bebas furniture
    if (md.ladder) this.must.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], rad: 0.7 }); // mulut tangga harus tetap terjangkau
    for (const d of md.doors) {
      if (d.level !== 0) continue;
      // area ayunan daun pintu (dari engsel, sepanjang sudut tutup -> buka) tidak boleh ditempati furniture
      for (const sp of swingPoints({ hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: 0.04 })) this.keepouts.push({ x: sp.x, z: sp.z, r: 0.45 });
      this.keepouts.push({ x: d.cx, z: d.cz, r: 1.5 });
      for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; this.must.push({ x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, rad: 0.7 }); }
    }
    for (const c of md.containers) if (c.level === 0) this.must.push({ x: c.ax, z: c.az, rad: 1.6 });

    // ---- pintu ----
    for (const d of md.doors) this.setupDoor(d);

    // ---- container bawaan map ----
    const roots = new Set<number>(md.containers.map((c) => c.rootIdx));
    const accessById = new Map(md.containers.map((c) => [c.id, c] as const));
    roots.forEach((ri) => {
      const obj = this.nodeObj.get(ri) ?? this.nodeByName.get(md.nodeName(ri));
      if (!obj) { if (dev) console.warn(`[game] objek container ${md.nodeName(ri)} tidak ditemukan`); return; }
      const lvl = md.containers.find((c) => c.rootIdx === ri)!.level;
      const made = this.makeContainers(obj, '', lvl, false, (id) => { const c = accessById.get(id); return c ? [c.ax, c.az] : [obj.position.x, obj.position.z]; });
      this.fixedContainers.push(...made); made.forEach((c) => this.registerHide(c));
    });

    // ---- tutup ventilasi & tuas generator (visual yang bisa dibuka tapi sebelumnya tidak interaktif) ----
    this.setupFlaps(json);

    // ---- tangga ----
    // Tangga dijalani langsung (stairs.ts + PlayScene): tidak ada interaksi CLIMB / teleport. Titik pendaratan hanya dipakai untuk keepout & reachability.
    if (md.ladder) {
      this.ladderBottom.set(md.ladder.bottom[0], md.ladder.bottom[1], md.ladder.bottom[2]);
      this.ladderTop.set(md.ladder.top[0], md.ladder.top[1], md.ladder.top[2]);
    }

    // ---- sembunyikan kandidat key bawaan map (key sekarang dibuat dari prefab berwarna & hanya muncul di dalam container) ----
    for (const i of md.keyCandidateIdx) { const o = this.nodeObj.get(i); if (o) o.visible = false; }
    this.buildKeyPrefab();
    this.buildExitLocks();
    this.buildEntity();
    this.buildDecorAssets();

    // ---- titik suara jauh: pusat tiap ruangan (buzz lampu sudah diturunkan dari panel langit-langit) ----
    for (const r of md.rooms) this.distHooks.push(new THREE.Vector3((r.rect.minx + r.rect.maxx) / 2, levelY(r.level) + 1.6, (r.rect.minz + r.rect.maxz) / 2));

    // ---- reachability lantai 2 (statis): container hanya dipakai bila terjangkau dari tangga ----
    if (md.ladder) {
      const nav1 = new NavGrid(cw, 1, this.fixedObbs);
      nav1.flood(md.ladder.top[0], md.ladder.top[2]);
      for (const c of md.containers) if (c.level === 1 && nav1.reached(c.ax, c.az, 1.6)) this.reach1.add(c.id);
    }

    this.batchStatic();

    // ---- occluder untuk raycast (semua yang bukan interaktif & bukan dekorasi tipis) ----
    const occ: THREE.Object3D[] = [];
    const collect = (o: THREE.Object3D, skip: boolean) => {
      const s = skip || SKIP_OCCLUDER.test(o.name || '');
      if (!s && (o as any).isMesh) occ.push(o);
      for (const c of o.children) collect(c, s);
    };
    collect(root, false);
    this.ix.addOccluders(occ);

    // matriks statis dibekukan (hemat CPU); bagian yang beranimasi tetap otomatis
    const animated = new Set<THREE.Object3D>();
    this.doors.forEach((d) => animated.add(d.obj));
    this.flaps.forEach((f) => f.objs.forEach((q) => animated.add(q.obj)));
    this.fixedContainers.forEach((c) => c.parts.forEach((p) => animated.add(p.obj)));
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (!animated.has(o) && !(o as any).isLight) o.matrixAutoUpdate = false; });
  }

  // ------------------------------------------------------------------ kursi custom
  /**
   * Mengganti isi semua node `Chair_*` (extras.type 'Chair') dengan model dari chair.glb. Posisi/rotasi node dipertahankan, jadi kursi
   * tetap di tempat dan menghadap arah yang sama. Collision TIDAK diubah: model diskalakan seragam agar footprint-nya selalu berada
   * di dalam kotak collision kursi bawaan (hx,hz dari `md.colliders`) -> pemain tidak pernah bisa menembus bagian kursi mana pun.
   * Semua kursi memakai 1 geometri + 1 material, lalu ikut batching statis (mobile).
   */
  private swapChairs(json: GltfJson, g: any) {
    if (!g?.scene) return;
    try {
      g.scene.updateMatrixWorld(true);
      let src: THREE.Mesh | null = null;
      g.scene.traverse((o: any) => { if (!src && o.isMesh && o.geometry?.attributes?.position && !Array.isArray(o.material)) src = o as THREE.Mesh; });
      if (!src) return;
      const mesh = src as THREE.Mesh;
      const base = mesh.geometry.clone(); base.applyMatrix4(mesh.matrixWorld); // bake transform node Sketchfab (rotasi Z-up -> Y-up)
      base.computeBoundingBox();
      const bb = base.boundingBox!;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const cache = new Map<string, THREE.BufferGeometry>();
      let n = 0;
      json.nodes.forEach((nd: any, i: number) => {
        if (nd.extras?.type !== 'Chair') return;
        const o: any = this.nodeObj.get(i), col = this.md.colliders.find((c) => c.idx === i);
        if (!o || !col) return;
        const h: number = nd.extras.size?.[1] ?? 1.03;
        const key = `${col.obb.hx.toFixed(3)}|${col.obb.hz.toFixed(3)}|${h}`;
        let geo = cache.get(key);
        if (!geo) {
          const f = fitChair([bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z], { w: col.obb.hx * 2, d: col.obb.hz * 2, h });
          geo = base.clone();
          geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.tx, f.ty, f.tz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw), new THREE.Vector3(f.scale, f.scale, f.scale)));
          geo.computeBoundingBox(); geo.computeBoundingSphere();
          cache.set(key, geo); this.chairGeos.push(geo);
        }
        if (o.isMesh) { o.geometry = geo; o.material = mat; }
        else { for (const c of [...o.children]) o.remove(c); const m = new THREE.Mesh(geo, mat); m.name = 'ChairMesh'; o.add(m); }
        n++;
      });
      base.dispose(); mesh.geometry.dispose();
      if (n) this.chairMat = mat; else mat.dispose();
      if (dev) console.info(`[game] kursi custom terpasang: ${n}`);
    } catch (e) { if (dev) console.warn('[game] kursi custom gagal dipasang; kursi bawaan dipakai', e); }
  }

  // ------------------------------------------------------------------ optimasi mobile: batching mesh statis
  /**
   * Menggabungkan mesh yang tidak pernah bergerak/diinteraksi (struktur, furniture tanpa laci/pintu, buku, rak, kursi) per
   * material + potongan 12 m + lantai, sehingga draw call turun drastis tanpa mengubah visual. Pintu, container, tangga, dan template
   * furniture acak (sudah disalin) tidak disentuh. Material dipakai ulang (tidak ada duplikat), mesh asli dilepas dari scene.
   */
  private batchStatic() {
    const keep = new Set<THREE.Object3D>();
    const protect = (o?: THREE.Object3D | null) => o?.traverse((c) => keep.add(c));
    for (const d of this.doors) protect(d.obj);
    for (const f of this.flaps) for (const q of f.objs) protect(q.obj);
    for (const c of this.fixedContainers) protect(c.root);
    if (this.md.ladder) protect(this.nodeObj.get(this.md.ladder.idx));
    const groups = new Map<string, { mat: THREE.Material; items: { g: THREE.BufferGeometry; m: THREE.Matrix4; o: THREE.Mesh }[] }>();
    const box = new THREE.Box3(), ctr = new THREE.Vector3();
    let before = 0;
    this.root.updateMatrixWorld(true);
    this.root.traverse((o: any) => {
      if (!o.isMesh) return; before++;
      if (o.isInstancedMesh || o.isSkinnedMesh || keep.has(o) || Array.isArray(o.material) || !o.geometry?.attributes?.position) return;
      const g = o.geometry as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox!).applyMatrix4(o.matrixWorld).getCenter(ctr);
      const key = `${o.material.uuid}|${ctr.y > CFG.LEVEL_Y[1] - 0.5 ? 1 : 0}|${Math.floor(ctr.x / 12)}|${Math.floor(ctr.z / 12)}`;
      const gr = groups.get(key) ?? { mat: o.material as THREE.Material, items: [] };
      gr.items.push({ g, m: o.matrixWorld.clone(), o }); groups.set(key, gr);
    });
    let after = before;
    const merged: THREE.Mesh[] = [];
    groups.forEach((gr) => {
      if (gr.items.length < 2) return;
      const list: THREE.BufferGeometry[] = [];
      for (const it of gr.items) {
        const c = it.g.clone();
        for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
        const n = c.attributes.position.count;
        if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        if (!c.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; c.setIndex(new THREE.BufferAttribute(ix, 1)); }
        if (!c.attributes.normal) c.computeVertexNormals();
        c.applyMatrix4(it.m);
        list.push(c);
      }
      const geo = mergeGeometries(list, false);
      list.forEach((c) => c.dispose());
      if (!geo) return; // atribut tidak cocok: biarkan mesh asli
      const mesh = new THREE.Mesh(geo, gr.mat);
      mesh.name = 'Batch'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = true;
      if (CFG.SHADOWS && !SKIP_OCCLUDER.test(gr.items[0].o.name || '') && gr.mat.name !== 'light' && gr.mat.name !== 'exit_sign') { mesh.castShadow = !NO_CAST_MATS.has(gr.mat.name); mesh.receiveShadow = true; }
      merged.push(mesh); after -= gr.items.length - 1;
      for (const it of gr.items) it.o.removeFromParent();
    });
    for (const m of merged) { this.root.add(m); this.batchGeos.push(m.geometry); }
    this.root.updateMatrixWorld(true);
    if (dev) console.info(`[game] batching statis: ${before} -> ${after} mesh`);
  }

  // ------------------------------------------------------------------ pintu
  private doorPos(d: DoorDesc) { return { x: d.cx, y: 1.2, z: d.cz }; }

  private setupDoor(d: DoorDesc) {
    // collision SELALU dibuat dari data map (pintu tertutup tidak pernah bisa ditembus), tidak bergantung pada ada/tidaknya objek visual
    const obb = this.cw.addObb(d.closedObb);
    const obj = this.nodeObj.get(d.leaf) ?? this.nodeByName.get(d.name);
    if (!obj) { if (dev) console.warn(`[game] objek pintu ${d.name} tidak ditemukan (collision tetap aktif)`); return; }
    // engsel = origin node pintu (daun memanjang sepanjang +Z lokal): rotasi di sekitar engsel, bukan dari tengah
    const leaf: LeafGeom = { hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: d.closedObb.hx };
    const rt: DoorRT = { d, obj, q0: obj.quaternion.clone(), t: 0, target: 0, obb, unlocked: !d.locked, it: null as any, leaf, vis: { ...leaf, half: 0.04 }, pend: false, closedSfx: true };
    applyPose(obb, leaf, 0);
    const isExit = d.type === 'exit_door';
    const sealed = d.locked && !isExit; // exit lantai 2: tersegel permanen (game hanya punya gembok warna di exit lantai 1)
    rt.it = {
      id: d.name, kind: isExit ? 'exit' : 'door', reach: DOOR_REACH,
      prompt: () => ((isExit && !rt.unlocked) || sealed ? 'LOCKED' : rt.target ? 'CLOSE' : 'OPEN'),
      interact: (ctx) => {
        if (sealed) { ctx.say('Terkunci rapat', 1600); this.audio?.play('door_locked', { pos: this.doorPos(d) }); return; }
        if (isExit && !rt.unlocked) { // exit hanya terbuka bila ketiga gembok (per warna) sudah dibuka
          ctx.say(`Gembok: ${this.locksOpen()}/${this.locks.length}`, 2000);
          this.audio?.play('door_locked', { pos: this.doorPos(d) });
          return;
        }
        this.ix.invalidate();
        if (rt.target === 0) { rt.target = 1; rt.closedSfx = false; this.audio?.play('door_open', { pos: this.doorPos(d) }); return; } // animasi + collision diatur di update()
        // menutup: batalkan bila pemain berdiri di ambang pintu
        if (Math.abs(ctx.player.y - levelY(d.level)) < 1.9 && leafTouches(rt.leaf, 0, ctx.player.x, ctx.player.z, CFG.PLAYER_RADIUS + 0.25)) { ctx.say('BLOCKED', 1200); return; }
        rt.target = 0; rt.closedSfx = false;
      },
    };
    this.ix.register(rt.it, [obj]);
    this.doors.push(rt);
    if (isExit) this.exitRt = rt;
  }

  // ------------------------------------------------------------------ sembunyi (locker / lemari / kolong kasur)
  /** Semua locker & lemari (Locker/Cabinet, bawaan map maupun acak) bisa dimasuki: titik sembunyi di tengah badan, menghadap pintu (+Z lokal). */
  private registerHide(rt: ContainerRT) {
    const ty = (rt.root.userData as any)?.type;
    if (ty !== 'Locker' && ty !== 'Cabinet') return;
    this.hideMap.set(rt.it, { id: rt.id, kind: 'locker', level: rt.level, random: rt.random, rt });
  }

  private buildBed(b: BedPlacement): THREE.Group {
    if (!this.bedMats) {
      this.bedMats = {
        wood: new THREE.MeshLambertMaterial({ color: 0x4a3524 }), mat: new THREE.MeshLambertMaterial({ color: 0x8c8672 }),
        pillow: new THREE.MeshLambertMaterial({ color: 0xb4ae98 }), blanket: new THREE.MeshLambertMaterial({ color: 0x5b4a3b }),
      };
      const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
      this.bedGeo = { leg: box(0.07, 0.38, 0.07), head: box(1.0, 0.9, 0.06), foot: box(1.0, 0.45, 0.05), slab: box(1.0, 0.08, 2.05), mat: box(0.94, 0.16, 1.95), pillow: box(0.6, 0.1, 0.32), blanket: box(0.96, 0.05, 1.1) };
    }
    const M = this.bedMats!, G = this.bedGeo!, g = new THREE.Group(), meshes: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); meshes.push(m); };
    const hz = BED_SIZE.d / 2;
    for (const sx of [-0.46, 0.46]) for (const sz of [-hz + 0.05, hz - 0.05]) add(G.leg, M.wood, sx, 0.19, sz);
    add(G.slab, M.wood, 0, 0.42, 0); add(G.head, M.wood, 0, 0.45, -hz + 0.03); add(G.foot, M.wood, 0, 0.62, hz - 0.03);
    add(G.mat, M.mat, 0, 0.54, 0); add(G.pillow, M.pillow, 0, 0.64, -hz + 0.35); add(G.blanket, M.blanket, 0, 0.64, 0.38);
    g.position.set(b.x, 0, b.z); g.rotation.y = b.yaw; g.name = b.id; this.scene.add(g); g.updateMatrixWorld(true);
    const it: Interactable<GameCtx> = { id: b.id, kind: 'hide', runScoped: true, reach: 1.9, prompt: () => (this.hr ? null : 'HIDE'), interact: (ctx) => { this.tryHide(ctx.player, ctx.say); } };
    this.ix.register(it, meshes);
    this.hideMap.set(it, { id: b.id, kind: 'bed', level: 0, random: true, bed: b });
    return g;
  }

  get hiding(): boolean { return !!this.hr; }
  /** Target bidikan yang bisa dipakai sembunyi (untuk tombol HIDE di HUD). */
  hideTarget(): 'locker' | 'bed' | null { if (this.hr) return null; const t = this.ix.current; const s = t ? this.hideMap.get(t.it) : undefined; return s ? s.kind : null; }
  /** Teks prompt saat sedang bersembunyi (null = tidak ada). */
  hidePrompt(): string | null { return this.hr && this.hr.phase === 'hidden' ? 'KELUAR' : null; }

  private wrapA(a: number) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  /** Masuk (bila membidik locker/lemari/kasur) atau keluar (bila sedang bersembunyi). Mengembalikan true bila aksi diterima. */
  tryHide(player: PlayerState, say: (m: string, ms?: number) => void): boolean {
    if (this.hr) return this.beginExit(player, say);
    const t = this.ix.current; const spot = t ? this.hideMap.get(t.it) : undefined;
    if (!spot || spot.level !== player.level || player.onStairs) return false;
    const cam = this.camPos, eyeStand = cam.y;
    const from = { x: cam.x, y: cam.y, z: cam.z, yaw: player.yaw };
    if (spot.kind === 'locker' && spot.rt) {
      const rt = spot.rt;
      if (rt.group.some((g) => g.cs.searching)) { say('SEARCHING...', 900); return true; }
      if (rt.group.some((g) => !g.cs.want && g.openMax < 0.6)) { say('BLOCKED', 1000); return true; }
      rt.root.updateWorldMatrix(true, false);
      const f = new THREE.Vector3(0, 0, 1).transformDirection(rt.root.matrixWorld), inside = rt.root.localToWorld(new THREE.Vector3(0, 0, 0.1));
      this.hr = { spot, phase: 'open', t: 0, from, to: { x: inside.x, y: levelY(rt.level) + 1.5, z: inside.z, yaw: Math.atan2(-f.x, -f.z) }, exit: null, side: 0, eyeStand };
      this.hideSet(rt, 1);
    } else if (spot.bed) {
      const b = spot.bed, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const lx = (player.x - b.x) * c - (player.z - b.z) * s; // sisi mana (x lokal) tempat pemain berdiri
      const side = lx >= 0 ? 1 : -1;
      const sp = b.sides.find(([x, z]) => ((x - b.x) * c - (z - b.z) * s) * side > 0);
      if (!sp) { say('BLOCKED', 1000); return true; }
      const ox = side * (b.hx - 0.18), px = b.x + ox * c, pz = b.z - ox * s; // di kolong, dekat tepi tempat masuk
      this.hr = { spot, phase: 'crawl-in', t: 0, from, to: { x: px, y: 0.3, z: pz, yaw: Math.atan2(-(side * c), -(-side * s)) }, exit: { x: sp[0], z: sp[1] }, side, eyeStand };
      this.audio?.play('rustle', { pos: { x: b.x, y: 0.3, z: b.z } });
    } else return false;
    this.hv.kind = spot.kind; this.hv.active = true; this.hv.alpha = 0; this.hv.look = 'ease'; this.hv.phase = this.hr!.phase;
    this.hv.limYaw = spot.kind === 'bed' ? 0.95 : 0.55; this.hv.pitchMin = spot.kind === 'bed' ? -0.08 : -0.3; this.hv.pitchMax = spot.kind === 'bed' ? 0.3 : 0.22;
    this.ix.invalidate();
    return true;
  }

  /** Sembunyi di lemari: seluruh pintu lemari itu ikut membuka/menutup (hanya untuk aksi HIDE; interaksi biasa tetap per pintu). */
  private hideSet(rt: ContainerRT, want: 0 | 1) {
    let played = false;
    for (const g of rt.group) {
      if (g.cs.want === want) continue;
      g.cs.want = want; this.active.add(g);
      if (!played) { played = true; this.audio?.play((rt.sfx + (want ? '_open' : '_close')) as SfxName, { pos: { x: rt.ax, y: 0.9, z: rt.az } }); }
    }
  }

  private beginExit(player: PlayerState, say: (m: string, ms?: number) => void): boolean {
    const h = this.hr!; if (h.phase !== 'hidden') return true;
    const sp = h.spot;
    let ex: { x: number; z: number } | null = null;
    if (sp.kind === 'locker' && sp.rt) {
      const root = sp.rt.root; root.updateWorldMatrix(true, false);
      for (const [lx, lz] of [[0, 0.9], [0, 1.15], [0.35, 0.95], [-0.35, 0.95], [0, 0.72]] as [number, number][]) {
        const w = root.localToWorld(new THREE.Vector3(lx, 0, lz));
        if (!this.cw.blocked(w.x, w.z, CFG.PLAYER_RADIUS, sp.level)) { ex = { x: w.x, z: w.z }; break; }
      }
    } else if (sp.bed && h.exit) {
      const b = sp.bed, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      for (const k of [1, 1.25, 0.85]) { // titik di sisi masuk, geser menjauh bila terhalang
        const off = (b.hx + 0.55 * k) * h.side, x = b.x + off * c, z = b.z - off * s;
        if (!this.cw.blocked(x, z, CFG.PLAYER_RADIUS, 0)) { ex = { x, z }; break; }
      }
    }
    if (!ex) { say('BLOCKED', 1000); return true; }
    h.exit = ex; h.t = 0; h.from = { x: this.hv.x, y: this.hv.y, z: this.hv.z, yaw: this.hv.yaw };
    h.to = { x: ex.x, y: h.eyeStand, z: ex.z, yaw: h.from.yaw };
    if (sp.kind === 'locker' && sp.rt) {
      const rt = sp.rt; rt.group.forEach((g) => g.parts.forEach((q) => { if (q.obj) q.obj.visible = true; })); // pintu terlihat lagi lalu terbuka
      h.phase = 'reopen'; this.hideSet(rt, 1);
    } else { h.phase = 'crawl-out'; this.audio?.play('rustle', { pos: { x: sp.bed!.x, y: 0.3, z: sp.bed!.z } }); }
    this.hv.phase = h.phase; this.ix.invalidate();
    return true;
  }

  private hideTick(dt: number, player: PlayerState) {
    const h = this.hr!, sp = h.spot, hv = this.hv, rt = sp.rt;
    h.t += dt;
    const lerpPos = (u: number) => {
      const k = smooth(Math.min(1, Math.max(0, u)));
      hv.x = h.from.x + (h.to.x - h.from.x) * k; hv.y = h.from.y + (h.to.y - h.from.y) * k; hv.z = h.from.z + (h.to.z - h.from.z) * k;
      hv.yaw = h.from.yaw + this.wrapA(h.to.yaw - h.from.yaw) * k;
    };
    const setPlayer = () => { player.x = hv.x; player.z = hv.z; };
    switch (h.phase) {
      case 'open':
        if (!rt || rt.group.every((g) => g.cs.k >= 0.9) || h.t > 1.3) { h.phase = 'enter'; h.t = 0; h.from = { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z, yaw: player.yaw }; }
        else { hv.x = this.camPos.x; hv.y = this.camPos.y; hv.z = this.camPos.z; hv.yaw = player.yaw; }
        break;
      case 'enter':
        lerpPos(h.t / 0.65); setPlayer();
        if (h.t >= 0.65) { h.phase = 'close'; h.t = 0; if (rt) this.hideSet(rt, 0); }
        break;
      case 'close':
        hv.alpha = rt ? 1 - Math.min(1, Math.max(...rt.group.map((g) => g.cs.k))) : 1;
        if (!rt || rt.group.every((g) => g.cs.k <= 0.02) || h.t > 1.2) { rt?.group.forEach((g) => g.parts.forEach((q) => { if (q.obj) q.obj.visible = false; })); hv.alpha = 1; h.phase = 'hidden'; h.t = 0; hv.look = 'limited'; }
        break;
      case 'crawl-in':
        lerpPos(h.t / 0.95); hv.alpha = Math.min(1, Math.max(0, (h.t - 0.35) / 0.55)); setPlayer();
        if (h.t >= 0.95) { h.phase = 'hidden'; h.t = 0; hv.look = 'limited'; hv.alpha = 1; }
        break;
      case 'hidden': break;
      case 'reopen':
        hv.alpha = rt ? 1 - Math.min(1, Math.max(...rt.group.map((g) => g.cs.k))) : 0;
        if (!rt || rt.group.every((g) => g.cs.k >= 0.9) || h.t > 1.2) { h.phase = 'leave'; h.t = 0; hv.alpha = 0; h.from = { x: hv.x, y: hv.y, z: hv.z, yaw: hv.yaw }; }
        break;
      case 'leave':
        lerpPos(h.t / 0.6); setPlayer();
        if (h.t >= 0.6) this.finishExit(player);
        break;
      case 'crawl-out':
        lerpPos(h.t / 0.95); hv.alpha = 1 - Math.min(1, h.t / 0.5); setPlayer();
        if (h.t >= 0.95) this.finishExit(player);
        break;
    }
    hv.phase = h.phase;
  }

  private finishExit(player: PlayerState) {
    const h = this.hr!;
    if (h.exit) { player.x = h.exit.x; player.z = h.exit.z; }
    this.endHide();
  }

  /** Bersihkan state sembunyi (selesai keluar / run baru): pintu terlihat lagi, kamera dilepas. */
  private endHide() {
    const h = this.hr;
    if (h?.spot.rt) h.spot.rt.group.forEach((g) => g.parts.forEach((q) => { if (q.obj) q.obj.visible = true; }));
    this.hr = null; this.hv.active = false; this.hv.alpha = 0;
    this.ix.invalidate();
  }

  // ------------------------------------------------------------------ flap (ventilasi, tuas)
  private setupFlaps(json: GltfJson) {
    const groups = new Map<string, { idx: number; e: any }[]>();
    json.nodes.forEach((n: any, i: number) => {
      const e = n.extras; if (!e || !e.interactive || !this.nodeObj.has(i)) return;
      if (e.type === 'ventCover') { const k = 'vent:' + (e.vent ?? n.name); const a = groups.get(k) ?? []; a.push({ idx: i, e }); groups.set(k, a); }
      else if (e.type === 'lever') groups.set('lever:' + n.name, [{ idx: i, e }]);
    });
    groups.forEach((list, id) => {
      const objs: FlapRT['objs'] = [];
      for (const { idx, e } of list) {
        const obj = this.nodeObj.get(idx)!;
        const ax = (e.rotationAxis ?? 'x') as 'x' | 'y' | 'z';
        const open = e['openRotation' + ax.toUpperCase()] ?? 0, closed = e['closedRotation' + ax.toUpperCase()] ?? 0;
        objs.push({ obj, q0: obj.quaternion.clone(), axis: new THREE.Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0), rad: open - closed });
      }
      const lever = id.startsWith('lever:');
      const f: FlapRT = { id, objs, t: 0, target: 0, it: null as any, sfx: lever ? 'click' : 'cabinet', time: lever ? 0.35 : 0.6 };
      const pos = () => { const v = new THREE.Vector3(); objs[0].obj.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; };
      f.it = {
        id, kind: 'door', reach: DOOR_REACH,
        prompt: () => (lever ? (f.target ? 'TURN OFF' : 'TURN ON') : f.target ? 'CLOSE' : 'OPEN'),
        interact: () => {
          f.target = f.target ? 0 : 1; this.ix.invalidate();
          this.audio?.play(f.sfx === 'click' ? 'flash_click' : (f.target ? 'cabinet_open' : 'cabinet_close'), { pos: pos() });
        },
      };
      this.ix.register(f.it, objs.map((q) => q.obj));
      this.flaps.push(f);
    });
  }

  private poseFlap(f: FlapRT) {
    const a = ease(f.t);
    for (const q of f.objs) { q.obj.quaternion.copy(q.q0).multiply(this.tmpQ.setFromAxisAngle(q.axis, q.rad * a)); q.obj.updateMatrix(); }
  }

  private stepFlap(f: FlapRT, dt: number) {
    const r = dt / f.time;
    f.t = f.target ? Math.min(1, f.t + r) : Math.max(0, f.t - r);
    this.poseFlap(f);
  }

  /** Satu langkah animasi pintu: easing halus, daun tidak menembus pemain, collision mengikuti sudut daun (tidak pernah menjebak). */
  private stepDoor(d: DoorRT, dt: number, player: PlayerState) {
    const near = Math.abs(player.y - levelY(d.d.level)) < 1.9;
    if (d.t !== d.target) {
      const rate = dt / (d.d.openTime || 0.7);
      const nt = d.target ? Math.min(1, d.t + rate) : Math.max(0, d.t - rate);
      // daun berhenti sebelum menyentuh pemain; lanjut otomatis begitu pemain menyingkir
      if (!(near && sweepHitsPlayer(d.vis, ease(d.t), ease(nt), player.x, player.z, CFG.PLAYER_RADIUS + 0.02))) d.t = nt;
    }
    const a = ease(d.t);
    d.obj.quaternion.copy(d.q0).multiply(this.tmpQ.setFromAxisAngle(this.upAxis, d.leaf.openRad * a));
    // collision = pose daun saat masih menutup bukaan; terbuka cukup lebar = non-blocking
    if (doorBlocksAt(a)) {
      applyPose(d.obb, d.leaf, a);
      if (!d.obb.enabled) {
        const inside = near && CollisionWorld.distToObb(d.obb, player.x, player.z) < CFG.PLAYER_RADIUS + 0.03;
        d.pend = inside; if (!inside) d.obb.enabled = true; // pemain masih di ambang: tunggu keluar dulu
      }
    } else { d.obb.enabled = false; d.pend = false; }
    if (d.t === 0 && d.target === 0 && !d.closedSfx) {
      // pemain terlanjur berada di ambang saat pintu selesai menutup -> buka lagi (jangan sampai terjebak)
      if (near && leafTouches(d.leaf, 0, player.x, player.z, CFG.PLAYER_RADIUS + 0.2)) { d.target = 1; return; }
      d.closedSfx = true; this.audio?.play('door_close', { pos: this.doorPos(d.d) });
    }
  }

  // ------------------------------------------------------------------ variasi kondisi ruangan
  /** Geser beberapa furniture acak sejak awal run (kandidat divalidasi sama seperti event: jalan/key/exit/akses tetap aman). */
  private initialShifts(rr: Rng, nav: NavGrid, count: number): NavGrid {
    this.nav = nav;
    const all = () => this.fixedContainers.concat(this.randomContainers);
    let done = 0;
    for (const q of rr.shuffle(this.placements.slice())) {
      if (done >= count) break;
      const amt = rr.range(0.2, 0.45) * (rr.chance(0.5) ? 1 : -1);
      const dx = Math.cos(q.yaw) * amt, dz = -Math.sin(q.yaw) * amt;
      const cur = this.nav!;
      this.accessPts = all().filter((c) => c.level === 0 && cur.reached(c.ax, c.az, 1.6)).map((c) => ({ x: c.ax, z: c.az }));
      const plan = this.shiftPlan(q, dx, dz);
      const obj = this.randomObjs.find((o) => o.name === q.id), obb = this.cw.obbs.find((o) => o.id === q.id);
      if (!plan || !obj || !obb) continue;
      q.x += dx; q.z += dz; q.ax += dx; q.az += dz;
      obj.position.x = q.x + q.vx; obj.position.z = q.z + q.vz; obj.updateMatrixWorld(true);
      obb.cx = q.x; obb.cz = q.z;
      for (const c of this.randomContainers) if (c.id.endsWith('@' + q.id)) { c.ax += dx; c.az += dz; }
      this.nav = plan.nav; this.baseReach = plan.n; done++;
    }
    return this.nav!;
  }

  /** Pintu biasa terbuka, sebagian lampu redup/berkedip, container KOSONG sudah terbuka (container berisi key/loot tidak pernah disentuh). */
  private applyRoomState(st: ReturnType<typeof planRoomState>, containers: ContainerRT[]) {
    for (const i of st.openDoors) {
      const d = this.doors[i]; if (!d) continue;
      d.t = 1; d.target = 1; d.obb.enabled = false; d.pend = false; d.closedSfx = true;
      d.obj.quaternion.copy(d.q0).multiply(this.tmpQ.setFromAxisAngle(this.upAxis, (d.d.openAngle * Math.PI) / 180));
    }
    this.lightSrcs.forEach((s, i) => { const b = this.lightBase[i]; if (b) { s.intensity = b.i; s.flicker = b.f; s.chance = b.c; } });
    for (const i of st.dimLights) { const s = this.lightSrcs[i]; if (s) s.intensity *= 0.45; }
    for (const i of st.flickerLights) { const s = this.lightSrcs[i]; if (s) { s.flicker = true; s.chance = Math.max(s.chance, 0.6); } }
    const open = new Set(st.openContainers);
    for (const c of containers) if (open.has(c.id) && c.content?.type === 'empty') { c.cs.k = 1; c.cs.want = 1; c.cs.searched = true; this.setOpen(c, 1); this.active.add(c); } // active: collision bagian terbuka ikut dipasang
    this.roomMul = st.decorMul;
  }

  // ------------------------------------------------------------------ environmental storytelling
  /** Aset dekor: reuse mesh/material map (noda, kardus, pipa, rambu EXIT, metal) + beberapa geometri kecil buatan sendiri. */
  private buildDecorAssets() {
    // aset dekor: material map dipakai ulang (cardboard, metal_dark, exit_sign); geometri kecil dibuat sendiri (ikut dibuang saat dispose)
    const own = <T extends THREE.BufferGeometry>(g: T): T => { this.decorOwn.push(g); return g; };
    const cardboard = this.matByName.get('cardboard'), metal = this.matByName.get('metal_dark'), exitMat = this.matByName.get('exit_sign');
    let exitGeo: THREE.BufferGeometry | null = null;
    this.nodeByName.get('ExitSign_F1')?.traverse((c: any) => { if (!exitGeo && c.isMesh) exitGeo = own((c.geometry as THREE.BufferGeometry).clone().center()); });
    const stainMat = new THREE.MeshLambertMaterial({ color: 0x15100a, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decorOwn2.push(stainMat);
    const stainGeo = own(new THREE.CircleGeometry(1, 14)); stainGeo.rotateX(-Math.PI / 2);
    const boxGeo = own(new THREE.BoxGeometry(1, 1, 1)); boxGeo.translate(0, 0.5, 0);
    const pipeGeo = own(new THREE.CylinderGeometry(0.057, 0.057, 1, 8)); pipeGeo.rotateZ(Math.PI / 2);
    this.decorSrc = { stain: { geo: stainGeo, mat: stainMat } };
    if (cardboard) this.decorSrc.box = { geo: boxGeo, mat: cardboard };
    if (metal) this.decorSrc.pipe = { geo: pipeGeo, mat: metal };
    if (exitMat && exitGeo) this.decorSrc.exit = { geo: exitGeo, mat: exitMat };

    const paper = own(new THREE.PlaneGeometry(1, 1)); paper.rotateX(-Math.PI / 2);
    const can = own(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)); can.translate(0, 0.5, 0);
    const vent = own(new THREE.BoxGeometry(1, 1, 1));
    // APAR & rambu: satu geometri gabungan dengan warna per-vertex (satu material, tanpa tekstur)
    const part = (g: THREE.BufferGeometry, x: number, y: number, z: number, c: [number, number, number]) => {
      g.translate(x, y, z);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const ext = mergeGeometries([
      part(new THREE.CylinderGeometry(0.065, 0.065, 0.3, 10), 0, 0.15, 0, [0.62, 0.05, 0.04]),
      part(new THREE.CylinderGeometry(0.067, 0.067, 0.07, 10), 0, 0.15, 0, [0.8, 0.78, 0.72]),
      part(new THREE.CylinderGeometry(0.025, 0.04, 0.06, 8), 0, 0.33, 0, [0.07, 0.07, 0.07]),
      part(new THREE.BoxGeometry(0.09, 0.025, 0.025), 0.02, 0.375, 0, [0.07, 0.07, 0.07]),
      part(new THREE.BoxGeometry(0.1, 0.03, 0.02), 0, 0.22, -0.065, [0.12, 0.12, 0.12]),
    ])!;
    const warn = mergeGeometries([
      part(new THREE.BoxGeometry(0.28, 0.2, 0.012), 0, 0, 0, [0.85, 0.68, 0.06]),
      part(new THREE.BoxGeometry(0.03, 0.085, 0.004), 0, 0.02, 0.008, [0.05, 0.05, 0.05]),
      part(new THREE.BoxGeometry(0.03, 0.03, 0.004), 0, -0.058, 0.008, [0.05, 0.05, 0.05]),
    ])!;
    this.decorGeo = { paper, can, vent, extinguisher: ext, warning: warn };
    this.decorMat = { paper: new THREE.MeshLambertMaterial({ color: 0xd9d3bf, side: THREE.DoubleSide }), vc: new THREE.MeshLambertMaterial({ vertexColors: true }) };
  }

  private clearDecor() {
    for (const m of this.decorMeshes) { this.scene.remove(m); m.dispose(); } // hanya buffer instance; geometri/material dipakai ulang
    this.decorMeshes = [];
  }

  /** Dekor satu run: dihitung sekali di generate() dari RNG turunan (tidak mengubah urutan RNG furniture/key/event), nol biaya per frame. */
  private buildDecor(sd: number, nav: NavGrid) {
    if (!CFG.DECOR_ENABLED) return;
    try {
      const md = this.md, door = md.exit.door;
      const avoid = this.keepouts.concat([{ x: door.cx, z: door.cz, r: 3.2 }]); // spawn, exit, tangga, pintu tetap bersih
      const anchors = this.placements.map((p) => ({ x: p.x, z: p.z })).concat(this.fixedContainers.filter((c) => c.level === 0).map((c) => ({ x: c.ax, z: c.az })));
      const items = planDecor({
        nav, rng: makeRng((sd ^ 0x7f4a7c15) >>> 0), counts: Object.fromEntries(Object.entries(CFG.DECOR_COUNTS).map(([k, v]) => [k, Math.round(v * (this.roomMul[k as DecorKind] ?? 1))])) as any, minGap: CFG.DECOR_MIN_GAP, avoid, anchors,
        doors: md.doors.filter((d) => d.level === 0).map((d) => ({ cx: d.cx, cz: d.cz, nx: d.nx, nz: d.nz, level: d.level, type: d.type })),
        rooms: md.rooms.filter((r) => r.level === 0), planesX: this.planesX, planesZ: this.planesZ,
      });
      const by = new Map<DecorKind, DecorItem[]>();
      for (const it of items) { const a = by.get(it.kind) ?? []; a.push(it); by.set(it.kind, a); }
      const S = this.decorSrc, G = this.decorGeo, M = this.decorMat;
      const res: Record<DecorKind, { geo?: THREE.BufferGeometry; mat?: THREE.Material }> = {
        paper: { geo: G.paper, mat: M.paper }, stain: S.stain ?? {}, box: S.box ?? {}, can: { geo: G.can, mat: S.pipe?.mat },
        cable: S.pipe ?? {}, pipe: S.pipe ?? {}, vent: { geo: G.vent, mat: S.pipe?.mat },
        extinguisher: { geo: G.extinguisher, mat: M.vc }, warning: { geo: G.warning, mat: M.vc }, exit: S.exit ?? {},
      };
      const groups: [string, DecorKind[]][] = [['paper', ['paper']], ['stain', ['stain']], ['box', ['box']], ['can', ['can']], ['pipe', ['pipe', 'cable']], ['vent', ['vent']], ['extinguisher', ['extinguisher']], ['warning', ['warning']], ['exit', ['exit']]];
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
      for (const [, kinds] of groups) {
        const list = kinds.flatMap((k) => by.get(k) ?? []);
        const r = res[kinds[0]];
        if (!list.length || !r.geo || !r.mat) continue;
        const mesh = new THREE.InstancedMesh(r.geo, r.mat, list.length);
        list.forEach((it, i) => {
          e.set(0, it.yaw, it.rz ?? 0, 'YXZ'); q.setFromEuler(e);
          m4.compose(p.set(it.x, it.y, it.z), q, sc.set(it.sx, it.sy, it.sz)); mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, col.setScalar(it.shade));
        });
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        mesh.matrixAutoUpdate = false; mesh.renderOrder = kinds[0] === 'stain' ? 1 : 0;
        this.scene.add(mesh); this.decorMeshes.push(mesh);
      }
    } catch (err) { if (dev) console.warn('[game] dekor dilewati:', err); } // dekor hanya kosmetik: gagal tidak boleh merusak run
  }

  // ------------------------------------------------------------------ key (prefab) & gembok exit
  private buildKeyPrefab() {
    const ring = new THREE.TorusGeometry(0.04, 0.012, 6, 14); ring.rotateX(Math.PI / 2); ring.translate(-0.1, 0, 0);
    const shaft = new THREE.BoxGeometry(0.17, 0.02, 0.022); shaft.translate(0.01, 0, 0);
    const tooth1 = new THREE.BoxGeometry(0.025, 0.02, 0.045); tooth1.translate(0.085, 0, 0.03);
    const tooth2 = new THREE.BoxGeometry(0.02, 0.02, 0.035); tooth2.translate(0.05, 0, 0.026);
    this.keyGeos = [ring, shaft, tooth1, tooth2];
    for (const k of KEY_DEFS) this.keyMats[k.id] = new THREE.MeshStandardMaterial({ color: k.color, emissive: k.color, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.6 });
  }

  private makeKeyObject(id: KeyId): THREE.Group {
    const g = new THREE.Group();
    for (const geo of this.keyGeos) g.add(new THREE.Mesh(geo, this.keyMats[id]));
    g.add(new THREE.Mesh(this.keyHitGeo, this.pickHitMat)); // area bidik besar (HP)
    return g;
  }

  private buildExitLocks() {
    const e = this.md.exit, d = e.door;
    let nx = e.insideX - d.cx, nz = e.insideZ - d.cz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; // normal ke sisi pemain
    const hw = new THREE.Group();
    hw.position.set(d.cx + nx * 0.09, 0, d.cz + nz * 0.09);
    hw.rotation.y = Math.atan2(nx, nz);
    this.lockHw = hw;

    const linkGeo = new THREE.TorusGeometry(0.03, 0.008, 5, 10);
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x6b6b66, metalness: 0.85, roughness: 0.45 });
    const bodyGeo = new THREE.BoxGeometry(0.13, 0.11, 0.05);
    const shackleGeo = new THREE.TorusGeometry(0.035, 0.009, 5, 10, Math.PI);
    const hitGeo = new THREE.BoxGeometry(0.36, 0.36, 0.3);
    this.hwGeos.push(linkGeo, bodyGeo, shackleGeo, hitGeo); this.hwMats.push(chainMat);

    // rantai horizontal melintang pintu + 3 sambungan turun ke gembok
    const N = 22, drops = 3 * 3; // lebar bukaan pintu exit = 1,2 m (rantai 1,16 m)
    const chain = new THREE.InstancedMesh(linkGeo, chainMat, N + drops);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1.3, 1, 1), qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const lockX = [-0.34, 0, 0.34], chainY = 1.2;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), x = -0.58 + u * 1.16, y = chainY - 0.05 * Math.sin(Math.PI * u);
      m.compose(new THREE.Vector3(x, y, 0.02), i % 2 ? qx : q.identity(), sc); chain.setMatrixAt(i, m);
    }
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
      m.compose(new THREE.Vector3(lockX[k], chainY - 0.07 - j * 0.045, 0.02), j % 2 ? q.identity() : qx, sc); chain.setMatrixAt(N + k * 3 + j, m);
    }
    chain.instanceMatrix.needsUpdate = true; chain.frustumCulled = false;
    hw.add(chain); this.chainMesh = chain;

    KEY_DEFS.slice(0, CFG.REQUIRED_KEYS).forEach((kd, k) => {
      const mat = new THREE.MeshStandardMaterial({ color: kd.color, emissive: kd.color, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.4 });
      this.hwMats.push(mat);
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat); g.add(body);
      const sh = new THREE.Mesh(shackleGeo, chainMat); sh.position.y = 0.055; g.add(sh);
      g.add(new THREE.Mesh(hitGeo, this.pickHitMat));
      g.position.set(lockX[k], 0.98, 0.04);
      hw.add(g);
      const l: LockRT = { id: kd.id, group: g, opened: false, fall: 0, p0: g.position.clone(), it: null as any };
      l.it = {
        id: 'lock_' + kd.id, kind: 'lock',
        prompt: (ctx) => (l.opened ? null : ctx.player.inventory.hasKey(l.id) ? `UNLOCK ${kd.label}` : `LOCKED - ${kd.label}`),
        interact: (ctx) => {
          if (l.opened) return;
          const wp = this.lockWorldPos(l);
          if (!ctx.player.inventory.hasKey(l.id)) { ctx.say(`Butuh ${kd.label}`, 1800); this.audio?.play('door_locked', { pos: wp, vol: 0.8 }); return; }
          ctx.player.inventory.remove(l.id); // key dicek per warna/ID, bukan jumlah
          this.openLock(l, ctx);
        },
      };
      this.ix.register(l.it, [g]);
      this.locks.push(l);
    });
    this.scene.add(hw); hw.updateMatrixWorld(true);
  }

  private lockWorldPos(l: LockRT) { const v = new THREE.Vector3(); l.group.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; }
  locksOpen(): number { return this.locks.filter((l) => l.opened).length; }
  /** Status gembok per warna untuk HUD. */
  lockState(): Record<string, boolean> { const o: Record<string, boolean> = {}; for (const l of this.locks) o[l.id] = l.opened; return o; }

  private openLock(l: LockRT, ctx: GameCtx) {
    l.opened = true; l.fall = 0.001;
    this.ix.unregister(l.it);
    this.audio?.play('lock_unlock', { pos: this.lockWorldPos(l) });
    const n = this.locksOpen();
    if (n >= this.locks.length) {
      this.chainFall = 0.001;
      this.timers.push({ at: this.clock + 0.5, fn: () => this.audio?.play('chain_fall', { pos: { x: this.md.exit.door.cx, y: 1.2, z: this.md.exit.door.cz } }) });
      const rt = this.exitRt;
      if (rt) { rt.unlocked = true; this.timers.push({ at: this.clock + 1.1, fn: () => { rt.target = 1; rt.closedSfx = false; this.audio?.play('door_open', { pos: this.doorPos(rt.d) }); } }); }
      ctx.say('EXIT OPEN', 2600);
    } else ctx.say(`Gembok ${n}/${this.locks.length} terbuka`, 1800);
    ctx.changed();
  }

  private resetLocks() {
    for (const l of this.locks) {
      if (l.opened) this.ix.register(l.it, [l.group]);
      l.opened = false; l.fall = 0; l.group.visible = true; l.group.position.copy(l.p0); l.group.rotation.set(0, 0, 0);
    }
    this.chainFall = 0;
    if (this.chainMesh) { this.chainMesh.visible = true; this.chainMesh.position.set(0, 0, 0); }
  }

  // ------------------------------------------------------------------ container
  private makeContainers(root: THREE.Object3D, suffix: string, level: number, random: boolean, access: (id: string) => [number, number]): ContainerRT[] {
    const groups = new Map<string, THREE.Object3D[]>();
    for (const ch of root.children) {
      const it = (ch.userData as any)?.interact;
      if (it && it.type === 'container') { const a = groups.get(it.container_id) ?? []; a.push(ch); groups.set(it.container_id, a); }
    }
    const out: ContainerRT[] = [];
    groups.forEach((objs, rawId) => {
      const group: ContainerRT[] = [];
      const split = groups.size > 1 || objs.length > 1; // furniture multi-kompartemen: tiap pintu/laci jadi container sendiri
      objs.forEach((o, pi) => {
        const it = (o.userData as any).interact;
        const hinge = it.open_type === 'hinge';
        const slide = new THREE.Vector3(...((it.slide as number[]) ?? [0, 0, 0])), axis = new THREE.Vector3(...((it.axis as number[]) ?? [0, 1, 0]));
        const angle = ((it.angle_deg ?? 0) * Math.PI) / 180;
        const [mn, mx] = this.partBounds(o);
        const geom: PartGeom = {
          p0: [o.position.x, o.position.y, o.position.z], q0: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w], s: [o.scale.x, o.scale.y, o.scale.z],
          hinge, axis: [axis.x, axis.y, axis.z], angle, slide: [slide.x, slide.y, slide.z], mn, mx,
        };
        const part: PartRT = { obj: o, hinge, p0: o.position.clone(), q0: o.quaternion.clone(), slide, axis, angle, geom, ob: null };
        const anchor = it.anchor ? new THREE.Vector3(...(it.anchor as [number, number, number])) : new THREE.Vector3(0, 0.3, 0); // posisi simpan loot (ruang lokal furniture)
        const id = (split ? rawId + '#' + pi : rawId) + suffix;
        const [ax, az] = access(rawId);
        const label: string = it.label ?? 'Container';
        const rt: ContainerRT = {
          id, label, level, random, rawId, primary: pi === 0, group, root, parts: [part], anchor, slideKey: !hinge,
          ax, az, openTime: Math.max(0.35, it.open_time ?? 0.5), searchTime: it.search_time ?? 1,
          sfx: /drawer/i.test(label) ? 'drawer' : /cabinet|wardrobe/i.test(label) ? 'cabinet' : /locker/i.test(label) ? 'locker' : 'lid',
          cs: new ContainerState(), content: null, usable: false, baseUsable: false, openMax: 1, partPending: false,
          keyRt: null, by: null, it: null as any,
        };
        rt.it = {
          id, kind: 'container', runScoped: random, reach: 2.1,
          // Key di dalam container yang terbuka tetap diprioritaskan crosshair (lihat InteractionSystem.update)
          prompt: () => rt.cs.prompt(),
          interact: (ctx) => this.toggleContainer(rt, ctx),
        };
        // furniture multi-kompartemen: hanya daun pintu/laci itu sendiri yang bisa dibidik (badan furniture objek biasa)
        const targets = split ? [o] : [root];
        let hasMesh = false; for (const t of targets) t.traverse((m) => { if ((m as THREE.Mesh).isMesh) hasMesh = true; });
        rt.baseUsable = hasMesh && !!part.obj && Number.isFinite(rt.ax) && Number.isFinite(rt.az);
        rt.usable = rt.baseUsable;
        this.ix.register(rt.it, targets);
        group.push(rt); out.push(rt);
      });
    });
    return out;
  }

  /** Bounds lokal (ruang node bagian) dari mesh bagian + anak-anaknya, pada pose tertutup. */
  private partBounds(o: THREE.Object3D): [[number, number, number], [number, number, number]] {
    o.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    const mn: [number, number, number] = [Infinity, Infinity, Infinity], mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    o.traverse((c: any) => {
      if (!c.isMesh || !c.geometry) return;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      const b = c.geometry.boundingBox as THREE.Box3; m.multiplyMatrices(inv, c.matrixWorld);
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { v.set(x, y, z).applyMatrix4(m); for (let k = 0; k < 3; k++) { const q = k === 0 ? v.x : k === 1 ? v.y : v.z; if (q < mn[k]) mn[k] = q; if (q > mx[k]) mx[k] = q; } }
    });
    if (!isFinite(mn[0])) return [[0, 0, 0], [0, 0, 0]];
    return [mn, mx];
  }

  /** Hitung ulang ruang buka container (dinding/furniture lain bisa berubah tiap run atau setelah furniture bergeser). */
  private refreshOpen(rt: ContainerRT) {
    if (rt.cs.isOpen || rt.cs.animating) return; // sedang dipakai: jangan ubah di tengah animasi
    rt.root.updateWorldMatrix(true, false);
    rt.openMax = openLimit(this.cw, rt.level, rt.root.matrixWorld.elements as unknown as number[], rt.parts.map((q) => q.geom), rt.root.name);
    rt.usable = rt.baseUsable && rt.openMax >= 0.5; // terlalu sempit untuk dibuka: bukan lokasi key
  }

  /** Collision bagian terbuka (laci yang keluar / pintu lemari yang terbuka) mengikuti state; tidak diaktifkan selagi pemain tumpang tindih (tanpa jebakan). */
  private syncPartObbs(rt: ContainerRT, player: PlayerState) {
    const full = rt.cs.k >= 1 && rt.cs.want === 1;
    if (!full) { for (const q of rt.parts) if (q.ob) { this.cw.removeObb(q.ob); q.ob = null; } rt.partPending = false; return; }
    rt.root.updateWorldMatrix(true, false);
    const M = rt.root.matrixWorld.elements as unknown as number[];
    let pending = false;
    rt.parts.forEach((q, i) => {
      if (q.ob) return;
      const b = partBox(partMatrix(M, q.geom, rt.openMax), q.geom);
      const near = Math.abs(player.y - levelY(rt.level)) < 2 || player.level === rt.level;
      if (near && partDist(b, player.x, player.z) < CFG.PLAYER_RADIUS + 0.04) { pending = true; return; }
      q.ob = this.cw.addObb({ id: 'part:' + rt.id + ':' + i, cx: b.cx, cz: b.cz, hx: Math.max(0.03, b.hx), hz: Math.max(0.03, b.hz), yaw: b.yaw, level: rt.level, kind: 'part' });
    });
    rt.partPending = pending;
  }

  private setOpen(rt: ContainerRT, k: number) {
    const e = smooth(Math.max(0, Math.min(1, k))) * rt.openMax;
    for (const p of rt.parts) {
      if (p.hinge) { p.obj.quaternion.copy(p.q0).multiply(this.tmpQ.setFromAxisAngle(p.axis, p.angle * e)); }
      else p.obj.position.copy(p.p0).addScaledVector(p.slide, e);
    }
    const kr = rt.keyRt; if (kr && !kr.taken) kr.group.visible = rt.cs.k > 0.6; // key hanya terlihat saat container cukup terbuka
  }
  private resetContainer(rt: ContainerRT) {
    rt.cs.reset(); rt.content = null; rt.by = null; rt.keyRt = null; rt.partPending = false;
    for (const q of rt.parts) { if (q.ob) this.cw.removeObb(q.ob); q.ob = null; }
    this.setOpen(rt, 0);
    this.active.delete(rt);
  }

  /** Buka / tutup container. Pertama kali dibuka = menggeledah (isi ditemukan setelah searchTime). */
  private toggleContainer(rt: ContainerRT, ctx: GameCtx) {
    if (!rt.cs.want && !rt.cs.searching && rt.openMax < 0.3) { ctx.say('BLOCKED', 1200); return; } // terhalang dinding/furniture: tidak boleh menembus
    const act = rt.cs.toggle();
    if (act === 'ignored') return;
    this.ix.invalidate();
    const pos = { x: rt.ax, y: 0.9, z: rt.az };
    this.active.add(rt);
    if (act === 'close') { this.audio?.play((rt.sfx + '_close') as SfxName, { pos }); return; } // key yang belum diambil ikut tersembunyi di dalam
    rt.by = ctx;
    this.audio?.play((rt.sfx + '_open') as SfxName, { pos });
    if (rt.cs.searching) this.audio?.play('search', { pos });
    this.maybeLockerScare(rt);
  }

  // ------------------------------------------------------------------ locker scare (jarang, acak, sekali per locker terpilih)
  private scareHash(id: string): number { // 0..1 deterministik dari seed run + id locker (tidak tergantung urutan pembuatan/pembukaan)
    let h = (this.scareSeed ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  private maybeLockerScare(rt: ContainerRT) {
    if (rt.sfx !== 'locker' || this.scarePending || this.scareFired.has(rt.id) || this.hr) return;
    if (this.scareN >= CFG.SCARE_MAX_PER_RUN || this.clock - this.scareLast < CFG.SCARE_MIN_GAP) return;
    if (this.scareHash(rt.id) >= CFG.SCARE_LOCKER_CHANCE) return; // locker biasa: tidak ada apa-apa
    this.scarePending = true; this.scareFired.add(rt.id);      // ditandai langsung: membuka-menutup berulang tidak memicu lagi
    this.timers.push({ at: this.clock + 0.35 + Math.random() * 0.9, fn: () => this.fireLockerScare(rt) }); // jeda acak: tidak bisa ditebak
  }
  private fireLockerScare(rt: ContainerRT) {
    this.scarePending = false;
    if (!rt.cs.isOpen || this.hr || this.entRt || !this.ent || !this.entMat) { this.scareFired.delete(rt.id); return; } // ditutup/bersembunyi/entity lain aktif: batal tanpa menghabiskan jatah
    rt.root.updateWorldMatrix(true, false);
    const w = rt.root.localToWorld(rt.anchor.clone()), q = rt.root.getWorldQuaternion(new THREE.Quaternion());
    const ry = new THREE.Euler().setFromQuaternion(q, 'YXZ').y, fy = levelY(rt.level);
    this.scareRt = { t: 0, dur: 0.5 + Math.random() * 0.4, x: w.x, z: w.z, ry, fy };
    this.entMat.color.setHex(0xb9b1a3); this.ent.scale.set(0.8, 0.9, 0.8); this.ent.rotation.y = ry; this.ent.position.set(w.x, fy, w.z); this.ent.visible = true; this.entMat.opacity = 0;
    const pos = { x: w.x, y: 1.2, z: w.z };
    this.audio?.play('chain_fall', { pos, vol: 1.0 }); this.audio?.play('entity_whisper', { pos, vol: 0.9 }); this.audio?.play('heartbeat', { vol: 1.2 });
    for (const sl of this.pool) { sl.dimUntil = this.clock + 0.45; sl.dimDepth = 0.06; } // lampu 'tersentak' sesaat (mekanisme dim yang sudah ada)
    this.scareN++; this.scareLast = this.clock;
  }
  private updateScare(dt: number) {
    const e = this.scareRt, g = this.ent; if (!e || !g || !this.entMat) return;
    e.t += dt;
    const lunge = Math.min(1, e.t / 0.14); // menerjang ke depan sangat cepat lalu menghilang
    g.position.set(e.x + Math.sin(e.ry) * 0.32 * lunge, e.fy, e.z + Math.cos(e.ry) * 0.32 * lunge);
    this.entMat.opacity = 0.97 * Math.max(0, Math.min(1, e.t / 0.05, (e.dur - e.t) / 0.22));
    if (e.t >= e.dur) this.hideEntity();
  }

  private finishSearch(rt: ContainerRT) {
    this.ix.invalidate();
    const ctx = rt.by; if (!ctx) return;
    const c = rt.content ?? { type: 'empty' as const };
    if (c.type === 'key') {
      this.spawnKey(rt, c.key as KeyId);
      ctx.say(`FOUND: ${keyDef(c.key)?.label ?? 'Key'}`, 2200);
    } else if (c.type === 'loot') {
      ctx.player.inventory.add(c.item, 1, c.text);
      ctx.say(`FOUND: ${itemLabel(c.item)}`, 2200);
      this.audio?.play('item_pickup');
    } else ctx.say('NOTHING HERE', 1800);
    ctx.changed();
  }

  /** Posisi dunia tempat key muncul (posisi deterministik dari container, tanpa fisika). */
  private keyWorldPos(rt: ContainerRT): THREE.Vector3 {
    const a = rt.anchor.clone();
    if (rt.slideKey) a.addScaledVector(rt.parts[0].slide, rt.openMax);
    a.y += rt.slideKey ? 0.12 : 0.08;
    rt.root.updateWorldMatrix(true, false);
    const w = rt.root.localToWorld(a);
    w.y = Math.max(w.y, levelY(rt.level) + 0.3); // tidak tenggelam di lantai & mudah dibidik
    return w;
  }

  /** Key muncul fisik di dalam container yang terbuka; pemain harus membidik (crosshair) lalu PICK UP. */
  private spawnKey(rt: ContainerRT, id: KeyId) {
    const g = this.makeKeyObject(id);
    const w = this.keyWorldPos(rt);
    g.position.copy(w); g.rotation.y = rt.root.rotation.y;
    const label = keyDef(id)?.label ?? 'Key';
    const k: PickupRT = { group: g, taken: false, base: w.y, it: null as any };
    k.it = {
      id: 'key_' + id, kind: 'key', runScoped: true, reach: CFG.REACH + 0.4, shelter: rt.root,
      prompt: () => (k.taken ? null : 'PICK UP'),
      interact: (ctx) => {
        if (k.taken) return;
        k.taken = true; g.visible = false;
        this.ix.unregister(k.it);          // hilang dari world & tidak bisa dibidik lagi
        this.scene.remove(g);
        ctx.player.inventory.add(id);      // masuk inventory per warna
        ctx.say(`Diambil: ${label}`, 2000);
        this.audio?.play('key_pickup');
        ctx.changed();
      },
    };
    this.scene.add(g); g.updateMatrixWorld(true);
    this.randomObjs.push(g); this.pickups.push(k);
    this.ix.register(k.it, [g]);
    rt.keyRt = k;
  }

  // ------------------------------------------------------------------ run (generate sekali per start/restart)
  /** Spawn aman: dihitung sekali dari map statis (tanpa furniture acak). Titik bawaan dipakai bila aman. */
  private spawnChecked = false;
  private ensureSafeSpawn() {
    if (this.spawnChecked) return; this.spawnChecked = true;
    const md = this.md;
    const found = findSafeSpawn(this.cw, new NavGrid(this.cw, 0, this.fixedObbs), md.spawn);
    if (found && found.moved) {
      this.spawn = { ...md.spawn, x: found.x, z: found.z };
      this.keepouts[0] = { x: found.x, z: found.z, r: 2.6 }; this.must[0] = { x: found.x, z: found.z };
    } else if (!found && dev) console.warn('[game] spawn bawaan tidak valid & tidak ada alternatif; memakai titik bawaan');
  }

  /**
   * Membuat satu run yang DIJAMIN bisa diselesaikan: generate -> validasi -> bila gagal coba seed turunan (jumlah percobaan dibatasi),
   * dan percobaan terakhir memakai layout bawaan map tanpa furniture acak. Tidak pernah crash / looping tanpa batas.
   */
  startRun(seed?: number): RunInfo {
    const base = seed ?? CFG.MAP_SEED ?? newSeed(); // seed BARU tiap run bila MAP_SEED = null
    this.ensureSafeSpawn();
    const MAX = 6;
    let last: { info: RunInfo; problems: string[] } | null = null;
    for (let attempt = 0; attempt <= MAX; attempt++) {
      const sd = attempt === 0 ? base : (Math.imul(base ^ Math.imul(attempt, 0x9e3779b1), 0x85ebca6b) ^ attempt) >>> 0;
      let r: { info: RunInfo; problems: string[] };
      try { r = this.generate(sd, CFG.RANDOMIZE_PROPS && attempt < MAX); }
      catch (e) { r = { info: this.run, problems: ['error generate: ' + String(e)] }; }
      last = r;
      if (r.problems.length === 0) { r.info.attempts = attempt + 1; return this.run = r.info; }
      if (dev) console.warn(`[game] run seed ${sd} ditolak (percobaan ${attempt + 1}): ${r.problems.join('; ')}`);
    }
    return this.run = last!.info; // semua gagal (tidak seharusnya terjadi): tetap jalan dengan layout bawaan map
  }

  private generate(sd: number, randomize: boolean): { info: RunInfo; problems: string[] } {
    const rng = makeRng(sd);
    const md = this.md;

    // bersihkan sisa run sebelumnya
    this.ix.removeWhere((it) => !!it.runScoped);
    for (const o of this.randomObjs) { this.scene.remove(o); }
    this.ix.removeOccluders(this.randomObjs);
    this.randomObjs = []; this.randomContainers = []; this.pickups = [];
    this.cw.removeObbs((o) => o.kind.startsWith('rand-') || o.kind === 'part');
    this.clearDecor();
    for (const c of this.fixedContainers) this.resetContainer(c);
    for (const d of this.doors) { d.t = 0; d.target = 0; d.pend = false; d.closedSfx = true; applyPose(d.obb, d.leaf, 0); d.obb.enabled = true; d.unlocked = !d.d.locked; d.obj.quaternion.copy(d.q0); }
    for (const f of this.flaps) { f.t = 0; f.target = 0; this.poseFlap(f); }
    this.endHide();
    for (const [k, v] of this.hideMap) if (v.random) this.hideMap.delete(k);
    this.beds = [];
    this.active.clear();
    this.resetLocks();
    this.timers = []; this.scarePending = false; this.bo = null; this.fx.reset(); this.lightDim = 1; this.setLightMul(1); this.moving?.h?.stop(); this.moving = null; this.hideEntity();

    // furniture acak (satu kali di sini, bukan per frame)
    let nav = new NavGrid(this.cw, 0, this.fixedObbs);
    let placed: Placement[] = [];
    if (randomize) {
      // kasur di ruang istirahat/kamar: RNG terpisah (urutan RNG furniture & seed tidak berubah), ditempatkan SEBELUM furniture acak agar furniture menghindarinya
      this.beds = generateBeds(nav, makeRng((sd ^ 0x7be5a1c3) >>> 0), { rooms: md.rooms.filter((r) => r.level === 0), spawn: this.spawn, keepouts: this.keepouts, mustReach: this.must });
      const count = rng.int(CFG.MIN_FURNITURE, CFG.MAX_FURNITURE);
      placed = generateFurniture(nav, rng, { rooms: md.rooms.filter((r) => r.level === 0), forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: this.spawn, keepouts: this.keepouts, mustReach: this.must, count });
    }
    this.placements = placed;
    const newObjs: THREE.Object3D[] = [];
    for (const p of placed) {
      const tpl = this.templates[p.kind];
      if (!tpl) continue;
      const o = tpl.clone(true);
      o.visible = true; o.matrixAutoUpdate = true;
      o.traverse((c) => { c.matrixAutoUpdate = true; delete (c.userData as any).__ix; }); // buang sisa tag interaksi dari template
      o.position.set(p.x + p.vx, 0, p.z + p.vz); o.rotation.set(0, p.yaw, 0); o.scale.set(1, 1, 1); o.name = p.id; // kotak collision = bounds mesh; mesh digeser (p.vx, p.vz) agar pas di dalamnya
      this.scene.add(o); o.updateMatrixWorld(true);
      this.randomObjs.push(o); newObjs.push(o);
      this.cw.addObb({ id: p.id, cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, level: 0, kind: 'rand-' + p.kind });
      if (SEARCHABLE.includes(p.kind)) { const made = this.makeContainers(o, '@' + p.id, 0, true, () => [p.ax, p.az]); this.randomContainers.push(...made); made.forEach((c) => this.registerHide(c)); }
    }
    for (const b of this.beds) { const g = this.buildBed(b); newObjs.push(g); this.randomObjs.push(g); this.cw.addObb({ id: b.id, cx: b.x, cz: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, level: 0, kind: 'rand-bed' }); }
    this.ix.addOccluders(newObjs);
    this.baseReach = nav.flood(this.spawn.x, this.spawn.z); // reachability final (sesudah semua furniture)
    this.nav = nav;
    this.mustOk = this.must.filter((m) => nav.reached(m.x, m.z, m.rad ?? 0.25));
    // variasi kondisi ruangan: RNG turunan sendiri (tidak mengubah urutan RNG furniture/key/event)
    const srng = makeRng((sd ^ 0x2c1b3c6d) >>> 0);
    const RS = CFG.ROOM_STATE_ENABLED;
    if (RS) nav = this.initialShifts(srng, nav, srng.int(CFG.ROOM_STATE.shifts[0], CFG.ROOM_STATE.shifts[1]));

    // isi container: key HANYA di container valid (bisa dibuka, terjangkau, posisi key valid), satu per warna (Yellow/Red/Green)
    const all = this.fixedContainers.concat(this.randomContainers);
    for (const c of all) this.refreshOpen(c); // ruang buka tiap container sesuai layout run ini
    const audit = auditPlacements(this.cw, this.fixedObbs, this.placements, this.keepouts); // furniture: tidak menembus dinding/furniture lain, tidak di area bebas
    const keyIds = KEY_IDS.slice(0, CFG.REQUIRED_KEYS);
    const info = new Map<string, SlotInfo>();
    const slots: ContainerSlot[] = [];
    for (const c of all) {
      const kp = this.keyWorldPos(c);
      const si: SlotInfo = { id: c.id, level: c.level, ax: c.ax, az: c.az, keyPos: { x: kp.x, y: kp.y, z: kp.z }, usable: c.usable };
      info.set(c.id, si);
      if (!c.primary) continue; // slot isi tetap 1 per furniture (kompartemen lain kosong), tetapi dibuka/ditutup mandiri
      if (c.level === 0 && !nav.reached(c.ax, c.az, 1.6)) continue; // container yang tak terjangkau tidak dipakai
      if (c.level === 1 && !this.reach1.has(c.rawId)) continue; // lantai 2: hanya yang terjangkau dari tangga (bukan ruang tersegel)
      slots.push({ id: c.id, x: c.ax, z: c.az, level: c.level });
    }
    this.accessPts = slots.filter((s) => s.level === 0).map((s) => ({ x: s.x, z: s.z }));
    const keySlots = slots.filter((s) => !slotProblem(this.cw, nav, info.get(s.id)!)); // hanya slot yang lolos validasi
    // lantai 0 diutamakan; mezzanine hanya bila lantai 0 kurang (assignContents), dan tangga harus terjangkau
    const ladderOk = !md.ladder || nav.reached(md.ladder.bottom[0], md.ladder.bottom[2], 1.0);
    const usableSlots = keySlots.filter((s) => s.level === 0 || ladderOk);
    let contents = new Map<string, Content>(), problems: string[] = [];
    // pilih ulang penempatan key (hanya key-nya, bukan seluruh layout) bila validasi gagal; jumlah percobaan dibatasi
    for (let t = 0; t < 4; t++) {
      contents = assignContents(usableSlots, rng, keyIds, this.spawn, CFG.MIN_BATTERY_PICKUPS);
      const placedKeys: { key: string; slot: SlotInfo }[] = [];
      contents.forEach((c, id) => { if (c.type === 'key') placedKeys.push({ key: c.key, slot: info.get(id)! }); });
      problems = validateRun({ cw: this.cw, nav, spawn: this.spawn, exitInside: { x: md.exit.insideX, z: md.exit.insideZ }, required: keyIds.slice(), keys: placedKeys, ladderReachable: ladderOk });
      if (problems.length === 0) break;
    }
    if (audit.length) problems = problems.concat(audit.slice(0, 6).map((a) => 'penempatan: ' + a));
    const keyIdsAt: string[] = [], keyAt: Record<string, string> = {};
    for (const c of all) {
      c.content = contents.get(c.id) ?? { type: 'empty' };
      if (c.content.type === 'key') { keyIdsAt.push(c.id); keyAt[c.content.key] = c.id; }
    }

    this.roomMul = {};
    if (RS) {
      const reach = new Set(slots.map((s) => s.id));
      const st = planRoomState({
        rng: srng, cfg: CFG.ROOM_STATE, spawn: this.spawn, exit: { x: md.exit.insideX, z: md.exit.insideZ },
        doors: this.doors.map((d) => ({ cx: d.d.cx, cz: d.d.cz, level: d.d.level, type: d.d.type, locked: d.d.locked })),
        lights: this.lightSrcs.map((l) => ({ x: l.pos.x, z: l.pos.z })),
        containers: all.filter((c) => c.content?.type === 'empty' && reach.has(c.id)).map((c) => ({ id: c.id, x: c.ax, z: c.az })), // hanya yang kosong: key/loot tidak pernah dilewati
      });
      this.applyRoomState(st, all);
    }

    // Almond Water di lantai (fitur lama), di titik bebas & terjangkau
    const spots = pickFreeSpots(nav, rng, CFG.ALMOND_COUNT, this.spawn, 2.5, this.keepouts);
    spots.forEach((s, i) => this.addPickup(s.x, s.z, i));
    this.buildDecor(sd, nav);

    // event horor: RNG sendiri dari seed -> jadwal/jenis event reproducible
    this.evRng = makeRng((sd ^ 0x5bd1e995) >>> 0);
    this.sched = new EventScheduler(this.evRng);
    this.scareSeed = sd; this.scareFired.clear(); this.scareN = 0; this.scarePending = false; this.scareRt = null; this.scareLast = this.clock + CFG.SCARE_COOLDOWN_START - CFG.SCARE_MIN_GAP; // scare locker: pilihan = hash(seed, id) -> reproducible; run baru = state bersih
    this.distT = this.evRng.range(15, 40);

    const run: RunInfo = { seed: sd, furniture: placed.length, keyContainers: keyIdsAt, keyAt, containers: slots.length, attempts: 1 };
    return { info: run, problems };
  }

  private addPickup(x: number, z: number, i: number) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.pickGeo, this.pickMat));
    g.add(new THREE.Mesh(this.pickHitGeo, this.pickHitMat)); // area bidik lebih besar dari botolnya
    g.position.set(x, 0.5, z);
    const rt: PickupRT = { group: g, taken: false, base: 0.5, it: null as any };
    rt.it = {
      id: 'almond_' + i, kind: 'pickup', runScoped: true, prompt: () => (rt.taken ? null : 'PICK UP'),
      interact: (ctx) => {
        if (rt.taken) return;
        rt.taken = true; g.visible = false; this.ix.unregister(rt.it);
        ctx.player.inventory.add('almond_water'); ctx.say('Diambil: Almond Water', 1800); this.audio?.play('item_pickup'); ctx.changed();
      },
    };
    this.scene.add(g); g.updateMatrixWorld(true);
    this.randomObjs.push(g);
    this.ix.register(rt.it, [g]);
    this.pickups.push(rt);
  }

  // ------------------------------------------------------------------ per frame
  private pl: PlayerState | null = null;
  private buzzG = 1;

  update(dt: number, t: number, player: PlayerState, cam: THREE.Camera, ctx: GameCtx, playing = true) {
    this.clock += dt; this.pl = player; this.camPos.copy(cam.position);
    if (this.hr) this.hideTick(dt, player);
    // timer tertunda (event, gembok)
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.clock);
      if (due.length) { this.timers = this.timers.filter((x) => x.at > this.clock); due.forEach((x) => x.fn()); }
    }
    // pintu: animasi halus + collision sinkron dengan daun (hanya pintu yang bergerak / menunggu yang diproses)
    for (const d of this.doors) if (d.t !== d.target || d.pend || !d.closedSfx) this.stepDoor(d, dt, player);
    for (const f of this.flaps) if (f.t !== f.target) this.stepFlap(f, dt);
    // container: animasi buka/tutup + proses mencari
    if (this.active.size) this.active.forEach((rt) => {
      const far = Math.hypot(player.x - rt.ax, player.z - rt.az) > CFG.REACH + 2.5;
      const r = rt.cs.update(dt, rt.openTime, rt.searchTime, far);
      this.setOpen(rt, rt.cs.k);
      this.syncPartObbs(rt, player);
      if (r === 'found') this.finishSearch(rt);
      if (!rt.cs.animating && !rt.partPending) this.active.delete(rt);
    });
    // key / Almond Water: berputar & melayang
    for (const p of this.pickups) if (!p.taken) { p.group.rotation.y += dt * 1.5; p.group.position.y = p.base + Math.sin(t / 400 + p.group.position.x) * 0.04; p.group.updateMatrixWorld(true); }
    // animasi gembok jatuh & rantai lepas
    for (const l of this.locks) if (l.fall > 0 && l.group.visible) {
      l.fall += dt; l.group.position.y -= 2.5 * l.fall * dt; l.group.rotation.z += dt * 5;
      if (l.fall > 0.7) l.group.visible = false;
    }
    if (this.chainFall > 0 && this.chainMesh) {
      this.chainFall += dt; this.chainMesh.position.y -= 3 * this.chainFall * dt;
      if (this.chainFall > 0.9) this.chainMesh.visible = false;
    }
    // lampu mati-nyala (event)
    if (this.bo) {
      const b = this.bo; b.t += dt;
      while (b.i < b.steps.length && b.t >= b.steps[b.i][0]) { b.t -= b.steps[b.i][0]; b.i++; }
      if (b.i >= b.steps.length) { this.bo = null; this.setLightMul(1); } else this.setLightMul(b.steps[b.i][1]);
    }
    this.updateLights(dt, player);
    // event horor acak (jarang, tak terduga, selalu aman)
    if (playing && this.sched) this.sched.update(dt, (type) => this.tryEvent(type, player));
    this.updateMoving(dt, player);
    this.updateEntity(dt); this.updateScare(dt);
    // audio ambience / buzz posisional / suara jauh
    if ((this.audioT -= dt) <= 0) { this.audioT = 0.5; this.audioTick(player); }
    const g = this.lightMul > 0.5 ? 1 : 0;
    if (g !== this.buzzG) { this.buzzG = g; for (const v of this.buzzVoices) v.h?.setGain(g); this.ambH?.setGain(g ? 1 : 0.45); } // lampu mati: hum hilang, ambience lebih sunyi
    // interaksi: crosshair -> raycast (throttled)
    this.ix.update(cam, ctx);
  }

  private updateLights(dt: number, p: PlayerState) {
    if (!this.pool.length || !this.lightSrcs.length) return;
    this.lightT -= dt;
    const py = p.y + 1.6;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      const sorted = this.lightSrcs.map((s, i) => ({ s, i, d: (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 + (s.pos.y - py) ** 2 + (Math.abs(s.pos.y - py) > 2.6 ? 1e4 : 0) })).sort((a, b) => a.d - b.d);
      this.nearIdx = sorted.slice(0, 8).filter((e) => e.d < 400).map((e) => e.i); // kandidat event: hanya lampu yang benar-benar terlihat pemain
      // Penugasan slot STABIL: lampu yang masih dekat tetap dipegang slotnya (tidak lompat saat pemain bergerak). Lampu yang menjauh
      // di-fade-out dulu (gain -> 0), baru slotnya dipindah ke lampu baru yang fade-in. Tidak ada lampu yang 'tiba-tiba' menyala/mati karena langkah pemain.
      const K = this.pool.length, rank = new Map<number, number>();
      sorted.forEach((e, r) => { if (e.d < 900) rank.set(e.i, r); });
      for (const slot of this.pool) if (slot.src) slot.leaving = (rank.get(slot.idx) ?? 1e9) >= K + 2; // histeresis: dilepas bila peringkat >= K+2; kembali dekat sebelum selesai fade -> batal dilepas
      const held = new Set<number>(); for (const slot of this.pool) if (slot.src && !slot.leaving) held.add(slot.idx);
      const want = sorted.slice(0, K).filter((e) => e.d < 900 && !held.has(e.i));
      let wi = 0;
      for (const slot of this.pool) {
        if (wi >= want.length) break;
        if (!slot.src || (slot.leaving && slot.gain < 0.03)) {
          const e = want[wi++], ns = e.s;
          slot.src = ns; slot.idx = e.i; slot.leaving = false; slot.gain = slot.src && !this.poolInit ? 1 : 0; // pengisian awal langsung menyala, selanjutnya fade-in
          slot.light.position.copy(ns.pos); slot.light.color.copy(ns.color); slot.light.distance = ns.range;
        }
      }
      this.poolInit = true;
    }
    this.fx.update(dt, this.nearIdx, !!this.bo || this.lightMul < 1); // event lampu lokal acak (jarang); jeda saat blackout global
    let dim = 0, w = 0;
    const gk = Math.min(1, dt * 3.2); // fade ~0.3 dtk
    this.pool.forEach((slot, k) => {
      const s = slot.src;
      if (!s) { slot.light.intensity = 0; return; }
      slot.gain += ((slot.leaving ? 0 : 1) - slot.gain) * gk;
      if (s.flicker && this.clock > slot.next) { // lampu rusak: kedip acak (jeda, kedalaman, durasi berubah-ubah)
        slot.next = this.clock + this.fx.faultyGap();
        const d = this.fx.faultyDip(s.chance);
        if (d) { slot.dimUntil = this.clock + d.dur; slot.dimDepth = d.depth; }
      }
      const lv = this.fx.level(slot.idx) * (this.clock < slot.dimUntil ? slot.dimDepth : 1);
      slot.light.intensity = s.intensity * lv * this.lightMul * slot.gain;
      const wt = k === 0 ? 2 : 1; dim += lv * wt; w += wt; // lampu terdekat paling berpengaruh pada rasa gelap ruangan
    });
    this.lightDim = w ? dim / w : 1;
    this.applyFixture();
  }

  private setLightMul(m: number) {
    this.lightMul = m;
    this.applyFixture();
  }

  /** Panel lampu (satu material bersama) + ambient mengikuti blackout global DAN redupnya lampu terdekat; update hanya bila berubah. */
  private applyFixture() {
    const em = this.lightMul * (0.2 + 0.8 * this.lightDim);
    if (Math.abs(em - this.lastEm) < 0.01) return;
    this.lastEm = em;
    for (const f of this.fixtureMats) f.m.emissiveIntensity = f.base * (0.04 + 0.96 * em);
  }

  // ------------------------------------------------------------------ audio ambience
  private audioTick(p: PlayerState) {
    const a = this.audio; if (!a || !a.isReady()) return;
    if (!this.ambH) this.ambH = a.start('ambient', { vol: CFG.AMBIENCE_VOLUME });
    // buzz lampu: hanya 2 sumber terdekat yang aktif (hemat suara di HP)
    const py = p.y + 1.6;
    const near = this.buzzHooks.map((h, i) => ({ i, d: (h.x - p.x) ** 2 + (h.y - py) ** 2 + (h.z - p.z) ** 2 })).sort((x, y) => x.d - y.d).slice(0, 2);
    near.forEach((e, k) => {
      const v = this.buzzVoices[k], h = this.buzzHooks[e.i];
      if (!v.h) { v.h = a.start('buzz', { pos: h, vol: CFG.BUZZ_VOLUME }); v.hook = e.i; if (v.h) v.h.setGain(this.buzzG); }
      else if (v.hook !== e.i) { v.h.setPos(h.x, h.y, h.z); v.hook = e.i; }
    });
    // suara acak jauh (interval 25-70 dtk dari seed)
    if (this.distHooks.length && (this.distT -= 0.5) <= 0) {
      this.distT = this.evRng.range(25, 70);
      const far = this.distHooks.filter((h) => { const d = Math.hypot(h.x - p.x, h.z - p.z); return d > 9 && d < 28 && Math.abs(h.y - (p.y + 1.6)) < 6; }); // tidak terlalu dekat (bukan 'jauh' lagi) & tidak di luar jangkauan
      if (far.length) a.play('distant', { pos: this.evRng.pick(far) });
    }
  }

  // ------------------------------------------------------------------ event horor
  private tryEvent(type: EventType, p: PlayerState): boolean {
    if (this.bo || this.moving || this.entRt) return false; // satu event pada satu waktu
    for (const c of this.active) if (c.cs.searching) return false; // jangan mengganggu saat pemain sedang menggeledah
    switch (type) {
      case 'lights': return this.evLights();
      case 'door': return this.evDoor(p);
      case 'furniture': return this.evFurniture(p);
      case 'entity': return this.evEntity(p);
    }
  }

  private evLights(): boolean {
    const hold = this.evRng.range(1.3, 3.0);
    const steps: [number, number][] = [[0.05, 0.3], [0.05, 1], [0.05, 0], [hold, 0], [0.05, 1], [0.07, 0], [0.05, 1], [0.13, 0], [0.04, 1], [0.11, 0], [0.15, 1], [0.1, 0], [0.05, 1]];
    this.bo = { steps, i: 0, t: 0 };
    this.audio?.play('lights_off');
    this.timers.push({ at: this.clock + 0.15 + hold, fn: () => this.audio?.play('lights_on') });
    return true;
  }

  private evDoor(p: PlayerState): boolean {
    if (p.level !== 0) return false;
    const c = this.doors.filter((d) => d.d.type === 'door' && !d.d.locked && d.d.level === 0 && d.t === 0 && d.target === 0 && (() => { const dd = Math.hypot(d.d.cx - p.x, d.d.cz - p.z); return dd > 4 && dd < 16; })());
    if (!c.length) return false;
    const d = this.evRng.pick(c);
    d.target = 1; d.closedSfx = false;
    this.audio?.play('door_open', { pos: this.doorPos(d.d) });
    this.timers.push({ at: this.clock + this.evRng.range(2.5, 5), fn: () => this.closeEventDoor(d, 0) });
    return true;
  }

  private closeEventDoor(d: DoorRT, tries: number) {
    if (d.target !== 1) return; // pemain sudah menutupnya sendiri
    const p = this.pl;
    const near = p && p.level === d.d.level && (leafDist(d.leaf, 0, p.x, p.z) < CFG.PLAYER_RADIUS + 0.9);
    if (near) { if (tries < 8) this.timers.push({ at: this.clock + 1.5, fn: () => this.closeEventDoor(d, tries + 1) }); return; } // jangan menutup di depan/di atas pemain
    d.target = 0; d.closedSfx = false; // suara 'door_close' diputar saat pintu benar-benar menutup (lihat stepDoor)
  }

  private shiftPlan(q: Placement, dx: number, dz: number) {
    return planShift({
      cw: this.cw, fixed: this.fixedObbs, placements: this.placements, q, dx, dz, keepouts: this.keepouts, spawn: this.spawn, baseReach: this.baseReach,
      pickups: this.pickups.filter((k) => !k.taken).map((k) => ({ x: k.group.position.x, z: k.group.position.z })), mustOk: this.mustOk, accessPts: this.accessPts,
    });
  }

  /** Furniture bergeser 25-50 cm. Divalidasi ulang dengan flood-fill: tidak boleh menutup jalan, key, container, exit. */
  private evFurniture(p: PlayerState): boolean {
    if (p.level !== 0 || !this.nav) return false;
    const box = (x: number, z: number, q: Placement) => ({ cx: x, cz: z, hx: q.hx, hz: q.hz, cos: Math.cos(q.yaw), sin: Math.sin(q.yaw) });
    const cands: Placement[] = [];
    for (const q of this.placements) {
      const dist = CollisionWorld.distToObb(box(q.x, q.z, q), p.x, p.z);
      if (dist < 3.5 || dist > 20) continue; // jangan di dekat pemain; harus masih terdengar
      const cs = this.randomContainers.filter((c) => c.id.endsWith('@' + q.id));
      if (cs.some((c) => c.cs.isOpen || c.content?.type === 'key')) continue; // container berisi key / sedang terbuka tidak pernah dipindah
      if (!this.randomObjs.some((o) => o.name === q.id)) continue;
      cands.push(q);
    }
    if (!cands.length) return false;
    const q = this.evRng.pick(cands);
    const amt = this.evRng.range(0.25, 0.5) * (this.evRng.chance(0.5) ? 1 : -1);
    const dx = Math.cos(q.yaw) * amt, dz = -Math.sin(q.yaw) * amt; // geser menyamping (sumbu lokal X)
    const plan = this.shiftPlan(q, dx, dz);
    if (!plan) return false;
    const { nav, n } = plan;
    const obj = this.randomObjs.find((o) => o.name === q.id), obb = this.cw.obbs.find((o) => o.id === q.id);
    if (!obj || !obb) return false;
    const h = this.audio?.start('furniture_scrape', { pos: { x: q.x, y: 0.6, z: q.z } }) ?? null;
    this.moving = { obj, p: q, obb, x0: q.x, z0: q.z, dx, dz, t: 0, dur: 1.7, h };
    this.nav = nav; this.baseReach = n;
    return true;
  }

  private updateMoving(dt: number, player: PlayerState) {
    const m = this.moving; if (!m) return;
    m.t += dt;
    let k = smooth(Math.min(1, m.t / m.dur));
    // pemain mendekat saat bergerak: berhenti di posisi sekarang (jangan sampai menjepit pemain)
    if (k < 1 && player.level === 0 && CollisionWorld.distToObb(m.obb, player.x, player.z) < CFG.PLAYER_RADIUS + 0.6) { m.dx *= k; m.dz *= k; m.t = m.dur; k = 1; m.h?.stop(); }
    const x = m.x0 + m.dx * (m.t >= m.dur ? 1 : k), z = m.z0 + m.dz * (m.t >= m.dur ? 1 : k);
    m.obj.position.x = x + m.p.vx; m.obj.position.z = z + m.p.vz; m.obj.updateMatrixWorld(true);
    m.obb.cx = x; m.obb.cz = z;
    if (m.t >= m.dur) {
      const p = m.p; p.x = x; p.z = z; p.ax += m.dx; p.az += m.dz;
      for (const c of this.randomContainers) if (c.id.endsWith('@' + p.id)) { c.ax += m.dx; c.az += m.dz; }
      this.moving = null;
      for (const c of this.fixedContainers.concat(this.randomContainers)) if (c.level === 0 && Math.hypot(c.ax - p.x, c.az - p.z) < 4) this.refreshOpen(c); // geser bisa menyempitkan ruang buka tetangga
    } else m.h?.setPos(x, 0.6, z);
  }

  private buildEntity() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x040302, transparent: true, opacity: 0, depthWrite: false });
    const body = new THREE.CapsuleGeometry(0.15, 0.95, 3, 8), head = new THREE.SphereGeometry(0.125, 8, 6), arm = new THREE.CylinderGeometry(0.028, 0.022, 0.95, 5), leg = new THREE.CylinderGeometry(0.06, 0.04, 0.85, 5);
    this.hwGeos.push(body, head, arm, leg); this.hwMats.push(mat);
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); };
    add(body, 0, 1.22); add(head, 0, 1.92); add(arm, -0.22, 1.18, 0, 0.08); add(arm, 0.22, 1.18, 0, -0.08); add(leg, -0.09, 0.43); add(leg, 0.09, 0.43);
    g.visible = false; g.frustumCulled = false;
    this.scene.add(g); this.ent = g; this.entMat = mat;
  }

  /** Bayangan melintas sekilas di area terbuka, jauh dari pemain, tanpa collision (tidak mengganggu gameplay). */
  private evEntity(p: PlayerState): boolean {
    if (p.level !== 0 || !this.ent || this.scareRt) return false;
    const rng = this.evRng;
    for (let tries = 0; tries < 20; tries++) {
      const a = p.yaw + rng.range(-0.7, 0.7), dist = rng.range(6.5, 11);
      const mx = p.x - Math.sin(a) * dist, mz = p.z - Math.cos(a) * dist;
      const sg = rng.chance(0.5) ? 1 : -1, lx = Math.cos(a) * sg, lz = -Math.sin(a) * sg, L = 2.6;
      const x0 = mx - lx * L, z0 = mz - lz * L, x1 = mx + lx * L, z1 = mz + lz * L;
      let ok = true;
      for (let s = 0; s <= 1.0001 && ok; s += 0.1) if (this.cw.blocked(x0 + (x1 - x0) * s, z0 + (z1 - z0) * s, 0.25, 0)) ok = false; // jalur harus kosong
      for (let s = 0.1; s < 1 && ok; s += 0.08) if (this.cw.blocked(p.x + (mx - p.x) * s, p.z + (mz - p.z) * s, 0.05, 0)) ok = false; // harus terlihat (tanpa dinding)
      if (!ok) continue;
      const steps = this.audio?.start('entity_steps', { pos: { x: x0, y: 0.4, z: z0 } }) ?? null;
      const whisper = this.audio?.start('entity_whisper', { pos: { x: x0, y: 1.5, z: z0 }, vol: 0.8 }) ?? null;
      this.entRt = { x0, z0, x1, z1, t: 0, dur: (2 * L) / 3.8, steps, whisper };
      this.ent.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      this.ent.position.set(x0, 0, z0); this.ent.visible = true;
      return true;
    }
    return false;
  }

  private updateEntity(dt: number) {
    const e = this.entRt, g = this.ent; if (!e || !g || !this.entMat) return;
    e.t += dt;
    const k = Math.min(1, e.t / e.dur), x = e.x0 + (e.x1 - e.x0) * k, z = e.z0 + (e.z1 - e.z0) * k;
    g.position.set(x, Math.abs(Math.sin(e.t * 9)) * 0.03, z);
    this.entMat.opacity = 0.93 * Math.max(0, Math.min(1, e.t / 0.3, (e.dur - e.t) / 0.35));
    e.steps?.setPos(x, 0.4, z); e.whisper?.setPos(x, 1.5, z);
    if (e.t >= e.dur) this.hideEntity();
  }
  private hideEntity() {
    this.scareRt = null; this.entMat?.color.setHex(0x040302); this.ent?.scale.setScalar(1); // pulihkan tampilan entity biasa setelah scare
    if (this.entRt) { this.entRt.steps?.stop(); this.entRt.whisper?.stop(); }
    this.entRt = null;
    if (this.ent) this.ent.visible = false;
  }

  /** Jenis suara langkah menurut lantai: keramik/beton di bathroom & utility, selain itu karpet. */
  stepSound(p: PlayerState): 'step_tile' | 'step_carpet' {
    if (p.onStairs) return 'step_tile'; // permukaan tangga (beton): tidak ada SFX tangga khusus, pakai langkah keras
    if (p.level !== 0) return 'step_carpet';
    for (const r of this.md.rooms) if (r.level === p.level && p.x >= r.rect.minx && p.x <= r.rect.maxx && p.z >= r.rect.minz && p.z <= r.rect.maxz) return TILE_ROOMS.test(r.type) ? 'step_tile' : 'step_carpet';
    return 'step_carpet';
  }

  /** Gerak pemain (tangga, pintu, furniture, dinding) — satu pintu masuk collision untuk PlayScene. */
  move(p: PlayerState, dx: number, dz: number, R: number) { movePlayer(this.cw, this.md.stair, p, dx, dz, R); }
  /** Tinggi lantai target di bawah pemain (naik/turun tangga bertahap). */
  floorY(p: PlayerState): number { return floorTarget(this.md.stair, p, levelY); }
  canStand(p: PlayerState): boolean { return canStandAt(this.cw, this.md.stair, p, CFG.PLAYER_RADIUS); }
  /** Target interaksi tidak boleh tembus dinding: garis pemain -> titik bidik (container) dicek ke grid dinding. */
  interactBlocked(p: PlayerState): boolean {
    const t = this.ix.current as any;
    if (!t || !t.point || (t.it.kind !== 'container' && t.it.kind !== 'hide') || p.onStairs) return false;
    const dx = t.point.x - p.x, dz = t.point.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.3) return false;
    const k = Math.max(0, d - 0.2) / d;
    return this.cw.segmentBlocked(p.x, p.z, p.x + dx * k, p.z + dz * k, p.level, 0.01);
  }

  /** Pemain berada di zona escape dan pintu exit sudah dibuka. */
  escaped(p: PlayerState): boolean {
    const r = this.md.exit.trigger;
    return !!this.exitRt?.unlocked && this.exitRt.t >= 0.9 && p.level === 0 && p.x >= r.minx && p.x <= r.maxx && p.z >= r.minz && p.z <= r.maxz;
  }

  dispose() {
    this.timers = []; this.bo = null; this.active.clear(); this.moving?.h?.stop(); this.moving = null; this.sched = null;
    this.buzzVoices.forEach((v) => { v.h?.stop(); v.h = null; }); this.ambH?.stop(); this.ambH = null;
    this.hideEntity();
    this.scene.remove(this.root);
    for (const o of this.randomObjs) this.scene.remove(o);
    for (const p of this.pool) this.scene.remove(p.light);
    this.clearDecor();
    this.decorOwn.forEach((g) => g.dispose()); this.decorOwn2.forEach((m) => m.dispose()); Object.values(this.decorGeo).forEach((g) => g?.dispose()); Object.values(this.decorMat).forEach((m) => m?.dispose());
    if (this.lockHw) this.scene.remove(this.lockHw);
    if (this.ent) this.scene.remove(this.ent);
    const geos = new Set<any>(), mats = new Set<any>();
    const gather = (o: any) => { if (o.geometry) geos.add(o.geometry); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x: any) => mats.add(x)); };
    this.root.traverse(gather);
    for (const t of Object.values(this.templates)) t?.traverse(gather); // template/furniture acak berbagi geometri dengan mesh yang sudah digabung
    this.matByName.forEach((m) => mats.add(m));
    this.templates = {};
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
    this.matUp.dispose();
    this.pickGeo.dispose(); this.pickMat.dispose(); this.pickHitGeo.dispose(); this.pickHitMat.dispose(); this.keyHitGeo.dispose();
    this.keyGeos.forEach((g) => g.dispose()); Object.values(this.keyMats).forEach((m) => m.dispose());
    this.hwGeos.forEach((g) => g.dispose()); this.hwMats.forEach((m) => m.dispose());
    this.chainMesh?.dispose();
    this.chairGeos.forEach((g) => g.dispose()); this.chairGeos = [];
    if (this.chairMat) { const cm: any = this.chairMat; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) cm[k]?.dispose(); cm.dispose(); this.chairMat = null; }
    this.ix.clear();
  }
}
