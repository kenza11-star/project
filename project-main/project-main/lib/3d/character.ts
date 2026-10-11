import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { autoRig, type AutoRig } from './autorig';
import { computePose, jumpState, smooth, type Body } from './motion';
import type { BoneName } from './rigcore';

export const MODEL_EXT = ['glb', 'gltf', 'vrm'];
export const MAX_MODEL_BYTES = 40 * 1024 * 1024;
export const DEFAULT_MODEL_URL = '/models/james.glb';
export const DEFAULT_MODEL_LABEL = 'James (default)';
export const extOf = (n: string) => (n.split('.').pop() || '').toLowerCase();
export function validateModelFile(f: File): string | null {
  if (!MODEL_EXT.includes(extOf(f.name))) return 'Format tidak didukung. Gunakan .glb, .gltf, atau .vrm';
  if (f.size === 0) return 'File kosong';
  if (f.size > MAX_MODEL_BYTES) return `File terlalu besar (maks ${MAX_MODEL_BYTES / 1048576} MB)`;
  return null;
}

type RigKey = 'head' | 'chest' | 'lArm' | 'rArm' | 'lLeg' | 'rLeg';
type RigNodes = Partial<Record<RigKey, THREE.Object3D>>;
interface Joint { node: THREE.Object3D; base: THREE.Quaternion; ax: THREE.Vector3; ay: THREE.Vector3; az: THREE.Vector3 }
interface Opts { animations?: THREE.AnimationClip[]; vrm?: VRM; rig?: RigNodes; lower?: boolean }
export type Gait = 0 | 1 | 2; // 0 diam, 1 jalan, 2 lari
const WALK = 1.25, RUN = 2.9, CROUCH_WALK = 0.75, CROUCH_RUN = 1.15;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TARGET_H = 1.7;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- deteksi tulang ----------
const norm = (n: string) => n.toLowerCase().replace(/mixamorig/g, '').replace(/[^a-z]/g, '');
const BAD = /fore|lower|twist|hand|finger|thumb|index|middle|ring|pinky|little|shoulder|clavicle|collar/;
const LARM = /(leftupperarm|leftarm|upperarmleft|armleft|upperarml|arml)$|^(bip)?l(upper)?arm$/;
const RARM = /(rightupperarm|rightarm|upperarmright|armright|upperarmr|armr)$|^(bip)?r(upper)?arm$/;
const LLEG = /(leftupperleg|leftupleg|leftthigh|upperlegleft|upperlegl|thighleft|thighl)$|^(bip)?l(upperleg|upleg|thigh)$/;
const RLEG = /(rightupperleg|rightupleg|rightthigh|upperlegright|upperlegr|thighright|thighr)$|^(bip)?r(upperleg|upleg|thigh)$/;

