import { MOCK_USERS } from './social/logic';
import { load, save } from './storage/local';

export interface Profile { name: string; uid: string }
const LEGACY_UID = '10001'; // UID bawaan versi lama (sama di semua perangkat)

// UID 5 digit acak (10000-99999), tidak bentrok dengan user demo.
export function randomUid(): string {
  for (let i = 0; i < 50; i++) {
    let n: number;
    try { n = crypto.getRandomValues(new Uint32Array(1))[0] % 90000; } catch { n = Math.floor(Math.random() * 90000); }
    const uid = String(10000 + n);
    if (!MOCK_USERS[uid] && uid !== LEGACY_UID) return uid;
  }
  return '54321';
}

// Ambil profil perangkat ini. Perangkat baru (atau yang masih memakai UID lama) otomatis dapat UID acak dan disimpan permanen.
export function loadProfile(): Profile {
  const p = load<Partial<Profile>>('profile', {});
  const name = typeof p.name === 'string' && p.name.trim().length >= 3 ? p.name.trim().slice(0, 16) : 'PLAYER';
  const ok = typeof p.uid === 'string' && /^\d{5}$/.test(p.uid) && p.uid !== LEGACY_UID && !MOCK_USERS[p.uid];
  const profile: Profile = { name, uid: ok ? (p.uid as string) : randomUid() };
  save('profile', profile);
  return profile;
}

export function validateName(name: string): string | null {
  const n = name.trim();
  if (n.length < 3 || n.length > 16) return 'Username harus 3-16 karakter';
  return null;
}
