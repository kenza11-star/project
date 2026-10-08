// Inventory & state per pemain. Tidak ada state global: tiap PlayerState punya Inventory sendiri.
import { KEY_DEFS, isKeyId } from './keys';

export interface ItemDef { label: string; usable: boolean }
export const ITEMS: Record<string, ItemDef> = {
  key_yellow: { label: 'Yellow Key', usable: false },
  key_red: { label: 'Red Key', usable: false },
  key_green: { label: 'Green Key', usable: false },
  battery: { label: 'Battery', usable: true },
  medkit: { label: 'Medkit', usable: false },
  note: { label: 'Notes', usable: true },
  almond_water: { label: 'Almond Water', usable: true },
};
export const itemLabel = (id: string) => ITEMS[id]?.label ?? id;

export class Inventory {
  private counts = new Map<string, number>();
  private noteTexts: string[] = [];

  add(id: string, n = 1, text?: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + n);
    if (id === 'note' && text) this.noteTexts.push(text);
  }
  remove(id: string, n = 1): boolean {
    const c = this.counts.get(id) ?? 0;
    if (c < n) return false;
    if (c - n === 0) this.counts.delete(id); else this.counts.set(id, c - n);
    return true;
  }
  count(id: string): number { return this.counts.get(id) ?? 0; }
  total(): number { let t = 0; this.counts.forEach((v) => (t += v)); return t; }
  list(): { id: string; label: string; count: number; usable: boolean }[] {
    return Array.from(this.counts.entries()).map(([id, count]) => ({ id, label: itemLabel(id), count, usable: !!ITEMS[id]?.usable }));
  }
  /** Jumlah key (semua warna) yang sedang dibawa. */
  keyTotal(): number { return KEY_DEFS.reduce((n, k) => n + this.count(k.id), 0); }
  hasKey(id: string): boolean { return isKeyId(id) && this.count(id) > 0; }
  notes(): string[] { return this.noteTexts.slice(); }
  /** Ambil satu catatan (bergilir) untuk dibaca. */
  readNote(i: number): string | null { return this.noteTexts.length ? this.noteTexts[i % this.noteTexts.length] : null; }
  clear(): void { this.counts.clear(); this.noteTexts = []; }
}

export interface PlayerState {
  id: string;
  name: string;
  inventory: Inventory;
  x: number; z: number; yaw: number; pitch: number;
  level: number; // 0 = lantai bawah, 1 = mezzanine (grid collision yang dipakai)
  y: number;     // tinggi lantai di bawah kaki (kontinu; naik/turun bertahap di tangga)
  onStairs: boolean; // sedang berada di dalam lintasan tangga
  noteIdx: number;
}

export function createPlayer(id: string, name: string): PlayerState {
  return { id, name, inventory: new Inventory(), x: 0, z: 0, yaw: 0, pitch: 0, level: 0, y: 0, onStairs: false, noteIdx: 0 };
}