function detectRig(obj: THREE.Object3D): RigNodes {
  const out: RigNodes = {};
  obj.traverse((o) => {
    if (!(o as any).isBone) return;
    const n = norm(o.name);
    if (!n) return;
    if (!out.head && /head$/.test(n) && !/top|end|front|eye/.test(n)) out.head = o;
    if (/(chest|spine\d?)$/.test(n)) out.chest = o;
    if (BAD.test(n)) return;
    if (LARM.test(n)) out.lArm = o; else if (RARM.test(n)) out.rArm = o;
    else if (LLEG.test(n)) out.lLeg = o; else if (RLEG.test(n)) out.rLeg = o;
  });
  return out;
}
function vrmNodes(v: VRM): RigNodes {
  const h = v.humanoid;
  const g = (n: any) => h.getNormalizedBoneNode(n) || undefined;
  return {
    head: g('head'), chest: g('upperChest') || g('chest') || g('spine'),
    lArm: g('leftUpperArm'), rArm: g('rightUpperArm'), lLeg: g('leftUpperLeg'), rLeg: g('rightUpperLeg'),
  };
}
// Turunkan lengan dari T-pose untuk model VRM (rig normalized, T-pose menghadap +Z).
function lowerVrm(v: VRM) {
  const h = v.humanoid;
  const l = h.getNormalizedBoneNode('leftUpperArm'), r = h.getNormalizedBoneNode('rightUpperArm');
  if (l) l.rotation.z = -1.2;
  if (r) r.rotation.z = 1.2;
  v.update(0);
}
// Turunkan lengan model glTF umum: putar tulang di ruang dunia agar mengarah ke bawah.
function lowerGeneric(l: THREE.Object3D, r: THREE.Object3D) {
  const wl = new THREE.Vector3(), wr = new THREE.Vector3();
  l.getWorldPosition(wl); r.getWorldPosition(wr);
  const leftSign = wl.x >= wr.x ? 1 : -1;
  [[l, leftSign], [r, -leftSign]].forEach(([b, sgn]) => {
    const bone = b as THREE.Object3D;
    const child = bone.children.find((c) => (c as any).isBone) || bone.children[0];
    if (!child || !bone.parent) return;
    bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), c = new THREE.Vector3();
    bone.getWorldPosition(p); child.getWorldPosition(c);
    const cur = c.sub(p);
    if (cur.lengthSq() < 1e-8) return;
    cur.normalize();
    const dir = new THREE.Vector3((sgn as number) * 0.15, -1, 0).normalize();
    const dq = new THREE.Quaternion().setFromUnitVectors(cur, dir);
    const wq = new THREE.Quaternion(); bone.getWorldQuaternion(wq);
    const pq = new THREE.Quaternion(); bone.parent.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
    bone.updateMatrixWorld(true);
  });
}

// Cari lengan lewat geometri bila nama tulang tidak dikenali: tulang atas yang menjulur mendatar (T-pose/A-pose).
function detectArmsGeometric(obj: THREE.Object3D): { pos?: THREE.Object3D; neg?: THREE.Object3D } {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const H = box.max.y - box.min.y, cx = (box.min.x + box.max.x) / 2;
  const pos: { b: THREE.Object3D; x: number }[] = [], neg: { b: THREE.Object3D; x: number }[] = [];
  const p = new THREE.Vector3(), c = new THREE.Vector3();
  obj.traverse((o) => {
    if (!(o as any).isBone || BAD.test(norm(o.name))) return;
    const child = o.children.find((ch) => (ch as any).isBone);
    if (!child) return;
    o.getWorldPosition(p); child.getWorldPosition(c);
    const d = c.clone().sub(p), len = d.length();
    if (len < 1e-6 || p.y < box.min.y + 0.55 * H || Math.abs(d.x) / len < 0.5) return;
    const x = p.x - cx;
    if (d.x * x <= 0) return;
    (x > 0 ? pos : neg).push({ b: o, x });
  });
  pos.sort((a, b) => a.x - b.x); neg.sort((a, b) => b.x - a.x);
  return { pos: pos[0]?.b, neg: neg[0]?.b };
}
// Apakah clip animasi hanya berisi pose statis T/A-pose (lengan tidak turun)?
function clipsArePose(obj: THREE.Object3D, clips: THREE.AnimationClip[], arm?: THREE.Object3D): boolean {
  if (clips.every((c) => c.duration < 0.4)) return true;
  if (!arm) return false;
  const mixer = new THREE.AnimationMixer(obj);
  const walk = clips.find((c) => /walk/i.test(c.name));
  const idle = clips.find((c) => /idle|stand|breath|wait/i.test(c.name)) || clips.filter((c) => c !== walk)[0] || clips[0];
  mixer.clipAction(idle).play(); mixer.update(0);
  obj.updateMatrixWorld(true);
  const child = arm.children.find((ch) => (ch as any).isBone) || arm.children[0];
  let pose = false;
  if (child) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    arm.getWorldPosition(a); child.getWorldPosition(b);
    const d = b.sub(a); if (d.length() > 1e-6) pose = d.y / d.length() > -0.6;
  }
  mixer.stopAllAction(); mixer.uncacheRoot(obj);
  return pose;
}
function disposeObj(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    (m as THREE.SkinnedMesh).skeleton?.dispose?.();
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) {
      for (const v of Object.values(mt as any)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      mt.dispose();
    }
  });
}

