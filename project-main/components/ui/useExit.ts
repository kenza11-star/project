'use client';
import { useEffect, useState } from 'react';

/** Menahan komponen tetap terpasang `ms` setelah `open` jadi false, supaya animasi keluar sempat tampil. */
export function useExit(open: boolean, ms: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open };
}
