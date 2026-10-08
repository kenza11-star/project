"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventScheduler = void 0;
const CFG = __importStar(require("./config"));
class EventScheduler {
    constructor(rng) {
        this.last = null;
        this.lastAt = {};
        this.clock = 0;
        this.rng = rng;
        this.timer = rng.range(CFG.EVENT_FIRST_MIN, CFG.EVENT_FIRST_MAX);
    }
    /** Jenis berikutnya (bobot, tidak sama dengan sebelumnya, belum cooldown). Selalu memakai jumlah panggilan RNG yang sama. */
    pickType() {
        const entries = Object.keys(CFG.EVENT_WEIGHTS).map((t) => {
            let w = CFG.EVENT_WEIGHTS[t];
            if (t === this.last)
                w = 0;
            const at = this.lastAt[t];
            if (at !== undefined && this.clock - at < CFG.EVENT_TYPE_COOLDOWN)
                w *= 0.15;
            return [t, w];
        });
        if (entries.every(([, w]) => w <= 0))
            return 'lights';
        return this.rng.weighted(entries);
    }
    /**
     * Panggil tiap frame. Mengembalikan jenis event yang harus dicoba sekarang (atau null).
     * `run(type)` mencoba menjalankan event dan mengembalikan true bila berhasil (kondisi aman terpenuhi).
     * Bila gagal -> dicoba lagi lebih cepat; bila berhasil -> jeda panjang acak.
     */
    update(dt, run) {
        this.clock += dt;
        this.timer -= dt;
        if (this.timer > 0)
            return null;
        const type = this.pickType();
        const ok = run(type);
        if (ok) {
            this.last = type;
            this.lastAt[type] = this.clock;
            this.timer = this.rng.range(CFG.EVENT_GAP_MIN, CFG.EVENT_GAP_MAX);
            return type;
        }
        this.timer = this.rng.range(CFG.EVENT_RETRY_MIN, CFG.EVENT_RETRY_MAX);
        return null;
    }
}
exports.EventScheduler = EventScheduler;
