// Model SCP-106 (scp-106.glb): skinned mesh dengan 55 joint, TANPA animasi bawaan, material unlit bertekstur.
// Pose bawaan node = berdiri tegak, lengan di sisi badan (pose-T hanya ada di bind pose, tidak tampil). Di sini pose dibuat prosedural
// dengan 'aim': tiap tulang diputar (di ruang dunia) agar menunjuk ke arah target, jadi tidak bergantung pada sumbu lokal tulang:
//   lengan terangkat ke depan lalu menutup (memeluk), jari menekuk seperti mencengkeram, badan condong, kepala menunduk ke pemain.
// Model hanya ada di scene selama jumpscare (show/hide), dan semua resource dibuang di dispose().
import * as THREE from 'three';
import { ARM_KEYS, type ScpFrame } from './scp';

const SUF = '_106_2_skeleton';
// Ukuran model pada pose node (diukur dari GLB): tinggi 6,39 unit (y -0,045..6,345), pinggul di z = 0,243.
const MODEL_H = 6.39, FOOT_Y = -0.045, HIP_Z = 0.243;

const ARMS = [
  { sg: 1, sh: 'Bone_004', el: 'Bone_005', wr: 'Bone_006', fingers: [['Bone_006', 'Bone_007', 'Bone_008'], ['Bone_009', 'Bone_010', 'Bone_011'], ['Bone_012', 'Bone_013', 'Bone_014'], ['Bone_015', 'Bone_016', 'Bone_017'], ['Bone_018', 'Bone_019', 'Bone_020']] },
  { sg: -1, sh: 'Bone_024', el: 'Bone_025', wr: 'Bone_026', fingers: [['Bone_026', 'Bone_027', 'Bone_028'], ['Bone_034', 'Bone_048', 'Bone_049'], ['Bone_035', 'Bone_046', 'Bone_047'], ['Bone_036', 'Bone_044', 'Bone_045'], ['Bone_037', 'Bone_042', 'Bone_043']] },
] as const;

interface ArmRt { sg: number; sh: THREE.Bone; el: THREE.Bone; wr: THREE.Bone; fingers: THREE.Bone[][]; restU: THREE.Vector3; restF: THREE.Vector3 }

export class ScpModel {
  /** Akar yang diposisikan dunia (posisi kaki-pinggul, yaw). */
  readonly root = new THREE.Group();
  private rig: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private arms: ArmRt[] = [];
  private spine: THREE.Bone | null = null; private spine2: THREE.Bone | null = null; private neck: THREE.Bone | null = null; private head: THREE.Bone | null = null;
  readonly ok: boolean;
  private scale: number;
  // scratch (tanpa alokasi per frame)
  private vD = new THREE.Vector3(); private vP0 = new THREE.Vector3(); private vP1 = new THREE.Vector3(); private vCur = new THREE.Vector3();
  private qD = new THREE.Quaternion(); private qW = new THREE.Quaternion(); private qP = new THREE.Quaternion();
  private dirA = new THREE.Vector3(); private dirB = new THREE.Vector3(); private dirC = new THREE.Vector3();

