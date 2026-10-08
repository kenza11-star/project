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
exports.Stamina = void 0;
// Stamina sprint. Logika murni.
const CFG = __importStar(require("./config"));
class Stamina {
    constructor() {
        this.value = CFG.STAMINA_MAX;
        this.exhausted = false; // habis -> harus pulih sampai STAMINA_RESUME_AT dulu
        this.delay = 0;
    }
    get pct() { return Math.round((this.value / CFG.STAMINA_MAX) * 100); }
    canSprint() { return !this.exhausted && this.value > 0; }
    /** Panggil tiap frame. `sprinting` = pemain benar-benar sedang lari. Mengembalikan 'exhausted' pada frame habis. */
    update(dt, sprinting) {
        let ev = null;
        if (sprinting && this.canSprint()) {
            this.value -= CFG.STAMINA_DRAIN * dt;
            this.delay = CFG.STAMINA_REGEN_DELAY;
            if (this.value <= 0) {
                this.value = 0;
                this.exhausted = true;
                ev = 'exhausted';
            }
        }
        else {
            if (this.delay > 0)
                this.delay -= dt;
            else
                this.value = Math.min(CFG.STAMINA_MAX, this.value + CFG.STAMINA_REGEN * dt);
            if (this.exhausted && this.value >= CFG.STAMINA_RESUME_AT)
                this.exhausted = false;
        }
        return ev;
    }
    reset() { this.value = CFG.STAMINA_MAX; this.exhausted = false; this.delay = 0; }
}
exports.Stamina = Stamina;
