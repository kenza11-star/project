import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Backrooms Lobby', description: 'Prototype lobby 3D horror' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#0c0904',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="id"><body>{children}</body></html>);
}
