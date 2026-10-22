// Sistem karakter: DIKUNCI sementara. Semua pemain memakai satu model 3D default yang sama (James, public/models/james.glb).
//
// Untuk membuka kembali pemilihan karakter nanti, cukup ubah CHARACTER_SELECTION_ENABLED menjadi true:
//  - Lobby.tsx membuka CharacterModal (upload/ganti model) alih-alih modal "COMING SOON", dan memulihkan model tersimpan.
//  - resolveCharacterModel() meneruskan id model dari jaringan (sekarang selalu 'default').
// Komponen CharacterModal, loader model upload (lib/3d/character.ts) dan penyimpanan IndexedDB TIDAK dihapus.
export const CHARACTER_SELECTION_ENABLED = false;

/** Teks yang ditampilkan saat tombol KARAKTER ditekan selagi terkunci (persis, tanpa tambahan). */
export const COMING_SOON_TEXT = 'COMING SOON';

export const DEFAULT_CHARACTER_ID = 'default';

/**
 * Id model yang dipakai untuk merender pemain (lokal maupun remote). Selagi terkunci, apa pun yang diterima/tersimpan DIABAIKAN
 * dan semua pemain memakai model default yang sama. Saat sistem karakter diaktifkan, di sinilah id katalog divalidasi.
 */
export function resolveCharacterModel(requested?: string | null): string {
  if (!CHARACTER_SELECTION_ENABLED) return DEFAULT_CHARACTER_ID;
  return requested && requested.length <= 32 ? requested : DEFAULT_CHARACTER_ID;
}
