import * as THREE from 'three';
import { Character, loadCharacter, loadDefaultCharacter, type Gait } from './character';
import * as tx from './textures';

export class LobbyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  private room = new THREE.Group();
  private fog = new THREE.FogExp2(0x15110a, 0.09);
  private lamp: THREE.SpotLight;
  private slots: (Character | null)[] = [null, null];
  private ids = [0, 0];
  private labels: HTMLDivElement[] = [];
  private duo = false; private showPartner = false;
  private cmd: { gait: Gait; crouch: boolean } = { gait: 0, crouch: false };
  private raf = 0; private last = 0; private flick = 0; private disposed = false; private w = 1; private h = 1;
  private ro: ResizeObserver;
  private v = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = this.fog;
    const add = (w: number, h: number, map: THREE.Texture, x: number, y: number, z: number, rx: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; this.room.add(m);
    };
    add(6, 14, tx.floor(3, 7), 0, 0, -1.5, -Math.PI / 2, 0);
    add(6, 14, tx.ceiling(3, 7), 0, 3, -1.5, Math.PI / 2, 0);
    add(6, 3, tx.wallpaper(3, 1.5), 0, 1.5, -7, 0, 0);
    add(14, 3, tx.wallpaper(7, 1.5), -3, 1.5, -1.5, 0, Math.PI / 2);
    add(14, 3, tx.wallpaper(7, 1.5), 3, 1.5, -1.5, 0, -Math.PI / 2);
    for (const z of [-1, -5]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
      f.position.set(0, 2.97, z); this.room.add(f);
    }
    this.scene.add(this.room);
    this.scene.add(new THREE.AmbientLight(0xb09a60, 0.9));
    this.scene.add(new THREE.HemisphereLight(0xffeeaa, 0x332200, 0.5));
    this.lamp = new THREE.SpotLight(0xffe9a0, 90, 0, 0.8, 0.6, 2);
    this.lamp.position.set(0.3, 2.8, 1.8); this.lamp.target.position.set(0, 0.8, 0);
    this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(512, 512); this.lamp.shadow.bias = -0.0005;
    this.scene.add(this.lamp, this.lamp.target);
    for (let i = 0; i < 2; i++) {
      const d = document.createElement('div'); d.className = 'nlabel'; host.appendChild(d); this.labels.push(d);
    }
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  private resize() {
    this.w = Math.max(1, this.host.clientWidth); this.h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    const a = this.w / this.h;
    this.camera.aspect = a;
    this.camera.position.set(0, 1.3, 4.3 + Math.max(0, 1.5 - a) * 2.2);
    this.camera.lookAt(0, 0.95, 0);
    this.camera.updateProjectionMatrix();
  }
  configure(duo: boolean, showPartner: boolean, names: [string, string]) {
    this.duo = duo; this.showPartner = showPartner;
    this.labels[0].textContent = names[0]; this.labels[1].textContent = names[1];
    this.layout();
  }
  private layout() {
    this.slots.forEach((c, i) => {
      const show = i === 0 || (this.duo && this.showPartner);
      this.labels[i].style.display = show && c ? 'block' : 'none';
      if (!c) return;
      c.root.visible = show;
      c.setHome(this.duo ? (i === 0 ? -0.75 : 0.75) : 0, 0, this.duo ? (i === 0 ? 0.22 : -0.22) : 0, this.duo ? 0.4 : 1.1);
    });
  }
  // Ganti karakter slot. Model lama di-dispose. Mengembalikan false bila request sudah usang.
  async setModel(i: number, src: { blob: Blob | null; ext: string } | null, onProgress?: (p: number) => void): Promise<boolean> {
    const id = ++this.ids[i];
    // Slot 0 (pemain) default = model James; slot 1 (teman) tetap boneka sederhana.
    let ch: Character;
    try {
      ch = src && src.blob ? await loadCharacter(src.blob, src.ext, onProgress)
        : i === 0 ? await loadDefaultCharacter(onProgress) : Character.createDefault(i);
    } catch (e) {
      // Gagal dan slot masih kosong (mis. file tersimpan rusak): tampilkan karakter default supaya tidak kosong.
      if (!this.slots[i] && !this.disposed && id === this.ids[i]) await this.setModel(i, null).catch(() => false);
      throw e;
    }
    if (this.disposed || id !== this.ids[i]) { ch.dispose(); return false; }
    const old = this.slots[i];
    if (old) old.dispose();
    this.slots[i] = ch; this.scene.add(ch.root);
    if (i === 0) ch.setCommand(this.cmd.gait, this.cmd.crouch);
    this.layout();
    return true;
  }
  // Tombol animasi di lobby: berlaku untuk karakter pemain (slot 0)
  setAnim(gait: Gait, crouch: boolean) { this.cmd = { gait, crouch }; this.slots[0]?.setCommand(gait, crouch); }
  jump() { this.slots[0]?.jump(); }
  start() {
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) { this.last = t; return; }
      const dt = Math.min((t - this.last) / 1000, 0.05); this.last = t;
      for (const c of this.slots) c?.update(dt);
      if (this.flick > 0) this.flick -= dt; else if (Math.random() < 0.004) this.flick = 0.12;
      this.lamp.intensity = this.flick > 0 ? 35 : 90;
      this.renderer.render(this.scene, this.camera);
      this.slots.forEach((c, i) => {
        if (!c || !c.root.visible) return;
        this.v.set(c.root.position.x, 1.95, c.root.position.z).project(this.camera);
        this.labels[i].style.transform = `translate(${(this.v.x * 0.5 + 0.5) * this.w}px,${(-this.v.y * 0.5 + 0.5) * this.h}px) translate(-50%,-110%)`;
      });
    };
    this.raf = requestAnimationFrame(loop);
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect();
    this.slots.forEach((c) => c?.dispose());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mt: any) => { mt.map?.dispose(); mt.dispose(); });
    });
    this.lamp.shadow.map?.dispose();
    this.labels.forEach((l) => l.remove());
    this.renderer.dispose();
  }
}
