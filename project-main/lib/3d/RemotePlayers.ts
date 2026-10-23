// Pemain remote di dalam game: satu instance Character (model default yang sama) per pemain, masing-masing dengan posisi, rotasi,
// nama, dan status animasi sendiri. Data datang dari RoomClient.sample() (sudah divalidasi & diinterpolasi). Tanpa fisika: murni tampilan.
import * as THREE from 'three';
import { Character, loadDefaultCharacter } from './character';
import { resolveCharacterModel } from '@/lib/character/config';
import type { RemoteView } from '@/lib/net/roomclient';

const HEAD_STAND = 1.95, HEAD_CROUCH = 1.45, HEAD_LIE = 0.45;

interface Entry { bubble: THREE.Sprite | null; bubbleUntil: number; id: string; ch: Character | null; loading: boolean; label: THREE.Sprite; name: string; dead: boolean; labelY: number; lie: boolean; mic: number }

const LW = 512, LH = 96;   // kanvas label (2x lebih tajam dari sebelumnya); world 1.0 x 0.1875
/** Gambar nama (+ ikon mic hijau di kanan nama bila mic ON). `mic` 0 = mati (tanpa ikon), 1..3 = ON dengan level bicara 0..2 (ikon sedikit membesar + glow). Nama tetap di tengah. */
function drawLabel(c: HTMLCanvasElement, name: string, mic: number) {
  const g = c.getContext('2d'); if (!g) return;
  g.clearRect(0, 0, LW, LH);
  let fs = 60;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (; fs > 24; fs -= 2) { g.font = `bold ${fs}px "Courier New", monospace`; if (g.measureText(name).width / 2 + 10 + fs * 0.85 * 0.84 * 1.16 <= LW / 2 - 4) break; } // sisakan ruang ikon di kanan agar tidak terpotong
  const w = g.measureText(name).width;
  g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(name, LW / 2, 50);
  g.fillStyle = '#e8dca8'; g.fillText(name, LW / 2, 50);
  if (mic <= 0) return;
  const lvl = mic - 1, H = fs * 0.85 * (1 + lvl * 0.08), cx = LW / 2 + w / 2 + 10 + H * 0.36, cy = 50;
  const body = new Path2D(), holder = new Path2D(), stem = new Path2D(), r = 0.17 * H;
  body.arc(0, -0.5 * H + r, r, Math.PI, 0); body.arc(0, 0.1 * H - r, r, 0, Math.PI); body.closePath();   // kapsul
  holder.arc(0, -0.05 * H, 0.3 * H, 0, Math.PI);                                                          // penahan U
  stem.moveTo(0, 0.25 * H); stem.lineTo(0, 0.43 * H); stem.moveTo(-0.15 * H, 0.45 * H); stem.lineTo(0.15 * H, 0.45 * H); // tiang + alas
  g.save(); g.translate(cx, cy + H * 0.02); g.lineCap = 'round'; g.lineJoin = 'round';
  const lw = Math.max(3, H * 0.09);
  if (lvl > 0) { g.shadowColor = 'rgba(61,220,106,.9)'; g.shadowBlur = 6 * lvl; }
  g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = lw + 5; g.stroke(holder); g.stroke(stem); g.stroke(body);   // outline gelap tipis
  g.shadowBlur = 0; g.fillStyle = g.strokeStyle = '#3ddc6a'; g.lineWidth = lw; g.stroke(holder); g.stroke(stem); g.fill(body);
  g.restore();
}
function makeLabel(name: string, mic = 0): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = LW; c.height = LH;
  drawLabel(c, name, mic);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(1.0, LH / LW, 1); sp.renderOrder = 10;
  return sp;
}
function makeBubble(text: string): THREE.Sprite {
  const W = 360, pad = 18, lh = 32, c = document.createElement('canvas'); c.width = W; c.height = 200;
  const g = c.getContext('2d')!; g.font = '600 26px system-ui, sans-serif';
  const lines: string[] = []; let cur = '';
  for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W - pad * 2 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); const ls = lines.slice(0, 4);
  const h = ls.length * lh + pad * 2, tail = 16; c.height = h + tail; g.font = '600 26px system-ui, sans-serif';
  g.fillStyle = 'rgba(18,14,8,.88)'; g.strokeStyle = 'rgba(232,220,168,.75)'; g.lineWidth = 3;
  g.beginPath(); (g as any).roundRect(3, 3, W - 6, h - 3, 20); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(W / 2 - 12, h - 1); g.lineTo(W / 2, h + tail - 2); g.lineTo(W / 2 + 12, h - 1); g.closePath(); g.fill();
  g.fillStyle = '#f3ead0'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ls.forEach((l, i) => g.fillText(l, W / 2, pad + lh * i + lh / 2 + 1));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
  const k = 0.0034; sp.scale.set(W * k, c.height * k, 1); sp.center.set(0.5, 0); sp.renderOrder = 11; return sp;
}
function disposeLabel(sp: THREE.Sprite) {
  sp.removeFromParent(); (sp.material as THREE.SpriteMaterial).map?.dispose(); sp.material.dispose();
}

