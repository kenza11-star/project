// Penanda "sedang bermain" di <html>. Fallback landscape (.rotfix: UI diputar 90deg di HP portrait) hanya berlaku saat penanda ini aktif,
// jadi lobby dan login selalu tampil dengan layout portrait/landscape aslinya (tidak terputar).
// Skrip kecil di app/layout.tsx mendengarkan 'resize' dan memasang/melepas .rotfix; event dikirim sinkron di sini supaya efeknya langsung.
export function setPlayMode(on: boolean): void {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  if (on) d.setAttribute('data-play', '1'); else d.removeAttribute('data-play');
  try { window.dispatchEvent(new Event('resize')); } catch { /* abaikan */ }
}
