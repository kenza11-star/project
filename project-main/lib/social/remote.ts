// KLIEN. Teman nyata lewat /api/friends (Supabase di belakangnya). Hanya dipakai bila online (login backend). Party/undangan game tetap lokal.
import { call } from '@/lib/net/roomapi';
import { NAME_CACHE, type Social } from './logic';

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

/** Murni: tanam daftar dari server ke state sosial lokal. Party/undangan tidak disentuh, kecuali yang menunjuk teman yang sudah dihapus. */
export function mergeRemote(s: Social, list: RemoteFriend[]): Social {
  const friends: string[] = [], sent: string[] = [], incoming: string[] = [];
  for (const f of list) {
    NAME_CACHE[f.uid] = f.name;
    if (f.status === 'accepted') friends.push(f.uid); else if (f.incoming) incoming.push(f.uid); else sent.push(f.uid);
  }
  const keep = (a: string[]) => a.filter((u) => friends.includes(u));
  const party = s.party && friends.includes(s.party) ? s.party : null;
  return { ...s, friends, sent, incoming, invited: keep(s.invited), gameInvites: keep(s.gameInvites), party };
}