export class RemotePlayers {
  private m = new Map<string, Entry>();
  private disposed = false;
  private pend = new Map<string, { text: string; until: number }>();
  /** Balon chat di atas kepala pemain `id` (hilang sendiri). */
  say(id: string, text: string, secs = 7) { this.pend.set(id, { text, until: performance.now() + secs * 1000 }); }
  constructor(private scene: THREE.Scene) {}

  get count() { return this.m.size; }

  /** Dipanggil tiap frame. `views` = RoomClient.sample(): pemain yang tidak ada di daftar dihapus (keluar), yang baru dibuat (masuk). */
  /** `mic(id)`: 0 = mic mati, 1..3 = mic ON (level bicara 0..2). Label digambar ulang HANYA saat nilainya berubah. */
  update(dt: number, views: RemoteView[], reveal?: (id: string) => boolean, mic?: (id: string) => number) {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      let e = this.m.get(v.id);
      if (!e) {
        e = { bubble: null, bubbleUntil: 0, id: v.id, ch: null, loading: false, label: makeLabel(v.name), name: v.name, dead: false, labelY: HEAD_STAND, lie: false, mic: 0 };
        this.scene.add(e.label); this.m.set(v.id, e);
      } else if (e.name !== v.name) { disposeLabel(e.label); e.label = makeLabel(v.name, e.mic); e.name = v.name; this.scene.add(e.label); }
      const mc = mic ? mic(v.id) : 0;
      if (mc !== e.mic) {
        const on0 = e.mic > 0; e.mic = mc;
        const m = e.label.material as THREE.SpriteMaterial, cv = (m.map as THREE.CanvasTexture).image as HTMLCanvasElement;
        if (on0 !== mc > 0) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; drawLabel(cv, e.name, mc); m.map?.dispose(); m.map = t; m.needsUpdate = true; } // status mic berubah: texture baru, yang lama di-dispose
        else { drawLabel(cv, e.name, mc); (m.map as THREE.CanvasTexture).needsUpdate = true; }   // hanya level bicara berubah (maks 10x/dtk): gambar ulang kanvas yang sama
      }
      if (!e.ch && !e.loading) this.spawn(e, resolveCharacterModel(v.state.model));
      const st = v.state, ch = e.ch;
      // cg = tertangkap. Rebahan hanya saat benar-benar diseret (gait 1 = bergerak); jumpscare (diam) tetap berdiri/jongkok. Setelah mulai diseret tetap rebahan sampai cg hilang (bangun).
      e.lie = !!st.cg && (e.lie || st.gait === 1);
      const vis = !st.hide || (reveal ? reveal(v.id) : false); // bersembunyi di locker/kasur: model tidak terlihat, KECUALI pintu lokernya terbuka (penghuni sebenarnya terlihat)
      if (ch) {
        ch.root.visible = vis;
        ch.placePuppet(st.x, st.y, st.z, st.yaw + Math.PI); // kamera menghadap -Z saat yaw 0, model menghadap +Z
        ch.driveSpeed(st.speed); ch.setCommand(0, st.crouch); ch.setLie(e.lie);
        ch.update(dt);
      }
      e.label.visible = vis && !!ch;
      // label ikut posisi karakter yang DIGAMBAR (sudah dihaluskan), bukan titik jaringan mentah -> nama tidak bergetar terhadap badan
      const lp = ch ? ch.root.position : st;
      e.labelY += ((e.lie ? HEAD_LIE : st.crouch ? HEAD_CROUCH : HEAD_STAND) - e.labelY) * Math.min(1, 1 - Math.exp(-8 * dt)); // tinggi label berubah mulus saat jongkok/berdiri
      e.label.position.set(lp.x, lp.y + e.labelY + 0.2, lp.z);
      (e.label.material as THREE.SpriteMaterial).opacity = v.stale ? 0.4 : 1;
      const pb = this.pend.get(v.id);
      if (pb) { this.pend.delete(v.id); if (e.bubble) disposeLabel(e.bubble); e.bubble = makeBubble(pb.text); e.bubbleUntil = pb.until; this.scene.add(e.bubble); }
      if (e.bubble) {
        const left = e.bubbleUntil - performance.now();
        if (left <= 0) { disposeLabel(e.bubble); e.bubble = null; }
        else { e.bubble.visible = vis && !!ch; e.bubble.position.set(lp.x, lp.y + e.labelY + 0.42, lp.z); (e.bubble.material as THREE.SpriteMaterial).opacity = Math.min(1, left / 600); }
      }
    }
    for (const [id, e] of this.m) if (!seen.has(id)) this.remove(id, e);
  }

  /** Korban yang sedang diseret: pasang pergelangan kakinya di tangan monster (dipanggil SETELAH monster diperbarui tiap frame). */
  pin(id: string, x: number, y: number, z: number, yaw: number, floorY: number) {
    const e = this.m.get(id); if (e && e.lie && e.ch && e.ch.root.visible) e.ch.pinGrip(x, y, z, yaw, floorY);
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
    e.ch?.dispose(); e.ch = null; disposeLabel(e.label); if (e.bubble) disposeLabel(e.bubble);
  }

  dispose() {
    this.disposed = true;
    for (const [id, e] of [...this.m]) this.remove(id, e);
  }
}
