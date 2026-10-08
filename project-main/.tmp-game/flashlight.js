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
exports.Flashlight = void 0;
// Senter + battery. Logika murni (tanpa three.js). Battery hanya berkurang saat senter ON.
const CFG = __importStar(require("./config"));
class Flashlight {
    constructor(maxSeconds = CFG.FLASH_MAX_SECONDS) {
        this.on = false;
        this.max = maxSeconds;
        this.charge = maxSeconds;
    }
    get pct() { return Math.max(0, Math.min(100, Math.ceil((this.charge / this.max) * 100 - 1e-9))); }
    get empty() { return this.charge <= 0; }
    get full() { return this.charge >= this.max - 1e-6; }
    /** Nyalakan/matikan. Mengembalikan state baru. Tidak bisa ON bila battery habis. */
    toggle() {
        if (this.on) {
            this.on = false;
            return false;
        }
        if (this.empty)
            return false;
        this.on = true;
        return true;
    }
    /** Kurangi battery hanya saat ON. Mengembalikan 'died' pada frame saat battery habis. */
    update(dt) {
        if (!this.on)
            return null;
        this.charge -= dt;
        if (this.charge <= 0) {
            this.charge = 0;
            this.on = false;
            return 'died';
        }
        return null;
    }
    /** Pakai battery: isi penuh. */
    recharge() { this.charge = this.max; }
    reset() { this.charge = this.max; this.on = false; }
    /** Pengali intensitas 0..1: redup & berkedip saat battery hampir habis. `r` = angka acak 0..1 (untuk kedip). */
    factor(r) {
        if (!this.on)
            return 0;
        const p = this.pct;
        if (p > CFG.FLASH_LOW_PCT)
            return 1;
        const base = 0.35 + 0.65 * (p / CFG.FLASH_LOW_PCT);
        return r < 0.06 ? base * 0.25 : base;
    }
}
exports.Flashlight = Flashlight;
