'use client';
import { useEffect, useRef, useState } from 'react';

// true bila layar sentuh (HP/tablet) sedang portrait. Game TIDAK diputar lewat CSS: saat portrait
// ditampilkan overlay "putar perangkat" (RotateGate) dan gameplay dijeda. Desktop tidak terpengaruh.
// portraitRef dibaca game loop (di luar render React).
export function usePortrait() {
  const [portrait, setPortrait] = useState(false);
  const portraitRef = useRef(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const v = window.innerHeight > window.innerWidth && window.matchMedia('(pointer:coarse)').matches;
      if (v === portraitRef.current) return;
      portraitRef.current = v; setPortrait(v);
    };
    // debounce singkat: saat orientation lock sedang diproses browser, layar sempat portrait sesaat
    const onChange = () => { if (t) clearTimeout(t); t = setTimeout(check, 200); };
    check();
    window.addEventListener('resize', onChange); window.addEventListener('orientationchange', onChange);
    return () => { if (t) clearTimeout(t); window.removeEventListener('resize', onChange); window.removeEventListener('orientationchange', onChange); };
  }, []);
  return { portrait, portraitRef };
}
