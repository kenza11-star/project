// Alur MASUK loker/lemari di mode online (logika murni; efek ke dunia 3D disuntikkan; dites di scripts/test-lockers.js).
//
// Urutan: (1) bila snapshot server sudah menunjukkan loker terisi pemain lain -> tolak seketika dan tampilkan penghuninya (pintu dibuka);
// (2) selain itu pintu dibuka OPTIMISTIK (tanpa menunggu jaringan) sambil meminta klaim ke SERVER; (3) server memutuskan:
//   ok          -> mulai urutan sembunyi (bila posisi/keadaan pemain masih sah), lease diperbarui berkala;
//   occupied    -> pintu tetap terbuka: pemain melihat penghuni sebenarnya; pemain harus mencari loker lain;
//   unavailable -> server tak terjangkau: TIDAK masuk (gagal-aman), pintu yang kita buka ditutup lagi.
// Tidak ada klaim ganda dari satu pemain (`busy`), dan hasil yang datang sesudah restart/tertangkap dibatalkan (klaim langsung dilepas).
import type { LockerGate } from '../net/lockerclient';

export interface LockerFlowFx {
  openDoors(): void;
  closeDoors(): void;
  say(msg: string, ms?: number): void;
  /** Masih sah setelah menunggu server: pemain masih di dekat loker, lantai sama, tidak di tangga, tidak sedang bersembunyi di tempat lain. */
  valid(): boolean;
  /** Mulai urutan sembunyi (masuk, pintu menutup, mengintip). */
  begin(): void;
  /** Server memberi loker ini ke pemain lain saat kita bersembunyi: keluarkan pemain. */
  evict(owner: string | null): void;
}
export type FlowStart = 'busy' | 'occupied' | 'pending';

export class LockerEntry {
  private pending = false;
  private epoch = 0;
  get busy(): boolean { return this.pending; }
  /** Batalkan permintaan yang sedang menunggu (restart run / tertangkap). Hasilnya nanti dibuang dan klaimnya dilepas. */
  cancelAll(): void { this.epoch++; this.pending = false; }

  start(key: string, gate: LockerGate, fx: LockerFlowFx, wasClosed: boolean): FlowStart {
    if (this.pending) return 'busy';
    const occ = gate.ownerOf(key);
    if (occ && occ !== gate.selfId) { fx.openDoors(); fx.say('LOKER TERISI', 1800); return 'occupied'; }
    this.pending = true;
    const ep = this.epoch;
    fx.openDoors(); // optimistik: kalau ternyata terisi, penghuninya langsung terlihat
    void gate.claim(key).then((res) => {
      if (ep !== this.epoch) { if (res.ok) gate.release(key); return; } // dunia sudah direset selagi menunggu
      this.pending = false;
      if (res.ok) {
        if (!gate.alive() || !fx.valid()) { gate.release(key); if (wasClosed) fx.closeDoors(); return; }
        fx.begin();
        gate.hold(key, (owner) => fx.evict(owner));
      } else if ((res as { reason?: string }).reason === 'occupied') { fx.openDoors(); fx.say('LOKER TERISI', 1800); }
      else { if (wasClosed) fx.closeDoors(); fx.say('LOKER TIDAK TERSEDIA (SERVER)', 2000); }
    });
    return 'pending';
  }
}
