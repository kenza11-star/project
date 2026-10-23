'use client';

// Tampilan layar muat NIGHTROUND (foto lorong + judul + bar). `value` 0..1 = progres nyata; tanpa `value` = bar bergerak (tidak ada angka palsu).
export default function LoadArt({ value }: { value?: number }) {
  const det = typeof value === 'number';
  const v = det ? Math.min(1, Math.max(0, value as number)) : 0;
  const pct = Math.round(v * 100);
  return (
    <>
      <div className="spl-bg" />
      <div className="spl-vig" />
      <header className="spl-head">
        <h1 className="spl-title">NIGHTROUND</h1>
        <p className="spl-sub"><span>THE FORGOTTEN COMPLEX</span></p>
      </header>
      <footer className="spl-foot">
        <div className="spl-row">
          <div className="spl-ld"><span>MEMUAT</span><span className="spl-dots" aria-hidden><i /><i /><i /></span>{det && <b className="spl-pct">{pct}%</b>}</div>
          <p className="spl-quote">“Jangan pernah menoleh ke belakang.”</p>
        </div>
        <div className="spl-bar" role="progressbar" aria-label="Memuat" aria-valuemin={0} aria-valuemax={100} aria-valuenow={det ? pct : undefined}>
          <div className={'spl-fill' + (det ? '' : ' spl-ind')} style={det ? { transform: `scaleX(${v})` } : undefined} />
        </div>
      </footer>
    </>
  );
}
