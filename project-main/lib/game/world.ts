import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, type Obb, type ObbIn } from './collision';
import { extractMapData, applyPropNudges, measureFootprints, type MapData, type GltfJson, type DoorDesc } from './mapdata';
import { NavGrid, applyFootprints, swingBox, boxesOverlap, generateFurniture, pickFreeSpots, assignContents, SEARCHABLE, type Placement, type Content, type FurnKind, type ContainerSlot } from './layout';
import { InteractionSystem, type Interactable } from './interaction';
import { makeRng, newSeed, type Rng } from './rng';
import { itemLabel, type PlayerState } from './inventory';
import { KEY_DEFS, KEY_IDS, keyDef, type KeyId } from './keys';
import { EventScheduler, type EventType } from './events';
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

export const levelY = (level: number) => (level === 1 ? 3 : 0);

const TEMPLATE: Record<FurnKind, string> = {
  table: 'Table_Office_01', shelf: 'Shelf_Office_01', desk: 'Desk_Office_01', cabinet: 'Cabinet_Office_01',
  locker: 'Locker_Dark_01', crate: 'Crate_Dark_01', box: 'Crate_Dark_02',
};
const SKIP_OCCLUDER = /^(Decal_|Puddle|Pipe_|Light_|Baseboard|Mirror_|Audio_|Key_Candidate)/;

interface PartRT {
  obj: THREE.Object3D; hinge: boolean; p0: THREE.Vector3; q0: THREE.Quaternion;
  slide: THREE.Vector3; axis: THREE.Vector3; angle: number;
}
interface ContainerRT {
  id: string; label: string; level: number; random: boolean;
  root: THREE.Object3D; parts: PartRT[]; anchor: THREE.Vector3; slideKey: boolean;
  ax: number; az: number; openTime: number; searchTime: number;
  sfx: 'drawer' | 'cabinet' | 'locker' | 'lid';
  cs: ContainerState; content: Content | null;
  usable: boolean;   // punya bagian yang bisa dibuka + mesh yang bisa dibidik (syarat jadi lokasi key)
  keyRt: PickupRT | null; by: GameCtx | null; it: Interactable<GameCtx>;
}
interface DoorRT {
  d: DoorDesc; obj: THREE.Object3D; q0: THREE.Quaternion; t: number; target: 0 | 1; obb: Obb;
  unlocked: boolean; it: Interactable<GameCtx>;
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

