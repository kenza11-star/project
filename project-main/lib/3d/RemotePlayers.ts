// Pemain remote di dalam game: satu instance Character (model default yang sama) per pemain, masing-masing dengan posisi, rotasi,
// nama, dan status animasi sendiri. Data datang dari RoomClient.sample() (sudah divalidasi & diinterpolasi). Tanpa fisika: murni tampilan.
import * as THREE from 'three';
import { Character, loadDefaultCharacter } from './character';
import { resolveCharacterModel } from '@/lib/character/config';
import type { RemoteView } from '@/lib/net/roomclient';

const HEAD_STAND = 1.95, HEAD_CROUCH = 1.45;

interface Entry { id: string; ch: Character | null; loading: boolean; label: THREE.Sprite; name: string; dead: boolean }

function makeLabel(name: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.font = 'bold 30px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(name, 128, 34);
    g.fillStyle = '#e8dca8'; g.fillText(name, 128, 34);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(1.0, 0.25, 1); sp.renderOrder = 10;
  return sp;
}
function disposeLabel(sp: THREE.Sprite) {
  sp.removeFromParent(); (sp.material as THREE.SpriteMaterial).map?.dispose(); sp.material.dispose();
}

export class RemotePlayers {
  private m = new Map<string, Entry>();
  private disposed = false;
  constructor(private scene: THREE.Scene) {}

  get count() { return this.m.size; }

  /** Dipanggil tiap frame. `views` = RoomClient.sample(): pemain yang tidak ada di daftar dihapus (keluar), yang baru dibuat (masuk). */
  update(dt: number, views: RemoteView[], reveal?: (id: string) => boolean) {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      let e = this.m.get(v.id);
      if (!e) {
        e = { id: v.id, ch: null, loading: false, label: makeLabel(v.name), name: v.name, dead: false };
        this.scene.add(e.label); this.m.set(v.id, e);
      } else if (e.name !== v.name) { disposeLabel(e.label); e.label = makeLabel(v.name); e.name = v.name; this.scene.add(e.label); }
      if (!e.ch && !e.loading) this.spawn(e, resolveCharacterModel(v.state.model));
      const st = v.state, ch = e.ch;
      const vis = !st.hide || (reveal ? reveal(v.id) : false); // bersembunyi di locker/kasur: model tidak terlihat, KECUALI pintu lokernya terbuka (penghuni sebenarnya terlihat)
      if (ch) {
        ch.root.visible = vis;
        ch.placePuppet(st.x, st.y, st.z, st.yaw + Math.PI); // kamera menghadap -Z saat yaw 0, model menghadap +Z
        ch.driveSpeed(st.speed); ch.setCommand(0, st.crouch);
        ch.update(dt);
      }
      e.label.visible = vis && !!ch;
      e.label.position.set(st.x, st.y + (st.crouch ? HEAD_CROUCH : HEAD_STAND) + 0.2, st.z);
      (e.label.material as THREE.SpriteMaterial).opacity = v.stale ? 0.4 : 1;
    }
    for (const [id, e] of this.m) if (!seen.has(id)) this.remove(id, e);
  }

  /** Model dimuat sekali per pemain (instance sendiri). Bila pemain sudah pergi sebelum selesai dimuat, instance langsung dibuang. */
  private spawn(e: Entry, _modelId: string) {
    e.loading = true;
    // Hanya model default yang ada selama sistem karakter terkunci; _modelId disiapkan untuk katalog karakter nanti.
    loadDefaultCharacter().then((ch) => {
      if (this.disposed || e.dead) { ch.dispose(); return; }
      ch.setPuppet(true); ch.root.visible = false; this.scene.add(ch.root); e.ch = ch; e.loading = false;
    }).catch(() => { e.loading = false; });
  }

  private remove(id: string, e: Entry) {
    e.dead = true; this.m.delete(id);
    e.ch?.dispose(); e.ch = null; disposeLabel(e.label);
  }

  dispose() {
    this.disposed = true;
    for (const [id, e] of [...this.m]) this.remove(id, e);
  }
}