export class Character {
  root = new THREE.Group();
  private model = new THREE.Group();
  private obj: THREE.Object3D;
  private vrm?: VRM;
  private mixer?: THREE.AnimationMixer;
  private idleAct?: THREE.AnimationAction;
  private walkAct?: THREE.AnimationAction;
  private rig: Partial<Record<RigKey, Joint>> = {};
  private full?: AutoRig; // model statis yang diberi tulang otomatis -> animasi penuh
  private body: Body = { thigh: 0.4, shin: 0.4, armDown: [0.8, 0.8], foreFwd: [0.5, 0.5] };
  private baseScale = 1; private basePos = new THREE.Vector3();
  private time = 0; private seed = Math.random() * 10;
  private home = new THREE.Vector3(); private baseYaw = 0; private yaw = 0; private placed = false; private roam = 1.1;
  private tx = 0; private tz = 0; private hasTarget = false; private homing = false;
  private cmdGait: Gait = 0; private cmdCrouch = false;
  private ambGait: Gait = 0; private ambCrouch = false; private ambT = rand(1.5, 3); private ambLeft = 0;
  private v = 0; private phase = Math.random() * 6; private cd = 0; private jumpT = -1; private mv = 0;
  private lookY = 0; private lookTo = 0; private lookT = 1;
  private q1 = new THREE.Quaternion(); private q2 = new THREE.Quaternion();

