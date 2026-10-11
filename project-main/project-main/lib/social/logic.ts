// Logika teman/party murni (tanpa backend). Semua fungsi mengembalikan [state baru, pesan, sukses].
// Untuk backend nyata nanti: ganti fungsi-fungsi ini dengan panggilan API/WebSocket.
export interface Social {
  friends: string[];
  sent: string[];
  incoming: string[];
  invited: string[];
  gameInvites: string[];
  party: string | null;
  mode: 'solo' | 'duo';
}
export const MOCK_USERS: Record<string, string> = {
  '12345': 'TEMAN123', '23456': 'TEMAN456', '34567': 'TEMAN789', '45678': 'GHOST01',
};
export const initialSocial: Social = { friends: [], sent: [], incoming: [], invited: [], gameInvites: [], party: null, mode: 'solo' };
export type R = [Social, string, boolean];
export const userName = (uid: string) => MOCK_USERS[uid] ?? 'USER' + uid;
const uniq = (a: string[], u: string) => (a.includes(u) ? a : [...a, u]);
const del = (a: string[], u: string) => a.filter((x) => x !== u);

export function findUser(uid: string, selfUid: string): { uid: string; name: string } | null {
  if (uid === selfUid) return null;
  const n = MOCK_USERS[uid];
  return n ? { uid, name: n } : null;
}
export function sendRequest(s: Social, uid: string): R {
  if (s.friends.includes(uid)) return [s, 'Sudah berteman', false];
  if (s.sent.includes(uid)) return [s, 'Request sudah dikirim', false];
  if (s.incoming.includes(uid)) return [s, 'Dia sudah mengikutimu, cek notifikasi', false];
  return [{ ...s, sent: [...s.sent, uid] }, `Request dikirim ke ${userName(uid)}`, true];
}
export function acceptRequest(s: Social, uid: string): R {
  if (!s.incoming.includes(uid)) return [s, 'Request tidak ditemukan', false];
  return [{ ...s, incoming: del(s.incoming, uid), sent: del(s.sent, uid), friends: uniq(s.friends, uid) }, `${userName(uid)} sekarang temanmu`, true];
}
export function rejectRequest(s: Social, uid: string): R {
  return [{ ...s, incoming: del(s.incoming, uid) }, 'Request ditolak', true];
}
export function removeFriend(s: Social, uid: string): R {
  return [{ ...s, friends: del(s.friends, uid), invited: del(s.invited, uid), gameInvites: del(s.gameInvites, uid), party: s.party === uid ? null : s.party }, `${userName(uid)} dihapus dari teman`, true];
}
export function inviteFriend(s: Social, uid: string): R {
  if (!s.friends.includes(uid)) return [s, 'Dia belum jadi temanmu', false];
  if (s.party === uid) return [s, 'Sudah ada di party', false];
  if (s.party) return [s, 'Party penuh (maks 2 pemain)', false];
  if (s.invited.includes(uid)) return [s, 'Undangan sudah dikirim', false];
  return [{ ...s, mode: 'duo', invited: [...s.invited, uid] }, `Undangan dikirim ke ${userName(uid)}`, true];
}
export function acceptGameInvite(s: Social, uid: string): R {
  if (s.party) return [s, 'Party penuh (maks 2 pemain)', false];
  return [{ ...s, mode: 'duo', party: uid, gameInvites: del(s.gameInvites, uid), invited: del(s.invited, uid) }, `${userName(uid)} masuk lobby`, true];
}
export function rejectGameInvite(s: Social, uid: string): R {
  return [{ ...s, gameInvites: del(s.gameInvites, uid) }, 'Undangan ditolak', true];
}
export function setMode(s: Social, mode: 'solo' | 'duo'): Social {
  return mode === 'solo' ? { ...s, mode: 'solo', party: null, invited: [] } : { ...s, mode: 'duo' };
}
// ---- Simulasi sisi "teman" (mode DEMO lokal) ----
export function demoIncomingRequest(s: Social, uid: string): R {
  return [{ ...s, incoming: uniq(s.incoming, uid) }, `${userName(uid)} mengikutimu (demo)`, true];
}
export function demoFriendAccepts(s: Social, uid: string): R {
  if (!s.sent.includes(uid)) return [s, 'Tidak ada request terkirim', false];
  return [{ ...s, sent: del(s.sent, uid), friends: uniq(s.friends, uid) }, `${userName(uid)} menerima requestmu (demo)`, true];
}
export function demoIncomingInvite(s: Social, uid: string): R {
  if (!s.friends.includes(uid)) return [s, 'Bukan temanmu', false];
  return [{ ...s, gameInvites: uniq(s.gameInvites, uid) }, `${userName(uid)} mengundangmu (demo)`, true];
}
export function demoPartnerJoins(s: Social, uid: string): R {
  if (!s.invited.includes(uid)) return [s, 'Tidak ada undangan terkirim', false];
  if (s.party) return [s, 'Party penuh', false];
  return [{ ...s, party: uid, mode: 'duo', invited: del(s.invited, uid) }, `${userName(uid)} menerima undangan (demo)`, true];
}
