// Permukaan aspal & logam (PBR 512px dari public/textures) untuk: dinding+lantai tangga, dan semua lantai ruang tahanan.
// UV dihitung ulang dalam METER (box-projection per muka) -> tekstur tidak melar walau UV asli GLB cuma 1 tile untuk seluruh lantai.
// Material dibuat polos dulu (warna gelap) lalu peta dipasang setelah semua file termuat (tanpa kilatan hitam/cermin); tes node (tanpa document) = tetap polos.
import * as THREE from 'three';
import { applyMaterialEnv, loadPbr } from './materials';

export type SurfKind = 'asphalt' | 'metal';

/** Ukuran 1 tile tekstur di dunia (meter). */
const TILE: Record<SurfKind, number> = { asphalt: 1.8, metal: 1.4 };

/** Material permukaan. userData.surf = true -> World.dispose ikut melepas semua peta (lihat disposeSurface). */
export function makeSurface(kind: SurfKind, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const asphalt = kind === 'asphalt';
  const m = new THREE.MeshStandardMaterial({ color: asphalt ? 0x4a4945 : 0x4c4a47, roughness: asphalt ? 0.92 : 0.7, metalness: asphalt ? 0 : 0.5, side });
  m.userData.surf = true;
  const files = asphalt
    ? [{ key: 'd', file: 'floor_diff.jpg', srgb: true }, { key: 'orm', file: 'floor_orm.jpg' }, { key: 'nor', file: 'floor_nor.jpg' }]
    : [{ key: 'd', file: 'metal_diff.jpg', srgb: true }, { key: 'orm', file: 'metal_orm.jpg' }, { key: 'nor', file: 'metal_nor.jpg' }];
  loadPbr(files, 1, (t) => {
    m.map = t.d; m.normalMap = t.nor; m.roughnessMap = t.orm;
    if (asphalt) { m.color.setHex(0xb8b6b0); m.roughness = 1; m.normalScale.set(0.9, 0.9); }
    else { m.color.setHex(0xc4c2be); m.roughness = 0.85; m.metalness = 0.55; m.metalnessMap = t.orm; m.normalScale.set(0.7, 0.7); applyMaterialEnv(m, 0.45); }
    m.needsUpdate = true;
  });
  return m;
}

/** Lepas peta material permukaan (map/normal/roughness/metalness). */
export function disposeSurface(m: any) {
  if (!m?.userData?.surf) return;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) m[k]?.dispose?.();
}

/** UV dari posisi (dikali `m` bila ada) dengan proyeksi sumbu dominan normal: lantai/atap = xz, dinding = zy / xy. Satuan meter / tile. */
export function boxProjectUV(g: THREE.BufferGeometry, kind: SurfKind, m?: THREE.Matrix4 | null) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'); if (!pos) return;
  const tile = TILE[kind], uv = new Float32Array(pos.count * 2), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); if (m) v.applyMatrix4(m);
    if (nor) { n.fromBufferAttribute(nor, i); if (nm) n.applyMatrix3(nm); } else n.set(0, 1, 0);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u: number, w: number;
    if (ay >= ax && ay >= az) { u = v.x; w = v.z; } else if (ax >= az) { u = v.z; w = v.y; } else { u = v.x; w = v.y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = w / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Tangga (Stairs_A_Steps): anak tangga (muka menghadap atas) = ASPAL, dinding samping/riser = LOGAM. Satu mesh, dua group, geometri (posisi) tidak berubah.
 * Mengembalikan 2 material baru (dibuang bersama root oleh World.dispose) atau null bila mesh tidak cocok.
 */
export function retexStairs(mesh: THREE.Mesh): THREE.Material[] | null {
  const g = mesh.geometry as THREE.BufferGeometry, nor = g?.getAttribute('normal'), idx = g?.index;
  if (!g || !nor || !idx || Array.isArray(mesh.material)) return null;
  mesh.updateWorldMatrix(true, false);
  const ia = idx.array as Uint16Array | Uint32Array, up: number[] = [], side: number[] = [];
  for (let i = 0; i < ia.length; i += 3) {
    const ny = (nor.getY(ia[i]) + nor.getY(ia[i + 1]) + nor.getY(ia[i + 2])) / 3;   // muka datar: normal per muka sama; node bisa berotasi -> dianggap tidak (map lurus)
    (ny > 0.5 ? up : side).push(ia[i], ia[i + 1], ia[i + 2]);
  }
  const out = new (ia.constructor as any)(ia.length) as Uint16Array | Uint32Array; out.set(up, 0); out.set(side, up.length);
  g.setIndex(new THREE.BufferAttribute(out, 1));
  g.clearGroups(); if (up.length) g.addGroup(0, up.length, 0); if (side.length) g.addGroup(up.length, side.length, 1);
  // UV memakai ruang DUNIA (mesh statis) supaya skala meter benar; proyeksi dipisah per jenis permukaan (tile berbeda) -> 2 pass pada subset muka
  const uvA = new Float32Array(nor.count * 2);
  boxProjectUV(g, 'asphalt', mesh.matrixWorld); const a = g.getAttribute('uv').array as Float32Array; uvA.set(a);
  boxProjectUV(g, 'metal', mesh.matrixWorld); const b = g.getAttribute('uv').array as Float32Array;
  for (let i = 0; i < up.length; i++) { const k = up[i] * 2; b[k] = uvA[k]; b[k + 1] = uvA[k + 1]; }   // vertex per-muka (tidak dibagi lintas jenis)
  g.getAttribute('uv').needsUpdate = true;
  const asphalt = makeSurface('asphalt'), metal = makeSurface('metal');
  mesh.material = [asphalt, metal];
  return [asphalt, metal];
}

/** Pagar/dinding pengaman tangga (Stairs_A_Railings): sebelumnya abu-abu polos -> pelat LOGAM bertekstur (UV meter, dua sisi). */
export function retexRailings(mesh: THREE.Mesh): THREE.Material | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  if (!g || Array.isArray(mesh.material)) return null;
  mesh.updateWorldMatrix(true, false);
  boxProjectUV(g, 'metal', mesh.matrixWorld);
  const m = makeSurface('metal', THREE.DoubleSide); mesh.material = m; return m;
}
