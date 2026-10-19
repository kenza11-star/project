import { load, save } from '../storage/local';
import type { Session } from './types';

// Sesi lokal (guest / info akun terakhir). Bukan bukti identitas: backend harus memverifikasi sendiri lewat provider.restore().
export function loadSession(): Session | null {
  const s = load<any>('session', null);
  if (s && s.kind === 'guest') return { kind: 'guest' };
  if (s && s.kind === 'account' && s.user && typeof s.user.id === 'string' && typeof s.user.name === 'string') return { kind: 'account', user: { id: s.user.id, name: s.user.name, uid: typeof s.user.uid === 'string' ? s.user.uid : undefined, displayName: typeof s.user.displayName === 'string' ? s.user.displayName : undefined } };
  return null;
}
export function saveSession(s: Session | null) { save('session', s); }
