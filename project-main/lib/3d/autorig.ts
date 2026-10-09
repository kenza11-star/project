import * as THREE from 'three';
import { buildRig, skinWeights, type BoneName, type Rig } from './rigcore';

export interface AutoRig { rig: Rig; bones: Partial<Record<BoneName, THREE.Bone>>; rest: Partial<Record<BoneName, THREE.Vector3>> }

// Model statis (tanpa tulang) -> beri kerangka humanoid + skin otomatis. Mengembalikan null bila model sudah punya tulang / gagal.
export function autoRig(obj: THREE.Object3D): AutoRig | null {
  let hasBones = false;
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => {
    if ((o as any).isBone || (o as THREE.SkinnedMesh).isSkinnedMesh) hasBones = true;
    else if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (hasBones || !meshes.length) return null;
  try {
    obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    // Bake transform tiap mesh ke ruang obj
    const baked = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return { m, g };
    });
    // Mesh terbesar = badan (dipakai untuk mencari sendi)
    const body = baked.reduce((a, b) => (b.g.attributes.position.count > a.g.attributes.position.count ? b : a));
    const pos = body.g.attributes.position;
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
    const rig = buildRig(P);
    for (const b of rig.bones) for (const v of [...b.head, ...b.tail]) if (!isFinite(v)) throw new Error('sendi tidak valid');

    // Kerangka
    const bones: Partial<Record<BoneName, THREE.Bone>> = {}, rest: Partial<Record<BoneName, THREE.Vector3>> = {};
    const list: THREE.Bone[] = [];
    rig.bones.forEach((d) => {
      const b = new THREE.Bone(); b.name = d.name;
      const par = d.parent ? rig.bones.find((q) => q.name === d.parent)! : null;
      b.position.set(d.head[0] - (par ? par.head[0] : 0), d.head[1] - (par ? par.head[1] : 0), d.head[2] - (par ? par.head[2] : 0));
      bones[d.name] = b; rest[d.name] = b.position.clone(); list.push(b);
      if (par) bones[par.name]!.add(b);
    });
    obj.add(bones.hips!);
    obj.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(list);
    const headIdx = rig.bones.findIndex((b) => b.name === 'head');

    // Ganti mesh statis dengan SkinnedMesh
    for (const { m, g } of baked) {
      const n = g.attributes.position.count;
      if (g === body.g) {
        const q = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { q[i * 3] = g.attributes.position.getX(i); q[i * 3 + 1] = g.attributes.position.getY(i); q[i * 3 + 2] = g.attributes.position.getZ(i); }
        const w = skinWeights(q, rig);
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(w.index, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w.weight, 4));
      } else { // mesh kecil (mata, dsb.): menempel kaku di kepala
        const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { idx[i * 4] = headIdx; wt[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
      }
      const sm = new THREE.SkinnedMesh(g, m.material);
      sm.name = m.name; sm.castShadow = true; sm.receiveShadow = m.receiveShadow; sm.frustumCulled = false;
      obj.add(sm); sm.updateMatrixWorld(true);
      sm.bind(skeleton);
      m.removeFromParent(); m.geometry.dispose();
    }
    return { rig, bones, rest };
  } catch (e) {
    console.warn('Auto-rig gagal, memakai animasi sederhana', e);
    return null;
  }
}
