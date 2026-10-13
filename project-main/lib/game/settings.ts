// Pengaturan pemain (grafik, sensitivitas, volume, kontrol). Logika murni + penyimpanan localStorage (kunci 'bl:settings').
// Hanya hal yang benar-benar didukung game: resolusi render & shadow senter, sensitivitas bidik, volume master, invert Y.

export type Gfx = 'low' | 'medium' | 'high';
export interface Settings { gfx: Gfx; sens: number; volume: number; invertY: boolean }

export const SENS_MIN = 0.4, SENS_MAX = 2.5, SENS_BASE = 0.006; // SENS_BASE = nilai bidik asli proyek (rad per px)
export const DEFAULTS: Settings = { gfx: 'high', sens: 1, volume: 1, invertY: false }; // default = perilaku game sebelum fitur ini

/** Batas resolusi render (pixel ratio) & shadow senter per level. 'high' = konfigurasi asli proyek. */
export const GFX: Record<Gfx, { prMax: number; shadows: boolean; label: string }> = {
  low: { prMax: 0.8, shadows: false, label: 'LOW' },
  medium: { prMax: 1.0, shadows: true, label: 'MEDIUM' },
  high: { prMax: 1.25, shadows: true, label: 'HIGH' },
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export function normalizeSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
  return {
    gfx: o.gfx === 'low' || o.gfx === 'medium' || o.gfx === 'high' ? o.gfx : DEFAULTS.gfx,
    sens: clamp(num(o.sens, DEFAULTS.sens), SENS_MIN, SENS_MAX),
    volume: clamp(num(o.volume, DEFAULTS.volume), 0, 1),
    invertY: typeof o.invertY === 'boolean' ? o.invertY : DEFAULTS.invertY,
  };
}

const KEY = 'bl:settings';
export function loadSettings(): Settings {
  try { const s = localStorage.getItem(KEY); return normalizeSettings(s ? JSON.parse(s) : null); } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage penuh/diblokir: pengaturan hanya berlaku sesi ini */ }
}
