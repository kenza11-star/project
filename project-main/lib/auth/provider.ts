import type { AuthProvider, AuthResult } from './types';
import { firebaseClientConfigured } from '@/lib/config/env';
import { firebaseProvider } from './firebaseProvider';

// ====================================================================================
// TITIK INTEGRASI AUTH.
//  - NEXT_PUBLIC_FIREBASE_* terisi  -> Firebase Authentication (lib/auth/firebaseProvider.ts) + verifikasi identitas di server (/api/auth/session).
//  - Belum terisi                    -> provider "tidak tersedia": tidak membuat/memeriksa akun apa pun, tidak menyimpan password;
//                                       form menampilkan pesan jujur dan "Play as Guest" tetap berjalan offline.
// Kode Firebase dimuat dinamis hanya saat dipakai, jadi tanpa konfigurasi tidak ada panggilan jaringan ke Firebase.
// ====================================================================================
const unavailable = (): Promise<AuthResult> => Promise.resolve({
  ok: false, code: 'unavailable',
  message: 'Server akun belum tersambung, jadi login/daftar belum bisa diproses. Pakai "Play as Guest" untuk bermain sekarang.',
});
const offline: AuthProvider = {
  available: false,
  login: unavailable,
  register: unavailable,
  logout: () => Promise.resolve(),
  restore: () => Promise.resolve(null),
};

export const authProvider: AuthProvider = firebaseClientConfigured() ? firebaseProvider : offline;
