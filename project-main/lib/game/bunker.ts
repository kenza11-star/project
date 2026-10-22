// Tampilan 3D ruangan puzzle tersembunyi ("bunker") + palka pintu masuk. Logika & koordinat ada di puzzleroom.ts (murni, dites).
// Saklar = aset pengguna lever_power_switch.glb dipakai APA ADANYA (SkeletonUtils.clone + animasi 'Level_Down' bawaannya); tidak ada model saklar buatan.
// Semua geometri bunker dibuat di sini dari kotak/silinder + tekstur kanvas kecil; static dibekukan (matrixAutoUpdate=false). Tidak menambah PointLight:
// lampu bunker dikirim ke pool lampu world (jumlah light di scene tetap -> tanpa recompile shader).
import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CollisionWorld } from './collision';
import type { InteractionSystem, Interactable } from './interaction';
import type { GameCtx } from './world';
import { applyMaterialEnv } from './materials';
import {
  BK, LAYOUT, PROPS, COLORS, GLYPHS, LEVER_Y, bunkerWalls, inBunker, lampsFor, ORDER_N, CIRC_LEVERS, CIRC_LAMPS, DRUMS, SIMON_COLORS,
  type PuzzleModel, type RoomPuzzle, type HatchSpot, type Mount, type Station,
} from './puzzleroom';

export interface BunkerDeps {
  scene: THREE.Scene; cw: CollisionWorld; ix: InteractionSystem<GameCtx>; hitMat: THREE.Material;
  lever: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
  audio: () => { play(name: any, o?: any): any; alarm(): void } | null;
  press(st: Station, i: number): void; keypad(): void; climb(): void; enter(): void;
}
export interface BunkerLight { x: number; y: number; z: number; c: number; i: number; r: number; flicker: boolean }

const LEVER_SCALE = 0.0023;     // panel saklar ~0,44 m lebar (aset asli 191 satuan lebar; skala seragam, model tidak diubah)
const LEVER_BACK = 18.6 * LEVER_SCALE; // sisi belakang panel (z model -18,6) menempel dinding
const FACE = (m: Mount) => Math.atan2(m.nx, m.nz);

// ---------- tekstur kanvas kecil ----------
let seedN = 1;
const rnd = () => { seedN = (seedN * 1664525 + 1013904223) >>> 0; return seedN / 4294967296; };
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function redraw(t: THREE.CanvasTexture, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = t.image as HTMLCanvasElement, g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height); draw(g, c.width, c.height); t.needsUpdate = true;
}
function noiseBase(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number) {
  const im = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = (rnd() - 0.5) * amp; im.data[i * 4] = base[0] + v; im.data[i * 4 + 1] = base[1] + v; im.data[i * 4 + 2] = base[2] + v * 0.9; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
}
const texConcrete = () => canvasTex(256, 256, (g, w, h) => {
  noiseBase(g, w, h, [74, 78, 72], 38);
  g.strokeStyle = 'rgba(10,12,10,.55)'; g.lineWidth = 2;
  for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let r = 0; r < 4; r++) for (let x = (r % 2) * 64; x <= w; x += 128) { g.beginPath(); g.moveTo(x, r * 64); g.lineTo(x, r * 64 + 64); g.stroke(); }
  for (let i = 0; i < 26; i++) { const x = rnd() * w, y0 = rnd() * h * 0.6, l = 30 + rnd() * 120, gr = g.createLinearGradient(0, y0, 0, y0 + l); gr.addColorStop(0, 'rgba(12,14,8,.5)'); gr.addColorStop(1, 'rgba(12,14,8,0)'); g.fillStyle = gr; g.fillRect(x, y0, 3 + rnd() * 6, l); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,60,30,${0.05 + rnd() * 0.12})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 4 + rnd() * 22, 0, 7); g.fill(); }
}, true);
const texFloor = () => canvasTex(256, 256, (g, w, h) => {
  noiseBase(g, w, h, [46, 47, 45], 30);
  g.strokeStyle = 'rgba(6,6,6,.6)'; g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(20,16,12,${0.1 + rnd() * 0.2})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 30, 4 + rnd() * 20, rnd() * 3, 0, 7); g.fill(); }
}, true);
const texMetal = (rust = 0.5) => canvasTex(128, 128, (g, w, h) => {
  noiseBase(g, w, h, [58, 60, 62], 22);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${110 + rnd() * 40},${50 + rnd() * 20},20,${rust * (0.08 + rnd() * 0.25)})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 14, 0, 7); g.fill(); }
}, true);
const texDoor = () => canvasTex(256, 320, (g, w, h) => {
  noiseBase(g, w, h, [66, 68, 70], 24);
  g.fillStyle = '#c9a21a'; for (let k = -2; k < 12; k++) { g.beginPath(); g.moveTo(k * 28, h); g.lineTo(k * 28 + 14, h); g.lineTo(k * 28 + 14 + 40, h - 40); g.lineTo(k * 28 + 40, h - 40); g.fill(); g.beginPath(); g.moveTo(k * 28, 0); g.lineTo(k * 28 + 14, 0); g.lineTo(k * 28 + 14 + 40, 40); g.lineTo(k * 28 + 40, 40); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 40, w, 4); g.fillRect(0, h - 44, w, 4);
  g.fillStyle = 'rgba(15,15,15,.85)'; for (const [x, y] of [[16, 56], [w - 16, 56], [16, h - 56], [w - 16, h - 56], [w / 2, 56], [w / 2, h - 56]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(140,60,20,.25)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(rnd() * w, 60 + rnd() * (h - 120), 3 + rnd() * 16, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(170,170,160,.8)'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText('SUBSTASIUN 7', w / 2, 100); g.font = 'bold 16px monospace'; g.fillText('AKSES TERBATAS', w / 2, 124);
});
function drawGlyph(g: CanvasRenderingContext2D, id: number, cx: number, cy: number, r: number) {
  g.beginPath();
  switch (id) {
    case 0: g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.95, cy + r * 0.75); g.lineTo(cx - r * 0.95, cy + r * 0.75); g.closePath(); break;
    case 1: g.arc(cx, cy, r * 0.9, 0, 7); break;
    case 2: g.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6); break;
    case 3: g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.75, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.75, cy); g.closePath(); break;
    case 4: for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); break;
    default: { const a = r * 0.85, b = r * 0.28; g.moveTo(cx - b, cy - a); g.lineTo(cx + b, cy - a); g.lineTo(cx + b, cy - b); g.lineTo(cx + a, cy - b); g.lineTo(cx + a, cy + b); g.lineTo(cx + b, cy + b); g.lineTo(cx + b, cy + a); g.lineTo(cx - b, cy + a); g.lineTo(cx - b, cy + b); g.lineTo(cx - a, cy + b); g.lineTo(cx - a, cy - b); g.lineTo(cx - b, cy - b); g.closePath(); }
  }
  g.fill();
}
const ROMAN = ['I', 'II', 'III', 'IV'];
function plateBase(g: CanvasRenderingContext2D, w: number, h: number, c1 = '#2b2d2c', c2 = '#161817') {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(190,190,170,.55)'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 12, 1 + rnd() * 3); }
}
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []; let line = '';
  for (const wd of text.split(' ')) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line); return out;
}