  constructor(obj: THREE.Object3D, o: Opts = {}) {
    this.obj = obj; this.vrm = o.vrm;
    this.model.add(obj); this.root.add(this.model);
    obj.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) { m.castShadow = true; if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false; }
    });
    let clips = o.animations || [];
    let nodes: RigNodes;
    if (o.rig) nodes = o.rig;
    else if (o.vrm) { nodes = vrmNodes(o.vrm); if (!clips.length) lowerVrm(o.vrm); }
    else {
      const ar = clips.length ? null : autoRig(obj); // model tanpa tulang -> pasang tulang + skin otomatis
      if (ar) { this.full = ar; nodes = {}; }
      else {
        nodes = detectRig(obj);
        this.root.updateMatrixWorld(true);
        let la = nodes.lArm, ra = nodes.rArm;
        if (!la || !ra) { const g = detectArmsGeometric(obj); la = la || g.pos; ra = ra || g.neg; nodes.lArm = la; nodes.rArm = ra; }
        if (clips.length && clipsArePose(obj, clips, la)) clips = [];
        this.root.updateMatrixWorld(true);
        if (!clips.length && la && ra) lowerGeneric(la, ra);
      }
    }
    // Normalisasi ukuran & posisi (kaki di y=0, tinggi 1.7)
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = size.y > 1e-4 ? TARGET_H / size.y : 1;
    this.model.scale.setScalar(s);
    this.model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    this.baseScale = s; this.basePos.copy(this.model.position);
    this.root.updateMatrixWorld(true);
    if (this.full) this.body = { thigh: this.full.rig.thigh * s, shin: this.full.rig.shin * s, armDown: this.full.rig.armDown, foreFwd: this.full.rig.foreFwd };
    // Sumbu gerak per sendi (dalam bingkai induknya)
    const mq = new THREE.Quaternion(); this.model.getWorldQuaternion(mq);
    (Object.keys(nodes) as RigKey[]).forEach((k) => {
      const node = nodes[k]; if (!node || !node.parent) return;
      const pq = new THREE.Quaternion(); node.parent.getWorldQuaternion(pq);
      const inv = mq.clone().invert().multiply(pq).invert();
      this.rig[k] = {
        node, base: node.quaternion.clone(),
        ax: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), ay: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), az: new THREE.Vector3(0, 0, 1).applyQuaternion(inv),
      };
    });
    // Animation clip bawaan (jika ada)
    if (clips.length) {
      this.mixer = new THREE.AnimationMixer(obj);
      const walk = clips.find((c) => /walk/i.test(c.name));
      const idle = clips.find((c) => /idle|stand|breath|wait/i.test(c.name)) || clips.filter((c) => c !== walk)[0] || clips[0];
      this.idleAct = this.mixer.clipAction(idle); this.idleAct.play();
      if (walk && walk !== idle) { this.walkAct = this.mixer.clipAction(walk); this.walkAct.play(); this.walkAct.setEffectiveWeight(0); }
    }
  }

  static createDefault(i: number) {
    const mat = new THREE.MeshStandardMaterial({ color: i === 0 ? 0x8a7d55 : 0x56626e, roughness: 0.85 });
    const g = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, y: number, p: THREE.Object3D) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; p.add(m); };
    const torso = new THREE.Group(); torso.position.y = 1.0; g.add(torso);
    part(new THREE.CapsuleGeometry(0.17, 0.38, 4, 8), 0.28, torso);
    const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
    part(new THREE.SphereGeometry(0.12, 12, 10), 0.1, head);
    const mkArm = (sx: number) => { const a = new THREE.Group(); a.position.set(sx * 0.26, 0.48, 0); a.rotation.z = -sx * 0.08; part(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), -0.3, a); torso.add(a); return a; };
    const mkLeg = (sx: number) => { const l = new THREE.Group(); l.position.set(sx * 0.1, 0.95, 0); part(new THREE.CapsuleGeometry(0.075, 0.7, 4, 8), -0.5, l); g.add(l); return l; };
    return new Character(g, { rig: { head, chest: torso, lArm: mkArm(1), rArm: mkArm(-1), lLeg: mkLeg(1), rLeg: mkLeg(-1) } });
  }

  private get canWalk() { return this.full ? true : this.mixer ? !!this.walkAct : Object.keys(this.rig).length > 0; }
  /** true bila karakter punya tulang penuh (jalan/lari/lompat/jongkok sungguhan) */
  get fullBody() { return !!this.full; }

  setHome(x: number, z: number, yaw: number, roam = 1.1) {
    this.roam = this.full ? roam : Math.min(roam, 0.32);
    const same = this.placed && this.home.x === x && this.home.z === z && this.baseYaw === yaw;
    this.home.set(x, 0, z); this.baseYaw = yaw;
    if (same) return;
    if (!this.placed) { this.root.position.set(x, 0, z); this.yaw = yaw; this.root.rotation.y = yaw; this.placed = true; return; }
    this.tx = x; this.tz = z; this.hasTarget = true; this.homing = true;
  }
  /** Perintah manual dari tombol: gait 0/1/2 (diam/jalan/lari) dan jongkok. Semua 0/false = kembali ke gerak otomatis. */
  setCommand(gait: Gait, crouch: boolean) {
    const was = this.cmdGait !== 0 || this.cmdCrouch;
    this.cmdGait = gait; this.cmdCrouch = crouch;
    if (was && !gait && !crouch) { this.ambGait = 0; this.ambCrouch = false; this.ambLeft = 0; this.ambT = rand(2, 4); }
  }
  jump() { if (this.jumpT < 0) this.jumpT = 0; }

  private pickTarget() {
    const R = this.roam, px = this.root.position.x, pz = this.root.position.z;
    for (let i = 0; i < 8; i++) {
      const x = Math.max(-2.4, Math.min(2.4, this.home.x + rand(-R, R)));
      const z = Math.max(-2.4, Math.min(1.0, this.home.z + rand(-R * 1.5, R * 0.7)));
      if (Math.hypot(x - px, z - pz) >= Math.min(1.0, R * 0.9) || i === 7) { this.tx = x; this.tz = z; this.hasTarget = true; return; }
    }
  }
  private startAmbient() {
    const r = Math.random();
    if (this.canWalk && r < 0.38) { this.ambGait = 1; this.ambLeft = rand(4, 8); }
    else if (this.canWalk && r < 0.5) { this.ambGait = 2; this.ambLeft = rand(2.5, 4.5); }
    else if (r < 0.65) { this.jump(); this.ambT = rand(2.5, 4); }
    else if (r < 0.8) { this.ambCrouch = true; this.ambLeft = rand(2.5, 4); }
    else this.ambT = rand(1.5, 3);
  }
  private think(dt: number) {
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookT = rand(1.6, 4); this.lookTo = Math.random() < 0.45 ? 0 : rand(-0.7, 0.7); }
    this.lookY += (this.lookTo - this.lookY) * Math.min(1, dt * 3);
    if (this.cmdGait !== 0 || this.cmdCrouch) { this.ambGait = 0; this.ambCrouch = false; this.ambLeft = 0; return; }
    if (this.ambLeft > 0) {
      this.ambLeft -= dt;
      if (this.ambLeft <= 0) { this.ambGait = 0; this.ambCrouch = false; this.ambT = rand(1.5, 3.5); }
    } else if (!this.homing) {
      this.ambT -= dt;
      if (this.ambT <= 0) this.startAmbient();
    }
  }
  private locomote(dt: number) {
    const g: Gait = this.canWalk ? (this.homing ? 1 : ((this.cmdGait || this.ambGait) as Gait)) : 0;
    const crouch = this.cmdCrouch || this.ambCrouch;
    const k = this.full ? 1 : 0.45;
    if (g > 0 && !this.hasTarget) this.pickTarget();
    if (g === 0) this.hasTarget = false;
    let vt = 0;
    if (g > 0 && this.hasTarget) {
      const dx = this.tx - this.root.position.x, dz = this.tz - this.root.position.z, d = Math.hypot(dx, dz);
      if (d < Math.max(0.1, this.v * 0.1)) { this.homing = false; this.hasTarget = false; }
      else {
        const diff = wrap(Math.atan2(dx, dz) - this.yaw);
        const sp = crouch ? (g === 2 ? CROUCH_RUN : CROUCH_WALK) : (g === 2 ? RUN : WALK);
        vt = (this.homing ? 1.1 : sp) * k * Math.max(0, 1 - Math.abs(diff) / 1.2); // belok dulu, baru melaju
        this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), (g === 2 ? 7 : 5) * dt);
      }
    } else if (this.v < 0.3) {
      this.yaw += wrap(this.baseYaw - this.yaw) * Math.min(1, dt * 4);
    }
    this.v += (vt - this.v) * Math.min(1, dt * (vt > this.v ? 4 : 7));
    if (this.v > 0.01) {
      const p = this.root.position;
      p.x = Math.max(-2.6, Math.min(2.6, p.x + Math.sin(this.yaw) * this.v * dt));
      p.z = Math.max(-3, Math.min(1.1, p.z + Math.cos(this.yaw) * this.v * dt));
    }
    this.root.rotation.y = this.yaw;
  }

  private rot(k: RigKey, x: number, y: number, z: number) {
    const j = this.rig[k]; if (!j) return;
    const q = this.q1.setFromAxisAngle(j.ax, x);
    q.multiply(this.q2.setFromAxisAngle(j.ay, y));
    q.multiply(this.q2.setFromAxisAngle(j.az, z));
    j.node.quaternion.copy(q.multiply(j.base));
  }

  update(dt: number) {
    this.time += dt;
    this.think(dt);
    this.locomote(dt);
    // parameter gerak turunan dari kecepatan nyata -> kaki tidak "meluncur"
    const m = Math.min(1, this.v / (1.1 * (this.full ? 1 : 0.45)));
    const r = this.full ? smooth((this.v - 1.6) / 1.2) : 0;
    this.mv = m;
    const cyc = this.v > 0.03 ? Math.max(0.4, (this.full ? this.v : this.v / 0.45) / (1.5 + r)) : 0;
    this.phase += dt * Math.PI * 2 * cyc;
    const crouchOn = this.cmdCrouch || this.ambCrouch;
    this.cd += ((crouchOn ? (this.v > 0.15 ? 0.55 : 0.85) : 0) - this.cd) * Math.min(1, dt * 7);
    let js: { crouch: number; air: number; armsUp: number; lift: number; done: boolean } = { crouch: 0, air: 0, armsUp: 0, lift: 0, done: true };
    if (this.jumpT >= 0) { this.jumpT += dt; js = jumpState(this.jumpT); if (js.done) this.jumpT = -1; }
    const crouch = Math.min(1, this.cd + js.crouch);

    if (this.full) {
      const s = this.baseScale;
      const o = computePose(this.body, { t: this.time, seed: this.seed, phase: this.phase, gait: m, run: r, crouch, air: js.air, armsUp: js.armsUp, lookY: this.lookY, lift: js.lift });
      const B = this.full.bones;
      (Object.keys(o.rot) as BoneName[]).forEach((n) => { const b = B[n]; if (b) b.rotation.set(o.rot[n][0], o.rot[n][1], o.rot[n][2]); });
      const h = B.hips!, rp = this.full.rest.hips!;
      h.position.set(rp.x + o.hips[0] / s, rp.y + o.hips[1] / s, rp.z + o.hips[2] / s);
    } else {
      if (this.mixer) {
        this.mixer.update(dt);
        if (this.walkAct && this.idleAct) { this.walkAct.setEffectiveWeight(m); this.idleAct.setEffectiveWeight(1 - m); }
      }
      if (!this.idleAct) this.procedural(js.lift, crouch);
      else { this.model.position.y = this.basePos.y + js.lift; this.model.scale.y = this.baseScale * (1 - 0.28 * crouch); }
    }
    this.vrm?.update(dt);
  }

  // Animasi sederhana untuk model ber-tulang tanpa clip: napas, geser berat badan, kepala, tangan tidak kaku. Lompat = loncat, jongkok = pendek.
  private procedural(lift: number, crouch: number) {
    const ph = this.time + this.seed, mv = this.mv, w = this.phase;
    const br = Math.sin(ph * 1.6);
    this.rot('chest', 0.025 * br, 0.04 * Math.sin(ph * 0.4), 0.015 * Math.sin(ph * 0.5) + mv * 0.05 * Math.sin(w));
    this.rot('head', 0.03 * Math.sin(ph * 0.9) - 0.02 * br, this.lookY + 0.05 * Math.sin(ph * 0.7), 0.02 * Math.sin(ph * 0.6));
    this.rot('lArm', 0.05 * Math.sin(ph * 0.9) + mv * 0.55 * Math.sin(w), 0, 0.03 * Math.sin(ph * 1.1));
    this.rot('rArm', 0.05 * Math.sin(ph * 0.9 + 1.3) - mv * 0.55 * Math.sin(w), 0, -0.03 * Math.sin(ph * 1.1 + 0.5));
    this.rot('lLeg', -mv * 0.5 * Math.sin(w), 0, 0);
    this.rot('rLeg', mv * 0.5 * Math.sin(w), 0, 0);
    this.model.position.set(this.basePos.x + 0.012 * Math.sin(ph * 0.35), this.basePos.y + lift + mv * 0.02 * Math.abs(Math.sin(w)), this.basePos.z);
    this.model.rotation.z = 0.012 * Math.sin(ph * 0.4);
    this.model.scale.y = this.baseScale * (1 + 0.004 * br) * (1 - 0.28 * crouch);
  }

  dispose() {
    this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.obj);
    try { if (this.vrm) VRMUtils.deepDispose(this.vrm.scene); } catch { /* lanjut */ }
    disposeObj(this.obj);
    this.root.removeFromParent();
  }
}


