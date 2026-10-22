"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMonsterMsg = void 0;
// Penanda pesan monster di transport room (mandiri, tanpa impor dari lib/game supaya lib/net tetap terkompilasi sendiri).
// Isi & validasi pesan ada di lib/game/monstersync.ts; transport hanya perlu mengenali jenisnya.
const isMonsterMsg = (raw) => { const t = raw?.t; return t === 'm' || t === 'mc'; };
exports.isMonsterMsg = isMonsterMsg;
