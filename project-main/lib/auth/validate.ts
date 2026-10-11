// Validasi form login/register (logika murni, dites di scripts/test-auth.js).
// Ini HANYA validasi bentuk input di sisi klien supaya pesan error cepat. Keamanan sebenarnya (hash password, rate limit,
// cek duplikat, sesi) wajib dilakukan backend; jangan mengandalkan validasi ini.
export const USERNAME_MIN = 3, USERNAME_MAX = 16, PASSWORD_MIN = 8, PASSWORD_MAX = 128, EMAIL_MAX = 254;

export type Errors<K extends string> = Partial<Record<K, string>>;

export function validateUsername(v: string): string | null {
  const n = v.trim();
  if (n.length < USERNAME_MIN || n.length > USERNAME_MAX) return `Username harus ${USERNAME_MIN}-${USERNAME_MAX} karakter`;
  if (!/^[A-Za-z0-9_.-]+$/.test(n)) return 'Username hanya boleh huruf, angka, titik, minus, dan garis bawah';
  return null;
}
export function validateEmail(v: string): string | null {
  const n = v.trim();
  if (!n) return 'Email wajib diisi';
  if (n.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(n)) return 'Format email tidak valid';
  return null;
}
export function validatePassword(v: string): string | null {
  if (v.length < PASSWORD_MIN) return `Password minimal ${PASSWORD_MIN} karakter`;
  if (v.length > PASSWORD_MAX) return `Password maksimal ${PASSWORD_MAX} karakter`;
  if (!v.trim()) return 'Password tidak boleh hanya spasi';
  return null;
}

export interface LoginInput { identifier: string; password: string }
export interface RegisterInput { username: string; email: string; password: string; confirm: string }

export function validateLogin(i: LoginInput): Errors<keyof LoginInput> {
  const e: Errors<keyof LoginInput> = {};
  const id = i.identifier.trim();
  if (!id) e.identifier = 'Isi username atau email';
  else if (id.length > EMAIL_MAX) e.identifier = 'Terlalu panjang';
  if (!i.password) e.password = 'Isi password';
  return e;
}
export function validateRegister(i: RegisterInput): Errors<keyof RegisterInput> {
  const e: Errors<keyof RegisterInput> = {};
  const u = validateUsername(i.username); if (u) e.username = u;
  const m = validateEmail(i.email); if (m) e.email = m;
  const p = validatePassword(i.password); if (p) e.password = p;
  if (!e.password && i.confirm !== i.password) e.confirm = 'Konfirmasi password tidak sama';
  else if (e.password && !i.confirm) e.confirm = 'Isi konfirmasi password';
  return e;
}
export const hasErrors = (e: object) => Object.keys(e).length > 0;
