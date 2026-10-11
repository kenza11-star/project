'use client';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export default function Modal({ title, onClose, children, side }: { title?: string; onClose: () => void; children: ReactNode; side?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className={'backdrop' + (side ? ' side' : '')} onClick={onClose}>
      <div className="panel" role="dialog" onClick={(e) => e.stopPropagation()}>
        <button className="xbtn" aria-label="Tutup" onClick={onClose}><X size={20} /></button>
        {title && <h2 className="ptitle">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
