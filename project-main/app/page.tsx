'use client';
import dynamic from 'next/dynamic';
import LoadingScreen from '@/components/ui/LoadingScreen';

// Selama kode lobby diunduh (nyata), tampilkan layar Loading yang sama dengan yang dipakai Lobby sesudahnya.
const Lobby = dynamic(() => import('@/components/lobby/Lobby'), {
  ssr: false,
  loading: () => <LoadingScreen active />,
});

export default function Page() { return <Lobby />; }
