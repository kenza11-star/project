// Tampilan 3D monster (three.js): memuat GLB yang sudah dipasangi tulang (scripts/rig-monster.py), memainkan klip idle/walk/run/grab,
// dan menempatkan monster untuk jumpscare (tangan menjangkau & menutupi kamera). Logika AI/jaringan TIDAK ada di sini (lihat lib/game/monster*.ts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as CFG from '../game/config';
import type { MonAnim } from '../game/monster';
import type { JsFrame } from '../game/monsterfx';

const dev = process.env.NODE_ENV !== 'production';
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3(), _mid = new THREE.Vector3(), _want = new THREE.Vector3();
const TIP = new THREE.Vector3(0.011, -0.264, 0.11);   // ujung jari relatif pergelangan (ruang tulang, sudah diskalakan 1,1x)
const NAMES: MonAnim[] = ['idle', 'walk', 'run', 'grab'];

export class MonsterView {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private act: Partial<Record<MonAnim, THREE.AnimationAction>> = {};
  private cur: MonAnim = 'idle';
  private handL: THREE.Object3D | null; private handR: THREE.Object3D | null; private head: THREE.Object3D | null;
  private disposed = false; private grabbing = false;

  /** Muat model; null bila gagal (monster dinonaktifkan, game tetap berjalan). */
  static async load(scene: THREE.Scene, url: string): Promise<MonsterView | null> {
    try { const g = await new GLTFLoader().loadAsync(url); return new MonsterView(scene, g); }
    catch (e) { if (dev) console.warn('[monster] model gagal dimuat:', e); return null; }
  }
  private constructor(private scene: THREE.Scene, g: GLTF) {
    this.root.name = 'GauntCreature'; this.root.visible = false; this.root.add(g.scene); scene.add(this.root);
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; } }); // kerangka kulit bergerak jauh dari pose awal: jangan di-cull
    this.mixer = new THREE.AnimationMixer(g.scene);
    for (const clip of g.animations) {
      const n = clip.name as MonAnim; if (!NAMES.includes(n)) continue;
      const a = this.mixer.clipAction(clip); if (n === 'grab') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
      this.act[n] = a;
    }
    this.handL = g.scene.getObjectByName('Hand_L') || null; this.handR = g.scene.getObjectByName('Hand_R') || null; this.head = g.scene.getObjectByName('Head') || null;
    this.setAnim('idle', 0);
  }
  get ready(): boolean { return !this.disposed && !!this.act.idle && !!this.act.walk && !!this.act.run && !!this.act.grab && !!this.handL && !!this.handR && !!this.head; }

  /** Ganti klip dengan crossfade; timeScale menyesuaikan irama langkah dengan kecepatan gerak. */
  setAnim(name: MonAnim, fade = 0.25, speed = 0) {
    if (this.grabbing && name !== 'grab') return;
    const next = this.act[name]; if (!next) return; const prev = this.act[this.cur];
    if (name !== this.cur) {
      next.reset(); next.enabled = true; next.setEffectiveWeight(1);
      if (prev && fade > 0) next.crossFadeFrom(prev, fade, false); else prev?.stop();
      next.play(); this.cur = name;
    }
    next.setEffectiveTimeScale(name === 'walk' ? THREE.MathUtils.clamp(speed / CFG.MONSTER_PATROL_SPEED, 0.6, 1.6) : name === 'run' ? THREE.MathUtils.clamp(speed / CFG.MONSTER_CHASE_SPEED, 0.75, 1.3) : 1);
  }
  place(x: number, y: number, z: number, yaw: number) { this.root.position.set(x, y, z); this.root.rotation.y = yaw; }
  /** Dipanggil tiap frame; di luar jarak/lantai (show=false) model tidak digambar dan tidak dianimasikan -> hemat FPS HP. */
  update(dt: number, show: boolean) { this.root.visible = show; if (show && !this.grabbing) this.mixer.update(dt); }

  // ---- jumpscare: pose klip 'grab' dikendalikan manual oleh timeline (sinkron dengan kamera & suara) ----
  beginGrab() {
    const a = this.act.grab; if (!a) return; this.grabbing = true;
    for (const k of NAMES) if (k !== 'grab') this.act[k]?.stop();
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(0); a.play(); this.cur = 'grab';
  }
  endGrab() { this.grabbing = false; this.act.grab?.stop(); this.cur = 'idle'; this.setAnim('idle', 0); }
  private setGrabTime(t: number) { const a = this.act.grab; if (!a) return; a.time = Math.min(Math.max(0, t), a.getClip().duration); this.mixer.update(0); }
  /** Titik tengah ujung jari kedua tangan (dunia). */
  handsTip(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0); let n = 0;
    for (const h of [this.handL, this.handR]) { if (!h) continue; h.getWorldPosition(_p); h.getWorldQuaternion(_q); _o.copy(TIP).applyQuaternion(_q); out.add(_p).add(_o); n++; }
    return n ? out.multiplyScalar(1 / n) : out;
  }
  headPos(out: THREE.Vector3): THREE.Vector3 { return this.head ? this.head.getWorldPosition(out) : out.copy(this.root.position); }
  /** Tempatkan monster di depan kamera lalu geser agar tangannya menutupi kamera (reach 0..1). camYaw: arah hadap kamera (rotation.y). */
  placeForJumpscare(cam: THREE.Camera, camYaw: number, floorY: number, f: JsFrame) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), px = cam.position.x + fx * f.dist, pz = cam.position.z + fz * f.dist;
    this.root.position.set(px, floorY, pz); this.root.rotation.y = Math.atan2(cam.position.x - px, cam.position.z - pz);
    this.setGrabTime(f.grabT); this.root.updateMatrixWorld(true);
    this.handsTip(_mid); _want.set(cam.position.x + fx * 0.3, cam.position.y - 0.04, cam.position.z + fz * 0.3);
    this.root.position.addScaledVector(_want.sub(_mid), f.reach); this.root.updateMatrixWorld(true);
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.mixer.stopAllAction(); this.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) { const s = mt as THREE.MeshStandardMaterial; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) s[k]?.dispose(); s.dispose(); }
    });
  }
}
