// KLIEN. Teman + undangan main NYATA lewat /api/friends, /api/invites, /api/social (Postgres di belakangnya). Hanya dipakai bila online (login backend).
import { call } from '@/lib/net/roomapi';
import { NAME_CACHE, type Social } from './logic';
import type { RoomSession } from '@/lib/net/roomapi';

export interface RemoteFriend { uid: string; name: string; status: 'pending' | 'accepted'; incoming: boolean }

export async function fetchFriends(): Promise<RemoteFriend[]> {
  const r = await call<{ friends: RemoteFriend[] }>('/api/friends', 'GET');
  return Array.isArray(r.friends) ? r.friends : [];
}
const act = (uid: string, action: 'request' | 'accept' | 'decline' | 'remove') => call<{ status?: string }>('/api/friends', 'POST', { uid, action });
export const requestFriend = (uid: string) => act(uid, 'request');
export const acceptFriend = (uid: string) => act(uid, 'accept');
export const declineFriend = (uid: string) => act(uid, 'decline');
export const removeFriendRemote = (uid: string) => act(uid, 'remove');

export interface InviteIn { id: string; uid: string; name: string; created_at: string }
export interface InviteOut { id: string; uid: string; status: 'pending' | 'accepted' | 'declined' }
export interface Invites { incoming: InviteIn[]; outgoing: InviteOut[] }
export interface SocialPoll { friends: RemoteFriend[]; invites: Invites; /** true = server gagal memuat undangan (mis. migrasi SQL belum dijalankan); daftar teman tetap valid. */ invitesFailed: boolean }

/** Satu panggilan: daftar teman/permintaan + undangan main masuk/keluar. Dipolling lobby tiap beberapa detik. */
export async function fetchSocial(): Promise<SocialPoll> {
  const r = await call<Partial<SocialPoll>>('/api/social', 'GET');
  return { friends: Array.isArray(r.friends) ? r.friends : [], invites: { incoming: r.invites?.incoming ?? [], outgoing: r.invites?.outgoing ?? [] }, invitesFailed: r.invitesFailed === true };
}
/** Kirim undangan ke TEMAN (UID 5 digit) untuk bergabung ke room yang sedang menunggu. Disimpan di server; muncul di akun penerima. */
export const sendInvite = (uid: string, roomId: string) => call<{ status: string }>('/api/invites', 'POST', { action: 'send', uid, roomId });
/** Terima = langsung masuk room pengundang (data room dikembalikan). Tolak = undangan ditandai ditolak. */
export const answerInvite = (inviteId: string, accept: boolean) => call<{ status: string; room?: RoomSession }>('/api/invites', 'POST', { action: accept ? 'accept' : 'decline', inviteId });

/** Murni: tanam daftar dari server ke state sosial lokal. `inv` (opsional) mengisi undangan main masuk (gameInvites) & keluar yang menunggu (invited). */
export function mergeRemote(s: Social, list: RemoteFriend[], inv?: Invites): Social {
  const friends: string[] = [], sent: string[] = [], incoming: string[] = [];
  for (const f of list) {
    NAME_CACHE[f.uid] = f.name;
    if (f.status === 'accepted') friends.push(f.uid); else if (f.incoming) incoming.push(f.uid); else sent.push(f.uid);
  }
  const keep = (a: string[]) => a.filter((u) => friends.includes(u));
  const party = s.party && friends.includes(s.party) ? s.party : null;
  if (inv) {
    for (const i of inv.incoming) NAME_CACHE[i.uid] = i.name;
    return { ...s, friends, sent, incoming, invited: inv.outgoing.filter((o) => o.status === 'pending').map((o) => o.uid), gameInvites: inv.incoming.map((i) => i.uid), party };
  }
  return { ...s, friends, sent, incoming, invited: keep(s.invited), gameInvites: keep(s.gameInvites), party };
}
