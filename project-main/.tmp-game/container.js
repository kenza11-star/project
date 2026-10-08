"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerState = void 0;
// Status buka/tutup container (laci, lemari, locker, peti). Logika murni tanpa three.js agar bisa dites.
// Pertama kali dibuka = menggeledah (isi ditemukan setelah searchTime). Setelah itu bisa ditutup & dibuka kembali kapan saja.
class ContainerState {
    constructor() {
        this.k = 0; // bukaan 0..1 (dipakai animasi)
        this.want = 0; // target: 1 = buka, 0 = tutup
        this.searching = false;
        this.searched = false;
        this.timer = 0;
    }
    get animating() { return this.searching || this.k !== this.want; }
    get isOpen() { return this.k > 0 || this.want === 1; }
    prompt() { return this.searching ? 'SEARCHING...' : this.want ? 'CLOSE' : this.searched ? 'OPEN' : 'SEARCH'; }
    /** Tekan interaksi. Mengembalikan aksi yang terjadi ('ignored' saat sedang menggeledah). */
    toggle() {
        if (this.searching)
            return 'ignored';
        if (this.want) {
            this.want = 0;
            return 'close';
        }
        this.want = 1;
        if (!this.searched) {
            this.searching = true;
            this.timer = 0;
        }
        return 'open';
    }
    /** Maju satu frame. `tooFar` = pemain menjauh saat menggeledah (batal & menutup). Mengembalikan 'found' saat pencarian selesai. */
    update(dt, openTime, searchTime, tooFar = false) {
        const rate = dt / Math.max(0.05, openTime);
        this.k = this.want ? Math.min(1, this.k + rate) : Math.max(0, this.k - rate);
        if (!this.searching)
            return null;
        this.timer += dt;
        if (tooFar) {
            this.searching = false;
            this.want = 0;
            this.timer = 0;
            return null;
        }
        if (this.timer >= searchTime && this.k >= 1) {
            this.searching = false;
            this.searched = true;
            return 'found';
        }
        return null;
    }
    reset() { this.k = 0; this.want = 0; this.searching = false; this.searched = false; this.timer = 0; }
}
exports.ContainerState = ContainerState;
