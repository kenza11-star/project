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
exports.keyPosProblem = keyPosProblem;
exports.slotProblem = slotProblem;
exports.validateRun = validateRun;
exports.findSafeSpawn = findSafeSpawn;
const CFG = __importStar(require("./config"));
const floorY = (level) => CFG.LEVEL_Y[level] ?? 0;
/** Posisi key valid? (hingga, di atas lantai, di dalam grid map, bukan di dalam dinding). Mengembalikan alasan gagal atau null. */
function keyPosProblem(cw, level, p) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))
        return 'posisi key tidak valid (NaN)';
    const fy = floorY(level);
    if (p.y < fy + 0.2)
        return 'key di bawah lantai';
    if (p.y > fy + 2.3)
        return 'key terlalu tinggi';
    if (p.x < cw.x0 || p.z < cw.z0 || p.x > cw.x0 + cw.W * cw.cell || p.z > cw.z0 + cw.H * cw.cell)
        return 'key di luar map';
    if (cw.gridBlocked(p.x, p.z, 0.02, level))
        return 'key di dalam dinding';
    return null;
}
/** Slot container boleh dipakai untuk key? Mengembalikan alasan gagal atau null. `nav` = hasil flood dari spawn (lantai 0). */
function slotProblem(cw, nav, s) {
    if (!s.usable)
        return `container ${s.id} tidak bisa dibuka/dicari`;
    const kp = keyPosProblem(cw, s.level, s.keyPos);
    if (kp)
        return `${s.id}: ${kp}`;
    if (s.level === 0) {
        if (!nav || !nav.reached(s.ax, s.az, 1.6))
            return `${s.id}: tidak terjangkau dari spawn`;
        // key harus bisa dibidik dari titik berdiri (jarak datar & jarak dari mata)
        const h = Math.hypot(s.keyPos.x - s.ax, s.keyPos.z - s.az);
        if (h > 2.0 || Math.hypot(h, 1.65 - s.keyPos.y) > CFG.REACH + 0.4)
            return `${s.id}: key terlalu jauh dari titik berdiri`;
    }
    return null;
}
/** Validasi akhir satu run. Daftar kosong = run bisa diselesaikan. */
function validateRun(c) {
    const bad = [];
    const got = c.keys.map((k) => k.key).sort().join(',');
    if (got !== c.required.slice().sort().join(','))
        bad.push(`key tidak lengkap/duplikat: ${got || '(kosong)'}`);
    const slots = new Set();
    for (const k of c.keys) {
        if (slots.has(k.slot.id))
            bad.push(`dua key di container yang sama: ${k.slot.id}`);
        slots.add(k.slot.id);
        const p = slotProblem(c.cw, c.nav, k.slot);
        if (p)
            bad.push(`key ${k.key}: ${p}`);
        if (k.slot.level === 1 && !c.ladderReachable)
            bad.push(`key ${k.key} di lantai 2 tapi tangga tidak terjangkau`);
    }
    if (c.cw.blocked(c.spawn.x, c.spawn.z, CFG.PLAYER_RADIUS, 0))
        bad.push('spawn berada di dalam benda/dinding');
    if (!c.nav.reached(c.spawn.x, c.spawn.z, 0.15))
        bad.push('spawn di luar area terjangkau');
    if (!c.nav.reached(c.exitInside.x, c.exitInside.z, 0.7))
        bad.push('exit tidak terjangkau dari spawn');
    return bad;
}
/**
 * Cari titik spawn yang valid: titik asli bila aman, jika tidak titik terdekat yang tidak menabrak apa pun
 * dan berada di area luas yang terhubung (bukan kantong sempit). `nav` = NavGrid statis (tanpa furniture acak).
 */
function findSafeSpawn(cw, nav, sp, minArea = 5000) {
    const R = CFG.PLAYER_RADIUS + 0.1;
    const ok = (x, z) => !cw.blocked(x, z, R, 0) && nav.flood(x, z) >= minArea;
    if (ok(sp.x, sp.z))
        return { x: sp.x, z: sp.z, moved: false };
    for (let r = 0.25; r <= 5; r += 0.25) {
        const n = Math.max(8, Math.round(r * 10));
        for (let a = 0; a < n; a++) {
            const th = (a / n) * Math.PI * 2, x = sp.x + Math.cos(th) * r, z = sp.z + Math.sin(th) * r;
            if (ok(x, z))
                return { x, z, moved: true };
        }
    }
    return null;
}
