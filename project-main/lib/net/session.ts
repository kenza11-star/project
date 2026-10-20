// Sesi multiplayer aktif yang diberikan Lobby ke PlayScene.
import type { RoomClient } from './roomclient';
import type { LockerClient } from './lockerclient';
export interface NetSession {
  client: RoomClient;
  /** Sistem loker/lemari online: klaim & lepas ke server (1 pemain per loker), snapshot status untuk semua pemain. */
  lockers: LockerClient;
  roomId: string;
  code: string;
  seed: number;        // seed dunia bersama: semua pemain membangun layout furniture/key yang sama
  slot: number;        // slot milik pemain lokal (0..maxPlayers-1): menentukan titik spawn
  maxPlayers: number;  // 2..6
  selfName: string;
  /** Dipanggil saat pemain meninggalkan room (menutup koneksi & memberi tahu server). */
  leave: () => Promise<void>;
}
