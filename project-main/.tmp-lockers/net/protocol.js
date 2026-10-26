"use strict";
// Protokol sinkronisasi pemain (logika murni, tanpa three/react; dites di scripts/test-net.js).
//
// Prinsip:
//  - Hanya data kecil yang dikirim: posisi, rotasi, status animasi. MODEL 3D TIDAK dikirim: semua pemain memakai model default yang sama
//    (lib/character/config.ts), jadi tiap klien merender salinan model itu sendiri (satu instance per pemain).
//  - Semua pesan masuk dianggap TIDAK DIPERCAYA: wajib lewat sanitizeState() (tipe, NaN/Infinity, batas dunia).
//  - Identitas pengirim TIDAK diambil dari isi pesan, tetapi dari saluran (topik) tempat pesan diterima (lihat RoomTransport.onState).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeName = exports.sanitizeChatText = exports.CHAT_MAX = exports.MIN_RECV_GAP_MS = exports.STEP_SLACK = exports.MAX_SPEED = exports.WORLD_LIMIT = exports.STALE_MS = exports.KEEPALIVE_MS = exports.SEND_INTERVAL_MS = exports.MAX_ROOM_PLAYERS = exports.PROTOCOL_VERSION = void 0;
exports.sanitizeState = sanitizeState;
exports.stateChanged = stateChanged;
exports.clampStep = clampStep;
exports.PROTOCOL_VERSION = 1;
exports.MAX_ROOM_PLAYERS = 6;
exports.SEND_INTERVAL_MS = 100; // 10 Hz
exports.KEEPALIVE_MS = 1000; // tetap kirim 1x/dtk walau diam, supaya pemain yang baru masuk/reconnect langsung dapat posisi
exports.STALE_MS = 6000; // tidak ada data > 6 dtk padahal masih online -> ditandai stale
exports.WORLD_LIMIT = 500; // |koordinat| maksimum yang diterima (m)
exports.MAX_SPEED = 8; // m/dtk, batas kecepatan horizontal yang diterima (lari normal jauh di bawah ini)
exports.STEP_SLACK = 1.5; // m, toleransi jitter / tangga
exports.MIN_RECV_GAP_MS = 20; // pesan dari satu pemain lebih rapat dari ini (>50 Hz) dibuang sebagai banjir
exports.CHAT_MAX = 80;
const sanitizeChatText = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, exports.CHAT_MAX) : '');
exports.sanitizeChatText = sanitizeChatText;
function sanitizeCm(raw) {
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const c of raw.slice(0, 3)) {
        const o = c;
        const t = (0, exports.sanitizeChatText)(o?.t);
        if (typeof o?.i === 'number' && Number.isInteger(o.i) && o.i >= 0 && o.i < 2 ** 40 && t)
            out.push({ i: o.i, t });
    }
    return out.length ? out : null;
}
const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
/** Validasi + normalisasi pesan dari jaringan. null = buang. */
function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    if (r.v !== exports.PROTOCOL_VERSION)
        return null;
    const ep = num(r.ep, 2 ** 31), seq = num(r.seq, 2 ** 40);
    const x = num(r.x, exports.WORLD_LIMIT), y = num(r.y, exports.WORLD_LIMIT), z = num(r.z, exports.WORLD_LIMIT);
    const yaw = num(r.yaw, 1e4), pitch = num(r.pitch, 10);
    if (ep === null || seq === null || x === null || y === null || z === null || yaw === null || pitch === null)
        return null;
    const gait = r.gait === 1 || r.gait === 2 ? r.gait : 0;
    const level = r.level === 1 ? 1 : 0;
    let cm;
    const model = typeof r.model === 'string' && r.model.length <= 32 ? r.model : 'default';
    return { v: exports.PROTOCOL_VERSION, ep, seq, x, y, z, yaw, pitch: Math.max(-1.6, Math.min(1.6, pitch)), gait, crouch: r.crouch === true, hide: r.hide === true, ...(r.cg === true ? { cg: true } : {}), ...(typeof r.bd === 'number' && Number.isInteger(r.bd) && r.bd >= 0 && r.bd < 16 ? { bd: r.bd } : {}), ...((cm = sanitizeCm(r.cm)) ? { cm } : {}), level, model };
}
const sanitizeName = (s) => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N}_.\- ]/gu, '').trim().slice(0, 16) : '') || 'PLAYER';
exports.sanitizeName = sanitizeName;
/** Dua keadaan lokal dianggap sama (tidak perlu dikirim ulang) bila selisih di bawah ambang. */
function stateChanged(a, b) {
    if (!a)
        return true;
    return Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01 || Math.abs(a.z - b.z) > 0.01 || Math.abs(a.yaw - b.yaw) > 0.01 || Math.abs(a.pitch - b.pitch) > 0.01
        || a.gait !== b.gait || a.crouch !== b.crouch || a.hide !== b.hide || (a.cg === true) !== (b.cg === true) || a.bd !== b.bd || a.level !== b.level || a.model !== b.model
        || (a.cm?.map((c) => c.i).join() ?? '') !== (b.cm?.map((c) => c.i).join() ?? '');
}
/**
 * Anti-teleport / speed-hack di sisi PENERIMA (pesan jaringan tidak dipercaya). Perpindahan yang melebihi MAX_SPEED*dt + STEP_SLACK dipotong
 * ke batas itu sepanjang arah yang sama, jadi pemain curang tampak bergerak cepat menuju titik tujuan, bukan "menembus" dunia seketika.
 * Gerak sah (termasuk reconnect setelah jeda: dt besar = anggaran besar) lolos tanpa perubahan. Ini perlindungan tampilan, bukan anti-cheat penuh.
 */
function clampStep(prev, next, dtMs) {
    const dt = Math.max(0, Math.min(dtMs, 60000)) / 1000;
    const budget = exports.MAX_SPEED * dt + exports.STEP_SLACK;
    const dx = next.x - prev.x, dz = next.z - prev.z, d = Math.hypot(dx, dz);
    if (d <= budget)
        return { state: next, clamped: false };
    const k = budget / d;
    return { state: { ...next, x: prev.x + dx * k, z: prev.z + dz * k }, clamped: true };
}
