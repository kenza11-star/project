// Aturan room (logika murni, dipakai server API & klien; dites di scripts/test-backend.js).
import { MAX_ROOM_PLAYERS } from './protocol';

export const ROOM_CODE_LEN = 6;
// Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L).
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_STALE_SECONDS = 120;    // anggota tanpa heartbeat selama ini dianggap pergi (slot dilepas) -- harus sama dengan SQL
export const HEARTBEAT_MS = 30_000;
export const ROOM_ONLINE_SECONDS = 30;    // anggota dianggap ONLINE bila heartbeat/sync terakhir < ini (harus sama dengan room_view di SQL)
// Ruang tunggu (status 'waiting') lebih longgar: di HP tab dibekukan saat pemain pindah ke WhatsApp (salin/bagikan kode), jadi 30 dtk terlalu pendek.
export const ROOM_WAITING_ONLINE_SECONDS = 90;   // harus sama dengan room_online_seconds('waiting') di SQL (migration_v3_presence.sql)
export const ROOM_WAITING_SEAT_SECONDS = 300;    // harus sama dengan room_seat_seconds('waiting') di SQL

export function generateRoomCode(randomInt: (max: number) => number): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}
export const normalizeRoomCode = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase().replace(/[\s-]/g, '');
  return c.length === ROOM_CODE_LEN && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch)) ? c : null;
};
export const validMaxPlayers = (v: unknown): v is 2 | 3 | 4 => typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= MAX_ROOM_PLAYERS;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validRoomId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const validDisplayName = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 3 && v.trim().length <= 16 && /^[\p{L}\p{N}_.\- ]+$/u.test(v.trim());

export type RoomErrorCode = 'invalid' | 'unauthorized' | 'room_not_found' | 'room_full' | 'room_closed' | 'room_started' | 'not_host' | 'not_member' | 'not_ready' | 'not_friend' | 'invite_gone' | 'rate_limited' | 'not_configured' | 'server';
export const ROOM_ERROR_TEXT: Record<RoomErrorCode, string> = {
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
