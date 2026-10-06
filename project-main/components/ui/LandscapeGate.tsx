'use client';
import { Smartphone } from 'lucide-react';

// Layar "ketuk untuk mulai": browser hanya mengizinkan fullscreen + orientation lock dari sentuhan pengguna,
// jadi satu ketukan di awal inilah yang memasukkan seluruh game (lobby + gameplay) ke landscape.
export default function LandscapeGate({ onStart }: { onStart: () => void }) {
  return (
    <div className="gate" onClick={onStart} role="button" aria-label="Mulai">
      <Smartphone size={46} />
      <b>KETUK UNTUK MULAI</b>
      <small>Layar otomatis masuk mode landscape</small>
    </div>
  );
}

// Fallback true-landscape: bila browser tidak mendukung / menolak orientation lock dan HP masih portrait,
// pemain diminta memutar perangkat (tampilan game sendiri tidak diputar).
export function RotateGate() {
  return (
    <div className="gate rotate" role="alert" aria-live="polite">
      <Smartphone size={46} />
      <b>PUTAR PERANGKAT</b>
      <small>Game ini hanya bisa dimainkan dalam mode landscape</small>
    </div>
  );
}
