'use client';
import dynamic from 'next/dynamic';

const Lobby = dynamic(() => import('@/components/lobby/Lobby'), {
  ssr: false,
  loading: () => <div className="boot">MEMUAT...</div>,
});

export default function Page() { return <Lobby />; }
