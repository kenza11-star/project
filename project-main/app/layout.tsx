import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Backrooms Lobby', description: 'Prototype lobby 3D horror' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#0c0904',
};

// Fallback landscape (tanpa layar blokir): di layar sentuh yang masih portrait, pasang kelas .rotfix -> CSS memutar tampilan 90deg.
const ROT = "(function(){var d=document.documentElement,m=matchMedia('(pointer:coarse)');function c(){d.classList.toggle('rotfix',m.matches&&innerHeight>innerWidth)}c();addEventListener('resize',c);addEventListener('orientationchange',function(){setTimeout(c,120);setTimeout(c,400)});if(window.visualViewport)visualViewport.addEventListener('resize',c)})()";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="id"><body><script dangerouslySetInnerHTML={{ __html: ROT }} />{children}</body></html>);
}
