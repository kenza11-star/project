"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOM_ERROR_TEXT = exports.validDisplayName = exports.validRoomId = exports.UUID_RE = exports.validMaxPlayers = exports.normalizeRoomCode = exports.ROOM_WAITING_SEAT_SECONDS = exports.ROOM_WAITING_ONLINE_SECONDS = exports.ROOM_ONLINE_SECONDS = exports.HEARTBEAT_MS = exports.ROOM_STALE_SECONDS = exports.ROOM_CODE_ALPHABET = exports.ROOM_CODE_LEN = void 0;
exports.generateRoomCode = generateRoomCode;
// Aturan room (logika murni, dipakai server API & klien; dites di scripts/test-backend.js).
const protocol_1 = require("./protocol");
exports.ROOM_CODE_LEN = 6;
// Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L).
exports.ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
exports.ROOM_STALE_SECONDS = 120; // anggota tanpa heartbeat selama ini dianggap pergi (slot dilepas) -- harus sama dengan SQL
exports.HEARTBEAT_MS = 30000;
exports.ROOM_ONLINE_SECONDS = 30; // anggota dianggap ONLINE bila heartbeat/sync terakhir < ini (harus sama dengan room_view di SQL)
// Ruang tunggu (status 'waiting') lebih longgar: di HP tab dibekukan saat pemain pindah ke WhatsApp (salin/bagikan kode), jadi 30 dtk terlalu pendek.
exports.ROOM_WAITING_ONLINE_SECONDS = 90; // harus sama dengan room_online_seconds('waiting') di SQL (migration_v3_presence.sql)
exports.ROOM_WAITING_SEAT_SECONDS = 300; // harus sama dengan room_seat_seconds('waiting') di SQL
function generateRoomCode(randomInt) {
    let s = '';
    for (let i = 0; i < exports.ROOM_CODE_LEN; i++)
        s += exports.ROOM_CODE_ALPHABET[randomInt(exports.ROOM_CODE_ALPHABET.length)];
    return s;
}
const normalizeRoomCode = (v) => {
    if (typeof v !== 'string')
        return null;
    const c = v.trim().toUpperCase().replace(/[\s-]/g, '');
    return c.length === exports.ROOM_CODE_LEN && [...c].every((ch) => exports.ROOM_CODE_ALPHABET.includes(ch)) ? c : null;
};
exports.normalizeRoomCode = normalizeRoomCode;
const validMaxPlayers = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= protocol_1.MAX_ROOM_PLAYERS;
exports.validMaxPlayers = validMaxPlayers;
exports.UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRoomId = (v) => typeof v === 'string' && exports.UUID_RE.test(v);
exports.validRoomId = validRoomId;
const validDisplayName = (v) => typeof v === 'string' && v.trim().length >= 3 && v.trim().length <= 16 && /^[\p{L}\p{N}_.\- ]+$/u.test(v.trim());
exports.validDisplayName = validDisplayName;
exports.ROOM_ERROR_TEXT = {
    invalid: 'Permintaan tidak valid.',
    unauthorized: 'Sesi login tidak valid. Masuk ulang.',
    room_not_found: 'Room tidak ditemukan. Periksa kodenya.',
    room_full: 'Room penuh.',
    room_closed: 'Room sudah ditutup.',
    room_started: 'Permainan di room ini sudah dimulai.',
    not_host: 'Hanya host yang bisa memulai.',
    not_member: 'Kamu bukan anggota room ini.',
    not_ready: 'Belum cukup pemain aktif. Tunggu pemain lain masuk (minimal 2).',
    not_friend: 'Kalian belum berteman.',
    invite_gone: 'Undangan sudah tidak berlaku.',
    rate_limited: 'Terlalu banyak permintaan. Coba lagi sebentar.',
    not_configured: 'Server multiplayer belum dikonfigurasi.',
    server: 'Terjadi kesalahan di server. Coba lagi.',
};
