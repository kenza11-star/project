// Sistem audio WebAudio ringan untuk HP: buffer di-decode sekali, panner 'equalpower' + atenuasi linear,
// batas jumlah suara aktif, throttle per jenis, variasi pitch & varian file.
import * as CFG from './config';
import { SFX, SFX_BASE, type SfxName } from './sfx';

export interface Vec { x: number; y: number; z: number }
export interface PlayOpts { pos?: Vec; vol?: number; rate?: number }
export interface Handle { setPos(x: number, y: number, z: number): void; setGain(g: number): void; stop(): void }
const NULL_HANDLE: Handle = { setPos() {}, setGain() {}, stop() {} };

interface Voice { filter: BiquadFilterNode | null; name: SfxName; prio: number; loop: boolean; at: number; src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null; base: number; pos: Vec | null; stop: () => void }

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lp: BiquadFilterNode | null = null; // low-pass global (peredam); transparan saat tidak dipakai
  private lpF = 0;
  private bufs = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private lastPlay = new Map<string, number>();
  private lastVariant = new Map<string, number>();
  private ready = false;
  private disposed = false;
  private listener: Vec = { x: 0, y: 0, z: 0 };
  private fwd = { x: 0, z: -1 };
  private lt = 0;

  /** Buat context (butuh gesture pengguna agar tidak diblokir browser; aman dipanggil berkali-kali). */
  init(): void {
    if (this.ctx || this.disposed) { this.unlock(); return; }
    try {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = CFG.MASTER_VOLUME;
      // kompresor ringan: suara serentak (event + langkah + pintu) tidak clipping di speaker HP
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
      // low-pass global di antara master & kompresor: normalnya di batas Nyquist (transparan); setMuffle() menurunkannya untuk efek teredam
      this.lpF = Math.min(22000, this.ctx.sampleRate / 2 - 100);
      this.lp = this.ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = this.lpF; this.lp.Q.value = 0.5;
      this.master.connect(this.lp); this.lp.connect(comp); comp.connect(this.ctx.destination);
      this.unlock();
      void this.loadAll();
    } catch (e) { console.warn('audio init gagal', e); this.ctx = null; }
  }

  /** Lanjutkan context bila tidak berjalan (suspended, atau 'interrupted' di iOS Safari). */
  unlock(): void { try { const c = this.ctx; if (c && !this.disposed && c.state !== 'running' && c.state !== 'closed') void c.resume(); } catch { /* abaikan */ } }
  /** Hentikan sementara (app/tab di background). */
  suspend(): void { try { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); } catch { /* abaikan */ } }
  isReady(): boolean { return this.ready; }
  /** Peredam global 0..1 (0 = jernih, 1 = sangat teredam, ~CFG.MUFFLE_MIN_HZ). Perubahan dihaluskan; aman dipanggil tiap frame. */
  setMuffle(m: number): void {
    const ctx = this.ctx, lp = this.lp;
    if (!ctx || !lp || this.disposed) return;
    const nyq = Math.min(22000, ctx.sampleRate / 2 - 100), k = Math.max(0, Math.min(1, m));
    const f = k < 0.002 ? nyq : nyq * Math.pow(CFG.MUFFLE_MIN_HZ / nyq, k); // eksponensial: terasa merata di telinga
    if (k >= 0.002 && Math.abs(f - this.lpF) / this.lpF < 0.015) return; // abaikan perubahan <1,5% (hemat); kembali ke jernih (k~0) selalu diterapkan penuh
    this.lpF = f;
    try { lp.frequency.setTargetAtTime(f, ctx.currentTime, 0.12); } catch { /* abaikan */ }
  }

  private async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const c = this.ctx!;
    return new Promise((res, rej) => { const p: any = c.decodeAudioData(data, res, rej); if (p && p.catch) p.catch(rej); });
  }

  private async loadAll(): Promise<void> {
    const files = new Set<string>();
    Object.values(SFX).forEach((d) => d.files.forEach((f) => files.add(f)));
    const list = Array.from(files);
    for (let i = 0; i < list.length; i += 6) { // sedikit demi sedikit agar tidak membebani HP
      if (this.disposed || !this.ctx) return; // di-dispose (restart/unmount) saat memuat: berhenti, jangan decode ke context tertutup
      await Promise.all(list.slice(i, i + 6).map(async (f) => {
        try {
          const r = await fetch(SFX_BASE + f + '.wav');
          if (!r.ok || this.disposed || !this.ctx) return;
          const ab = await r.arrayBuffer();
          if (this.disposed || !this.ctx) return;
          this.bufs.set(f, await this.decode(ab));
        } catch (e) { console.warn('SFX gagal dimuat:', f); }
      }));
      if (this.disposed) return;
    }
    this.ready = true;
  }

  /** Posisi & arah pendengar (kamera). Dipanggil tiap frame; diperbarui ~20 Hz. */
  setListener(x: number, y: number, z: number, yaw: number, dt: number): void {
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
    this.fwd.x = -Math.sin(yaw); this.fwd.z = -Math.cos(yaw);
    this.lt -= dt; if (this.lt > 0 || !this.ctx) return; this.lt = 0.05;
    const l: any = this.ctx.listener;
    try {
      if (l.positionX) {
        l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
        l.forwardX.value = this.fwd.x; l.forwardY.value = 0; l.forwardZ.value = this.fwd.z;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else { l.setPosition(x, y, z); l.setOrientation(this.fwd.x, 0, this.fwd.z, 0, 1, 0); }
    } catch { /* abaikan */ }
  }

  private dist(p: Vec): number { return Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z); }

  private makeRoom(prio: number, loop: boolean): boolean {
    if (this.voices.size < CFG.MAX_VOICES) return true;
    let victim: Voice | null = null;
    this.voices.forEach((v) => { if (v.loop) return; if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.at < victim.at)) victim = v; });
    if (!victim) return false;
    const vv = victim as Voice;
    if (vv.prio > prio && !loop) return false; // suara baru kurang penting
    vv.stop();
    return true;
  }

  /** Putar suara; mengembalikan handle (bisa digeser/dihentikan) atau null bila tidak diputar (jauh / audio belum siap / batas suara). */
  start(name: SfxName, o: PlayOpts = {}): Handle | null {
    const ctx = this.ctx, master = this.master, def = SFX[name];
    if (!ctx || !master || !this.ready || this.disposed) return null;
    if (ctx.state !== 'running') return null;
    const now = ctx.currentTime;
    if (def.gap && now - (this.lastPlay.get(name) ?? -9) < def.gap) return null;
    if (o.pos && def.max > 0 && this.dist(o.pos) > def.max) return null; // terlalu jauh -> tidak diputar
    if (!this.makeRoom(def.prio, !!def.loop)) return null;

    let vi = Math.floor(Math.random() * def.files.length);
    if (def.files.length > 1 && vi === this.lastVariant.get(name)) vi = (vi + 1) % def.files.length;
    this.lastVariant.set(name, vi);
    const buf = this.bufs.get(def.files[vi]);
    if (!buf) return null;

    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!def.loop;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * def.jitter);
    const gain = ctx.createGain();
    const base = def.vol * (o.vol ?? 1) * (def.loop ? 1 : 0.92 + Math.random() * 0.16); // variasi volume kecil antar pemutaran
    gain.gain.value = base;
    let panner: PannerNode | null = null, filter: BiquadFilterNode | null = null;
    src.connect(gain);
    if (o.pos && def.max > 0) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = def.ref ?? 1.5;
      panner.maxDistance = def.max;
      panner.rolloffFactor = 1;
      this.setPannerPos(panner, o.pos.x, o.pos.y, o.pos.z);
      // udara menyerap suara tinggi: makin jauh makin 'tertutup' (satu filter murah, hanya bila sumber cukup jauh)
      const ref = def.ref ?? 1.5, tt = Math.max(0, Math.min(1, (this.dist(o.pos) - ref) / Math.max(1, def.max - ref)));
      if (tt > 0.1) { filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 16000 * Math.pow(0.16, tt); gain.connect(filter); filter.connect(panner); }
      else gain.connect(panner);
      panner.connect(master);
    } else gain.connect(master);

    const v: Voice = {
      name, filter, prio: def.prio, loop: !!def.loop, at: now, src, gain, panner, base, pos: o.pos ? { ...o.pos } : null,
      stop: () => { try { src.onended = null; src.stop(); } catch { /* sudah berhenti */ } this.cleanup(v); },
    };
    src.onended = () => this.cleanup(v);
    this.voices.add(v); this.lastPlay.set(name, now);
    src.start();
    return {
      setPos: (x, y, z) => { if (v.panner) this.setPannerPos(v.panner, x, y, z); },
      setGain: (g) => { try { v.gain.gain.value = v.base * g; } catch { /* abaikan */ } },
      stop: () => v.stop(),
    };
  }

  play(name: SfxName, o: PlayOpts = {}): Handle { return this.start(name, o) ?? NULL_HANDLE; }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number) {
    const a: any = p;
    if (a.positionX) { a.positionX.value = x; a.positionY.value = y; a.positionZ.value = z; } else a.setPosition(x, y, z);
  }

  private cleanup(v: Voice) {
    if (!this.voices.has(v)) return;
    this.voices.delete(v);
    try { v.src.disconnect(); v.gain.disconnect(); v.filter?.disconnect(); v.panner?.disconnect(); } catch { /* abaikan */ }
  }

  stopAll(): void { Array.from(this.voices).forEach((v) => v.stop()); }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    try { void this.ctx?.close(); } catch { /* abaikan */ }
    this.ctx = null; this.master = null; this.lp = null; this.bufs.clear();
  }
}