// Samakan material agar pasti tampil di HP: MToon (VRM) -> Standard, outline disembunyikan, dua sisi (menghindari wajah terbalik/culling).
function simplifyMaterials(root: THREE.Object3D) {
  const conv = (mt: any): THREE.Material => {
    const isToon = !!mt.isMToonMaterial;
    if (isToon && (mt.isOutline || mt.side === THREE.BackSide)) {
      const h = new THREE.MeshBasicMaterial(); h.visible = false; return h;
    }
    if (!isToon) { mt.side = THREE.DoubleSide; return mt; }
    const st = new THREE.MeshStandardMaterial({
      color: mt.color ?? 0xffffff, map: mt.map ?? null, normalMap: mt.normalMap ?? null,
      emissive: mt.emissive ?? 0x000000, emissiveMap: mt.emissiveMap ?? null,
      transparent: !!mt.transparent, opacity: mt.opacity ?? 1, alphaTest: mt.alphaTest ?? 0,
      roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
    });
    mt.dispose();
    return st;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}

export async function loadCharacter(blob: Blob, ext: string, onProgress?: (p: number) => void): Promise<Character> {
  const buf = await blob.arrayBuffer();
  onProgress?.(0.3);
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  let input: ArrayBuffer | string = buf;
  if (ext === 'gltf') {
    const txt = new TextDecoder().decode(buf);
    let json: any;
    try { json = JSON.parse(txt); } catch { throw new Error('File .gltf rusak (bukan JSON valid)'); }
    const ext_ = (u: any) => u && !String(u).startsWith('data:');
    if (json.buffers?.some((b: any) => ext_(b.uri)) || json.images?.some((i: any) => ext_(i.uri))) {
      throw new Error('.gltf ini memakai file eksternal. Pakai .glb atau .gltf yang embedded');
    }
    input = txt;
  } else if (new TextDecoder().decode(buf.slice(0, 4)) !== 'glTF') {
    throw new Error('File bukan GLB/VRM valid (header rusak)');
  }
  const gltf: any = await new Promise((res, rej) =>
    loader.parse(input, '', res, (e: any) => rej(new Error(e?.message || 'Model gagal dibaca (file corrupt?)'))));
  onProgress?.(0.8);
  const vrm: VRM | undefined = gltf.userData?.vrm;
  if (ext === 'vrm' && !vrm) throw new Error('File .vrm tidak berisi data VRM yang valid');
  let obj: THREE.Object3D;
  if (vrm) { try { VRMUtils.rotateVRM0(vrm); } catch { /* abaikan */ } obj = vrm.scene; } else obj = gltf.scene;
  if (!obj) throw new Error('Model kosong');
  simplifyMaterials(obj);
  try {
    const ch = new Character(obj, { animations: vrm ? [] : gltf.animations, vrm });
    onProgress?.(1);
    return ch;
  } catch (e) { disposeObj(obj); throw e; }
}

// Karakter default: model James dari /public/models. Bila gagal diunduh/diparse, jatuh ke boneka sederhana agar lobby tidak kosong.
export async function loadDefaultCharacter(onProgress?: (p: number) => void): Promise<Character> {
  try {
    const res = await fetch(DEFAULT_MODEL_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    let blob: Blob;
    if (res.body && total > 0) {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { chunks.push(value); got += value.length; onProgress?.(Math.min(0.28, (got / total) * 0.28)); }
      }
      blob = new Blob(chunks);
    } else blob = await res.blob();
    return await loadCharacter(blob, 'glb', onProgress);
  } catch (e) {
    console.warn('Karakter default gagal dimuat, memakai boneka sederhana', e);
    return Character.createDefault(0);
  }
}
