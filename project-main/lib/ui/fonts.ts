// Font horror: Eater (judul, rusak/menetes) + Special Elite (mesin ketik dokumen SCP) dari Google Fonts (OFL).
// Dimuat lewat <link id="horror-fonts"> di app/layout.tsx. Bila gagal dimuat (offline/diblokir), CSS memakai fallback serif/monospace.
export const HORROR_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Eater&family=Special+Elite&display=swap';

/** Resolve saat font siap (atau gagal). Batas maksimum `maxMs` hanya agar font yang gagal tidak menahan selamanya; jalan paralel dengan pemuatan lain. */
export function loadHorrorFonts(maxMs = 1500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const link = document.getElementById('horror-fonts') as HTMLLinkElement | null;
  const sheet: Promise<void> = link && !link.sheet
    ? new Promise<void>((res) => { link.addEventListener('load', () => res(), { once: true }); link.addEventListener('error', () => res(), { once: true }); })
    : Promise.resolve();
  const fonts = sheet.then(() => Promise.all([document.fonts.load('1em Eater'), document.fonts.load('1em "Special Elite"')])).then(() => undefined, () => undefined);
  const cap = new Promise<void>((res) => setTimeout(res, maxMs));
  return Promise.race([fonts, cap]);
}
