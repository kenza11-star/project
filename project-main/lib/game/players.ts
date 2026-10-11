// Mode pemain & slot (logika murni, tanpa three/react; dites di scripts/test-players.js).
// Belum ada networking: slot 0 = pemain lokal (bisa dimainkan), slot 'remote' = anggota party yang terdaftar tetapi belum terhubung,
// slot 'open' = kosong. Struktur spawn (offset) dan kamera (view = pembagian layar) sudah siap untuk dipakai networking/split-screen nanti.
import * as CFG from './config';

export type PlayerMode = 1 | 2 | 3 | 4;
export const PLAYER_MODES: { mode: PlayerMode; label: string }[] = [
  { mode: 1, label: 'Single Player' },
  { mode: 2, label: '2 Players' },
  { mode: 3, label: '3 Players' },
  { mode: 4, label: '4 Players' },
];

export function normalizeMode(v: unknown): PlayerMode {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : CFG.PLAYER_MODE_DEFAULT;
}
export const modeLabel = (m: PlayerMode) => PLAYER_MODES.find((x) => x.mode === m)!.label;

export interface ViewRect { x: number; y: number; w: number; h: number } // bagian layar (0..1)
export type SlotStatus = 'local' | 'remote' | 'open';
export interface Slot {
  index: number; id: string; name: string; status: SlotStatus;
  offset: { dx: number; dz: number }; // posisi spawn relatif terhadap titik spawn utama
  view: ViewRect;                      // pembagian layar kamera slot ini (kamera aktif sekarang: slot 0 layar penuh)
}

/** Offset spawn: slot 0 tepat di titik spawn asli, slot lain tersebar merata pada lingkaran radius `spread`. */
export function spawnOffsets(count: number, spread = CFG.SPAWN_SPREAD): { dx: number; dz: number }[] {
  const n = Math.max(1, Math.min(CFG.MAX_PLAYERS, Math.floor(count)));
  const out = [{ dx: 0, dz: 0 }];
  for (let k = 0; k < n - 1; k++) {
    const a = (k * 2 * Math.PI) / Math.max(1, n - 1);
    out.push({ dx: Math.cos(a) * spread, dz: Math.sin(a) * spread });
  }
  return out;
}

/** Pembagian layar untuk N kamera: 1 = penuh, 2 = kiri/kanan, 3 = dua atas + satu bawah, 4 = 2x2. */
export function viewLayout(count: number): ViewRect[] {
  const n = Math.max(1, Math.min(CFG.MAX_PLAYERS, Math.floor(count)));
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2) return [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }];
  if (n === 3) return [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
  return [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
}

/** `filled` = nama pemain yang sudah ada, urut: [pemain lokal, anggota party...]. Sisanya slot kosong. */
export function buildSlots(mode: PlayerMode, filled: string[]): Slot[] {
  const m = normalizeMode(mode);
  const offs = spawnOffsets(m), views = viewLayout(m);
  return Array.from({ length: m }, (_, i) => ({
    index: i, id: 'p' + (i + 1),
    name: i === 0 ? (filled[0] || 'PLAYER') : (filled[i] || ''),
    status: (i === 0 ? 'local' : filled[i] ? 'remote' : 'open') as SlotStatus,
    offset: offs[i], view: views[i],
  }));
}
export const liveSlots = (s: Slot[]) => s.filter((x) => x.status !== 'open');
export const openCount = (s: Slot[]) => s.filter((x) => x.status === 'open').length;

/**
 * Titik spawn tiap slot. Slot 0 = `base` persis (tidak diubah, tanpa pengecekan: sudah divalidasi game).
 * Slot lain: coba offset penuh lalu lebih kecil dan diputar; ambil yang bebas collision & tidak menumpuk. Gagal -> titik spawn utama.
 */
export function placeSpawns(base: { x: number; z: number }, offsets: { dx: number; dz: number }[], isFree: (x: number, z: number) => boolean, minGap = CFG.SPAWN_MIN_GAP): { x: number; z: number }[] {
  const out = [{ x: base.x, z: base.z }];
  for (let i = 1; i < offsets.length; i++) {
    const o = offsets[i];
    let pick: { x: number; z: number } | null = null;
    for (const sc of [1, 0.7, 0.45]) {
      for (let r = 0; r < 8 && !pick; r++) {
        const c = Math.cos((r * Math.PI) / 4), s = Math.sin((r * Math.PI) / 4);
        const x = base.x + (o.dx * c - o.dz * s) * sc, z = base.z + (o.dx * s + o.dz * c) * sc;
        if (isFree(x, z) && out.every((q) => Math.hypot(q.x - x, q.z - z) >= minGap * sc)) pick = { x, z };
      }
      if (pick) break;
    }
    out.push(pick || { x: base.x, z: base.z });
  }
  return out;
}
