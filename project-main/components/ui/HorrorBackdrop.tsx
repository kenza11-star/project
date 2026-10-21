'use client';
import { webPaths } from '@/lib/ui/cobweb';

const CORNERS: { c: 'tl' | 'tr' | 'bl' | 'br'; seed: number }[] = [{ c: 'tl', seed: 11 }, { c: 'tr', seed: 23 }, { c: 'bl', seed: 37 }, { c: 'br', seed: 53 }];

// Latar horror ringan: kabut (2 lapis, hanya transform), jaring laba-laba di 4 sudut (SVG statis + goyang pelan), tetesan, kedip gelap, vignette.
// Semua animasi memakai transform/opacity saja (tanpa filter/canvas) supaya aman di HP.
export default function HorrorBackdrop() {
  return (
    <div className="hbd" aria-hidden>
      <div className="fog a" /><div className="fog b" />
      {CORNERS.map(({ c, seed }) => {
        const w = webPaths(seed);
        return (
          <div key={c} className={'webwrap ' + c}>
            <svg className="web" style={{ animationDelay: `${-seed % 7}s`, animationDuration: `${9 + (seed % 5)}s` }} viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeLinecap="round">
              <path d={w.spokes} strokeWidth=".7" /><path d={w.rings} strokeWidth=".45" />
            </svg>
          </div>
        );
      })}
      <i className="drip d1" /><i className="drip d2" />
      <div className="flk" />
    </div>
  );
}