  private nodeObj = new Map<number, THREE.Object3D>();
  private nodeByName = new Map<string, THREE.Object3D>();
  private doors: DoorRT[] = [];
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
  private pool: { light: THREE.PointLight; src: LightSrc | null; dimUntil: number; next: number }[] = [];
  private lightT = 0;
  private ladderBottom = new THREE.Vector3();
  private ladderTop = new THREE.Vector3();
  private exitRt: DoorRT | null = null;
  private clock = 0;
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
  private lastMul = 1;
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
    const gltf: any = await new Promise((res, rej) => {
      new GLTFLoader().load(CFG.MAP_URL, res, (e: ProgressEvent) => { if (e.total) onProgress?.(e.loaded / e.total); }, rej);
    });
    const json = gltf.parser.json as GltfJson;
    const nudged = applyPropNudges(json);
    applyFootprints(measureFootprints(json, TEMPLATE)); // footprint furniture acak = bounds nyata GLB (termasuk bagian yang menonjol)
    const md = extractMapData(json);
    const w = new GameWorld(scene, gltf.scene, md);
    w.build(gltf, nudged, json);
    return w;
  }

  private build(gltf: any, nudged: number[], json: GltfJson) {
    const { scene, root, md, cw } = this;
    // peta node-glTF -> objek three
    const assoc: Map<any, any> = gltf.parser.associations;
    root.traverse((o: any) => { const a = assoc.get(o); if (a && a.nodes !== undefined) this.nodeObj.set(a.nodes, o); if (o.name && !this.nodeByName.has(o.name)) this.nodeByName.set(o.name, o); });
    for (const i of nudged) { const o = this.nodeObj.get(i); const t = (json.nodes[i] as any).translation; if (o && t) o.position.set(t[0], t[1], t[2]); }
    scene.add(root);
    root.updateMatrixWorld(true);

    // textures: ringan di HP
    const seenMat = new Set<any>();
    root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (seenMat.has(m)) continue; seenMat.add(m); if (m.map) m.map.anisotropy = 2; if (m.name === 'M_Light' && m.emissive) this.fixtureMats.push({ m, base: m.emissiveIntensity ?? 1 }); }
    });

    // ---- lampu: ganti lampu titik GLB dengan pool kecil (jauh lebih ringan) ----
    const lights: any[] = [];
    root.traverse((o: any) => { if (o.isPointLight) lights.push(o); });
    for (const l of lights) {
      const pos = new THREE.Vector3().setFromMatrixPosition(l.matrixWorld);
      const ud = l.userData || {};
      this.lightSrcs.push({ pos, color: l.color.clone(), intensity: (ud.base_intensity ?? l.intensity) * CFG.LIGHT_SCALE, range: l.distance || 8, flicker: !!ud.flicker, chance: ud.flicker_chance ?? 0.3 });
    }
    this.lightBase = this.lightSrcs.map((s) => ({ i: s.intensity, f: s.flicker, c: s.chance })); // kondisi asli (variasi per run dimulai dari sini)
    for (const l of lights) l.parent?.remove(l);
    for (let i = 0; i < CFG.LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xfff0b0, 0, 8, 2);
      scene.add(light);
      this.pool.push({ light, src: null, dimUntil: 0, next: 0 });
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
    if (md.mezz) cw.walk[1] = { ...md.mezz };
    for (const c of md.colliders) cw.addObb(c.obb);
    this.fixedObbs = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]); // pintu exit disegel untuk nav

    // ---- keepout & titik wajib terjangkau untuk furniture acak ----
    this.keepouts.push({ x: md.spawn.x, z: md.spawn.z, r: 2.6 });
    this.keepouts.push({ x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 });
    if (md.ladder) this.keepouts.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
    this.must.push({ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 });
    for (const d of md.doors) {
      if (d.level !== 0) continue;
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
      const obj = this.nodeObj.get(ri);
      if (!obj) return;
      const lvl = md.containers.find((c) => c.rootIdx === ri)!.level;
      this.fixedContainers.push(...this.makeContainers(obj, '', lvl, false, (id) => { const c = accessById.get(id); return c ? [c.ax, c.az] : [obj.position.x, obj.position.z]; }));
    });

    // ---- tangga ----
    if (md.ladder) {
      this.ladderBottom.set(md.ladder.bottom[0], md.ladder.bottom[1], md.ladder.bottom[2]);
      this.ladderTop.set(md.ladder.top[0], md.ladder.top[1], md.ladder.top[2]);
      const lo = this.nodeObj.get(md.ladder.idx);
      if (lo) {
        const it: Interactable<GameCtx> = {
          id: 'ladder', kind: 'ladder', prompt: () => 'CLIMB',
          interact: (ctx) => {
            const p = ctx.player;
            if (p.level === 0) { p.x = this.ladderTop.x; p.z = this.ladderTop.z; p.level = 1; }
            else { p.x = this.ladderBottom.x; p.z = this.ladderBottom.z; p.level = 0; }
          },
        };
        this.ix.register(it, [lo]);
      }
    }

    // ---- sembunyikan kandidat key bawaan map (key sekarang dibuat dari prefab berwarna & hanya muncul di dalam container) ----
    for (const i of md.keyCandidateIdx) { const o = this.nodeObj.get(i); if (o) o.visible = false; }
    this.buildKeyPrefab();
    this.buildExitLocks();
    this.buildEntity();
    this.buildDecorAssets();

    // ---- titik suara dari map (Audio_Buzz_*, Audio_RandomDistant_*) ----
    root.traverse((o) => {
      const n = o.name || '';
      if (n.startsWith('Audio_Buzz_')) this.buzzHooks.push(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
      else if (n.startsWith('Audio_RandomDistant_')) this.distHooks.push(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
    });

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
    this.fixedContainers.forEach((c) => c.parts.forEach((p) => animated.add(p.obj)));
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (!animated.has(o) && !(o as any).isLight) o.matrixAutoUpdate = false; });
  }

  // ------------------------------------------------------------------ pintu
  private doorPos(d: DoorDesc) { return { x: d.cx, y: 1.2, z: d.cz }; }

  private setupDoor(d: DoorDesc) {
    const obj = this.nodeObj.get(d.leaf);
    if (!obj) return;
    const obb = this.cw.addObb(d.closedObb);
    const rt: DoorRT = { d, obj, q0: obj.quaternion.clone(), t: 0, target: 0, obb, unlocked: !d.locked, it: null as any };
    const isExit = d.type === 'exit_door';
    rt.it = {
      id: d.name, kind: isExit ? 'exit' : 'door',
      prompt: () => (isExit && !rt.unlocked ? 'LOCKED' : rt.target ? 'CLOSE' : 'OPEN'),
      interact: (ctx) => {
        if (isExit && !rt.unlocked) { // exit hanya terbuka bila ketiga gembok (per warna) sudah dibuka
          ctx.say(`Gembok: ${this.locksOpen()}/${this.locks.length}`, 2000);
          this.audio?.play('door_locked', { pos: this.doorPos(d) });
          return;
        }
        this.ix.invalidate();
        if (rt.target === 0) { rt.target = 1; rt.obb.enabled = false; this.audio?.play('door_open', { pos: this.doorPos(d) }); return; }
        // menutup: batalkan bila pemain berdiri di ambang pintu
        if (CollisionWorld.distToObb(rt.obb, ctx.player.x, ctx.player.z) < CFG.PLAYER_RADIUS + 0.25) { ctx.say('BLOCKED', 1200); return; }
        rt.target = 0;
      },
    };
    this.ix.register(rt.it, [obj]);
    this.doors.push(rt);
    if (isExit) this.exitRt = rt;
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
      d.t = 1; d.target = 1; d.obb.enabled = false;
      d.obj.quaternion.copy(d.q0).multiply(this.tmpQ.setFromAxisAngle(this.upAxis, (d.d.openAngle * Math.PI) / 180));
    }
    this.lightSrcs.forEach((s, i) => { const b = this.lightBase[i]; if (b) { s.intensity = b.i; s.flicker = b.f; s.chance = b.c; } });
    for (const i of st.dimLights) { const s = this.lightSrcs[i]; if (s) s.intensity *= 0.45; }
    for (const i of st.flickerLights) { const s = this.lightSrcs[i]; if (s) { s.flicker = true; s.chance = Math.max(s.chance, 0.6); } }
    const open = new Set(st.openContainers);
    for (const c of containers) if (open.has(c.id) && c.content?.type === 'empty') { c.cs.k = 1; c.cs.want = 1; c.cs.searched = true; this.setOpen(c, 1); }
    this.roomMul = st.decorMul;
  }

  // ------------------------------------------------------------------ environmental storytelling
  /** Aset dekor: reuse mesh/material map (noda, kardus, pipa, rambu EXIT, metal) + beberapa geometri kecil buatan sendiri. */
  private buildDecorAssets() {
    const srcOf = (name: string) => {
      let m: THREE.Mesh | null = null;
      this.nodeByName.get(name)?.traverse((c: any) => { if (!m && c.isMesh) m = c; });
      const mesh = m as THREE.Mesh | null;
      return mesh ? { geo: mesh.geometry, mat: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material } : null;
    };
    const stain = srcOf('Decal_Stain_01'), box = srcOf('Box_Util_02'), pipe = srcOf('Pipe_Util_1'), exit = srcOf('Exit_Sign');
    if (stain) this.decorSrc.stain = stain; if (box) this.decorSrc.box = box; if (pipe) this.decorSrc.pipe = pipe; if (exit) this.decorSrc.exit = exit;

    const paper = new THREE.PlaneGeometry(1, 1); paper.rotateX(-Math.PI / 2);
    const can = new THREE.CylinderGeometry(0.5, 0.5, 1, 10); can.translate(0, 0.5, 0);
    const vent = new THREE.BoxGeometry(1, 1, 1);
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
        doors: md.doors.map((d) => ({ cx: d.cx, cz: d.cz, nx: d.nx, nz: d.nz, level: d.level, type: d.type })),
        rooms: md.rooms, planesX: this.planesX, planesZ: this.planesZ,
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
    const N = 28, drops = 3 * 3;
    const chain = new THREE.InstancedMesh(linkGeo, chainMat, N + drops);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1.3, 1, 1), qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const lockX = [-0.42, 0, 0.42], chainY = 1.2;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), x = -0.78 + u * 1.56, y = chainY - 0.05 * Math.sin(Math.PI * u);
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
      if (rt) { rt.unlocked = true; this.timers.push({ at: this.clock + 1.1, fn: () => { rt.target = 1; rt.obb.enabled = false; this.audio?.play('door_open', { pos: this.doorPos(rt.d) }); } }); }
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
      const first = (objs[0].userData as any).interact;
      const parts: PartRT[] = objs.map((o) => {
        const it = (o.userData as any).interact;
        const hinge = it.open_type === 'hinge';
        return {
          obj: o, hinge, p0: o.position.clone(), q0: o.quaternion.clone(),
          slide: new THREE.Vector3(...((it.slide as number[]) ?? [0, 0, 0])),
          axis: new THREE.Vector3(...((it.axis as number[]) ?? [0, 1, 0])),
          angle: ((it.angle_deg ?? 0) * Math.PI) / 180,
        };
      });
      const anchorObj = root.children.find((c) => c.name === objs[0].name + '_LootAnchor') ?? root.children.find((c) => c.name === 'LootAnchor');
      const anchor = anchorObj ? anchorObj.position.clone() : new THREE.Vector3(0, 0.3, 0);
      const id = rawId + suffix;
      const [ax, az] = access(rawId);
      const label: string = first.label ?? 'Container';
      const rt: ContainerRT = {
        id, label, level, random, root, parts, anchor, slideKey: !parts[0].hinge,
        ax, az, openTime: Math.max(0.35, first.open_time ?? 0.5), searchTime: first.search_time ?? 1,
        sfx: /drawer/i.test(label) ? 'drawer' : /cabinet|wardrobe/i.test(label) ? 'cabinet' : /locker/i.test(label) ? 'locker' : 'lid',
        cs: new ContainerState(), content: null, usable: false,
        keyRt: null, by: null, it: null as any,
      };
      rt.it = {
        id, kind: 'container', runScoped: random,
        // Key di dalam container yang terbuka tetap diprioritaskan crosshair (lihat InteractionSystem.update)
        prompt: () => rt.cs.prompt(),
        interact: (ctx) => this.toggleContainer(rt, ctx),
      };
      // meja dengan 2 laci: hanya laci yang bisa dicari (badan meja objek biasa)
      const targets = groups.size > 1 ? objs : [root];
      let hasMesh = false; for (const t of targets) t.traverse((m) => { if ((m as THREE.Mesh).isMesh) hasMesh = true; });
      rt.usable = hasMesh && parts.every((q) => !!q.obj) && Number.isFinite(rt.ax) && Number.isFinite(rt.az);
      this.ix.register(rt.it, targets);
      out.push(rt);
    });
    return out;
  }

  private setOpen(rt: ContainerRT, k: number) {
    const e = smooth(Math.max(0, Math.min(1, k)));
    for (const p of rt.parts) {
      if (p.hinge) { p.obj.quaternion.copy(p.q0).multiply(this.tmpQ.setFromAxisAngle(p.axis, p.angle * e)); }
      else p.obj.position.copy(p.p0).addScaledVector(p.slide, e);
    }
    const kr = rt.keyRt; if (kr && !kr.taken) kr.group.visible = rt.cs.k > 0.6; // key hanya terlihat saat container cukup terbuka
  }
  private resetContainer(rt: ContainerRT) {
    rt.cs.reset(); rt.content = null; rt.by = null; rt.keyRt = null;
    this.setOpen(rt, 0);
    this.active.delete(rt);
  }

  /** Buka / tutup container. Pertama kali dibuka = menggeledah (isi ditemukan setelah searchTime). */
  private toggleContainer(rt: ContainerRT, ctx: GameCtx) {
    const act = rt.cs.toggle();
    if (act === 'ignored') return;
    this.ix.invalidate();
    const pos = { x: rt.ax, y: 0.9, z: rt.az };
    this.active.add(rt);
    if (act === 'close') { this.audio?.play((rt.sfx + '_close') as SfxName, { pos }); return; } // key yang belum diambil ikut tersembunyi di dalam
    rt.by = ctx;
    this.audio?.play((rt.sfx + '_open') as SfxName, { pos });
    if (rt.cs.searching) this.audio?.play('search', { pos });
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
    if (rt.slideKey) a.add(rt.parts[0].slide);
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
    this.cw.removeObbs((o) => o.kind.startsWith('rand-'));
    this.clearDecor();
    for (const c of this.fixedContainers) this.resetContainer(c);
    for (const d of this.doors) { d.t = 0; d.target = 0; d.obb.enabled = true; d.unlocked = !d.d.locked; d.obj.quaternion.copy(d.q0); }
    this.active.clear();
    this.resetLocks();
    this.timers = []; this.bo = null; this.setLightMul(1); this.moving?.h?.stop(); this.moving = null; this.hideEntity();

    // furniture acak (satu kali di sini, bukan per frame)
    let nav = new NavGrid(this.cw, 0, this.fixedObbs);
    let placed: Placement[] = [];
    if (randomize) {
      const count = rng.int(CFG.MIN_FURNITURE, CFG.MAX_FURNITURE);
      placed = generateFurniture(nav, rng, { rooms: md.rooms, spawn: this.spawn, keepouts: this.keepouts, mustReach: this.must, count });
    }
    this.placements = placed;
    const newObjs: THREE.Object3D[] = [];
    for (const p of placed) {
      const tpl = this.nodeByName.get(TEMPLATE[p.kind]);
      if (!tpl) continue;
      const o = tpl.clone(true);
      o.visible = true; o.matrixAutoUpdate = true;
      o.traverse((c) => { c.matrixAutoUpdate = true; delete (c.userData as any).__ix; }); // buang sisa tag interaksi dari template
      o.position.set(p.x + p.vx, 0, p.z + p.vz); o.rotation.set(0, p.yaw, 0); o.scale.set(1, 1, 1); o.name = p.id; // kotak collision = bounds mesh; mesh digeser (p.vx, p.vz) agar pas di dalamnya
      this.scene.add(o); o.updateMatrixWorld(true);
      this.randomObjs.push(o); newObjs.push(o);
      this.cw.addObb({ id: p.id, cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, level: 0, kind: 'rand-' + p.kind });
      if (SEARCHABLE.includes(p.kind)) this.randomContainers.push(...this.makeContainers(o, '@' + p.id, 0, true, () => [p.ax, p.az]));
    }
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
    const keyIds = KEY_IDS.slice(0, CFG.REQUIRED_KEYS);
    const info = new Map<string, SlotInfo>();
    const slots: ContainerSlot[] = [];
    for (const c of all) {
      const kp = this.keyWorldPos(c);
      const si: SlotInfo = { id: c.id, level: c.level, ax: c.ax, az: c.az, keyPos: { x: kp.x, y: kp.y, z: kp.z }, usable: c.usable };
      info.set(c.id, si);
      if (c.level === 0 && !nav.reached(c.ax, c.az, 1.6)) continue; // container yang tak terjangkau tidak dipakai
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
    this.clock += dt; this.pl = player;
    // timer tertunda (event, gembok)
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.clock);
      if (due.length) { this.timers = this.timers.filter((x) => x.at > this.clock); due.forEach((x) => x.fn()); }
    }
    // pintu
    for (const d of this.doors) {
      if (d.t === d.target) continue;
      const rate = dt / (d.d.openTime || 0.7);
      d.t = d.target ? Math.min(1, d.t + rate) : Math.max(0, d.t - rate);
      d.obj.quaternion.copy(d.q0).multiply(this.tmpQ.setFromAxisAngle(this.upAxis, (d.d.openAngle * Math.PI / 180) * smooth(d.t)));
      if (d.t === 0 && d.target === 0) {
        // pemain masuk ambang saat pintu menutup -> buka lagi (jangan sampai terjebak collision)
        if (player.level === d.d.level && CollisionWorld.distToObb(d.obb, player.x, player.z) < CFG.PLAYER_RADIUS + 0.2) { d.target = 1; d.obb.enabled = false; }
        else { d.obb.enabled = true; this.audio?.play('door_close', { pos: this.doorPos(d.d) }); }
      }
    }
    // container: animasi buka/tutup + proses mencari
    if (this.active.size) this.active.forEach((rt) => {
      const far = Math.hypot(player.x - rt.ax, player.z - rt.az) > CFG.REACH + 2.5;
      const r = rt.cs.update(dt, rt.openTime, rt.searchTime, far);
      this.setOpen(rt, rt.cs.k);
      if (r === 'found') this.finishSearch(rt);
      if (!rt.cs.animating) this.active.delete(rt);
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
    this.updateEntity(dt);
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
    const py = levelY(p.level) + 1.6;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      const sorted = this.lightSrcs.map((s) => ({ s, d: (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 + (s.pos.y - py) ** 2 })).sort((a, b) => a.d - b.d);
      this.pool.forEach((slot, i) => {
        const s = sorted[i]?.s ?? null;
        slot.src = s;
        if (s) { slot.light.position.copy(s.pos); slot.light.color.copy(s.color); slot.light.distance = s.range; }
      });
    }
    for (const slot of this.pool) {
      const s = slot.src;
      if (!s) { slot.light.intensity = 0; continue; }
      if (s.flicker && this.clock > slot.next) { slot.next = this.clock + 0.12; if (Math.random() < s.chance * 0.25) slot.dimUntil = this.clock + 0.06 + Math.random() * 0.1; }
      slot.light.intensity = (this.clock < slot.dimUntil ? s.intensity * 0.12 : s.intensity) * this.lightMul;
    }
  }

  private setLightMul(m: number) {
    this.lightMul = m;
    if (Math.abs(m - this.lastMul) < 0.001) return;
    this.lastMul = m;
    for (const f of this.fixtureMats) f.m.emissiveIntensity = f.base * (0.04 + 0.96 * m); // panel lampu ikut padam
  }

  // ------------------------------------------------------------------ audio ambience
  private audioTick(p: PlayerState) {
    const a = this.audio; if (!a || !a.isReady()) return;
    if (!this.ambH) this.ambH = a.start('ambient', { vol: CFG.AMBIENCE_VOLUME });
    // buzz lampu: hanya 2 sumber terdekat yang aktif (hemat suara di HP)
    const py = levelY(p.level) + 1.6;
    const near = this.buzzHooks.map((h, i) => ({ i, d: (h.x - p.x) ** 2 + (h.y - py) ** 2 + (h.z - p.z) ** 2 })).sort((x, y) => x.d - y.d).slice(0, 2);
    near.forEach((e, k) => {
      const v = this.buzzVoices[k], h = this.buzzHooks[e.i];
      if (!v.h) { v.h = a.start('buzz', { pos: h, vol: CFG.BUZZ_VOLUME }); v.hook = e.i; if (v.h) v.h.setGain(this.buzzG); }
      else if (v.hook !== e.i) { v.h.setPos(h.x, h.y, h.z); v.hook = e.i; }
    });
    // suara acak jauh (interval 25-70 dtk dari seed)
    if (this.distHooks.length && (this.distT -= 0.5) <= 0) {
      this.distT = this.evRng.range(25, 70);
      const far = this.distHooks.filter((h) => { const d = Math.hypot(h.x - p.x, h.z - p.z); return d > 9 && d < 28 && Math.abs(h.y - (levelY(p.level) + 1.6)) < 6; }); // tidak terlalu dekat (bukan 'jauh' lagi) & tidak di luar jangkauan
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
    d.target = 1; d.obb.enabled = false;
    this.audio?.play('door_open', { pos: this.doorPos(d.d) });
    this.timers.push({ at: this.clock + this.evRng.range(2.5, 5), fn: () => this.closeEventDoor(d, 0) });
    return true;
  }

  private closeEventDoor(d: DoorRT, tries: number) {
    if (d.target !== 1) return; // pemain sudah menutupnya sendiri
    const p = this.pl;
    const near = p && p.level === d.d.level && (CollisionWorld.distToObb(d.obb, p.x, p.z) < CFG.PLAYER_RADIUS + 0.9);
    if (near) { if (tries < 8) this.timers.push({ at: this.clock + 1.5, fn: () => this.closeEventDoor(d, tries + 1) }); return; } // jangan menutup di depan/di atas pemain
    d.target = 0; // suara 'door_close' diputar saat pintu benar-benar menutup (lihat update)
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
    if (p.level !== 0 || !this.ent) return false;
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
    if (this.entRt) { this.entRt.steps?.stop(); this.entRt.whisper?.stop(); }
    this.entRt = null;
    if (this.ent) this.ent.visible = false;
  }

  /** Jenis suara langkah menurut lantai: keramik/beton di bathroom & utility, selain itu karpet. */
  stepSound(p: PlayerState): 'step_tile' | 'step_carpet' {
    if (p.level !== 0) return 'step_carpet';
    for (const r of this.md.rooms) if (p.x >= r.rect.minx && p.x <= r.rect.maxx && p.z >= r.rect.minz && p.z <= r.rect.maxz) return r.type === 'bathroom' || r.type === 'utility' ? 'step_tile' : 'step_carpet';
    return 'step_carpet';
  }

  /** Pemain berada di zona escape dan pintu exit sudah dibuka. */
  escaped(p: PlayerState): boolean {
    const r = this.md.exit.trigger;
    return !!this.exitRt?.unlocked && p.x >= r.minx && p.x <= r.maxx && p.z >= r.minz && p.z <= r.maxz;
  }

  dispose() {
    this.timers = []; this.bo = null; this.active.clear(); this.moving?.h?.stop(); this.moving = null; this.sched = null;
    this.buzzVoices.forEach((v) => { v.h?.stop(); v.h = null; }); this.ambH?.stop(); this.ambH = null;
    this.hideEntity();
    this.scene.remove(this.root);
    for (const o of this.randomObjs) this.scene.remove(o);
    for (const p of this.pool) this.scene.remove(p.light);
    this.clearDecor();
    Object.values(this.decorGeo).forEach((g) => g?.dispose()); Object.values(this.decorMat).forEach((m) => m?.dispose());
    if (this.lockHw) this.scene.remove(this.lockHw);
    if (this.ent) this.scene.remove(this.ent);
    const geos = new Set<any>(), mats = new Set<any>();
    this.root.traverse((o: any) => { if (o.geometry) geos.add(o.geometry); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x: any) => mats.add(x)); });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
    this.pickGeo.dispose(); this.pickMat.dispose(); this.pickHitGeo.dispose(); this.pickHitMat.dispose(); this.keyHitGeo.dispose();
    this.keyGeos.forEach((g) => g.dispose()); Object.values(this.keyMats).forEach((m) => m.dispose());
    this.hwGeos.forEach((g) => g.dispose()); this.hwMats.forEach((m) => m.dispose());
    this.chainMesh?.dispose();
    this.ix.clear();
  }
}
