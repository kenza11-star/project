// Tampilan 3D monster (three.js): memuat GLB yang sudah dipasangi tulang (scripts/rig-monster.py), memainkan klip idle/walk/run/grab,
// dan menempatkan monster untuk jumpscare (tangan menjangkau & menutupi kamera). Logika AI/jaringan TIDAK ada di sini (lihat lib/game/monster*.ts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as CFG from '../game/config';
import type { MonAnim } from '../game/monster';
import { JS_FACE_DIST, JS_FACE_ABOVE, type JsFrame } from '../game/monsterfx';

const dev = process.env.NODE_ENV !== 'production';
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3(), _mid = new THREE.Vector3(), _want = new THREE.Vector3(), _h = new THREE.Vector3();
const TIP = new THREE.Vector3(0.011, -0.264, 0.11);   // ujung jari relatif pergelangan (ruang tulang, sudah diskalakan 1,1x)
const NAMES: MonAnim[] = ['idle', 'walk', 'run', 'grab'];
// Jumpscare: klip 'grab' tidak diubah (tanpa IK lengan); hanya badan monster yang condong & bergeser agar wajahnya dekat kamera.
const LEAN_MAX = 1.1;   // condong maksimum (rad)

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
    this.root.name = 'GauntCreature'; this.root.rotation.order = 'YXZ'; this.root.visible = false; this.root.add(g.scene); scene.add(this.root);
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
        if (CFG.MONSTER_GLOW > 0) for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { const s = mt as THREE.MeshStandardMaterial; if (s.isMeshStandardMaterial && s.map && s.emissive) { s.emissiveMap = s.map; s.emissive.setScalar(CFG.MONSTER_GLOW); s.needsUpdate = true; } }   // tekstur sedikit menyala sendiri: monster tetap terlihat di lorong gelap
      } }); // kerangka kulit bergerak jauh dari pose awal: jangan di-cull
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
    // 'drag' (menyeret korban): belum ada klip khusus di model -> memakai klip 'walk' dengan irama menyesuaikan kecepatan seret
    const key: MonAnim = name === 'drag' ? 'walk' : name, next = this.act[key]; if (!next) return; const prev = this.act[this.cur === 'drag' ? 'walk' : this.cur];
    if (name !== this.cur) {
      next.reset(); next.enabled = true; next.setEffectiveWeight(1);
      if (prev && fade > 0) next.crossFadeFrom(prev, fade, false); else prev?.stop();
      next.play(); this.cur = name;
    }
    next.setEffectiveTimeScale(key === 'walk' ? THREE.MathUtils.clamp(speed / CFG.MONSTER_PATROL_SPEED, 0.6, 1.6) : key === 'run' ? THREE.MathUtils.clamp(speed / CFG.MONSTER_CHASE_SPEED, 0.75, 1.3) : 1);
  }
  place(x: number, y: number, z: number, yaw: number) { this.root.position.set(x, y, z); this.root.rotation.x = 0; this.root.rotation.y = yaw; }
  /** Titik tengah pergelangan monster (posisi dunia bone Hand_L & Hand_R): tempat pergelangan kaki korban dipegang saat diseret (klip walk, lengan tidak diregangkan). false bila belum siap. */
  wristMid(out: THREE.Vector3): boolean {
    if (!this.handL || !this.handR) return false;
    this.root.updateMatrixWorld(true);
    this.handL.getWorldPosition(_p); this.handR.getWorldPosition(out); out.add(_p).multiplyScalar(0.5); return true;
  }
  /** Dipanggil tiap frame; di luar jarak/lantai (show=false) model tidak digambar dan tidak dianimasikan -> hemat FPS HP. */
  update(dt: number, show: boolean) { this.root.visible = show; if (show && !this.grabbing) this.mixer.update(dt); }

  // ---- jumpscare: pose klip 'grab' dikendalikan manual oleh timeline (sinkron dengan kamera & suara) ----
  beginGrab() {
    const a = this.act.grab; if (!a) return; this.grabbing = true;
    for (const k of NAMES) if (k !== 'grab') this.act[k]?.stop();
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(0); a.play(); this.cur = 'grab';
  }
  endGrab() { this.grabbing = false; this.root.rotation.x = 0; this.act.grab?.stop(); this.cur = 'idle'; this.setAnim('idle', 0); }
  private setGrabTime(t: number) { const a = this.act.grab; if (!a) return; a.time = Math.min(Math.max(0, t), a.getClip().duration); this.mixer.update(0); }
  /** Titik tengah ujung jari kedua tangan (dunia). */
  handsTip(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0); let n = 0;
    for (const h of [this.handL, this.handR]) { if (!h) continue; h.getWorldPosition(_p); h.getWorldQuaternion(_q); _o.copy(TIP).applyQuaternion(_q); out.add(_p).add(_o); n++; }
    return n ? out.multiplyScalar(1 / n) : out;
  }
  headPos(out: THREE.Vector3): THREE.Vector3 { return this.head ? this.head.getWorldPosition(out) : out.copy(this.root.position); }
  /** Tempatkan monster di depan kamera (reach 0..1): condong sampai kepalanya sedikit di atas kamera, lalu geser sampai wajah ~JS_FACE_DIST di depan kamera.
   *  Klip 'grab' sudah menghadapkan wajah ke kamera; kamera sedikit di bawah kepala agar wajah terlihat. camYaw: arah hadap kamera (rotation.y). */
  placeForJumpscare(cam: THREE.Camera, camYaw: number, floorY: number, f: JsFrame) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), px = cam.position.x + fx * f.dist, pz = cam.position.z + fz * f.dist;
    const yaw = Math.atan2(cam.position.x - px, cam.position.z - pz), sy = Math.sin(yaw), cy = Math.cos(yaw);
    this.root.position.set(px, floorY, pz); this.root.rotation.set(0, yaw, 0);
    this.setGrabTime(f.grabT); this.root.updateMatrixWorld(true);
    if (!this.head) return;
    // 1) condong ke depan (sumbu lokal monster) sampai tinggi kepala = tinggi kamera + JS_FACE_ABOVE (hanya bila kepala lebih tinggi; tidak pernah mengangkat monster)
    this.head.getWorldPosition(_h); _o.copy(_h).sub(this.root.position);
    const zf = _o.x * sy + _o.z * cy, hy = _o.y, ty = cam.position.y - floorY + JS_FACE_ABOVE; let best = 0, bd = Infinity;
    for (let i = 0; i <= 24; i++) { const th = (i / 24) * LEAN_MAX, d = Math.abs(hy * Math.cos(th) - zf * Math.sin(th) - ty); if (d < bd) { bd = d; best = th; } }
    this.root.rotation.x = best * f.reach; this.root.updateMatrixWorld(true);
    // 2) geser horizontal sampai wajah tepat JS_FACE_DIST di depan kamera
    this.head.getWorldPosition(_h); _want.set(cam.position.x + fx * JS_FACE_DIST, 0, cam.position.z + fz * JS_FACE_DIST);
    this.root.position.x += (_want.x - _h.x) * f.reach; this.root.position.z += (_want.z - _h.z) * f.reach; this.root.updateMatrixWorld(true);
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
