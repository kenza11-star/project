// Environment map kecil & gelap (sekali, PMREM): ruang tertutup gelap + panel lampu hangat di plafon.
// Tanpa env map, material logam/kayu berkilap terlihat hitam/plastik. Dengan ini logam memantulkan panel lampu (garis terang), tapi ambient diffuse nyaris nol.
import * as THREE from 'three';

export function buildEnv(r: THREE.WebGLRenderer): { tex: THREE.Texture; dispose: () => void } {
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.045, 0.03), side: THREE.BackSide }));
  sc.add(room);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(9) });
  const lampGeo = new THREE.PlaneGeometry(1.2, 0.6); const geos: THREE.BufferGeometry[] = [room.geometry, lampGeo];
  for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5], [0, 0]]) { const m = new THREE.Mesh(lampGeo, lampMat); m.position.set(x, 1.55, z); m.rotation.x = Math.PI / 2; sc.add(m); }
  const pm = new THREE.PMREMGenerator(r); const rt = pm.fromScene(sc, 0.06); pm.dispose();
  geos.forEach((g) => g.dispose()); (room.material as THREE.Material).dispose(); lampMat.dispose();
  return { tex: rt.texture, dispose: () => rt.dispose() };
}