  constructor(gltfScene: THREE.Object3D, height: number) {
    this.rig = gltfScene;
    this.scale = height / MODEL_H;
    this.rig.scale.setScalar(this.scale);
    this.rig.position.set(0, -FOOT_Y * this.scale, -HIP_Z * this.scale); // kaki di y=0 root, pinggul di atas titik root
    this.root.add(this.rig);
    this.root.updateMatrixWorld(true);
    this.rig.traverse((o: any) => {
      if (o.isBone) { const nm: string = o.name; const key = nm.endsWith(SUF) ? nm.slice(0, -SUF.length) : nm; this.bones.set(key, o); this.rest.set(o, o.quaternion.clone()); }
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; // pose di luar bounding sphere bind-pose: jangan pernah dipotong
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.color) m.color.multiplyScalar(0.85); // unlit: sedikit digelapkan agar menyatu dengan lorong gelap
      }
    });
    const b = (n: string) => this.bones.get(n) ?? null;
    this.spine = b('Bone_001'); this.spine2 = b('Bone_002'); this.neck = b('Bone_021'); this.head = b('Bone_022');
    let allOk = !!(this.spine && this.spine2 && this.neck && this.head);
    for (const a of ARMS) {
      const sh = b(a.sh), el = b(a.el), wr = b(a.wr);
      const fingers = a.fingers.map((f) => f.map((n) => b(n)));
      if (!sh || !el || !wr || fingers.some((f) => f.some((x) => !x))) { allOk = false; continue; }
      const rest1 = new THREE.Vector3(), rest2 = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      sh.getWorldPosition(p0); el.getWorldPosition(p1); rest1.subVectors(p1, p0).normalize();
      el.getWorldPosition(p0); wr.getWorldPosition(p1); rest2.subVectors(p1, p0).normalize();
      this.arms.push({ sg: a.sg, sh, el, wr, fingers: fingers as THREE.Bone[][], restU: rest1, restF: rest2 });
    }
    this.ok = allOk && this.arms.length === 2;
    this.root.visible = false;
  }

  // ---- 'aim': putar tulang (ruang dunia) agar vektor tulang -> anak menunjuk ke dirLocal (ruang root) ----
  private aim(bone: THREE.Bone, child: THREE.Object3D, dirLocal: THREE.Vector3): void {
    this.vD.copy(dirLocal).transformDirection(this.root.matrixWorld);
    bone.getWorldPosition(this.vP0); child.getWorldPosition(this.vP1);
    this.vCur.subVectors(this.vP1, this.vP0);
    if (this.vCur.lengthSq() < 1e-12) return;
    this.vCur.normalize();
    this.qD.setFromUnitVectors(this.vCur, this.vD);        // rotasi dunia: arah sekarang -> arah target
    bone.getWorldQuaternion(this.qW).premultiply(this.qD);  // rotasi dunia baru tulang
    if (bone.parent) { bone.parent.getWorldQuaternion(this.qP).invert(); bone.quaternion.copy(this.qP.multiply(this.qW)); } else bone.quaternion.copy(this.qW);
    bone.updateMatrixWorld(true);
  }

  private lerpDir(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, k: number): THREE.Vector3 { return out.copy(a).multiplyScalar(1 - k).addScaledVector(b, k).normalize(); }

  /** Terapkan satu frame pose. Posisi/yaw root diatur terlebih dulu lewat place(). */
  pose(f: ScpFrame, t: number): void {
    if (!this.ok) return;
    this.root.updateMatrixWorld(true);
    for (const [bn, q] of this.rest) bn.quaternion.copy(q); // selalu mulai dari pose node (tanpa akumulasi galat)
    this.root.updateMatrixWorld(true);
    const jit = Math.sin(t * 61) * f.shake, jit2 = Math.sin(t * 47 + 1.3) * f.shake;
    // badan condong ke depan, kepala menunduk ke arah pemain
    this.dirA.set(jit, Math.cos(f.lean), Math.sin(f.lean)).normalize(); this.aim(this.spine!, this.spine2!, this.dirA);
    const h = ARM_KEYS.head; this.dirA.set(h[0] + jit2 * 2, h[1], h[2] * (0.4 + 0.6 * f.raise)).normalize(); this.aim(this.neck!, this.head!, this.dirA);
    const uo = ARM_KEYS.upperOpen, uc = ARM_KEYS.upperClose, fo = ARM_KEYS.foreOpen, fc = ARM_KEYS.foreClose;
    for (const a of this.arms) {
      const s = a.sg;
      // lengan: sisi badan -> terbuka lebar menjemput -> menutup memeluk
      this.dirB.set(s * uo[0], uo[1], uo[2]).normalize(); this.dirC.set(s * uc[0], uc[1], uc[2]).normalize();
      this.lerpDir(this.dirA, a.restU, this.dirB, f.raise); this.lerpDir(this.dirA, this.dirA, this.dirC, f.close);
      this.dirA.x += s * jit * 0.5; this.dirA.normalize();
      this.aim(a.sh, a.el, this.dirA);
      this.dirB.set(s * fo[0], fo[1], fo[2]).normalize(); this.dirC.set(s * fc[0], fc[1], fc[2]).normalize();
      this.lerpDir(this.dirA, a.restF, this.dirB, f.raise); this.lerpDir(this.dirA, this.dirA, this.dirC, f.close);
      const fx = this.dirA.x, fy = this.dirA.y, fz = this.dirA.z;
      this.aim(a.el, a.wr, this.dirA);
      // jari menekuk (mencengkeram) mengikuti arah lengan bawah
      for (const fg of a.fingers) {
        this.dirA.set(fx, fy - 0.45 * f.raise, fz).normalize(); this.aim(fg[0], fg[1], this.dirA);
        this.dirA.set(fx, fy - 0.9 * f.raise, fz).normalize(); this.aim(fg[1], fg[2], this.dirA);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /** Posisi dunia (pusat badan di lantai) dan arah hadap (yaw, radian; +Z lokal = depan). */
  place(x: number, y: number, z: number, yaw: number): void { this.root.position.set(x, y, z); this.root.rotation.set(0, yaw, 0); this.root.updateMatrixWorld(true); }

  show(scene: THREE.Scene): void { if (this.root.parent !== scene) scene.add(this.root); this.root.visible = true; }
  /** Hilang seketika dan dikeluarkan dari scene (tidak ada model tertinggal di dunia). */
  hide(): void { this.root.visible = false; this.root.removeFromParent(); for (const [bn, q] of this.rest) bn.quaternion.copy(q); }

  dispose(): void {
    this.hide();
    this.rig.traverse((o: any) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m?.map?.dispose(); m?.dispose(); }
      o.skeleton?.dispose?.();
    });
  }
}
