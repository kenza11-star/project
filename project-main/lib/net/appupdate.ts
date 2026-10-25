// Logika murni notifikasi update (tanpa DOM/React, supaya bisa diuji). Notifikasi TIDAK wajib: semua kegagalan = diam.
export const LATER_MS = 24 * 3600_000;
export const LATER_KEY = 'app_update_later';

/** "1.10.0" -> [1,10,0]; null bila bukan versi angka-titik valid. */
export function parseVer(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})$/.exec(v.trim());
  return m ? m[1].split('.').map(Number) : null;
}
/** Bandingkan sebagai angka per segmen (1.10 > 1.9). null bila salah satu tidak valid. */
export function cmpVer(a: unknown, b: unknown): number | null {
  const x = parseVer(a), y = parseVer(b); if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
export const isNewer = (latest: unknown, current: unknown) => cmpVer(latest, current) === 1;

/** Versi aplikasi (APK/installed app). Asumsi: WebView Android (UA berisi "; wv)"), PWA terpasang (display-mode standalone), atau marker UA "NightRound/x.y.z". Web biasa = false. */
export function isAppRuntime(ua: string, standalone: boolean): boolean {
  return standalone || /; wv\)/.test(ua) || /\bNightRound\/\d/i.test(ua);
}
/** Versi klien: bila wrapper APK menaruh "NightRound/x.y.z" di UA, itu yang dipakai (APK memuat website live, jadi konstanta web tidak mewakili versi APK). Jika tidak, pakai fallback. */
export function clientVersion(ua: string, fallback: string): string {
  const m = /\bNightRound\/(\d+(?:\.\d+){0,3})/i.exec(ua); return m ? m[1] : fallback;
}

export interface UpdateInfo { update: boolean; version?: string; notes?: string[]; message?: string; url?: string }
export interface LaterState { v: string; t: number }

/** Parse aman dari localStorage; apa pun yang rusak = null. */
export function parseLater(raw: string | null): LaterState | null {
  try { const o = JSON.parse(raw || 'null'); if (o && typeof o.v === 'string' && Number.isFinite(o.t)) return { v: o.v, t: o.t }; } catch { /* diam */ }
  return null;
}
/** Tampilkan bila ada update valid, kecuali "Later" masih berlaku (<24 jam) untuk versi yang sama atau lebih baru. Versi LEBIH BARU dari yang ditunda -> muncul lagi. */
export function shouldShow(info: UpdateInfo | null, later: LaterState | null, now: number): boolean {
  if (!info || info.update !== true || !parseVer(info.version) || typeof info.url !== 'string' || !/^https:\/\//.test(info.url)) return false;
  if (!later) return true;
  if (isNewer(info.version, later.v)) return true;
  return now - later.t >= LATER_MS || later.t > now; // later.t di masa depan (jam salah) = anggap kedaluwarsa
}
