// Satu-satunya tempat klien menurunkan "jumlah pemain" & "boleh mulai" dari snapshot room. Dipakai Lobby (chip, label WAITING) DAN RoomModal (PEMAIN x/y, tombol Mulai),
// jadi kedua tampilan tidak mungkin berbeda, dan host/joiner yang memegang snapshot sama selalu menampilkan angka sama.
// Angka datang dari SERVER (online_count / can_start). Bila server lama belum mengirimnya, dihitung dari members[].online (bukan dari karakter yang dirender).
import type { RoomStateView } from './roomtypes';

export interface RoomCounts { online: number; seated: number; max: number; ready: boolean }
export function roomCounts(v: RoomStateView | null | undefined, fallbackMax: number): RoomCounts {
  if (!v) return { online: 1, seated: 1, max: fallbackMax, ready: false };
  const members = Array.isArray(v.members) ? v.members : [];
  const online = typeof v.online_count === 'number' ? v.online_count : members.filter((m) => m.online).length;
  const seated = typeof v.member_count === 'number' ? v.member_count : members.length;
  const ready = typeof v.can_start === 'boolean' ? v.can_start : v.status === 'waiting' && online >= 2;
  return { online, seated, max: v.max_players || fallbackMax, ready };
}
