'use client';
import LoadArt from './LoadArt';
import { useExit } from './useExit';

// Layar muat saat `active` (diikat ke proses pemuatan nyata oleh pemanggil, mis. map di PlayScene), lalu memudar.
// Progres detail tidak tersedia dari pemanggil, jadi bar bergerak (indeterminate) dan tidak menampilkan persen palsu.
export default function LoadingScreen({ active }: { active: boolean }) {
  const { mounted, closing } = useExit(active, 700);
  if (!mounted) return null;
  return (
    <div className={'spl spl-lite' + (closing ? ' out' : '')} role="status" aria-label="Memuat">
      <div className="spl-load"><LoadArt /></div>
    </div>
  );
}
