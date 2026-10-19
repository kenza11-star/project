"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockerEntry = void 0;
class LockerEntry {
    constructor() {
        this.pending = false;
        this.epoch = 0;
    }
    get busy() { return this.pending; }
    /** Batalkan permintaan yang sedang menunggu (restart run / tertangkap). Hasilnya nanti dibuang dan klaimnya dilepas. */
    cancelAll() { this.epoch++; this.pending = false; }
    start(key, gate, fx, wasClosed) {
        if (this.pending)
            return 'busy';
        const occ = gate.ownerOf(key);
        if (occ && occ !== gate.selfId) {
            fx.openDoors();
            fx.say('LOKER TERISI', 1800);
            return 'occupied';
        }
        this.pending = true;
        const ep = this.epoch;
        fx.openDoors(); // optimistik: kalau ternyata terisi, penghuninya langsung terlihat
        void gate.claim(key).then((res) => {
            if (ep !== this.epoch) {
                if (res.ok)
                    gate.release(key);
                return;
            } // dunia sudah direset selagi menunggu
            this.pending = false;
            if (res.ok) {
                if (!gate.alive() || !fx.valid()) {
                    gate.release(key);
                    if (wasClosed)
                        fx.closeDoors();
                    return;
                }
                fx.begin();
                gate.hold(key, (owner) => fx.evict(owner));
            }
            else if (res.reason === 'occupied') {
                fx.openDoors();
                fx.say('LOKER TERISI', 1800);
            }
            else {
                if (wasClosed)
                    fx.closeDoors();
                fx.say('LOKER TIDAK TERSEDIA (SERVER)', 2000);
            }
        });
        return 'pending';
    }
}
exports.LockerEntry = LockerEntry;
