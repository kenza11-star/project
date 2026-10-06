// Landscape lock untuk gameplay mobile. Semua best-effort: bila browser/device menolak lock dan HP masih portrait,
// tampil overlay RotateGate & gameplay dijeda (tampilan game TIDAK diputar lewat CSS).
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const orient = (): LockableOrientation | null =>
  typeof screen !== 'undefined' ? ((screen.orientation as LockableOrientation | undefined) ?? null) : null;

const tryLock = async (): Promise<boolean> => {
  try { const o = orient(); if (!o || !o.lock) return false; await o.lock('landscape'); return true; } catch { return false; }
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Panggil langsung dari user gesture (klik Play) dengan fullscreen=true.
// requestFullscreen dipanggil PERTAMA dan sinkron (sebelum await apa pun) supaya izin gesture belum hangus;
// Chrome Android hanya mengizinkan orientation.lock saat fullscreen.
export async function lockLandscape(fullscreen: boolean): Promise<void> {
  if (typeof document === 'undefined') return;
  if (fullscreen && !document.fullscreenElement) {
    const el = document.documentElement as FsEl;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch { /* fullscreen ditolak: lanjut coba lock saja */ }
  }
  if (await tryLock()) return;
  await wait(300); // beberapa browser baru siap setelah transisi fullscreen selesai
  await tryLock();
}

export function unlockLandscape(): void {
  try { orient()?.unlock?.(); } catch { /* abaikan */ }
  try { if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); } catch { /* abaikan */ }
}
