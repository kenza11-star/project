export const IMG_RE = /\.(jpe?g|png|webp)$/i;
export function checkImage(f: File): string | null {
  const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || IMG_RE.test(f.name);
  if (!okType) return 'Format harus JPG, PNG, atau WEBP';
  if (f.size > 10 * 1024 * 1024) return 'Gambar terlalu besar (maks 10 MB)';
  return null;
}
// Perkecil gambar agar ringan di HP, simpan sebagai WEBP.
export async function resizeImage(file: File, max: number, type: 'image/webp' | 'image/jpeg' = 'image/webp', quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Gambar rusak atau tidak bisa dibaca'));
      i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const g = c.getContext('2d')!;
    if (type === 'image/jpeg') { g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); } // JPEG tanpa alfa: PNG transparan jangan jadi hitam pekat acak
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal memproses gambar'))), type, quality));
  } finally { URL.revokeObjectURL(url); }
}

export const AVATAR_MAX_BYTES = 40 * 1024; // harus sama dengan AVATAR_MAX di app/api/profile/route.ts
/** Foto profil untuk disinkronkan ke server: 256px JPEG, kualitas ~0.7 (turun bertahap bila melebihi 40 KB). */
export async function resizeAvatar(file: File): Promise<Blob> {
  for (const q of [0.7, 0.55, 0.4]) { const b = await resizeImage(file, 256, 'image/jpeg', q); if (b.size <= AVATAR_MAX_BYTES) return b; }
  throw new Error('Foto terlalu rumit (maks 40 KB). Pilih foto lain.');
}
export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Gagal membaca foto')); r.readAsDataURL(b); });
