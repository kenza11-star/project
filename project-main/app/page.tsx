'use client';
import dynamic from 'next/dynamic';

// Selama kode lobby diunduh: layar hitam polos; Lobby lalu memutar Splash NIGHTROUND (intro -> muat).
const Lobby = dynamic(() => import('@/components/lobby/Lobby'), {
  ssr: false,
  loading: () => <div className="spl" role="status" aria-label="Memuat" />,
});

export default function Page() { return <Lobby />; }
