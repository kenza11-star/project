// Aset kaleng NORVIX Soda (GLB asli: Can_Body dengan vertex color + material Aluminium + Pull_Tab).
// - Material, vertex color, dan ukuran asli (~6,6 cm x 11,5 cm) dipertahankan; hanya ditambah envMap game agar logam tidak hitam.
// - Model asli ~224 ribu segitiga: dipakai penuh bila dekat, proxy silinder murah bila jauh, dan tidak digambar bila sangat jauh.
// - Hanya bola bidik tak terlihat yang didaftarkan ke sistem interaksi (raycast ke 224 ribu segitiga tiap bidikan akan berat di HP).
import * as THREE from 'three';
import { getMaterialEnv } from './materials';

export const SODA_H = 0.1152;      // tinggi kaleng (m) dari GLB: Aluminium y 0..0.1152
export const SODA_R = 0.033;       // radius kaleng (m)

export interface SodaInst { group: THREE.Group; detail: THREE.Object3D | null; proxy: THREE.Mesh; hit: THREE.Mesh }

export class SodaAsset {
  private src: THREE.Object3D | null;
  private proxyGeo: THREE.CylinderGeometry;
  private proxyMats: THREE.Material[];
  private hitGeo: THREE.SphereGeometry;
  private hitMat = new THREE.MeshBasicMaterial({ visible: false });
  private own: THREE.Material[] = [];

  constructor(gltfScene: THREE.Object3D | null) {
    this.src = gltfScene;
    const env = getMaterialEnv();
    let label = new THREE.Color(0xb02020), alu: THREE.Material | null = null;
    if (gltfScene) {
      const sumC = new THREE.Color(0, 0, 0); let n = 0;
      gltfScene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = true; // kaleng kecil: tidak perlu masuk shadow pass
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (env && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) { (m as THREE.MeshStandardMaterial).envMap = env; (m as THREE.MeshStandardMaterial).envMapIntensity = 0.8; m.needsUpdate = true; }
          if (m.name === 'Aluminium') alu = m;
        }
        const col = o.geometry?.attributes?.color;
        if (col) { const step = Math.max(1, Math.floor(col.count / 400)); for (let i = 0; i < col.count; i += step) { sumC.r += col.getX(i); sumC.g += col.getY(i); sumC.b += col.getZ(i); n++; } }
      });
      if (n) label = sumC.multiplyScalar(1 / n);
    }
    // proxy jarak jauh: badan berwarna rata-rata label + tutup/dasar aluminium (material aluminium GLB dipakai ulang)
    this.proxyGeo = new THREE.CylinderGeometry(SODA_R, SODA_R, SODA_H - 0.005, 18, 1);
    this.proxyGeo.translate(0, SODA_H / 2 + 0.0025, 0);
    const body = new THREE.MeshStandardMaterial({ color: label, metalness: 0.35, roughness: 0.45 });
    if (env) { body.envMap = env; body.envMapIntensity = 0.6; }
    this.own.push(body);
    this.proxyMats = [body, (alu as THREE.Material | null) ?? body, (alu as THREE.Material | null) ?? body]; // grup silinder: sisi, atas, bawah
    this.hitGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  get loaded(): boolean { return !!this.src; }

  /** Satu kaleng: origin di dasar kaleng (sisi bawah menempel permukaan). Klon berbagi geometri & material (tanpa memori ganda). */
  make(hitRadius: number): SodaInst {
    const group = new THREE.Group();
    const detail = this.src ? this.src.clone(true) : null;
    if (detail) group.add(detail);
    const proxy = new THREE.Mesh(this.proxyGeo, this.proxyMats as any);
    proxy.visible = !detail; proxy.castShadow = false; proxy.receiveShadow = false; group.add(proxy);
    const hit = new THREE.Mesh(this.hitGeo, this.hitMat);
    hit.scale.setScalar(hitRadius); hit.position.y = SODA_H / 2; group.add(hit);
    return { group, detail, proxy, hit };
  }

  /** Pilih representasi menurut jarak ke kamera (kuadrat jarak, m^2). */
  static lod(i: SodaInst, d2: number, near: number, cull: number): void {
    const n2 = near * near, c2 = cull * cull;
    if (i.detail) i.detail.visible = d2 < n2;
    i.proxy.visible = d2 >= n2 && d2 < c2;
    if (!i.detail) i.proxy.visible = d2 < c2;
  }

  dispose(): void {
    this.src?.traverse((o: any) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m?.map?.dispose(); m?.dispose(); }
    });
    this.src = null;
    this.proxyGeo.dispose(); this.hitGeo.dispose(); this.hitMat.dispose();
    this.own.forEach((m) => m.dispose());
  }
}
