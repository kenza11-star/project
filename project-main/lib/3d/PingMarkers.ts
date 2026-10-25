// STAGE 4 -- penanda ping 3D (dilihat semua pemain). Sprite tanpa depth test (tembus dinding, ukuran layar konstan) + nama pengirim; hilang sendiri.
import * as THREE from 'three';

interface Mk { sp: THREE.Sprite; until: number; life: number }

function draw(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.85)'; g.fillStyle = '#e8c860';
  g.beginPath(); g.moveTo(128, 150); g.bezierCurveTo(60, 90, 80, 22, 128, 22); g.bezierCurveTo(176, 22, 196, 90, 128, 150); g.closePath(); g.stroke(); g.fill();   // pin
  g.fillStyle = 'rgba(0,0,0,.8)'; g.beginPath(); g.arc(128, 74, 17, 0, Math.PI * 2); g.fill();
  g.font = 'bold 34px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8;
  const t = name.length > 12 ? name.slice(0, 11) + '.' : name;
  g.strokeStyle = 'rgba(0,0,0,.9)'; g.strokeText(t, 128, 196); g.fillStyle = '#f3ead0'; g.fillText(t, 128, 196);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export class PingMarkers {
  private m = new Map<string, Mk>();   // satu penanda per pengirim (ping baru menggantikan yang lama)
  constructor(private scene: THREE.Scene) {}
  add(owner: string, name: string, x: number, y: number, z: number, life: number) {
    this.drop(owner);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: draw(name), transparent: true, depthTest: false, depthWrite: false, fog: false }));
    sp.renderOrder = 12; sp.center.set(0.5, 0.0); sp.position.set(x, y + 0.15, z); this.scene.add(sp);
    this.m.set(owner, { sp, until: performance.now() + life * 1000, life: life * 1000 });
  }
  /** Tiap frame: skala mengikuti jarak (ukuran layar tetap), berkedip pelan menjelang habis. */
  update(cam: THREE.Camera) {
    const now = performance.now();
    for (const [id, k] of [...this.m]) {
      const left = k.until - now;
      if (left <= 0) { this.drop(id); continue; }
      const d = cam.position.distanceTo(k.sp.position), s = Math.min(1.1, Math.max(0.28, d * 0.075));
      k.sp.scale.set(s, s, 1);
      (k.sp.material as THREE.SpriteMaterial).opacity = Math.min(1, left / 1200) * (0.85 + 0.15 * Math.sin(now * 0.006));
    }
  }
  private drop(id: string) { const k = this.m.get(id); if (!k) return; k.sp.removeFromParent(); (k.sp.material as THREE.SpriteMaterial).map?.dispose(); k.sp.material.dispose(); this.m.delete(id); }
  clear() { for (const id of [...this.m.keys()]) this.drop(id); }
  dispose() { this.clear(); }
}