// ---------- tuas dari aset ----------
interface LeverRT { holder: THREE.Group; mixer: THREE.AnimationMixer; act: THREE.AnimationAction; dur: number; k: number; target: number; spring: number }
interface Reg { it: Interactable<GameCtx>; objs: THREE.Object3D[] }
export class Bunker {
  readonly group = new THREE.Group();
  readonly lights: BunkerLight[] = LAYOUT.lights.map((l) => ({ ...l }));
  private geos: THREE.BufferGeometry[] = []; private mats: THREE.Material[] = []; private texs: THREE.Texture[] = [];
  private levers: { s1: LeverRT[]; s2: LeverRT[]; s4: LeverRT[] } = { s1: [], s2: [], s4: [] };
  private moving = new Set<LeverRT>();
  private regs: Reg[] = [];
  private model!: PuzzleModel; private pz!: RoomPuzzle;
  private lampS1: THREE.MeshStandardMaterial[] = []; private lampS2: THREE.MeshStandardMaterial[] = []; private lampS4: THREE.MeshStandardMaterial[] = [];
  private lblS1: THREE.CanvasTexture[] = []; private lblS4: THREE.CanvasTexture[] = [];
  private drumTex: THREE.CanvasTexture[] = []; private digTex: THREE.CanvasTexture[] = [];
  private plaqueTex: THREE.CanvasTexture | null = null; private glyphTex: THREE.CanvasTexture[] = [];
  private keyTex!: THREE.CanvasTexture; private termTex!: THREE.CanvasTexture;
  private door!: THREE.Group; private doorK = 0; private doorTarget = 0; private doorObb: ReturnType<CollisionWorld['addObb']> | null = null;
  private hatch = new THREE.Group(); private hatchReg: Reg | null = null;
  private bulbMats: THREE.MeshStandardMaterial[] = [];
  private play: { step: number; t: number } | null = null; private flash: number[] = [0, 0, 0, 0];
  private ready = false; private clock = 0;
  private glow: THREE.MeshStandardMaterial | null = null;
  private leverGeoMats = new Set<THREE.Material>();

  constructor(private d: BunkerDeps) {
    this.group.name = 'bunker'; this.group.visible = false;
    d.scene.add(this.group); d.scene.add(this.hatch);
    this.build();
    this.ready = true;
  }

