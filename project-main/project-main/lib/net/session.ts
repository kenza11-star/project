// Sesi multiplayer aktif yang diberikan Lobby ke PlayScene.
import type { RoomClient } from './roomclient';
export interface NetSession {
  client: RoomClient;
  roomId: string;
  code: string;
  seed: number;        // seed dunia bersama: semua pemain membangun layout furniture/key yang sama
  slot: number;        // slot milik pemain lokal (0..maxPlayers-1): menentukan titik spawn
  maxPlayers: number;  // 2..4
  selfName: string;
  /** Dipanggil saat pemain meninggalkan room (menutup koneksi & memberi tahu server). */
  leave: () => Promise<void>;
}
