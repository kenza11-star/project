// TAHAP 4 -- audio tangkapan (logika murni, tanpa WebAudio/DOM): menerima kejadian tangkapan yang SUDAH lolos validasi otoritas + dedupe jaringan
// (MonsterController.onCatch), lalu menjadwalkan teriakan + benturan di LOKASI kejadian untuk pemain yang cukup dekat. Waktu dihitung per frame
// (tanpa setTimeout -> tidak ada timer yatim; restart/unmount cukup clear()). Pemutaran sebenarnya (panner 3D + falloff) dilakukan AudioManager.
import * as CFG from './config';
import { SFX } from './sfx';
import { JS_SCREAM_AT, JS_IMPACT_AT, JS_HUM_AT, JS_SCREAM_MID_AT, JS_SCREAM_HI_AT } from './monsterfx';
import type { CatchInfo } from './monstersync';

export type CaptureCueName = 'capture_hum' | 'capture_scream_lo' | 'capture_scream_mid' | 'capture_scream' | 'capture_impact';
/** rate = pengali kecepatan putar (nada); kosong = 1. */
export interface CaptureCue { name: CaptureCueName; pos: { x: number; y: number; z: number }; vol: number; rate?: number }
export interface CaptureListener { x: number; z: number; level: number }
/** scheduled = dijadwalkan; dup = kejadian sama sudah diproses; cooldown = korban sama terlalu cepat; spam = kejadian lain terlalu rapat; far = di luar jangkauan; nopos = lokasi tak diketahui; off = fitur mati. */
export type CaptureResult = 'scheduled' | 'dup' | 'cooldown' | 'spam' | 'far' | 'nopos' | 'off';
interface Pending extends CaptureCue { at: number }
/** Susunan lapisan per tangkapan, urut waktu: dengung rendah -> teriakan rendah -> sedang -> tinggi (puncak) -> benturan. Volume & nada NAIK bertahap sampai benturan. Tiap lapisan hanya diputar bila pendengar dalam jangkauannya (SFX[name].max). */
const LAYERS: ReadonlyArray<{ name: CaptureCueName; at: number; vol: number; rate: number }> = [
  { name: 'capture_hum', at: JS_HUM_AT, vol: 0.4, rate: 0.4 },
  { name: 'capture_scream_lo', at: JS_SCREAM_AT, vol: 0.45, rate: 0.7 },
  { name: 'capture_scream_mid', at: JS_SCREAM_MID_AT, vol: 0.7, rate: 1 },
  { name: 'capture_scream', at: JS_SCREAM_HI_AT, vol: 1, rate: 1.3 },
  { name: 'capture_impact', at: JS_IMPACT_AT, vol: 1, rate: 1 },
];

const SEEN_TTL = 60;
export class CaptureAudio {
  private clock = 0; private lastEvent = -1e9; private seen = new Map<string, number>(); private lastVictim = new Map<string, number>(); private pend: Pending[] = [];
  private out: CaptureCue[] = [];
  get pending(): number { return this.pend.length; }
  /** Batalkan semua yang terjadwal & lupakan riwayat (restart run: epoch/seq jaringan mulai dari awal, kunci lama tidak boleh menyaring kejadian baru). */
  clear() { this.pend.length = 0; this.seen.clear(); this.lastVictim.clear(); this.lastEvent = -1e9; }
  /** Dipanggil SEKALI per kejadian oleh jalur jaringan; tetap kebal terhadap panggilan ganda (kunci kejadian). selfId = id pemain lokal; l = posisi pendengar saat ini. */
  accept(ev: CatchInfo, selfId: string, l: CaptureListener): CaptureResult {
    if (!CFG.CAPTURE_AUDIO_ENABLED) return 'off';
    const now = this.clock;
    for (const [k, t] of this.seen) if (now - t > SEEN_TTL) this.seen.delete(k);
    if (this.seen.has(ev.key)) return 'dup';
    this.seen.set(ev.key, now);
    const lv = this.lastVictim.get(ev.id); if (lv !== undefined && now - lv < CFG.CAPTURE_AUDIO_VICTIM_COOLDOWN) return 'cooldown';
    const self = ev.id === selfId;
    if (!self && now - this.lastEvent < CFG.CAPTURE_AUDIO_MIN_GAP) return 'spam';   // korban sendiri selalu mendengar tangkapannya (kejadiannya unik: dedupe + cooldown sudah di atas)
    let x = ev.x, z = ev.z, lvl = ev.level;
    if (!Number.isFinite(x) || !Number.isFinite(z)) { if (!self) return 'nopos'; x = l.x; z = l.z; lvl = l.level; }   // korban selalu mendengar dirinya sendiri walau lokasi tak diketahui
    const ly = CFG.LEVEL_Y[l.level] ?? 0, ey = (CFG.LEVEL_Y[lvl] ?? 0) + CFG.CAPTURE_AUDIO_Y;
    const d = Math.hypot(x - l.x, z - l.z, ey - (ly + 1.6)), floor = lvl === l.level ? 1 : CFG.CAPTURE_AUDIO_OTHER_FLOOR_VOL;
    const pos = { x, y: ey, z };
    const cues: Pending[] = [];
    for (const L of LAYERS) if (self || d <= SFX[L.name].max) cues.push({ name: L.name, pos, vol: L.vol * (self ? 1 : floor), rate: L.rate, at: now + L.at });
    if (!cues.length) return 'far';
    this.lastVictim.set(ev.id, now); this.lastEvent = now; for (const c of cues) this.pend.push(c);
    return 'scheduled';
  }
  /** Maju satu frame; mengembalikan suara yang jatuh tempo (array dipakai ulang: jangan disimpan). Suara yang terlambat > CAPTURE_AUDIO_LATE_DROP dibuang. */
  update(dt: number): CaptureCue[] {
    this.clock += Math.max(0, dt); const out = this.out; out.length = 0;
    for (let i = 0; i < this.pend.length;) {
      const p = this.pend[i];
      if (p.at > this.clock) { i++; continue; }
      this.pend.splice(i, 1);
      if (this.clock - p.at <= CFG.CAPTURE_AUDIO_LATE_DROP) out.push(p);
    }
    return out;
  }
}
