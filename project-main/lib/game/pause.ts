// Pause menu: logika murni (tanpa three/react; dites di scripts/test-pause.js).
//
// Dua kebijakan, ditentukan oleh jumlah slot pemain (roster):
//  - 'freeze'  : Single Player. Menu terbuka = gameplay BENAR-BENAR berhenti (dunia, musuh/SCP, timer, gerak, senter, stamina, audio).
//  - 'overlay' : Multiplayer (2-4 slot). Menu hanya overlay LOKAL. Dunia/pemain lain/musuh/timer tetap berjalan; pemain lokal
//                tidak bisa bergerak, membidik, atau berinteraksi, tetapi tetap ada di dunia (bahaya tetap bisa mengenainya).
// Tidak pernah ada pause global di multiplayer.
import * as CFG from './config';

export type PauseMode = 'freeze' | 'overlay';
export type PausePanel = 'main' | 'options' | 'players' | 'howto' | 'confirm';

export const pauseModeFor = (playerCount: number): PauseMode => (playerCount > 1 ? 'overlay' : 'freeze');

/** Apa yang boleh berjalan pada satu frame, diturunkan dari status game + status menu. */
export interface FrameGate {
  /** Dunia disimulasikan (world.update, event, SCP, timer, senter, stamina, efek berbasis waktu). false hanya saat freeze. */
  simulate: boolean;
  /** Input lokal (gerak, bidik, interaksi, tombol aksi) diterima. */
  input: boolean;
  /** Audio dihentikan sementara. Hanya saat freeze (multiplayer: audio dunia tetap hidup). */
  muteAudio: boolean;
}
export function frameGate(status: string, menuOpen: boolean, mode: PauseMode): FrameGate {
  const playing = status === 'play';
  const frozen = playing && menuOpen && mode === 'freeze';
  return { simulate: playing && !frozen, input: playing && !menuOpen, muteAudio: !playing || frozen };
}

export class PauseState {
  open = false;
  panel: PausePanel = 'main';
  constructor(public readonly mode: PauseMode) {}

  get frozen(): boolean { return this.open && this.mode === 'freeze'; }
  /** true -> semua kontrol lokal harus diabaikan (juga di multiplayer). */
  get inputBlocked(): boolean { return this.open; }

  show(): boolean { if (this.open) return false; this.open = true; this.panel = 'main'; return true; }
  hide(): boolean { if (!this.open) return false; this.open = false; this.panel = 'main'; return true; }
  toggle(): boolean { return this.open ? this.hide() : this.show(); }
  go(p: PausePanel): void { if (this.open) this.panel = p; }
  /** Escape / tombol kembali: dari sub-panel balik ke menu utama; dari menu utama menutup menu. */
  back(): void { if (this.open && this.panel !== 'main') this.panel = 'main'; else this.hide(); }
}

/** Tampilan status pemain untuk daftar PLAYERS. Tidak ada networking: status koneksi diisi jujur. */
export interface PlayerRow { id: string; name: string; tag: 'YOU' | 'PARTY' | 'EMPTY'; connection: string }
export function playerRows(slots: { id: string; name: string; status: 'local' | 'remote' | 'open'; connection?: string }[]): PlayerRow[] {
  return slots.slice(0, CFG.MAX_PLAYERS).map((s) => s.status === 'local'
    ? { id: s.id, name: s.name || 'PLAYER', tag: 'YOU' as const, connection: s.connection ?? 'LOCAL' }
    : s.status === 'remote'
      ? { id: s.id, name: s.name, tag: 'PARTY' as const, connection: s.connection ?? 'NOT CONNECTED' }
      : { id: s.id, name: 'EMPTY SLOT', tag: 'EMPTY' as const, connection: 'WAITING' });
}
