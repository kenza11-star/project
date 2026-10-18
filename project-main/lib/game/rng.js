"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRng = makeRng;
exports.newSeed = newSeed;
function makeRng(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = {
        next,
        range: (a, b) => a + next() * (b - a),
        int: (a, b) => a + Math.floor(next() * (b - a + 1)),
        pick: (arr) => arr[Math.floor(next() * arr.length)],
        chance: (p) => next() < p,
        shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        } return arr; },
        weighted: (items) => {
            let tot = 0;
            for (const [, w] of items)
                tot += w;
            let x = next() * tot;
            for (const [v, w] of items) {
                x -= w;
                if (x <= 0)
                    return v;
            }
            return items[items.length - 1][0];
        },
    };
    return r;
}
function newSeed() {
    return (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffffffff)) >>> 0;
}
