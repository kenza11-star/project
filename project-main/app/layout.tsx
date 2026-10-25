import './globals.css';
import './horror.css';
import { HORROR_FONTS_HREF } from '@/lib/ui/fonts';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Backrooms Lobby', description: 'Prototype lobby 3D horror', manifest: '/manifest.webmanifest', other: { 'mobile-web-app-capable': 'yes' } };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#0c0904',
};

// Fallback landscape: HANYA saat bermain (html[data-play]). Di layar sentuh yang masih portrait, pasang kelas .rotfix -> CSS memutar tampilan game 90deg.
// Lobby & login TIDAK pernah diputar: mereka punya layout portrait sendiri (globals.css). `data-play` diatur lewat lib/ui/playmode.ts.
const ROT = "(function(){var d=document.documentElement,m=matchMedia('(pointer:coarse)');function c(){d.classList.toggle('rotfix',m.matches&&d.hasAttribute('data-play')&&innerHeight>innerWidth)}c();addEventListener('resize',c);addEventListener('orientationchange',function(){setTimeout(c,120);setTimeout(c,400)});if(window.visualViewport)visualViewport.addEventListener('resize',c)})()";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="id"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link id="horror-fonts" rel="stylesheet" href={HORROR_FONTS_HREF} /></head><body><script dangerouslySetInnerHTML={{ __html: ROT }} />{children}</body></html>);
}