  // ---------------------------------------------------------------- bahan
  private mat(o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; }
  private track<T extends THREE.Texture>(t: T): T { this.texs.push(t); return t; }
  private box(w: number, h: number, dd: number, m: THREE.Material, x: number, y: number, z: number, opt: { tile?: number; cast?: boolean; recv?: boolean; parent?: THREE.Object3D; stat?: boolean } = {}): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, dd), uv = g.attributes.uv, tile = opt.tile ?? 0, dims = [[dd, h], [dd, h], [w, dd], [w, dd], [w, h], [w, h]];
    if (tile) for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
    this.geos.push(g);
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = !!opt.cast; me.receiveShadow = opt.recv !== false;
    (opt.parent ?? this.group).add(me); if (opt.stat !== false && !opt.parent) { me.updateMatrix(); me.matrixAutoUpdate = false; }
    return me;
  }
  private cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, rot?: [number, number, number], seg = 12, parent?: THREE.Object3D): THREE.Mesh {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg); this.geos.push(g);
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); if (rot) me.rotation.set(rot[0], rot[1], rot[2]); me.castShadow = true; me.receiveShadow = true;
    (parent ?? this.group).add(me); if (!parent) { me.updateMatrix(); me.matrixAutoUpdate = false; }
    return me;
  }
  private plane(w: number, h: number, m: THREE.Material, mt: Mount, off: number, y: number, parent?: THREE.Object3D): THREE.Mesh {
    const g = new THREE.PlaneGeometry(w, h); this.geos.push(g);
    const me = new THREE.Mesh(g, m); me.position.set(mt.x + mt.nx * off, y, mt.z + mt.nz * off); me.rotation.y = FACE(mt);
    (parent ?? this.group).add(me); if (!parent) { me.updateMatrix(); me.matrixAutoUpdate = false; }
    return me;
  }
  private basic(tex: THREE.Texture, transparent = false): THREE.MeshStandardMaterial { return this.mat({ map: tex, roughness: 0.7, metalness: 0.15, transparent, depthWrite: !transparent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); }
  private lamp(hex: number): THREE.MeshStandardMaterial { return this.mat({ color: new THREE.Color(hex).multiplyScalar(0.25), emissive: hex, emissiveIntensity: 0.05, roughness: 0.4 }); }
  private setLamp(m: THREE.MeshStandardMaterial, hex: number, on: boolean, strong = 1.6) { m.emissive.setHex(hex); m.color.setHex(hex).multiplyScalar(on ? 1 : 0.22); m.emissiveIntensity = on ? strong : 0.04; }

  // ---------------------------------------------------------------- bangun (sekali)
  private build() {
    const { cx, cz, hw, hd, h, t, doorW, doorH, chW, chD } = BK, d = this.d;
    const concrete = texConcrete(), floorT = texFloor(); this.track(concrete); this.track(floorT);
    const wallM = this.mat({ map: concrete, color: 0xb8bdb2, roughness: 0.95, metalness: 0 });
    const floorM = this.mat({ map: floorT, color: 0xa8aaa6, roughness: 0.8, metalness: 0.05 });
    const ceilM = this.mat({ map: concrete, color: 0x6a6e66, roughness: 1, metalness: 0 });
    const metalT = this.track(texMetal(0.7)), rustT = this.track(texMetal(1.6));
    const metalM = this.mat({ map: metalT, roughness: 0.55, metalness: 0.7, color: 0xb0b2b0 });
    const rustM = this.mat({ map: rustT, roughness: 0.75, metalness: 0.5, color: 0xc0a080 });
    const darkM = this.mat({ color: 0x151617, roughness: 0.6, metalness: 0.6 });
    for (const m of [metalM, rustM]) applyMaterialEnv(m, 0.35);

    // lantai, langit-langit, dinding
    const fx = cx - hw - t, fw = (hw + t) * 2, fz = cz - hd - t, fd = (hd + t) * 2;
    this.box(fw, 0.2, fd, floorM, cx, -0.1, cz, { tile: 2.2 });
    this.box(fw, 0.2, fd, ceilM, cx, h + 0.1, cz, { tile: 2.2 });
    for (const w of bunkerWalls()) { const ww = w.maxx - w.minx, wd = w.maxz - w.minz; this.box(ww, h, wd, wallM, (w.minx + w.maxx) / 2, h / 2, (w.minz + w.maxz) / 2, { tile: 2 }); }
    void fx; void fz;
    // lantai & langit-langit bilik + lintel di atas pintu
    const cz1 = cz - hd - t, cz0 = cz1 - chD;
    this.box((chW + t) * 2, 0.2, chD + t, floorM, cx, -0.1, (cz0 + cz1) / 2, { tile: 2.2 });
    this.box((chW + t) * 2, 0.2, chD + t, ceilM, cx, h + 0.1, (cz0 + cz1) / 2, { tile: 2.2 });
    this.box(doorW, h - doorH, t, wallM, cx, doorH + (h - doorH) / 2, cz - hd - t / 2, { tile: 2 });
    // bingkai pintu besi
    this.box(0.18, doorH, t + 0.1, metalM, cx - doorW / 2 - 0.09, doorH / 2, cz - hd - t / 2, {});
    this.box(0.18, doorH, t + 0.1, metalM, cx + doorW / 2 + 0.09, doorH / 2, cz - hd - t / 2, {});
    this.box(doorW + 0.36, 0.18, t + 0.1, metalM, cx, doorH + 0.09, cz - hd - t / 2, {});

    // props & collision
    const gen = PROPS.find((p) => p.id === 'gen')!;
    this.box(gen.hx * 2, 1.1, gen.hz * 2, rustM, gen.cx, 0.55, gen.cz, { cast: true, tile: 1.5 });
    this.box(gen.hx * 2 - 0.3, 0.3, gen.hz * 2 - 0.2, darkM, gen.cx, 1.25, gen.cz, { cast: true });
    for (let k = 0; k < 3; k++) this.cyl(0.22, 0.22, 0.6, metalM, gen.cx - 0.7 + k * 0.7, 1.6, gen.cz, undefined, 14);
    this.cyl(0.07, 0.07, 1.8, darkM, gen.cx + 0.9, 2.0, gen.cz - 0.2, undefined, 8);
    const led = this.mat({ color: 0x300000, emissive: 0xff1a10, emissiveIntensity: 1.2 }); this.box(0.08, 0.08, 0.04, led, gen.cx + 0.8, 0.9, gen.cz + gen.hz + 0.02, { recv: false });
    const desk = PROPS.find((p) => p.id === 'desk')!;
    this.box(desk.hx * 2, 0.08, desk.hz * 2, this.mat({ color: 0x3a2e22, roughness: 0.9 }), desk.cx, 0.78, desk.cz, { cast: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.07, 0.76, 0.07, darkM, desk.cx + sx * (desk.hx - 0.06), 0.38, desk.cz + sz * (desk.hz - 0.06), { cast: true });
    const paper = this.mat({ color: 0xb8b09a, roughness: 1 });
    this.box(0.3, 0.012, 0.4, paper, desk.cx - 0.3, 0.83, desk.cz, { cast: false }); this.box(0.28, 0.012, 0.36, paper, desk.cx + 0.05, 0.84, desk.cz + 0.05, { cast: false });
    this.cyl(0.1, 0.12, 0.04, darkM, desk.cx + 0.55, 0.84, desk.cz - 0.05, undefined, 10); this.cyl(0.015, 0.015, 0.4, darkM, desk.cx + 0.55, 1.04, desk.cz - 0.05, undefined, 6);
    this.box(0.5, 0.45, 0.5, this.mat({ color: 0x2a2724, roughness: 0.9 }), desk.cx - 0.1, 0.22, desk.cz + 0.75, { cast: true }); // kursi menghadap dinding
    const crate = PROPS.find((p) => p.id === 'crate1')!, wood = this.mat({ color: 0x4a3a28, roughness: 0.95 });
    this.box(crate.hx * 2, 1.0, crate.hz * 2, wood, crate.cx, 0.5, crate.cz, { cast: true, tile: 1 }); this.box(crate.hx * 2 - 0.2, 0.7, crate.hz * 2 - 0.2, wood, crate.cx + 0.15, 1.35, crate.cz - 0.1, { cast: true });
    for (const id of ['barrel1', 'barrel2']) { const b = PROPS.find((p) => p.id === id)!; this.cyl(0.3, 0.3, 0.9, rustM, b.cx, 0.45, b.cz, undefined, 14); this.cyl(0.31, 0.31, 0.04, darkM, b.cx, 0.7, b.cz, undefined, 14); }
    // pipa & kabel langit-langit, rantai
    for (const [z, r] of [[cz - 3.9, 0.11], [cz - 3.5, 0.06], [cz + 3.8, 0.13]] as [number, number][]) this.cyl(r, r, hw * 2, rustM, cx, h - 0.25, z, [0, 0, Math.PI / 2], 10);
    for (const x of [cx - 4, cx + 1, cx + 4.5]) this.cyl(0.09, 0.09, 1.4, rustM, x, h - 0.9, cz - 3.9, undefined, 8);
    this.cyl(0.012, 0.012, 1.3, metalM, cx + 1.8, h - 0.65, cz + 0.4, undefined, 5); this.cyl(0.02, 0.02, 0.2, metalM, cx + 1.8, h - 1.4, cz + 0.4, undefined, 5);
    // genangan air (mengkilap)
    const pud = this.mat({ color: 0x050607, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.8 }); applyMaterialEnv(pud, 0.9);
    for (const [x, z, r] of [[cx - 1.5, cz + 2, 0.9], [cx + 2.2, cz - 2.2, 0.6], [cx - 3.8, cz - 2.4, 0.5]] as [number, number, number][]) { const g = new THREE.CircleGeometry(r, 18); this.geos.push(g); const m = new THREE.Mesh(g, pud); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.updateMatrix(); m.matrixAutoUpdate = false; this.group.add(m); }
    // dekal: noda, telapak tangan darah, tulisan stensil, tanda hitungan
    const decal = (w: number, h2: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, mt: Mount, y: number) => { const tx = this.track(canvasTex(256, Math.round(256 * h2 / w), draw)); this.plane(w, h2, this.basic(tx, true), mt, 0.012, y); };
    decal(1.4, 1.0, (g, w2, h2) => { for (let k = 0; k < 7; k++) { const x = 60 + (k % 4) * 50 + rnd() * 20, y = 50 + Math.floor(k / 4) * 90 + rnd() * 25; g.fillStyle = `rgba(95,6,8,${0.55 + rnd() * 0.3})`; g.beginPath(); g.ellipse(x, y, 20, 26, 0, 0, 7); g.fill(); for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(x - 22 + f * 14, y - 36, 5, 14, (f - 1.5) * 0.12, 0, 7); g.fill(); } const gr = g.createLinearGradient(0, y, 0, y + 80); gr.addColorStop(0, 'rgba(90,6,8,.6)'); gr.addColorStop(1, 'rgba(90,6,8,0)'); g.fillStyle = gr; g.fillRect(x - 3, y, 6, 70 + rnd() * 40); } void w2; void h2; }, { x: cx - 1.9, z: cz - hd, nx: 0, nz: 1 }, 1.7);
    decal(1.8, 0.5, (g, w2, h2) => { g.fillStyle = 'rgba(200,190,150,.55)'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText('JANGAN TARIK', w2 / 2, 42); g.fillText('SEMUANYA', w2 / 2, 80); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 0, w2, 2); void h2; }, { x: cx + 5.99, z: cz + 3.9, nx: -1, nz: 0 }, 2.0);
    decal(0.8, 0.8, (g, w2) => { g.strokeStyle = 'rgba(220,210,180,.75)'; g.lineWidth = 3; for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { const x = 25 + k * 14 + r * 0 + (r % 2) * 3, y = 30 + r * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y + 28); g.stroke(); } g.beginPath(); g.moveTo(10, 40); g.lineTo(90, 62); g.stroke(); g.fillStyle = 'rgba(210,200,170,.7)'; g.font = '16px monospace'; g.fillText('hari ke-?', 130, 100); g.fillText('masih ada yang', 130, 130); g.fillText('bernapas di sini', 130, 150); void w2; }, { x: cx - 5.99, z: cz + 4.6, nx: 1, nz: 0 }, 1.5);

    // bola lampu gantung (visual; cahaya dari pool)
    LAYOUT.lights.forEach((l, i) => {
      const m = this.mat({ color: 0x222222, emissive: l.c, emissiveIntensity: 1.6 }); this.bulbMats.push(m);
      const g = new THREE.SphereGeometry(0.07, 8, 6); this.geos.push(g); const me = new THREE.Mesh(g, m); me.position.set(l.x, l.y, l.z); me.updateMatrix(); me.matrixAutoUpdate = false; this.group.add(me);
      if (i < 4) this.cyl(0.008, 0.008, h - l.y, darkM, l.x, l.y + (h - l.y) / 2, l.z, undefined, 4);
    });

    // tangga + palka langit-langit (titik naik)
    { const L = LAYOUT.ladder, x = L.x + 0.12;
      for (const dz of [-0.2, 0.2]) this.box(0.05, h, 0.05, metalM, x, h / 2, L.z + dz, { cast: true });
      for (let k = 0; k < 9; k++) this.box(0.04, 0.04, 0.4, metalM, x, 0.3 + k * 0.3, L.z, { cast: true });
      const hm = this.mat({ color: 0x0a0c0e, emissive: 0x6f7f9a, emissiveIntensity: 0.55 }); this.box(0.9, 0.05, 0.9, hm, x + 0.1, h - 0.02, L.z, { recv: false });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), d.hitMat); this.geos.push(hit.geometry); hit.position.set(x + 0.1, 1.3, L.z); this.group.add(hit);
      this.reg(hit, { id: 'bk_ladder', kind: 'ladder', reach: 2.6, prompt: () => 'CLIMB UP', interact: () => d.climb() });
    }

    // ---- stasiun I: panel daya (west) ----
    const plateM = (tx: THREE.Texture) => this.mat({ map: tx, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.box(0.1, 1.9, 4.6, darkM, LAYOUT.s1[2].x + 0.05, 1.45, LAYOUT.s1[2].z, {});   // papan dasar panel
    LAYOUT.s1.forEach((m, i) => {
      this.levers.s1.push(this.leverAt(m, LEVER_Y, 1, i));
      const lm = this.lamp(0xffffff); this.lampS1.push(lm); const g = new THREE.SphereGeometry(0.045, 10, 8); this.geos.push(g);
      const lamp = new THREE.Mesh(g, lm); lamp.position.set(m.x + m.nx * 0.12, 1.97, m.z + m.nz * 0.12); lamp.updateMatrix(); lamp.matrixAutoUpdate = false; this.group.add(lamp);
      const tx = this.track(canvasTex(256, 80, () => {})); this.lblS1.push(tx); const pl = this.plane(0.36, 0.11, plateM(tx), m, 0.075, 0.93);
      void pl;
      this.regLever(this.levers.s1[i], 1, i, () => (this.pz && !this.pz.doneAt(1) && !this.pz.down1(i) ? 'PULL' : null));
    });
    // ---- stasiun II: sirkuit (east) ----
    this.box(0.1, 1.9, 4.6, darkM, LAYOUT.s2[2].x - 0.05, 1.45, LAYOUT.s2[2].z, {});
    LAYOUT.s2.forEach((m, i) => {
      this.levers.s2.push(this.leverAt(m, LEVER_Y, 2, i));
      const tx = this.track(canvasTex(256, 80, (g, w, h) => { plateBase(g, w, h); g.fillStyle = '#d8d2bc'; g.font = 'bold 54px monospace'; g.textAlign = 'center'; g.fillText('ABCDE'[i], w / 2, 62); })); this.plane(0.36, 0.11, plateM(tx), m, 0.075, 0.93);
      this.regLever(this.levers.s2[i], 2, i, () => (this.pz && !this.pz.doneAt(2) ? 'FLIP' : null));
    });
    { const b = LAYOUT.s2Board, lampsY = 2.28;
      const tx = this.track(canvasTex(512, 128, (g, w, h) => { plateBase(g, w, h); g.fillStyle = '#d8d2bc'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText('SIRKUIT UTAMA - SEMUA LAMPU HARUS MENYALA', w / 2, 112); }));
      this.plane(1.9, 0.5, plateM(tx), b, 0.06, 2.25);
      for (let i = 0; i < CIRC_LAMPS; i++) { const lm = this.lamp(0xffb347); this.lampS2.push(lm); const g = new THREE.SphereGeometry(0.06, 12, 8); this.geos.push(g); const me = new THREE.Mesh(g, lm); me.position.set(b.x + b.nx * 0.1, lampsY + 0.06, b.z + (i - 2) * 0.34); me.updateMatrix(); me.matrixAutoUpdate = false; this.group.add(me); }
    }
    // ---- stasiun III: kotak tromol glif (south) ----
    { const s = LAYOUT.s3, bx = this.box(1.2, 0.8, 0.3, metalM, s.x, 1.35, s.z + s.nz * 0.15, { cast: true });
      void bx;
      for (let k = 0; k < DRUMS; k++) {
        const tx = this.track(canvasTex(128, 128, () => {})); this.drumTex.push(tx);
        const m = this.plane(0.32, 0.32, plateM(tx), { ...s, x: s.x + (k - 1) * 0.38 }, 0.31, 1.35);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.2), d.hitMat); this.geos.push(hit.geometry); hit.position.set(s.x + (k - 1) * 0.38, 1.35, s.z + s.nz * 0.32); this.group.add(hit); void m;
        this.reg(hit, { id: 'bk_drum' + k, kind: 'lock', reach: 2.3, prompt: () => (this.pz && !this.pz.doneAt(3) ? 'TURN' : null), interact: () => { d.audio()?.play('flash_click', { pos: { x: s.x, y: 1.3, z: s.z } }); d.press(3, k); } });
      }
      const lbl = this.track(canvasTex(512, 96, (g, w, h) => { plateBase(g, w, h); g.fillStyle = '#d8d2bc'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText('GEMBOK TANDA  I - II - III', w / 2, 62); }));
      this.plane(1.2, 0.22, plateM(lbl), s, 0.31, 1.85);
    }
    // ---- stasiun IV: metronom (north) ----
    this.box(2.9, 1.9, 0.1, darkM, LAYOUT.s4[1].x + 0.9 + 0.2, 1.4, LAYOUT.s4[0].z + 0.05, {});
    LAYOUT.s4.forEach((m, i) => {
      this.levers.s4.push(this.leverAt(m, LEVER_Y - 0.1, 4, i));
      const lm = this.lamp(0xffffff); this.lampS4.push(lm); const g = new THREE.SphereGeometry(0.075, 12, 8); this.geos.push(g);
      const lamp = new THREE.Mesh(g, lm); lamp.position.set(m.x + m.nx * 0.14, 2.05, m.z + m.nz * 0.14); lamp.updateMatrix(); lamp.matrixAutoUpdate = false; this.group.add(lamp);
      const tx = this.track(canvasTex(128, 64, () => {})); this.lblS4.push(tx); this.plane(0.3, 0.14, plateM(tx), m, 0.075, 0.85);
      this.regLever(this.levers.s4[i], 4, i, () => (this.pz && !this.pz.doneAt(4) ? 'PULL' : null), true);
    });
    { const p = LAYOUT.s4Play, btn = this.mat({ color: 0x3a1010, emissive: 0xff3322, emissiveIntensity: 0.5, roughness: 0.4 });
      const b = this.box(0.2, 0.2, 0.08, btn, p.x, 1.35, p.z + 0.05, {});
      const tx = this.track(canvasTex(128, 64, (g, w, h) => { plateBase(g, w, h); g.fillStyle = '#d8d2bc'; g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.fillText('PLAY', w / 2, 44); })); this.plane(0.3, 0.14, plateM(tx), p, 0.02, 1.1);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.3), d.hitMat); this.geos.push(hit.geometry); hit.position.copy(b.position); hit.position.z += 0.1; this.group.add(hit);
      this.reg(hit, { id: 'bk_play', kind: 'lock', reach: 2.4, prompt: () => (this.pz && !this.pz.doneAt(4) && !this.play ? 'PLAY SEQUENCE' : null), interact: () => this.startPlay() });
      const tl = this.track(canvasTex(512, 96, (g, w, h) => { plateBase(g, w, h); g.fillStyle = '#d8d2bc'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.fillText('METRONOM: TONTON, LALU ULANGI', w / 2, 60); }));
      this.plane(1.9, 0.2, plateM(tl), { x: LAYOUT.s4[1].x + 0.9, z: LAYOUT.s4[0].z, nx: 0, nz: 1 }, 0.12, 2.38);
    }
    // ---- papan digit tiap stasiun ----
    const digAt: { m: Mount; y: number }[] = [
      { m: { ...LAYOUT.s1[2], nx: 1, nz: 0 }, y: 2.35 }, { m: { ...LAYOUT.s2[2] }, y: 2.78 }, { m: { ...LAYOUT.s3 }, y: 2.1 }, { m: { x: LAYOUT.s4[1].x + 0.9, z: LAYOUT.s4[0].z, nx: 0, nz: 1 }, y: 2.7 },
    ];
    digAt.forEach((q, k) => { const tx = this.track(canvasTex(256, 140, () => {})); this.digTex.push(tx); this.plane(0.5, 0.27, this.mat({ map: tx, emissiveMap: tx, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.5 }), q.m, 0.09, q.y); });
    // ---- papan petunjuk (LOG) & papan glif ----
    { const tx = this.track(canvasTex(1024, 720, () => {})); this.plaqueTex = tx; this.plane(1.45, 1.02, plateM(tx), LAYOUT.s1Plaque, 0.03, 1.75); }
    LAYOUT.glyphSlots.forEach((m) => { const tx = this.track(canvasTex(256, 256, () => {})); this.glyphTex.push(tx); this.plane(0.55, 0.55, plateM(tx), m, 0.03, 1.55); });

    // ---- pintu besi + panel kode ----
    this.door = new THREE.Group(); this.door.position.set(LAYOUT.door.x, doorH / 2, LAYOUT.door.z); this.group.add(this.door);
    const dt = this.track(texDoor()), dm = this.mat({ map: dt, roughness: 0.5, metalness: 0.75 }); applyMaterialEnv(dm, 0.4);
    const leaf = new THREE.BoxGeometry(doorW, doorH, 0.2); this.geos.push(leaf); const lm = new THREE.Mesh(leaf, [metalM, metalM, metalM, metalM, dm, dm] as any); lm.castShadow = true; lm.receiveShadow = true; this.door.add(lm);
    this.box(0.4, 0.55, 0.06, darkM, 0.62, -0.2, 0.12, { parent: this.door, stat: false });
    this.keyTex = this.track(canvasTex(256, 192, () => {}));
    { const g = new THREE.PlaneGeometry(0.34, 0.255); this.geos.push(g); const sm = this.mat({ map: this.keyTex, emissiveMap: this.keyTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 }); const s = new THREE.Mesh(g, sm); s.position.set(0.62, -0.1, 0.156); this.door.add(s); }
    { const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), d.hitMat); this.geos.push(hit.geometry); hit.position.set(0.62, -0.2, 0.2); this.door.add(hit);
      this.reg(hit, { id: 'bk_keypad', kind: 'lock', reach: 2.4, prompt: () => (this.doorTarget === 0 ? 'ENTER CODE' : null), interact: () => d.keypad() }); }
    this.doorObb = d.cw.addObb({ id: 'bunker-door', cx: LAYOUT.door.x, cz: LAYOUT.door.z, hx: doorW / 2, hz: 0.2, yaw: 0, level: 0, kind: 'fixed' });
    // bilik: terminal
    { this.termTex = this.track(canvasTex(512, 256, () => {})); const t0 = LAYOUT.terminal;
      this.box(1.8, 1.1, 0.5, darkM, t0.x, 0.55, t0.z - 0.1, { cast: true });
      const sm = this.mat({ map: this.termTex, emissiveMap: this.termTex, emissive: 0xffffff, emissiveIntensity: 1.1 }); this.plane(1.5, 0.75, sm, { x: t0.x, z: t0.z + 0.17, nx: 0, nz: 1 }, 0.0, 1.45);
      this.box(2.0, 1.9, 0.12, darkM, t0.x, 1.45, t0.z - 0.1 - 0.2, {}); }
    // collider tetap
    for (const p of PROPS) d.cw.addObb({ id: 'bunker-' + p.id, cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, yaw: 0, level: 0, kind: 'fixed' });
    for (const g of [this.group, this.hatch]) g.updateMatrixWorld(true);
    this.buildHatch();
  }

  /** Palka di lantai bangunan: pelat baja datar + cincin + celah merah samar (petunjuk halus bagi yang jeli). Dipindah tiap run. */
  private buildHatch() {
    const metal = this.mat({ map: this.track(texMetal(1.2)), roughness: 0.5, metalness: 0.8, color: 0x9a9c9a }); applyMaterialEnv(metal, 0.3);
    const glow = this.glow = this.mat({ color: 0x200000, emissive: 0xff2a14, emissiveIntensity: 0.9 });
    const dark = this.mat({ color: 0x101112, roughness: 0.7, metalness: 0.6 });
    this.box(0.9, 0.04, 0.9, dark, 0, 0.012, 0, { parent: this.hatch }); this.box(0.8, 0.05, 0.8, metal, 0, 0.034, 0, { parent: this.hatch });
    for (const s of [-1, 1]) { this.box(0.82, 0.012, 0.012, glow, 0, 0.012, s * 0.41, { parent: this.hatch, recv: false }); this.box(0.012, 0.012, 0.82, glow, s * 0.41, 0.012, 0, { parent: this.hatch, recv: false }); }
    const ring = new THREE.TorusGeometry(0.09, 0.012, 6, 14); this.geos.push(ring); const rm = new THREE.Mesh(ring, dark); rm.position.set(0, 0.075, 0); rm.rotation.x = Math.PI / 2 - 0.5; this.hatch.add(rm);
    for (const [x, z] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) this.cyl(0.025, 0.025, 0.02, dark, x, 0.065, z, undefined, 6, this.hatch);
    this.hatch.visible = false;
  }
  /** Lampu merah samar di palka (dipakai world sebagai sumber cahaya tambahan, supaya lantai di sekitarnya sedikit memerah). */
  hatchLight(): BunkerLight | null { return this.hatch.visible ? { x: this.hatch.position.x, y: 0.5, z: this.hatch.position.z, c: 0xff2a14, i: 1.2, r: 2.4, flicker: true } : null; }

  // ---------------------------------------------------------------- tuas dari aset
  private leverAt(m: Mount, y: number, _st: number, _i: number): LeverRT {
    const src = this.d.lever, root = skClone(src.scene) as THREE.Object3D;
    const holder = new THREE.Group(); holder.position.set(m.x + m.nx * LEVER_BACK, y, m.z + m.nz * LEVER_BACK); holder.rotation.y = FACE(m);
    root.scale.setScalar(LEVER_SCALE); holder.add(root); this.group.add(holder);
    root.traverse((o: any) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((q: THREE.Material) => { if (!this.leverGeoMats.has(q)) { this.leverGeoMats.add(q); applyMaterialEnv(q, 0.5); } }); } });
    const mixer = new THREE.AnimationMixer(root), clip = src.animations[0], act = mixer.clipAction(clip); act.play(); act.paused = true; act.time = 0; mixer.update(0);
    holder.updateMatrixWorld(true);
    return { holder, mixer, act, dur: clip.duration, k: 0, target: 0, spring: 0 };
  }
  private regLever(lv: LeverRT, st: Station, i: number, prompt: () => string | null, spring = false) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.6), this.d.hitMat); this.geos.push(hit.geometry); hit.position.set(0, 0, 0.2); lv.holder.add(hit);
    this.reg(hit, { id: `bk_lv${st}_${i}`, kind: 'lock', reach: 2.4, prompt, interact: () => { this.d.audio()?.play('flash_click', { pos: { x: lv.holder.position.x, y: LEVER_Y, z: lv.holder.position.z } }); if (spring) this.pulse(i); this.d.press(st, i); } });
  }
  private setLever(lv: LeverRT, k: number) { lv.act.time = Math.max(0, Math.min(1, k)) * lv.dur; lv.mixer.update(0); lv.holder.updateMatrixWorld(true); }
  /** Tuas bergerak mulus ke target (0 = atas/mati, 1 = bawah/hidup). */
  private aim(lv: LeverRT, target: number, snap = false) { lv.target = target; if (snap) { lv.k = target; this.setLever(lv, target); this.moving.delete(lv); } else if (lv.k !== target) this.moving.add(lv); }
  private pulse(i: number) { const lv = this.levers.s4[i]; if (!lv) return; lv.spring = 0.42; this.aim(lv, 1); this.flash[this.model ? this.model.layout4[i] : 0] = 0.5; }

  private reg(obj: THREE.Object3D, it: Interactable<GameCtx>) { it.runScoped = true; this.regs.push({ it, objs: [obj] }); this.d.ix.register(it, [obj]); }

  // ---------------------------------------------------------------- per-run
  /** Dipanggil tiap run baru (setelah ix.removeWhere(runScoped)): daftar ulang interaksi, gambar ulang papan sesuai seed, atur ulang tampilan. */
  beginRun(model: PuzzleModel, pz: RoomPuzzle, hatch: HatchSpot | null, vaultOpen: boolean) {
    this.model = model; this.pz = pz; this.play = null; this.flash = [0, 0, 0, 0];
    for (const r of this.regs) this.d.ix.register(r.it, r.objs);
    this.hatchReg = null;
    if (this.hatchHit) { this.hatch.remove(this.hatchHit); this.hatchHit.geometry.dispose(); this.hatchHit = null; }
    if (hatch) {
      this.hatch.position.set(hatch.x, 0, hatch.z); this.hatch.rotation.y = hatch.yaw; this.hatch.visible = true;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 1.0), this.d.hitMat); hit.position.set(0, 0.1, 0); this.hatch.add(hit);
      this.hatch.updateMatrixWorld(true);
      const it: Interactable<GameCtx> = { id: 'bk_hatch', kind: 'door', reach: 2.2, runScoped: true, prompt: () => 'OPEN HATCH', interact: () => this.d.enter() };
      this.d.ix.register(it, [hit]); this.hatchReg = { it, objs: [hit] };
      this.hatchHit = hit;
    } else this.hatch.visible = false;
    this.paintStatic();
    this.doorK = vaultOpen ? 1 : 0; this.doorTarget = vaultOpen ? 1 : 0; this.applyDoor();
    this.show(false, 0, true);
  }
  private hatchHit: THREE.Mesh | null = null;
  private paintStatic() {
    const m = this.model;
    // papan LOG TEKNISI: teka-teki logika urutan tuas
    redraw(this.plaqueTex!, (g, w, h) => {
      plateBase(g, w, h, '#33352f', '#1b1c19'); g.textAlign = 'center'; g.fillStyle = '#e6dfc4'; g.font = 'bold 54px monospace'; g.fillText('LOG TEKNISI', w / 2, 78);
      g.font = '28px monospace'; g.fillStyle = '#b9b39b'; g.fillText('PROSEDUR NYALA DAYA - TARIK BERURUTAN', w / 2, 118);
      g.textAlign = 'left'; g.fillStyle = '#f0ead2'; g.font = 'bold 35px monospace'; let y = 190;
      m.clues.forEach((c, i) => { const lines = wrap(g, `${i + 1}. ${CLUE_TXT(c)}`, w - 110); for (const ln of lines) { g.fillText(ln, 56, y); y += 46; } y += 12; });
      g.fillStyle = '#c9402f'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.fillText('SALAH URUTAN = SEMUA TUAS KEMBALI KE ATAS', w / 2, h - 34);
    });
    // label warna tuas I & IV
    m.layout1.forEach((c, i) => redraw(this.lblS1[i], (g, w, h) => { plateBase(g, w, h); g.fillStyle = COLORS[c].css; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.fillText(COLORS[c].id, w / 2, 56); }));
    m.layout4.forEach((c, i) => redraw(this.lblS4[i], (g, w, h) => { plateBase(g, w, h); g.fillStyle = COLORS[c].css; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText(COLORS[c].id, w / 2, 42); }));
    m.layout4.forEach((c, i) => this.setLamp(this.lampS4[i], COLORS[c].hex, false));
    // papan simbol: 3 asli (I, II, III) + 2 palsu (dicoret)
    for (let s = 0; s < this.glyphTex.length; s++) {
      const k = m.slotTrue.indexOf(s), dec = m.decoy.find((q) => q.slot === s);
      redraw(this.glyphTex[s], (g, w, h) => {
        plateBase(g, w, h, '#3a3b36', '#1d1e1b'); g.textAlign = 'center';
        if (k >= 0) { g.fillStyle = '#e6dfc4'; g.font = 'bold 46px monospace'; g.fillText('TANDA ' + ROMAN[k], w / 2, 56); drawGlyphFill(g, m.glyph[k], w / 2, 138, 54, '#f0e9cf'); g.font = 'bold 24px monospace'; g.fillStyle = '#b9b39b'; g.fillText(GLYPHS[m.glyph[k]], w / 2, 236); }
        else if (dec) { g.fillStyle = '#6f6b5c'; g.font = 'bold 40px monospace'; g.fillText('TANDA ?', w / 2, 56); drawGlyphFill(g, dec.glyph, w / 2, 138, 54, '#6f6b5c'); g.strokeStyle = '#c9302a'; g.lineWidth = 12; g.beginPath(); g.moveTo(28, 40); g.lineTo(w - 28, h - 28); g.moveTo(w - 28, 40); g.lineTo(28, h - 28); g.stroke(); g.fillStyle = '#c9302a'; g.font = 'bold 30px monospace'; g.fillText('RUSAK', w / 2, 236); }
      });
    }
    this.drawKeypad(false); this.drawTerminal(this.doorTarget === 1);
  }
  private drawKeypad(open: boolean) {
    redraw(this.keyTex, (g, w, h) => { plateBase(g, w, h, '#101612', '#070a08'); g.textAlign = 'center'; g.fillStyle = open ? '#47ff8a' : '#ff6a4a'; g.font = 'bold 34px monospace'; g.fillText(open ? 'TERBUKA' : 'KODE?', w / 2, 70); g.font = 'bold 64px monospace'; g.fillText(open ? 'OK' : '_ _ _ _', w / 2, 148); });
  }
  private drawTerminal(open: boolean) {
    redraw(this.termTex, (g, w, h) => { g.fillStyle = '#031208'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2aff7a'; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16); g.textAlign = 'center'; g.fillStyle = '#2aff7a'; g.font = 'bold 40px monospace'; g.fillText('AKSES DITERIMA', w / 2, 100); g.font = 'bold 30px monospace'; g.fillText('PINTU EXIT DIIZINKAN', w / 2, 160); g.font = '22px monospace'; g.fillStyle = '#1b9e50'; g.fillText(open ? 'SUBSTASIUN 7 - DAYA NORMAL' : '', w / 2, 220); });
  }

  /** Perbarui seluruh tampilan dari state puzzle. alarm = baru salah (bunyi), lp = tuas terakhir (stasiun*8+indeks) untuk animasi tuas pegas pemain lain. */
  show(alarm: boolean, lp: number, snap = false) {
    const pz = this.pz, m = this.model; if (!pz || !m) return;
    for (let i = 0; i < ORDER_N; i++) { const on = pz.down1(i); this.aim(this.levers.s1[i], on ? 1 : 0, snap); this.setLamp(this.lampS1[i], on ? 0x39ff7a : 0xff3322, true, on ? 1.5 : 0.45); }
    const lamps = pz.lamps();
    for (let i = 0; i < CIRC_LEVERS; i++) this.aim(this.levers.s2[i], pz.down2(i) ? 1 : 0, snap);
    for (let i = 0; i < CIRC_LAMPS; i++) this.setLamp(this.lampS2[i], pz.doneAt(2) ? 0x39ff7a : 0xffb347, ((lamps >> i) & 1) === 1);
    for (let k = 0; k < DRUMS; k++) { const gl = pz.drums[k]; redraw(this.drumTex[k], (g, w, h) => { plateBase(g, w, h, '#1c1d1b', '#0c0d0c'); drawGlyphFill(g, gl, w / 2, h / 2, 40, pz.doneAt(3) ? '#47ff8a' : '#e6dfc4'); }); }
    if (lp >> 3 === 4 && !snap) { const i = lp & 7; if (i < SIMON_COLORS && this.levers.s4[i].spring <= 0) this.pulse(i); }
    if (pz.doneAt(4) || pz.a === 0 && alarm) { /* tuas pegas kembali sendiri */ }
    for (let k = 0; k < 4; k++) { const dg = pz.digit(k); redraw(this.digTex[k], (g, w, h) => { g.fillStyle = '#060806'; g.fillRect(0, 0, w, h); g.strokeStyle = dg === null ? '#6b5a2a' : '#47ff8a'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#9a8a55'; g.font = 'bold 34px monospace'; g.textAlign = 'left'; g.fillText(ROMAN[k], 22, 52); g.textAlign = 'center'; g.fillStyle = dg === null ? '#6b5a2a' : '#47ff8a'; g.font = 'bold 96px monospace'; g.fillText(dg === null ? '?' : String(dg), w / 2 + 28, 112); }); }
    if (alarm) this.d.audio()?.alarm();
    this.d.ix.invalidate();
  }
  setVault(open: boolean) { if (open === (this.doorTarget === 1)) return; this.doorTarget = open ? 1 : 0; this.drawKeypad(open); this.drawTerminal(open); if (open) this.d.audio()?.play('door_open', { pos: { x: LAYOUT.door.x, y: 1.4, z: LAYOUT.door.z } }); this.d.ix.invalidate(); }
  get vaultOpen() { return this.doorTarget === 1; }
  private applyDoor() { this.door.position.y = BK.doorH / 2 + this.doorK * (BK.doorH + 0.1); this.door.updateMatrixWorld(true); if (this.doorObb) this.doorObb.enabled = this.doorK < 0.6; }

  private startPlay() {
    if (this.play || !this.model) return;
    this.play = { step: -1, t: 0 }; this.d.ix.invalidate();
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, px: number, pz: number) {
    if (!this.ready) return;
    const near = inBunker(px, pz, 2); if (this.group.visible !== near) this.group.visible = near;
    if (!near) return;
    this.clock += dt;
    for (const lv of this.moving) {
      if (lv.spring > 0 && lv.k >= 1) { lv.spring -= dt; if (lv.spring <= 0) lv.target = 0; }
      const dir = lv.target > lv.k ? 1 : -1; lv.k += dir * dt / 0.4;
      if ((dir > 0 && lv.k >= lv.target) || (dir < 0 && lv.k <= lv.target)) { lv.k = lv.target; if (lv.spring <= 0 || lv.k === 0) this.moving.delete(lv); }
      this.setLever(lv, lv.k);
    }
    for (const lv of this.levers.s4) if (lv.spring > 0 && lv.k >= 1 && !this.moving.has(lv)) this.moving.add(lv);
    if (this.doorK !== this.doorTarget) { this.doorK += Math.sign(this.doorTarget - this.doorK) * dt / 2.2; if (Math.abs(this.doorK - this.doorTarget) < 0.01) this.doorK = this.doorTarget; this.applyDoor(); }
    // metronom: lampu berkedip sesuai urutan (lokal)
    if (this.play) {
      const p = this.play, seq = this.model.simon; p.t += dt;
      if (p.t >= 0.8 || p.step < 0) { if (p.step >= 0 && p.step < seq.length) { /* lanjut */ } p.t = 0; p.step++; if (p.step >= seq.length) this.play = null; else { this.flash[seq[p.step]] = 0.55; this.d.audio()?.play('flash_click', { pos: { x: LAYOUT.s4[0].x + 1, y: 2, z: LAYOUT.s4[0].z } }); this.d.ix.invalidate(); } }
    }
    for (let c = 0; c < 4; c++) if (this.flash[c] > 0) this.flash[c] = Math.max(0, this.flash[c] - dt);
    for (let i = 0; i < SIMON_COLORS; i++) { const c = this.model.layout4[i]; this.setLamp(this.lampS4[i], COLORS[c].hex, this.flash[c] > 0, 2.2); }
    // lampu darurat berdenyut pelan; bola lampu berkedip
    const pulse = 0.6 + 0.4 * Math.sin(this.clock * 2.2);
    this.bulbMats.forEach((b, i) => { b.emissiveIntensity = (i === 2 ? 0.8 + pulse : 1.4) * (LAYOUT.lights[i].flicker ? (0.55 + 0.45 * Math.abs(Math.sin(this.clock * 9 + i) * Math.sin(this.clock * 2.3))) : 1); });
  }

  dispose() {
    for (const r of this.regs) this.d.ix.unregister(r.it);
    if (this.hatchReg) this.d.ix.unregister(this.hatchReg.it);
    this.d.cw.removeObbs((o) => o.id.startsWith('bunker-'));
    this.d.scene.remove(this.group); this.d.scene.remove(this.hatch);
    this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => m.dispose()); this.texs.forEach((t) => t.dispose());
    for (const g of [...this.levers.s1, ...this.levers.s2, ...this.levers.s4]) g.mixer.stopAllAction();
  }
}

// ---------- util ----------
function CLUE_TXT(c: PuzzleModel['clues'][number]): string {
  const n = (i: number) => COLORS[i].id;
  switch (c.t) {
    case 'first': return `${n(c.a)} ditarik PERTAMA.`;
    case 'last': return `${n(c.a)} ditarik TERAKHIR.`;
    case 'mid': return `${n(c.a)} ditarik di urutan TENGAH.`;
    case 'before': return `${n(c.a)} ditarik SEBELUM ${n(c.b)}.`;
    case 'after1': return `${n(c.b)} ditarik TEPAT SETELAH ${n(c.a)}.`;
    default: return `${n(c.a)} dan ${n(c.b)} TIDAK pernah ditarik berurutan.`;
  }
}
function drawGlyphFill(g: CanvasRenderingContext2D, id: number, cx: number, cy: number, r: number, col: string) { g.fillStyle = col; drawGlyph(g, id, cx, cy, r); }
void lampsFor;
