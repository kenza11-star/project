export const IMG_RE = /\.(jpe?g|png|webp)$/i;
export function checkImage(f: File): string | null {
  const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || IMG_RE.test(f.name);
  if (!okType) return 'Format harus JPG, PNG, atau WEBP';
  if (f.size > 10 * 1024 * 1024) return 'Gambar terlalu besar (maks 10 MB)';
  return null;
}
// Perkecil gambar agar ringan di HP, simpan sebagai WEBP.
export async function resizeImage(file: File, max: number): Promise<Blob> {
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
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal memproses gambar'))), 'image/webp', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
