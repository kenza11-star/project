'use client';
import HorrorBackdrop from './HorrorBackdrop';
import { useExit } from './useExit';

// Layar loading: tampil selama `active` (diikat ke proses pemuatan nyata oleh pemanggil), lalu memudar. Teks hanya "Loading...".
export default function LoadingScreen({ active }: { active: boolean }) {
  const { mounted, closing } = useExit(active, 700);
  if (!mounted) return null;
  return (
    <div className={'ldg' + (closing ? ' out' : '')} role="status" aria-label="Loading...">
      <HorrorBackdrop />
      <div className="ldg-txt" aria-hidden><span>Loading</span><i>.</i><i>.</i><i>.</i></div>
    </div>
  );
}
