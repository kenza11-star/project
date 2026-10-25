// Tampilan 3D ruangan penjara (prison_room.glb) + pintu sel + antechamber + pintu penghubung. Data & koordinat: prisonroom.ts (murni).
// GLB dipakai apa adanya (poly tetap); yang ditambah hanya geometri murah: dinding barat (diorama terbuka), antechamber, 6 kait/rantai (InstancedMesh), bohlam.
// Tidak menambah PointLight: lampu penjara dikirim ke pool lampu world (jumlah light scene tetap -> tanpa recompile shader). Tanpa shadow.
import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import type { InteractionSystem, Interactable } from './interaction';
import type { GameCtx } from './world';
import {
  PRISON_LEVEL, PRISON_OFFSET, PRISON_FLOOR_Y, PRISON_CEIL_Y, PRISON_WALLS, PRISON_PROPS, PRISON_DOOR, PRISON_SLOTS, SLOT_CUFF_H,
  PRISON_LIGHTS, PRISON_GATE, PRISON_HALL, PRISON_HALL_H, PRISON_GATE_CUT, PRISON_WALK, inPrison,
} from './prisonroom';
import { OPEN_FREE_FRAC } from './door';
import { applyMaterialEnv } from './materials';
import { makeSurface, boxProjectUV, disposeSurface } from './surfaces';

export interface PrisonDeps {
  scene: THREE.Scene; cw: CollisionWorld; ix: InteractionSystem<GameCtx>; hitMat: THREE.Material; model: THREE.Object3D;
  audio: () => { play(name: any, o?: any): any } | null;
  /** Siaran pintu (id 0 = pintu jeruji penghubung, 1 = pintu jeruji sel) ke pemain lain. */
  sendDoor?(id: 0 | 1, o: 0 | 1): void;
}
interface Reg { it: Interactable<GameCtx>; objs: THREE.Object3D[] }
const LAMP_TINT = [new THREE.Color(1.5, 1.35, 0.95), new THREE.Color(1.5, 1.2, 0.7)];
const OFF = PRISON_OFFSET, W2L = (x: number, y: number, z: number): [number, number, number] => [x - OFF.x, y - OFF.y, z - OFF.z];
const sm = (t: number) => t * t * (3 - 2 * t);

/** Lepas semua geometri/material/tekstur sebuah pohon objek (GLB hasil muat). */
export function disposeTree(root: THREE.Object3D) {
  const seen = new Set<any>();
  root.traverse((o: any) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue; seen.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) m[k]?.dispose?.();
      m.dispose();
    }
  });
}

export class PrisonRoom {
  readonly group = new THREE.Group();     // model + tambahan (koordinat lokal = koordinat model GLB)
  private readonly props = new THREE.Group();   // pintu penghubung di bangunan (selalu ada, kecil)
  private geos: THREE.BufferGeometry[] = []; private mats: THREE.Material[] = []; private texs: THREE.Texture[] = [];
  private regs: Reg[] = [];
  private pivot: THREE.Group | null = null; private doorObb: ReturnType<CollisionWorld['addObb']> | null = null;
  private k = 0; private target = 0; private monsterOpened = false; private cFar = 0;
  private gatePivot: THREE.Group | null = null; private gateObb: ReturnType<CollisionWorld['addObb']> | null = null;
  private gK = 0; private gTarget = 0; private gMonster = false; private gFar = 0;
  private ironM: { frame: THREE.MeshStandardMaterial; bar: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial } | null = null;
  readonly lights = PRISON_LIGHTS.map((l) => ({ ...l }));

