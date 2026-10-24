import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { autoRig, type AutoRig } from './autorig';
import { computePose, cycleLength, jumpState, smooth, type Body } from './motion';
import { PuppetFollower, clamp, damp, dampAngle, wrapAngle } from './animsmooth';
import type { BoneName } from './rigcore';

export const MODEL_EXT = ['glb', 'gltf', 'vrm'];
export const MAX_MODEL_BYTES = 40 * 1024 * 1024;
export const DEFAULT_MODEL_URL = '/models/james-animated.glb';
export const FALLBACK_MODEL_URL = '/models/james.glb'; // James lama (statis) + autoRig bila yang ber-animasi gagal dimuat
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
const wrap = wrapAngle;
const HANG_LIFT = 0.12, HANG_SECONDS = 0.5; // menggantung di kait penjara (STAGE 2): badan terangkat tipis (kaki nyaris menyentuh lantai), transisi halus
const LIE_LIFT = 0.14, LIE_SECONDS = 0.3; // rebahan (diseret): naik dari lantai agar punggung tidak tembus; transisi halus
const V_DEAD = 0.05; // kecepatan di bawah ini dianggap diam (menahan kaki bergetar dari noise interpolasi)
const TARGET_H = 1.7;
// Klip locomotion James ber-animasi: [Idle, Walk, Run, CrouchIdle, CrouchWalk]; kecepatan klip (m/dtk) pada tinggi model asli (tidak diskalakan game)
const LOCO_NAMES = ['Idle', 'Walk', 'Run', 'CrouchIdle', 'CrouchWalk'] as const;
const LOCO_SPEED = [0, 1.3, 3.4, 0, 0.8];
const TS_MIN = 0.6, TS_MAX = 1.5, CROUCH_ON = 0.3;
const sstep = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
function pickLoco(clips: THREE.AnimationClip[]): { loop: THREE.AnimationClip[]; jump: THREE.AnimationClip } | null {
  const by = (n: string) => clips.find((c) => c.name.toLowerCase() === n.toLowerCase());
  const loop = LOCO_NAMES.map(by), jump = by('Jump');
  return loop.every(Boolean) && jump ? { loop: loop as THREE.AnimationClip[], jump } : null;
}
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
  private loco = false; // true bila model membawa set klip locomotion lengkap (James ber-animasi)
  private la: THREE.AnimationAction[] = []; private lw = [1, 0, 0, 0, 0]; // 5 klip loop + bobot halus
  private jumpAct?: THREE.AnimationAction; private jumpOn = false; private jumpFin = false; private jw = 0;
  private rig: Partial<Record<RigKey, Joint>> = {};
  private full?: AutoRig; // model statis yang diberi tulang otomatis -> animasi penuh
  private body: Body = { thigh: 0.4, shin: 0.4, armDown: [0.8, 0.8], foreFwd: [0.5, 0.5] };
  private baseScale = 1; private basePos = new THREE.Vector3();
  private time = 0; private seed = Math.random() * 10;
  private home = new THREE.Vector3(); private baseYaw = 0; private yaw = 0; private placed = false; private roam = 1.1;
  private tx = 0; private tz = 0; private hasTarget = false; private homing = false;
  private cmdGait: Gait = 0; private cmdCrouch = false;
  private puppet = false; private puppetV = 0; // mode boneka: posisi/arah diatur dari luar (pemain remote), tanpa gerak acak lobby
  private fol = new PuppetFollower(); private pt: { x: number; y: number; z: number; yaw: number } | null = null; // target terakhir pemain remote; diikuti halus oleh `fol`
  private yawV = 0; private wkW = 0; // kecepatan putar badan (lobby) & bobot clip jalan (model ber-clip)
  private ambGait: Gait = 0; private ambCrouch = false; private ambT = rand(1.5, 3); private ambLeft = 0;
  private v = 0; private phase = Math.random() * 6; private cd = 0; private jumpT = -1; private mv = 0;
  private lookY = 0; private lookTo = 0; private lookT = 1;
  private q1 = new THREE.Quaternion(); private q2 = new THREE.Quaternion();
  private hangTarget = 0; private hangT = 0; private hangOn = false; private hv1 = new THREE.Vector3(); private hv2 = new THREE.Vector3(); private hv3 = new THREE.Vector3(); private hq1 = new THREE.Quaternion(); private hq2 = new THREE.Quaternion(); private hq3 = new THREE.Quaternion();
  private lieTarget = 0; private lieT = 0; private lieOn = false; // pose rebahan terlentang (seluruh model diputar; model statis)

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
        if (clips.length && !pickLoco(clips) && clipsArePose(obj, clips, la)) clips = [];
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
    const lc = clips.length && !o.vrm && !o.rig ? pickLoco(clips) : null;
    if (lc) {
      const mx = this.mixer = new THREE.AnimationMixer(obj);
      this.loco = true;
      this.la = lc.loop.map((c, i) => { const a = mx.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); a.setEffectiveWeight(i === 0 ? 1 : 0); a.play(); return a; });
      const ja = this.jumpAct = mx.clipAction(lc.jump);
      ja.setLoop(THREE.LoopOnce, 1); ja.clampWhenFinished = true;
      mx.addEventListener('finished', ((e: any) => { if (e.action === ja) this.jumpFin = true; }) as any);
    } else if (clips.length) {
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

  private get canWalk() { return this.full || this.loco ? true : this.mixer ? !!this.walkAct : Object.keys(this.rig).length > 0; }
  private get fast() { return !!this.full || this.loco; } // kecepatan gerak penuh (bukan versi pelan untuk model sederhana)
  /** true bila karakter punya tulang penuh (jalan/lari/lompat/jongkok sungguhan) */
  get fullBody() { return !!this.full || this.loco; }

  setHome(x: number, z: number, yaw: number, roam = 1.1) {
    this.roam = this.fast ? roam : Math.min(roam, 0.32);
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
  /** Diseret: pergelangan kaki dipasang di (x,y,z) dunia (tangan monster), badan menjulur ke belakang (yaw = yaw monster) dengan kepala turun ke lantai.
   *  Dipanggil SETELAH update() tiap frame; bobot mengikuti transisi rebahan. Model statis: cukup memutar seluruh model (tanpa IK). */
  pinGrip(x: number, y: number, z: number, yaw: number, floorY: number) {
    const L = smooth(this.lieT); if (L < 0.001) return;
    const rp = this.root.position, py = Math.max(y, floorY + LIE_LIFT);
    rp.x += (x - rp.x) * L; rp.y += (py - rp.y) * L; rp.z += (z - rp.z) * L;
    this.root.rotation.y += wrapAngle(yaw - this.root.rotation.y) * L;
    const al = Math.asin(clamp((py - floorY - LIE_LIFT) / TARGET_H, 0, 0.9)), th = -(Math.PI / 2 + al) * L, c = Math.cos(th), s = Math.sin(th), b = this.basePos, mp = this.model.position;
    mp.copy(b); mp.y += b.y * c - b.z * s - b.y; mp.z += b.y * s + b.z * c - b.z;   // pivot di pergelangan kaki (titik kaki); tinggi sudah dari root.y
    this.model.rotation.x = th; this.lieOn = true;
  }
  /** STAGE 2 (penjara): menggantung di kait. Kedua lengan terangkat ke atas (rotasi tulang di ruang dunia, tanpa aset baru), badan terangkat tipis, dada & kepala menunduk, ayun pelan. */
  setHang(on: boolean) { this.hangTarget = on ? 1 : 0; }
  /** Putar tulang di ruang dunia: sumbu `axis` sebesar `ang` (w = bobot terhadap pose animasi saat ini). */
  private spinBone(bone: THREE.Object3D | undefined, axis: THREE.Vector3, ang: number, w: number) {
    if (!bone || !bone.parent) return;
    bone.updateWorldMatrix(true, false); bone.getWorldQuaternion(this.hq1); bone.parent.getWorldQuaternion(this.hq2);
    this.hq3.setFromAxisAngle(axis, ang * w).multiply(this.hq1); bone.quaternion.copy(this.hq2.invert().multiply(this.hq3)); bone.updateMatrixWorld(true);
  }
  /** Arahkan tulang (tulang -> anak pertamanya) ke `dir` dunia, dicampur `w` dengan pose animasi. */
  private aimBone(bone: THREE.Object3D | undefined, dir: THREE.Vector3, w: number) {
    const child = bone && (bone.children.find((c) => (c as any).isBone) || bone.children[0]); if (!bone || !child || !bone.parent) return;
    bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    bone.getWorldPosition(this.hv1); child.getWorldPosition(this.hv2); this.hv2.sub(this.hv1); if (this.hv2.lengthSq() < 1e-8) return;
    this.hq1.setFromUnitVectors(this.hv2.normalize(), dir); bone.getWorldQuaternion(this.hq2); bone.parent.getWorldQuaternion(this.hq3);
    this.hq1.multiply(this.hq2); bone.quaternion.slerp(this.hq3.invert().multiply(this.hq1), w); bone.updateMatrixWorld(true);
  }
  private applyHang(H: number) {
    const t = this.time + this.seed, mp = this.model.position;
    mp.y = this.basePos.y + HANG_LIFT * H;
    if (!this.lieOn) { this.model.rotation.z = Math.sin(t * 0.9) * 0.035 * H; this.model.rotation.x = (0.05 + Math.sin(t * 0.7 + 1) * 0.02) * H; }
    this.root.updateMatrixWorld(true);
    const yaw = this.root.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw), lat = this.hv3.set(cy, 0, -sy).clone(), nod = new THREE.Vector3(cy, 0, -sy);
    this.spinBone(this.rig.chest?.node, nod, 0.14, H);     // dada sedikit membungkuk
    this.spinBone(this.rig.head?.node, nod, 0.36, H);      // kepala menunduk
    const la = this.rig.lArm?.node, ra = this.rig.rArm?.node; if (!la || !ra) return;
    la.getWorldPosition(this.hv1); ra.getWorldPosition(this.hv2);
    const sgn = this.hv1.sub(this.hv2).dot(lat) >= 0 ? 1 : -1, sw = Math.sin(t * 0.9) * 0.025;
    for (const [bone, s] of [[la, sgn], [ra, -sgn]] as const) {
      const dir = new THREE.Vector3(lat.x * (s * 0.1 + sw), 1, lat.z * (s * 0.1 + sw)).normalize();
      this.aimBone(bone, dir, H);                                                   // lengan atas ke kait
      this.aimBone(bone.children.find((c) => (c as any).isBone), dir, H);           // lengan bawah lurus ke atas
    }
  }
  /** Rebahan terlentang (diseret): model diputar X -90 derajat, kepala di belakang arah hadap (+Z), naik LIE_LIFT. Jongkok normal tidak berubah. */
  setLie(on: boolean) { this.lieTarget = on ? 1 : 0; }

  /** Mode boneka (pemain remote di game): karakter tidak bergerak/berpikir sendiri; posisi, arah, kecepatan, dan jongkok diatur lewat placePuppet/driveSpeed/setCommand. */
  setPuppet(on: boolean) { this.puppet = on; this.pt = null; this.fol.reset(); if (on) { this.placed = true; this.hasTarget = false; this.homing = false; this.ambGait = 0; this.ambCrouch = false; } }
  /** `yaw` = rotasi Y dunia untuk root (model menghadap +Z). */
  placePuppet(x: number, y: number, z: number, yaw: number) {
    if (!(Number.isFinite(x + y + z + yaw))) return;
    if (!this.pt) { this.pt = { x, y, z, yaw }; this.fol.snap(x, y, z, yaw); this.root.position.set(x, y, z); this.yaw = yaw; this.root.rotation.y = yaw; return; } // panggilan pertama: langsung di tempat (tanpa meluncur dari titik asal)
    this.pt.x = x; this.pt.y = y; this.pt.z = z; this.pt.yaw = yaw; // sisanya: hanya target; update() menggerakkan karakter ke sana secara halus
  }
  /** Cadangan kecepatan jalan (m/dtk) bila belum ada target posisi. Setelah ada target, kecepatan DIUKUR dari gerak yang digambar (lihat PuppetFollower). */
  driveSpeed(v: number) { this.puppetV = Math.max(0, Math.min(8, v)); }

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
    this.lookY += (this.lookTo - this.lookY) * damp(3, dt);
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
    const k = this.fast ? 1 : 0.45;
    if (g > 0 && !this.hasTarget) this.pickTarget();
    if (g === 0) this.hasTarget = false;
    let vt = 0, want = 0, goal: number | null = null; // goal = arah tujuan; want = kecepatan putar yang diinginkan (rad/dtk)
    if (g > 0 && this.hasTarget) {
      const dx = this.tx - this.root.position.x, dz = this.tz - this.root.position.z, d = Math.hypot(dx, dz);
      if (d < Math.max(0.1, this.v * 0.1)) { this.homing = false; this.hasTarget = false; }
      else {
        goal = Math.atan2(dx, dz);
        const diff = wrap(goal - this.yaw), maxRate = g === 2 ? 7 : 5;
        const sp = crouch ? (g === 2 ? CROUCH_RUN : CROUCH_WALK) : (g === 2 ? RUN : WALK);
        vt = (this.homing ? 1.1 : sp) * k * Math.max(0, 1 - Math.abs(diff) / 1.2); // belok dulu, baru melaju
        want = clamp(diff * 5, -maxRate, maxRate);
      }
    } else if (this.v < 0.3) {
      goal = this.baseYaw; want = clamp(wrap(goal - this.yaw) * 4, -3, 3);
    }
    // belok: kecepatan putar ikut dihaluskan (percepat/perlambat), bukan loncat dari 0 ke laju tetap -> awal/akhir belok tidak patah
    this.yawV += (want - this.yawV) * damp(18, dt);
    let stepY = this.yawV * dt;
    if (goal !== null) { const rem = wrap(goal - this.yaw); if (rem * stepY > 0 && Math.abs(stepY) > Math.abs(rem)) stepY = rem; } // jangan melewati arah tujuan (tanpa overshoot)
    this.yaw += stepY;
    if (this.yaw > Math.PI || this.yaw < -Math.PI) this.yaw = wrap(this.yaw);
    this.v += (vt - this.v) * damp(vt > this.v ? 4.5 : 7.5, dt);
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
    dt = clamp(dt, 0, 0.1); // lonjakan frame (tab di background, GC) tidak boleh melempar fase/posisi
    this.time += dt;
    this.lieT += clamp(this.lieTarget - this.lieT, -dt / LIE_SECONDS, dt / LIE_SECONDS);
    const L = smooth(this.lieT), nl = 1 - L;   // nl: jalan/jongkok meredup saat rebahan
    let turn = 0, dist = 0;
    const pt = this.puppet ? this.pt : null;
    if (pt) {
      // pemain remote: ikuti target jaringan secara halus; kecepatan, jarak, dan putaran DIUKUR dari gerak yang benar-benar digambar
      const f = this.fol.step(dt, pt.x, pt.y, pt.z, pt.yaw);
      this.root.position.set(f.x, f.y, f.z); this.yaw = f.yaw; this.root.rotation.y = f.yaw;
      this.v = f.speed; this.lookY = f.look; turn = f.turn; dist = f.dist;
    } else if (this.puppet) {
      this.lookY += (0 - this.lookY) * damp(3, dt);
      this.v += (this.puppetV - this.v) * damp(8, dt);
      dist = this.v * dt;
    } else {
      const px = this.root.position.x, pz = this.root.position.z;
      this.think(dt);
      this.locomote(dt);
      dist = Math.hypot(this.root.position.x - px, this.root.position.z - pz); // jarak nyata (setelah batas ruangan), bukan v*dt
      turn = this.yawV;
    }
    // parameter gerak turunan dari kecepatan nyata -> kaki tidak "meluncur"
    const kk = this.fast ? 1 : 0.45, vEff = Math.max(0, this.v - V_DEAD);
    const m = Math.min(1, vEff / (1.1 * kk)) * nl;
    const r = (this.full ? smooth((vEff - 1.6) / 1.2) : 0) * nl;
    this.mv = m;
    const crouchOn = this.cmdCrouch || this.ambCrouch;
    this.cd += ((crouchOn ? (this.v > 0.15 ? 0.55 : 0.85) : 0) - this.cd) * damp(7, dt);
    // fase langkah dimajukan oleh JARAK tempuh / panjang siklus (sesuai sudut ayun kaki) -> kaki tumpu tidak meluncur, kadens otomatis halus saat melambat/berhenti.
    // Model ber-tulang tanpa clip di lobby (bukan boneka) tetap memakai kadens lama yang sengaja diperlambat.
    if (!this.full && !this.puppet) this.phase += dt * Math.PI * 2 * (vEff > 0.03 ? Math.max(0.4, (vEff / 0.45) / 1.5) : 0);
    else if (dist > 0) this.phase += Math.PI * 2 * dist / cycleLength(this.body, m, r, this.cd);
    if (this.phase > 1e3) this.phase %= Math.PI * 2;
    let js: { crouch: number; air: number; armsUp: number; lift: number; done: boolean } = { crouch: 0, air: 0, armsUp: 0, lift: 0, done: true };
    const jumpStart = this.jumpT === 0;
    if (this.jumpT >= 0) { this.jumpT += dt; js = jumpState(this.jumpT); if (js.done) this.jumpT = -1; }
    const crouch = Math.min(1, this.cd + js.crouch) * nl;

    if (this.full) {
      const s = this.baseScale;
      const o = computePose(this.body, { t: this.time, seed: this.seed, phase: this.phase, gait: m, run: r, crouch, air: js.air, armsUp: js.armsUp, lookY: this.lookY, lift: js.lift, turn });
      const B = this.full.bones;
      (Object.keys(o.rot) as BoneName[]).forEach((n) => { const b = B[n]; if (b) b.rotation.set(o.rot[n][0], o.rot[n][1], o.rot[n][2]); });
      const h = B.hips!, rp = this.full.rest.hips!;
      h.position.set(rp.x + o.hips[0] / s, rp.y + o.hips[1] / s, rp.z + o.hips[2] / s);
    } else {
      if (this.mixer && this.loco) this.stepLoco(dt, jumpStart);
      else if (this.mixer) {
        // bobot dihaluskan & diatur SEBELUM mixer.update (dulu setelahnya = telat satu frame): crossfade idle<->jalan mulus
        this.wkW += (m - this.wkW) * damp(10, dt);
        if (this.walkAct && this.idleAct) { this.walkAct.setEffectiveWeight(this.wkW); this.idleAct.setEffectiveWeight(1 - this.wkW); this.walkAct.setEffectiveTimeScale(0.75 + 0.5 * this.wkW); }
        this.mixer.update(dt);
      }
      if (this.loco) this.model.position.y = this.basePos.y + js.lift; // jongkok & lompat dari klip, bukan scale.y
      else if (!this.idleAct) this.procedural(js.lift, crouch);
      else { this.model.position.y = this.basePos.y + js.lift; this.model.scale.y = this.baseScale * (1 - 0.28 * crouch); }
    }
    if (L > 0.001 || this.lieOn) {   // pose rebahan: putar seluruh model di sekitar titik kaki (pivot dijaga), naik LIE_LIFT
      const mp = this.model.position;
      mp.copy(this.basePos);   // posisi dasar tiap frame: cabang ber-tulang/clip tidak menulis ulang semua sumbu, jadi offset tidak boleh menumpuk
      if (L > 0.001) {
        const th = -Math.PI / 2 * L, c = Math.cos(th), s = Math.sin(th), b = this.basePos;
        mp.y += b.y * c - b.z * s - b.y + LIE_LIFT * L; mp.z += b.y * s + b.z * c - b.z;
        this.model.rotation.x = th; this.lieOn = true;
      } else { this.model.rotation.x = 0; this.lieOn = false; }
    }
    this.hangT += clamp(this.hangTarget - this.hangT, -dt / HANG_SECONDS, dt / HANG_SECONDS);
    const HG = smooth(this.hangT);
    if (HG > 0.001) { this.applyHang(HG); this.hangOn = true; }
    else if (this.hangOn) { this.hangOn = false; if (!this.lieOn) { this.model.rotation.x = 0; this.model.rotation.z = 0; } }
    this.vrm?.update(dt);
  }

  // James ber-animasi: crossfade 5 klip loop berdasarkan kecepatan nyata + Jump sekali putar. Bobot diatur SEBELUM mixer.update.
  private stepLoco(dt: number, jumpStart: boolean) {
    const la = this.la, sc = this.baseScale, vs = LOCO_SPEED.map((x) => x * sc);
    const v = Math.max(0, this.v - V_DEAD), tw = [0, 0, 0, 0, 0];
    if (this.cd > CROUCH_ON) { const t = sstep((v - 0.1) / (vs[4] - 0.1)); tw[3] = 1 - t; tw[4] = t; }
    else if (v <= vs[1]) { const t = sstep((v - 0.1) / (vs[1] - 0.1)); tw[0] = 1 - t; tw[1] = t; }
    else { const t = sstep((v - vs[1]) / (vs[2] - vs[1])); tw[1] = 1 - t; tw[2] = t; }
    const kf = damp(10, dt);
    for (let i = 0; i < 5; i++) this.lw[i] += (tw[i] - this.lw[i]) * kf;
    // Jump: putar sekali, lalu blend keluar setelah selesai
    const ja = this.jumpAct!;
    if (jumpStart) { ja.reset(); ja.play(); this.jumpOn = true; this.jumpFin = false; }
    const jt = this.jumpOn && !this.jumpFin ? 1 : 0;
    this.jw += (jt - this.jw) * damp(jt > this.jw ? 25 : 12, dt);
    if (this.jumpOn && this.jumpFin && this.jw < 0.01) { ja.stop(); this.jumpOn = false; this.jw = 0; }
    if (this.jumpOn) ja.setEffectiveWeight(this.jw);
    for (let i = 0; i < 5; i++) la[i].setEffectiveWeight(this.lw[i] * (1 - this.jw));
    // timeScale = kecepatan nyata / kecepatan klip (kaki tidak meluncur)
    for (const i of [1, 2, 4]) la[i].setEffectiveTimeScale(clamp(this.v / vs[i], TS_MIN, TS_MAX));
    // Walk<->Run: samakan fase saat klip lawannya hampir tak berbobot, agar crossfade tidak menyilang kaki
    const w = la[1], r = la[2], wd = w.getClip().duration, rd = r.getClip().duration;
    if (this.lw[2] < 0.01 && this.lw[1] > 0.5) r.time = (w.time / wd) * rd;
    else if (this.lw[1] < 0.01 && this.lw[2] > 0.5) w.time = (r.time / rd) * wd;
    this.mixer!.update(dt);
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

// Karakter default: James ber-animasi (james-animated.glb). Gagal -> James lama + autoRig -> bila gagal juga, boneka sederhana agar lobby tidak kosong.
async function fetchModel(url: string, onProgress?: (p: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!(res.body && total > 0)) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); got += value.length; onProgress?.(Math.min(0.28, (got / total) * 0.28)); }
  }
  return new Blob(chunks);
}
export async function loadDefaultCharacter(onProgress?: (p: number) => void): Promise<Character> {
  for (const url of [DEFAULT_MODEL_URL, FALLBACK_MODEL_URL]) {
    try {
      return await loadCharacter(await fetchModel(url, onProgress), 'glb', onProgress);
    } catch (e) {
      console.warn('Model default gagal dimuat: ' + url, e);
    }
  }
  return Character.createDefault(0);
}
