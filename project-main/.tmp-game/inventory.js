"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Inventory = exports.itemLabel = exports.ITEMS = void 0;
exports.createPlayer = createPlayer;
// Inventory & state per pemain. Tidak ada state global: tiap PlayerState punya Inventory sendiri.
const keys_1 = require("./keys");
exports.ITEMS = {
    key_yellow: { label: 'Yellow Key', usable: false },
    key_red: { label: 'Red Key', usable: false },
    key_green: { label: 'Green Key', usable: false },
    battery: { label: 'Battery', usable: true },
    medkit: { label: 'Medkit', usable: false },
    note: { label: 'Notes', usable: true },
    almond_water: { label: 'Almond Water', usable: true },
};
const itemLabel = (id) => exports.ITEMS[id]?.label ?? id;
exports.itemLabel = itemLabel;
class Inventory {
    constructor() {
        this.counts = new Map();
        this.noteTexts = [];
    }
    add(id, n = 1, text) {
        this.counts.set(id, (this.counts.get(id) ?? 0) + n);
        if (id === 'note' && text)
            this.noteTexts.push(text);
    }
    remove(id, n = 1) {
        const c = this.counts.get(id) ?? 0;
        if (c < n)
            return false;
        if (c - n === 0)
            this.counts.delete(id);
        else
            this.counts.set(id, c - n);
        return true;
    }
    count(id) { return this.counts.get(id) ?? 0; }
    total() { let t = 0; this.counts.forEach((v) => (t += v)); return t; }
    list() {
        return Array.from(this.counts.entries()).map(([id, count]) => ({ id, label: (0, exports.itemLabel)(id), count, usable: !!exports.ITEMS[id]?.usable }));
    }
    /** Jumlah key (semua warna) yang sedang dibawa. */
    keyTotal() { return keys_1.KEY_DEFS.reduce((n, k) => n + this.count(k.id), 0); }
    hasKey(id) { return (0, keys_1.isKeyId)(id) && this.count(id) > 0; }
    notes() { return this.noteTexts.slice(); }
    /** Ambil satu catatan (bergilir) untuk dibaca. */
    readNote(i) { return this.noteTexts.length ? this.noteTexts[i % this.noteTexts.length] : null; }
    clear() { this.counts.clear(); this.noteTexts = []; }
}
exports.Inventory = Inventory;
function createPlayer(id, name) {
    return { id, name, inventory: new Inventory(), x: 0, z: 0, yaw: 0, pitch: 0, level: 0, y: 0, onStairs: false, noteIdx: 0 };
}