  constructor(private d: PrisonDeps) {
    this.group.name = 'prison'; this.group.visible = false;
    this.group.position.set(OFF.x, OFF.y, OFF.z);
    this.group.add(d.model); d.scene.add(this.group); d.scene.add(this.props);
    this.prepModel(); this.buildShell(); this.buildSlots(); this.buildLamps(); this.buildDoor(); this.buildGate();
    d.cw.clearRect(PRISON_LEVEL, PRISON_GATE_CUT.minx, PRISON_GATE_CUT.minz, PRISON_GATE_CUT.maxx, PRISON_GATE_CUT.maxz);   // lubang di dinding timur bangunan (pintu jeruji)
    d.cw.walkEx[PRISON_LEVEL] = PRISON_WALK.map((b) => ({ ...b }));   // koridor + penjara tersambung fisik ke mezz (tidak ada teleport)
    for (const w of PRISON_WALLS) d.cw.fillRect(PRISON_LEVEL, w.minx, w.minz, w.maxx, w.maxz);
    for (const p of PRISON_PROPS) d.cw.addObb({ id: p.id, cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, yaw: p.yaw, level: PRISON_LEVEL, kind: 'fixed' });
    this.group.updateMatrixWorld(true); this.props.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- bahan & util
  private mat(o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; }
  /** Permukaan aspal/logam (PBR) milik ruangan ini; dilepas di dispose(). */
  private surf(kind: 'asphalt' | 'metal', side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial { const m = makeSurface(kind, side); this.mats.push(m); return m; }
  /** Kotak statis (koordinat model) dengan UV berulang tiap `tile` meter. */
  private box(w: number, h: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group, tile = 0): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, dd), uv = g.attributes.uv, dims = [[dd, h], [dd, h], [w, dd], [w, dd], [w, h], [w, h]];
    if (tile) for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
    this.geos.push(g);
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.receiveShadow = true; parent.add(me);
    if (parent === this.group) { me.updateMatrix(); me.matrixAutoUpdate = false; }
    return me;
  }
  private reg(obj: THREE.Object3D, it: Interactable<GameCtx>) { it.runScoped = true; this.regs.push({ it, objs: [obj] }); this.d.ix.register(it, [obj]); }

