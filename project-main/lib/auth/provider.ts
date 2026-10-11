import type { AuthProvider, AuthResult } from './types';

// ====================================================================================
// TITIK INTEGRASI BACKEND
// Ganti `authProvider` di bawah dengan implementasi yang memanggil API kamu, contoh:
//
//   export const authProvider: AuthProvider = {
//     available: true,
//     login: (i) => post('/api/auth/login', i),       // server: verifikasi hash, rate limit, set cookie httpOnly
//     register: (i) => post('/api/auth/register', i),  // server: cek duplikat, hash password (argon2/bcrypt)
//     logout: () => post('/api/auth/logout', {}).then(() => {}),
//     restore: () => get('/api/auth/me'),
//   };
//
// Selama belum ada backend, provider di bawah tidak membuat/memeriksa akun apa pun dan tidak menyimpan password.
// ====================================================================================
const unavailable = (): Promise<AuthResult> => Promise.resolve({
  ok: false, code: 'unavailable',
  message: 'Server akun belum tersambung, jadi login/daftar belum bisa diproses. Pakai "Main sebagai Tamu" untuk bermain sekarang.',
});

export const authProvider: AuthProvider = {
  available: false,
  login: unavailable,
  register: unavailable,
  logout: () => Promise.resolve(),
  restore: () => Promise.resolve(null),
};
