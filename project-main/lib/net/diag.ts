// Diagnostik klien (tanpa UI): ring buffer di window.__roomDiag + console.debug bila localStorage.roomDebug === '1'. Tidak pernah memuat token/kunci.
export interface DiagEvent { t: string; ev: string; [k: string]: unknown }
export function diag(ev: string, data: Record<string, unknown> = {}) {
  try {
    const e: DiagEvent = { t: new Date().toISOString(), ev, ...data };
    const w = (typeof window !== 'undefined' ? window : null) as (Window & { __roomDiag?: DiagEvent[] }) | null;
    if (w) { const a = (w.__roomDiag ||= []); a.push(e); if (a.length > 200) a.splice(0, a.length - 200); if (w.localStorage?.getItem('roomDebug') === '1') console.debug('[room]', e); }
  } catch { /* diagnostik tidak boleh mengganggu game */ }
}
