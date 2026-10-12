import { load, save } from './storage/local';

// Profil lokal perangkat. `name` = Display Name (bebas diganti pemain).
// Username & ID berasal dari akun (Session) dan TIDAK disimpan di sini; guest tidak punya ID.
export interface Profile { name: string }

export function loadProfile(): Profile {
  const p = load<Partial<Profile>>('profile', {});
  const name = typeof p.name === 'string' && p.name.trim().length >= 3 ? p.name.trim().slice(0, 16) : 'PLAYER';
  const profile: Profile = { name };
  save('profile', profile);
  return profile;
}

export function validateName(name: string): string | null {
  const n = name.trim();
  if (n.length < 3 || n.length > 16) return 'Display name harus 3-16 karakter';
  return null;
}
