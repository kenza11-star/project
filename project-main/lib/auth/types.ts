// Kontrak autentikasi. UI (components/auth/AuthScreen) hanya bicara lewat AuthProvider ini, jadi backend nanti cukup
// mengganti isi `lib/auth/provider.ts` tanpa mengubah UI.
export interface AuthUser { id: string; name: string }
export type AuthErrorCode = 'invalid' | 'taken' | 'rate_limited' | 'network' | 'unavailable' | 'unknown';
export type AuthResult = { ok: true; user: AuthUser } | { ok: false; code: AuthErrorCode; message: string; field?: string };

export interface AuthProvider {
  /** false = belum ada backend; UI menampilkan pemberitahuan jujur dan tetap menjalankan alur (hasilnya error 'unavailable'). */
  readonly available: boolean;
  login(input: { username: string; password: string }): Promise<AuthResult>;
  register(input: { username: string; password: string }): Promise<AuthResult>;
  logout(): Promise<void>;
  /** Pulihkan sesi akun yang sah dari server (mis. cookie httpOnly). null = tidak ada sesi. */
  restore(): Promise<AuthUser | null>;
}

// Sesi di perangkat ini. Sengaja TIDAK menyimpan password/token: token sesi nyata sebaiknya cookie httpOnly dari backend.
export type Session = { kind: 'guest' } | { kind: 'account'; user: AuthUser };
