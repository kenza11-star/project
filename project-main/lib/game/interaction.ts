import * as THREE from 'three';

// Sistem interaksi reusable: raycast dari tengah kamera (crosshair) -> objek yang terdaftar.
// Daftarkan objek lewat register(); prompt() menentukan teks (null = tidak ada prompt), interact() aksi saat tombol ditekan.
export type InteractKind = 'container' | 'pickup' | 'key' | 'lock' | 'door' | 'exit' | 'ladder' | 'hide';

export interface Interactable<C> {
  id: string;
  kind: InteractKind;
  prompt(ctx: C): string | null;
  interact(ctx: C): void;
  reach?: number;
  /** Objek pelindung (mis. furniture tempat key berada): mesh miliknya tidak dianggap penghalang bidikan. */
  shelter?: THREE.Object3D;
  runScoped?: boolean; // dihapus saat run baru
}
export interface Target<C> { it: Interactable<C>; dist: number; object: THREE.Object3D; point?: THREE.Vector3 }

const KEY = '__ix';

export class InteractionSystem<C> {
  reach: number;
  current: Target<C> | null = null;
  private targets: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private all: THREE.Object3D[] = [];
  private dirty = true;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2(0, 0); // tengah layar = posisi crosshair
  private frame = 0;
  private lastPos = new THREE.Vector3();
  private lastQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private idle = 0;
  private hasLast = false;

  constructor(reach = 2.4) { this.reach = reach; }

  register(it: Interactable<C>, objects: THREE.Object3D[]): void {
    for (const o of objects) o.traverse((m: any) => { if (m.isMesh) { m.userData[KEY] = it; this.targets.push(m); } });
    this.dirty = true;
  }
  unregister(it: Interactable<C>): void {
    this.targets = this.targets.filter((m) => m.userData[KEY] !== it);
    if (this.current?.it === it) this.current = null;
    this.dirty = true;
  }
  removeWhere(pred: (it: Interactable<C>) => boolean): void {
    this.targets = this.targets.filter((m) => { const it = m.userData[KEY] as Interactable<C>; return !(it && pred(it)); });
    if (this.current && pred(this.current.it)) this.current = null;
    this.dirty = true;
  }
  addOccluders(objs: THREE.Object3D[]): void { for (const o of objs) o.traverse((m: any) => { if (m.isMesh && !m.userData[KEY]) this.occluders.push(m); }); this.dirty = true; }
  removeOccluders(objs: THREE.Object3D[]): void {
    const set = new Set<THREE.Object3D>();
    for (const o of objs) o.traverse((m) => set.add(m));
    this.occluders = this.occluders.filter((m) => !set.has(m));
    this.dirty = true;
  }

  private visibleChain(o: THREE.Object3D | null): boolean { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

  private inside(o: THREE.Object3D, root: THREE.Object3D): boolean { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true; return false; }

  /** Panggil tiap frame. Raycast dibatasi ~20 Hz, dan dilewati bila kamera diam (hanya dicek ulang tiap ~0.3 dtk) agar ringan di HP. */
  update(cam: THREE.Camera, ctx: C, every = 3): Target<C> | null {
    const force = every === 1;
    if (!force) {
      if ((this.frame++ % every) !== 0) { // frame di antara dua raycast: pakai hasil terakhir
        if (this.current && this.current.it.prompt(ctx) === null) this.current = null;
        return this.current;
      }
      cam.getWorldPosition(this.tmpPos); cam.getWorldQuaternion(this.tmpQuat);
      const same = this.hasLast && this.tmpPos.distanceToSquared(this.lastPos) < 1e-6 && this.tmpQuat.angleTo(this.lastQuat) < 1e-4 && !this.dirty;
      if (same && ++this.idle < 6) { if (this.current && this.current.it.prompt(ctx) === null) this.current = null; return this.current; }
      this.idle = 0; this.lastPos.copy(this.tmpPos); this.lastQuat.copy(this.tmpQuat); this.hasLast = true;
    }
    if (this.dirty) { this.all = this.targets.concat(this.occluders); this.dirty = false; }
    this.ray.setFromCamera(this.ndc, cam);
    this.ray.far = this.reach + 0.5;
    const hits = this.ray.intersectObjects(this.all, false);
    // key yang terlihat & dalam jangkauan: furniture pemiliknya tidak boleh menghalangi bidikan
    const shelters: THREE.Object3D[] = [];
    for (const h of hits) {
      const it = h.object.userData[KEY] as Interactable<C> | undefined;
      if (it && it.kind === 'key' && it.shelter && this.visibleChain(h.object) && h.distance <= (it.reach ?? this.reach) && it.prompt(ctx) !== null) shelters.push(it.shelter);
    }
    this.current = null;
    let cand: Target<C> | null = null;
    for (const h of hits) {
      if (!this.visibleChain(h.object)) continue;
      const it = h.object.userData[KEY] as Interactable<C> | undefined;
      if (!it) { // objek biasa: penghalang, kecuali bagian dari furniture pemilik key yang sedang dibidik
        if (shelters.length && shelters.some((r) => this.inside(h.object, r))) continue;
        break;
      }
      if (h.distance > (it.reach ?? this.reach)) { if (it.kind === 'key') continue; break; }
      // prompt null = objek 'tembus' bagi crosshair -> lanjut ke objek di belakangnya
      if (it.prompt(ctx) === null) continue;
      if (it.kind === 'key') { cand = { it, dist: h.distance, object: h.object, point: h.point }; break; } // key diprioritaskan
      if (!cand) cand = { it, dist: h.distance, object: h.object, point: h.point };
    }
    this.current = cand;
    return this.current;
  }

  /** Raycast ulang segera (dipanggil saat tombol interaksi ditekan, agar target selalu terbaru). */
  refresh(cam: THREE.Camera, ctx: C): Target<C> | null { return this.update(cam, ctx, 1); }

  prompt(ctx: C): string | null { return this.current ? this.current.it.prompt(ctx) : null; }

  /** Tekan tombol interaksi: jalankan target di bawah crosshair. */
  activate(ctx: C): boolean {
    if (!this.current) return false;
    this.current.it.interact(ctx);
    return true;
  }
  /** Paksa raycast ulang pada pemanggilan update berikutnya (state dunia berubah: container terbuka, pintu bergerak, dll). */
  invalidate(): void { this.hasLast = false; }
  clear(): void { this.targets = []; this.occluders = []; this.all = []; this.current = null; this.dirty = true; this.hasLast = false; }
}
