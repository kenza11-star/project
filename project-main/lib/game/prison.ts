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
    this.d.model.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = true;
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
    const floorM = this.mat({ color: 0x2a2926, roughness: 0.9, metalness: 0.05 });
    const y0 = 0.28, y1 = 9.55, H = y1 - y0, cy = (y0 + y1) / 2;
    this.box(0.3, H, 15.09, stone, -3.95, cy, 6.945, this.group, 4);                 // dinding barat (GLB diorama terbuka di sisi ini)
    // antechamber di depan pintu sel: lantai, 3 dinding, plafon (interior x -1,0..4,7; z -4,7..-0,6)
    this.box(6.3, 0.2, 4.4, floorM, 1.85, y0 - 0.1, -2.8);
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

  // ---------------------------------------------------------------- bohlam gantung (visual; cahaya dari pool world)
  private lampMats: { b: THREE.MeshBasicMaterial; h: THREE.MeshBasicMaterial }[] = [];
  private buildLamps() {
    const bulb = new THREE.SphereGeometry(0.11, 10, 8), halo = new THREE.SphereGeometry(0.5, 10, 8), cord = new THREE.CylinderGeometry(0.01, 0.01, 1, 4); this.geos.push(bulb, halo, cord);
    const cm = this.mat({ color: 0x151515, roughness: 1 });
    for (const l of this.lights) {
      // bohlam terang (basic, tidak terkena pencahayaan) + halo aditif tipis agar terlihat memancarkan cahaya; per lampu agar bisa berkedip bersama pool lampu world
      const b = new THREE.MeshBasicMaterial({ color: new THREE.Color(l.c).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.5) });
      const h = new THREE.MeshBasicMaterial({ color: l.c, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      this.mats.push(b, h); this.lampMats.push({ b, h });
      const [lx, ly, lz] = W2L(l.x, l.y, l.z), top = PRISON_CEIL_Y - OFF.y, hh = top - ly;
      const m = new THREE.Mesh(bulb, b); m.position.set(lx, ly, lz); this.group.add(m);
      const g = new THREE.Mesh(halo, h); g.position.set(lx, ly, lz); g.renderOrder = 2; this.group.add(g);
      const c = new THREE.Mesh(cord, cm); c.scale.y = hh; c.position.set(lx, ly + hh / 2, lz); this.group.add(c);
    }
  }
  /** Tingkat nyala lampu k (0..1, dari pool lampu world: kedip/blackout) -> kecerahan bohlam & halo. */
  setLampLevel(k: number, v: number) {
    const m = this.lampMats[k]; if (!m) return; const x = Math.max(0, Math.min(1, v));
    m.b.color.setScalar(0.1 + 0.9 * x).multiply(this.lights[k] ? LAMP_TINT[k % LAMP_TINT.length] : LAMP_TINT[0]); m.h.opacity = 0.16 * x; m.h.visible = x > 0.03;
  }
  update(dt: number, px: number, pz: number, level: number, monster: { x: number; z: number; level: number; state?: string } | null) {
    const near = level === PRISON_LEVEL && inPrison(px, pz, 3); if (this.group.visible !== near) this.group.visible = near;
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
    this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => m.dispose()); this.texs.forEach((t) => t.dispose());
  }
}
