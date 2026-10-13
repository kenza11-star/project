// Pemetaan username <-> identitas Firebase (logika murni, dipakai klien DAN server; dites di scripts/test-backend.js).
//
// UI hanya meminta username + password (tanpa email). Firebase Email/Password butuh alamat email, jadi username dipetakan ke alamat
// internal `<username>@<domain>`. Alamat ini tidak pernah dikirimi email (verifikasi/reset password tidak dipakai), sehingga domainnya
// sengaja memakai TLD cadangan `.invalid`. Domain bisa diubah lewat NEXT_PUBLIC_AUTH_EMAIL_DOMAIN (harus sama di klien & server).
import { validateUsername } from './validate';

export const DEFAULT_AUTH_EMAIL_DOMAIN = 'players.kynx-horror.invalid';

export function authEmailDomain(): string {
  const d = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN) || '';
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? d.toLowerCase() : DEFAULT_AUTH_EMAIL_DOMAIN;
}
/** Username dinormalkan ke huruf kecil (Firebase memperlakukan email tanpa membedakan huruf besar/kecil). */
export const normalizeUsername = (u: string) => u.trim().toLowerCase();
export const usernameToEmail = (u: string, domain = authEmailDomain()) => `${normalizeUsername(u)}@${domain}`;
/** null bila email bukan milik sistem ini atau username-nya tidak valid. */
export function emailToUsername(email: unknown, domain = authEmailDomain()): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || email.slice(at + 1).toLowerCase() !== domain.toLowerCase()) return null;
  const u = normalizeUsername(email.slice(0, at));
  return validateUsername(u) ? null : u;
}