  /** Material GLB: dekal (BLEND) tidak menulis depth + offset agar tidak z-fight dengan dinding; mesh tanpa shadow cast (hemat). */
  private prepModel() {
    this.d.model.updateWorldMatrix(true, true);
    this.d.model.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = true;
      // lantai sel (floor1: 1 quad dengan UV 1 tile yang melar ke seluruh lantai) -> ASPAL berskala meter. Batu/puing di lantai (floor_stones) tetap bahan asli.
      if (o.name === 'floor1_floor_0' && !Array.isArray(o.material)) { boxProjectUV(o.geometry, 'asphalt', o.matrixWorld); o.material = this.surf('asphalt', THREE.DoubleSide); return; }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.transparent) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
      }
    });
  }

  // ---------------------------------------------------------------- tambahan murah: dinding barat, antechamber
  private buildShell() {
    let wallMap: THREE.Texture | null = null;
    this.d.model.traverse((o: any) => { if (!wallMap && o.isMesh && o.material?.name === 'walls') wallMap = o.material.map; });
    const stone = this.mat({ map: wallMap, color: wallMap ? 0x6a6660 : 0x37352f, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const floorM = this.surf('asphalt');   // lantai antechamber: aspal
    const y0 = 0.28, y1 = 9.55, H = y1 - y0, cy = (y0 + y1) / 2;
    this.box(0.3, H, 15.09, stone, -3.95, cy, 6.945, this.group, 4);                 // dinding barat (GLB diorama terbuka di sisi ini)
    // antechamber di depan pintu sel: lantai, 3 dinding, plafon (interior x -1,0..4,7; z -4,7..-0,6)
    this.box(6.3, 0.2, 4.4, floorM, 1.85, y0 - 0.1, -2.8, this.group, 1.8);
    this.box(6.3, 0.2, 4.4, stone, 1.85, y1 + 0.1, -2.8, this.group, 4);
    this.box(0.3, H, 2.9, stone, -1.15, cy, -3.55, this.group, 4); this.box(0.3, H - PRISON_GATE.h, 1.5, stone, -1.15, y1 - (H - PRISON_GATE.h) / 2, -1.35, this.group, 4);   // barat: bukaan koridor (dunia z 30,4..31,9) setinggi pintu
    this.box(0.3, H, 4.4, stone, 4.85, cy, -2.8, this.group, 4);
    this.box(6.3, H, 0.3, stone, 1.85, cy, -4.85, this.group, 4);
  }

  // ---------------------------------------------------------------- 6 titik ikat: kait di plafon + rantai + borgol (3 InstancedMesh)
  private buildSlots() {
    const n = PRISON_SLOTS.length, metal = this.mat({ color: 0x4a4d50, roughness: 0.55, metalness: 0.8 }), dark = this.mat({ color: 0x1b1c1d, roughness: 0.7, metalness: 0.6 });
    const hookY = PRISON_SLOTS[0].hookY, cuffY = PRISON_FLOOR_Y + SLOT_CUFF_H, len = hookY - 0.12 - cuffY;
    const rg = new THREE.CylinderGeometry(0.014, 0.014, len, 5), hg = new THREE.TorusGeometry(0.11, 0.022, 6, 12, Math.PI * 1.5), cg = new THREE.TorusGeometry(0.075, 0.02, 6, 10);
    const pg = new THREE.BoxGeometry(0.24, 0.05, 0.24); this.geos.push(rg, hg, cg, pg);
    const rods = new THREE.InstancedMesh(rg, dark, n), hooks = new THREE.InstancedMesh(hg, metal, n), cuffs = new THREE.InstancedMesh(cg, metal, n), plates = new THREE.InstancedMesh(pg, dark, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    PRISON_SLOTS.forEach((sl, i) => {
      const [lx, , lz] = W2L(sl.x, 0, sl.z), ly = (v: number) => v - OFF.y;
      m.compose(new THREE.Vector3(lx, ly((hookY - 0.12 + cuffY) / 2), lz), q.identity(), s); rods.setMatrixAt(i, m);
      q.setFromEuler(e.set(0, sl.yaw + Math.PI / 2, 0)); m.compose(new THREE.Vector3(lx, ly(hookY - 0.12), lz), q, s); hooks.setMatrixAt(i, m);   // cincin kait tegak, bidang sejajar arah pintu
      q.setFromEuler(e.set(Math.PI / 2, 0, 0)); m.compose(new THREE.Vector3(lx, ly(cuffY), lz), q, s); cuffs.setMatrixAt(i, m);   // borgol mendatar
      q.identity(); m.compose(new THREE.Vector3(lx, ly(hookY) + 0.025, lz), q, s); plates.setMatrixAt(i, m);
    });
    for (const im of [rods, hooks, cuffs, plates]) { im.instanceMatrix.needsUpdate = true; im.castShadow = false; im.frustumCulled = false; this.group.add(im); }
  }

  // ---------------------------------------------------------------- lampu gantung (visual; cahaya dari pool world)
  // Lampu industri sungguhan: kabel -> soket -> kap logam berbentuk kerucut -> bohlam kecil yang menyembul di bawah kap.
  // Kilau (glare) = 1 sprite menghadap kamera dengan gradien radial halus (bukan bola aditif bertepi keras) + 1 sprite lebar sangat tipis untuk udara berdebu.
  private lampMats: { b: THREE.MeshBasicMaterial; g: THREE.SpriteMaterial; w: THREE.SpriteMaterial; gl: number; wl: number; pos: THREE.Vector3 }[] = [];
  private glowTex: THREE.Texture | null = null;
  /** Gradien radial: inti tajam -> jatuh cepat (mendekati 1/r^2 seperti kilau bohlam di udara berdebu), tepi tepat 0 (tanpa lingkaran). */
  private glowTexture(): THREE.Texture | null {
    if (this.glowTex || typeof document === 'undefined') return this.glowTex;
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); if (!g) return null;
    const im = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2;                       // 0 di pusat, 1 di tepi
      const a = r >= 1 ? 0 : Math.pow(1 / (1 + 22 * r * r), 1.15) * (1 - r * r) * (1 - r * r);   // jatuh halus, tepi 0 dengan turunan 0
      const i = (y * N + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(255 * a);
    }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.texs.push(t); return (this.glowTex = t);
  }
  private buildLamps() {
    const bulb = new THREE.SphereGeometry(0.065, 12, 10), cord = new THREE.CylinderGeometry(0.008, 0.008, 1, 4), sock = new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8);
    const shade = new THREE.CylinderGeometry(0.07, 0.24, 0.17, 20, 1, true); this.geos.push(bulb, cord, sock, shade);
    const cm = this.mat({ color: 0x151515, roughness: 1 });
    const shM = this.mat({ color: 0x2d2f2f, roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide, emissive: 0x241a0c, emissiveIntensity: 0.6 }); applyMaterialEnv(shM, 0.5);
    const gt = this.glowTexture();
    for (const l of this.lights) {
      const col = new THREE.Color(l.c);
      const b = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(1.4) });
      const g = new THREE.SpriteMaterial({ map: gt, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const w = new THREE.SpriteMaterial({ map: gt, color: col, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      this.mats.push(b, g, w);
      const [lx, ly, lz] = W2L(l.x, l.y, l.z), top = PRISON_CEIL_Y - OFF.y, hh = top - ly - 0.2;
      this.lampMats.push({ b, g, w, gl: 1, wl: 1, pos: new THREE.Vector3(l.x, l.y, l.z) });
      const bm = new THREE.Mesh(bulb, b); bm.position.set(lx, ly - 0.02, lz); this.group.add(bm);                  // bohlam menyembul di bawah kap
      const sh = new THREE.Mesh(shade, shM); sh.position.set(lx, ly + 0.1, lz); this.group.add(sh);                  // kap kerucut
      const so = new THREE.Mesh(sock, cm); so.position.set(lx, ly + 0.2, lz); this.group.add(so);                    // soket
      const c = new THREE.Mesh(cord, cm); c.scale.y = hh; c.position.set(lx, ly + 0.25 + hh / 2, lz); this.group.add(c);
      const sg = new THREE.Sprite(g); sg.scale.setScalar(1.5); sg.position.set(lx, ly - 0.02, lz); sg.renderOrder = 2; this.group.add(sg);   // kilau inti
      const sw = new THREE.Sprite(w); sw.scale.setScalar(5.5); sw.position.set(lx, ly - 0.1, lz); sw.renderOrder = 2; this.group.add(sw);    // pendar lebar sangat tipis
    }
  }
  /** Tingkat nyala lampu k (0..1, dari pool lampu world: kedip/blackout) -> kecerahan bohlam & kilau. */
  setLampLevel(k: number, v: number) {
    const m = this.lampMats[k]; if (!m) return; const x = Math.max(0, Math.min(1, v));
    m.b.color.setScalar(0.1 + 0.9 * x).multiply(this.lights[k] ? LAMP_TINT[k % LAMP_TINT.length] : LAMP_TINT[0]);
    m.gl = x * x; m.wl = x;   // kilau turun lebih cepat daripada filamen (kedip terasa wajar)
    m.g.visible = m.gl > 0.01; m.w.visible = m.wl > 0.03;
  }
  /** Kilau memudar bila kamera sangat dekat (tidak menutup layar). */
  private glowFade(px: number, py: number, pz: number) {
    for (const m of this.lampMats) {
      const d = Math.hypot(px - m.pos.x, py - m.pos.y, pz - m.pos.z), f = Math.min(1, Math.max(0, (d - 0.5) / 1.6)), e = f * f * (3 - 2 * f);
      m.g.opacity = 0.55 * m.gl * e; m.w.opacity = 0.06 * m.wl * e;
    }
  }
  // ---------------------------------------------------------------- jeruji besi: bahan, daun jeruji, pintu sel, pintu penghubung + koridor
  /** Bahan besi (dipakai bersama): emissive tipis agar jeruji tetap terbaca di area gelap (lampu penjara hanya di sel & antechamber); envMap dipasang bila tersedia agar logam tidak hitam. */
  private iron() {
    if (this.ironM) return this.ironM;
    const frame = this.mat({ color: 0x3b3c3d, roughness: 0.62, metalness: 0.7, emissive: 0x1a1814, emissiveIntensity: 1 });
    const bar = this.mat({ color: 0x4a4b4c, roughness: 0.5, metalness: 0.75, emissive: 0x1c1a15, emissiveIntensity: 1 });
    const dark = this.mat({ color: 0x1b1c1d, roughness: 0.7, metalness: 0.5, emissive: 0x0a0a0a, emissiveIntensity: 1 });
    applyMaterialEnv(frame, 0.9); applyMaterialEnv(bar, 0.9); applyMaterialEnv(dark, 0.6);
    return (this.ironM = { frame, bar, dark });
  }
  /** Daun jeruji prosedural: memanjang ke +x lokal dari engsel (x=0), tebal ~5 cm. 2 tiang, rel bawah/atas/tengah, batang bulat vertikal (1 InstancedMesh), gembok, 2 buku engsel. y0 = tinggi dasar daun. */
  private barLeaf(len: number, h: number, y0: number, spacing: number): THREE.Group {
    const m = this.iron(), g = new THREE.Group(), t = 0.05;
    const add = (w: number, hh: number, dd: number, mm: THREE.Material, x: number, y: number) => {
      const ge = new THREE.BoxGeometry(w, hh, dd); this.geos.push(ge);
      const me = new THREE.Mesh(ge, mm); me.position.set(x, y, 0); me.castShadow = false; g.add(me);
    };
    add(t, h, t, m.frame, t / 2, y0 + h / 2); add(t, h, t, m.frame, len - t / 2, y0 + h / 2);             // tiang samping
    add(len, t, t, m.frame, len / 2, y0 + t / 2 + 0.04); add(len, t, t, m.frame, len / 2, y0 + h - t / 2); // rel bawah & atas
    for (const f of [0.34, 0.68]) add(len - 2 * t, 0.04, 0.035, m.frame, len / 2, y0 + h * f);              // rel tengah
    const n = Math.max(2, Math.round((len - 2 * t) / spacing)), step = (len - 2 * t) / n, bh = h - 0.1;
    const bg = new THREE.CylinderGeometry(0.0125, 0.0125, bh, 8); this.geos.push(bg);
    const im = new THREE.InstancedMesh(bg, m.bar, n - 1), mt = new THREE.Matrix4();
    for (let i = 1; i < n; i++) { mt.makeTranslation(t + step * i, y0 + 0.05 + bh / 2, 0); im.setMatrixAt(i - 1, mt); }
    im.instanceMatrix.needsUpdate = true; im.castShadow = false; im.frustumCulled = false; g.add(im);
    add(0.14, 0.2, 0.07, m.dark, len - 0.2, y0 + h * 0.5);                                                    // kotak gembok
    const kg = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8); this.geos.push(kg);
    for (const hy of [y0 + 0.3, y0 + h - 0.3]) { const k = new THREE.Mesh(kg, m.dark); k.position.set(0, hy, 0); g.add(k); }   // buku engsel
    return g;
  }
  private sfxAt(name: string, x: number, y: number, z: number) { try { this.d.audio()?.play(name, { pos: { x, y, z } }); } catch { /* audio opsional */ } }

  /** PINTU JERUJI SEL. Daun = node GLB asli (metal_door + lengan kunci + gembok) dipindah ke pivot di engsel; membuka ke dalam sel. Cadangan: daun prosedural bila node tidak ada. */
  private buildDoor() {
    const D = PRISON_DOOR, root = this.d.model;
    const piv = new THREE.Group(); piv.name = 'prison-cell-door'; piv.position.set(D.hinge.x - OFF.x, 0, D.hinge.z - OFF.z); this.group.add(piv);
    this.group.updateMatrixWorld(true);
    const leaf = root.getObjectByName('metal_door');
    if (leaf) for (const n of ['metal_door', 'pCube58', 'door_lock']) { const o = root.getObjectByName(n); if (o) piv.attach(o); }   // attach = pertahankan transform dunia
    else piv.add(this.barLeaf(2.6, 6.4, 0.24, 0.2));
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.8, 0.5), this.d.hitMat); this.geos.push(hit.geometry); hit.position.set(1.5, 1.7, 0); piv.add(hit);   // area bidik (jeruji berlubang): setinggi jangkauan tangan
    this.pivot = piv;
    this.doorObb = this.d.cw.addObb({ ...D.obb, level: PRISON_LEVEL, kind: 'door' });
    const it: Interactable<GameCtx> = {
      id: 'prison-door', kind: 'door', reach: D.reach, prompt: () => (this.target ? 'CLOSE' : 'OPEN'),
      interact: (ctx) => {
        if (this.target && this.bodyAt(this.doorObb, ctx.player.x, ctx.player.z, ctx.player.level, null)) { ctx.say('Terhalang', 1200); return; }
        this.setTarget(this.target ? 0 : 1);
      },
    };
    this.reg(hit, it);
    this.apply();
  }

  /** PINTU JERUJI PENGHUBUNG + koridor (lantai, dinding, plafon) di balik lubang dinding timur. Semua di `props` (selalu ada) agar lubang tidak tampak hitam. */
  private buildGate() {
    const G = PRISON_GATE, H = PRISON_HALL, f = PRISON_FLOOR_Y, C = PRISON_GATE_CUT, P = this.props, m = this.iron();
    let wallMap: THREE.Texture | null = null;
    this.d.model.traverse((o: any) => { if (!wallMap && o.isMesh && o.material?.name === 'walls') wallMap = o.material.map; });
    const stone = this.mat({ map: wallMap, color: wallMap ? 0x6a6660 : 0x37352f, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const floorM = this.surf('metal');   // lantai koridor di balik pintu jeruji: pelat logam
    const x0 = C.minx, x1 = H.maxx, L = x1 - x0, cx = (x0 + x1) / 2, cz = (H.minz + H.maxz) / 2, W = H.maxz - H.minz;
    this.box(L, 0.2, W + 0.3, floorM, cx, f - 0.105, cz, P, 1.4);                                  // lantai (sedikit di bawah lantai mezz: tanpa z-fight)
    this.box(L, PRISON_HALL_H, 0.15, stone, cx, f + PRISON_HALL_H / 2, H.minz - 0.075, P, 4);  // dinding utara (= collider 30,25..30,4)
    this.box(L, PRISON_HALL_H, 0.15, stone, cx, f + PRISON_HALL_H / 2, H.maxz + 0.075, P, 4);  // dinding selatan
    this.box(C.maxx - x0, 0.15, W + 0.3, stone, (x0 + C.maxx) / 2, f + G.h + 0.075, cz, P, 4); // langit-langit di lubang dinding (setinggi pintu)
    this.box(x1 - C.maxx, 0.15, W + 0.3, stone, (C.maxx + x1) / 2, f + PRISON_HALL_H + 0.075, cz, P, 4);   // plafon koridor
    // kusen besi tetap di sisi barat daun (daun membuka ke +x, tidak menabrak kusen)
    const fx = G.x - 0.085;
    this.box(0.07, 0.06, G.w, m.frame, fx, f + G.h - 0.03, G.z, P);
    this.box(0.07, 0.05, G.w, m.frame, fx, f + 0.025, G.z, P);
    this.box(0.07, G.h, 0.05, m.frame, fx, f + G.h / 2, G.hinge.z + 0.025, P);
    this.box(0.07, G.h, 0.05, m.frame, fx, f + G.h / 2, G.hinge.z + G.w - 0.025, P);
    // daun jeruji (pivot di engsel utara; tertutup memanjang +z, membuka +90 deg ke +x)
    const piv = new THREE.Group(); piv.name = 'prison-gate'; piv.position.set(G.hinge.x, f, G.hinge.z); P.add(piv);
    const leaf = this.barLeaf(G.w - 0.04, G.h - 0.06, 0.03, 0.115); leaf.rotation.y = -Math.PI / 2; leaf.position.z = 0.02; piv.add(leaf);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, G.h, G.w), this.d.hitMat); this.geos.push(hit.geometry); hit.position.set(0, G.h / 2, G.w / 2); piv.add(hit);
    this.gatePivot = piv;
    this.gateObb = this.d.cw.addObb({ ...G.obb, level: PRISON_LEVEL, kind: 'door' });
    const it: Interactable<GameCtx> = {
      id: 'prison-gate', kind: 'door', reach: G.reach, prompt: () => (this.gTarget ? 'CLOSE' : 'OPEN'),
      interact: (ctx) => {
        if (this.gTarget && this.bodyAt(this.gateObb, ctx.player.x, ctx.player.z, ctx.player.level, null)) { ctx.say('Terhalang', 1200); return; }
        this.setGate(this.gTarget ? 0 : 1);
      },
    };
    this.reg(hit, it);
    this.apply();
  }

  /** Pintu sel: target 1 = buka. byMonster -> menutup sendiri saat monster menjauh. remote = dari pemain lain (tanpa siaran ulang). */
  private setTarget(v: 0 | 1, byMonster = false, remote = false) {
    if (!this.pivot || this.target === v) return;
    this.target = v; this.monsterOpened = v === 1 && byMonster; this.cFar = 0;
    const D = PRISON_DOOR; this.sfxAt(v ? 'door_open' : 'door_close', D.cx, PRISON_FLOOR_Y + 1.2, D.cz);
    if (!remote) this.d.sendDoor?.(1, v);
    this.d.ix.invalidate();
  }
  /** Pintu penghubung (id 0): sama dengan setTarget. */
  private setGate(v: 0 | 1, byMonster = false, remote = false) {
    if (!this.gatePivot || this.gTarget === v) return;
    this.gTarget = v; this.gMonster = v === 1 && byMonster; this.gFar = 0;
    const G = PRISON_GATE; this.sfxAt(v ? 'door_open' : 'door_close', G.x, PRISON_FLOOR_Y + 1.2, G.z);
    if (!remote) this.d.sendDoor?.(0, v);
    this.d.ix.invalidate();
  }
  /** Pose daun + collider (aktif selama daun masih cukup menutup bukaan: OPEN_FREE_FRAC). */
  private apply() {
    if (this.pivot) {
      const a = sm(this.k); this.pivot.rotation.y = PRISON_DOOR.open * a;
      if (this.doorObb) this.doorObb.enabled = a < OPEN_FREE_FRAC;
      this.pivot.updateMatrixWorld(true);
    }
    if (this.gatePivot) {
      const a = sm(this.gK); this.gatePivot.rotation.y = PRISON_GATE.open * a;
      if (this.gateObb) this.gateObb.enabled = a < OPEN_FREE_FRAC;
      this.gatePivot.updateMatrixWorld(true);
    }
  }
  /** Monster terhalang pintu sel: buka, true selama daun masih membuka (tunggu); false = bukan pintu ini penghalangnya. */
  monsterOpen(x: number, z: number, level: number): boolean {
    if (!this.pivot || level !== PRISON_LEVEL || Math.hypot(x - PRISON_DOOR.cx, z - PRISON_DOOR.cz) >= PRISON_DOOR.reach) return false;
    if (this.target === 0) this.setTarget(1, true);
    return this.k < 0.97;
  }
  /** Monster dekat pintu penghubung: buka bila tertutup; true selama daun belum terbuka penuh (jangan menabrak daun). */
  gateWait(x: number, z: number, level: number): boolean {
    if (!this.gatePivot || level !== PRISON_LEVEL || Math.hypot(x - PRISON_GATE.x, z - PRISON_GATE.z) > 2.4) return false;
    if (this.gTarget === 0) this.setGate(1, true);
    return this.gK < 0.97;
  }
  /** Status pintu dari klien lain (id 0 = penghubung, 1 = sel): idempoten, tanpa siaran ulang. */
  setRemote(id: number, o: number) { if (id === 0) this.setGate(o ? 1 : 0, false, true); else this.setTarget(o ? 1 : 0, false, true); }
  /** Run baru: interaksi didaftarkan ulang (World menghapus yang runScoped) & kedua pintu kembali tertutup. */
  beginRun() {
    for (const r of this.regs) { this.d.ix.unregister(r.it); this.d.ix.register(r.it, r.objs); }
    this.k = 0; this.target = 0; this.monsterOpened = false; this.cFar = 0;
    this.gK = 0; this.gTarget = 0; this.gMonster = false; this.gFar = 0;
    this.apply(); this.d.ix.invalidate();
  }

  update(dt: number, px: number, pz: number, level: number, monster: { x: number; z: number; level: number; state?: string } | null) {
    const near = level === PRISON_LEVEL && inPrison(px, pz, 3); if (this.group.visible !== near) this.group.visible = near;
    if (near) this.glowFade(px, PRISON_FLOOR_Y + 1.6, pz);
    const mNear = (cx: number, cz: number, r: number) => !!monster && monster.level === PRISON_LEVEL && Math.hypot(monster.x - cx, monster.z - cz) < r;
    // pintu jeruji sel
    if (this.pivot && this.target === 0 && mNear(PRISON_DOOR.cx, PRISON_DOOR.cz, 2.0)) this.setTarget(1, true);
    if (this.pivot && this.target === 1 && this.monsterOpened) { this.cFar = mNear(PRISON_DOOR.cx, PRISON_DOOR.cz, 4.0) ? 0 : this.cFar + dt; if (this.cFar > 2.5 && !this.bodyAt(this.doorObb, px, pz, level, monster)) this.setTarget(0); }
    // pintu jeruji penghubung
    const G = PRISON_GATE, drag = !!monster && monster.state === 'drag';
    if (this.gatePivot && this.gTarget === 0 && drag && mNear(G.x, G.z, 2.4)) this.setGate(1, true);
    if (this.gatePivot && this.gTarget === 1 && this.gMonster) { this.gFar = mNear(G.x, G.z, 4.5) ? 0 : this.gFar + dt; if (this.gFar > 2.0 && !this.bodyAt(this.gateObb, px, pz, level, monster)) this.setGate(0); }
    if (this.pivot && this.k !== this.target) {
      this.k += Math.sign(this.target - this.k) * dt / (this.target ? 1.5 : 1.0);
      if (Math.abs(this.k - this.target) < 0.01) { this.k = this.target; this.d.ix.invalidate(); }
      this.apply();
    }
    if (this.gatePivot && this.gK !== this.gTarget) {
      this.gK += Math.sign(this.gTarget - this.gK) * dt / (this.gTarget ? 1.4 : 1.0);
      if (Math.abs(this.gK - this.gTarget) < 0.01) { this.gK = this.gTarget; this.d.ix.invalidate(); }
      this.apply();
    }
  }
  /** Ada pemain/monster dekat collider daun (tidak boleh menutup pintu menimpa badan). */
  private bodyAt(o: ReturnType<CollisionWorld['addObb']> | null, px: number, pz: number, level: number, monster: { x: number; z: number; level: number } | null): boolean {
    if (!o) return false;
    const dd = (x: number, z: number) => Math.hypot(x - o.cx, z - o.cz);
    return (level === PRISON_LEVEL && dd(px, pz) < 1.3) || (!!monster && monster.level === PRISON_LEVEL && dd(monster.x, monster.z) < 1.3);
  }

  dispose() {
    for (const r of this.regs) this.d.ix.unregister(r.it);
    this.d.cw.removeObbs((o) => o.id.startsWith('prison-'));
    this.d.scene.remove(this.group); this.d.scene.remove(this.props);
    disposeTree(this.d.model);
    this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => { disposeSurface(m); (m as any).map?.dispose?.(); m.dispose(); }); this.texs.forEach((t) => t.dispose());
  }
}
