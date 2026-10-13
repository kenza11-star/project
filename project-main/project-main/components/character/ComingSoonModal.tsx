'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { COMING_SOON_TEXT } from '@/lib/character/config';

// Modal pengganti pemilih karakter selagi fitur terkunci. Isi teks hanya persis "COMING SOON".
// Tutup: tombol X, ketuk di luar kartu, atau Esc. Gaya horror ada di app/horror.css (.cs-*).
export default function ComingSoonModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="cs" onClick={onClose}>
      <div className="cs-card" role="alertdialog" aria-label={COMING_SOON_TEXT} onClick={(e) => e.stopPropagation()}>
        <button className="cs-x" aria-label="Tutup" onClick={onClose}><X size={20} /></button>
        <div className="cs-title">{COMING_SOON_TEXT}</div>
      </div>
    </div>
  );
}
