'use client';
import { useEffect, useRef } from 'react';
import { LobbyScene } from '@/lib/3d/LobbyScene';

export interface ModelReq { id: number; blob: Blob | null; ext: string; persist: boolean; name: string; size: number }
interface Props {
  req: ModelReq | null; hold: boolean; duo: boolean; partnerName: string | null; selfName: string;
  onProgress: (p: number) => void;
  onResult: (r: ModelReq | null, ok: boolean, msg?: string) => void;
}

// Canvas transparan di atas ruang Backrooms. `hold` = masih memulihkan karakter tersimpan, jangan unduh karakter default dulu.
export default function Stage(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const sc = useRef<LobbyScene | null>(null);
  const cb = useRef(p); cb.current = p;

  useEffect(() => {
    let s: LobbyScene | null = null;
    try {
      s = new LobbyScene(cv.current!, host.current!);
      sc.current = s; s.start();
      s.setModel(1, null).catch(() => {});
    } catch { cb.current.onResult(null, false, 'WebGL tidak tersedia di perangkat ini'); }
    return () => { s?.dispose(); sc.current = null; };
  }, []);

  useEffect(() => { sc.current?.configure(p.duo, !!p.partnerName, [p.selfName, p.partnerName || '']); }, [p.duo, p.partnerName, p.selfName]);
  useEffect(() => {
    const s = sc.current; if (!s) return;
    const r = p.req;
    if (!r && p.hold) return;
    s.setModel(0, r ? { blob: r.blob, ext: r.ext } : null, (pr) => cb.current.onProgress(pr))
      .then((applied) => { if (applied) cb.current.onResult(r, true); })
      .catch((e) => cb.current.onResult(r, false, e?.message || 'Model gagal dimuat'));
  }, [p.req, p.hold]);

  return (
    <div ref={host} className="stage">
      <canvas ref={cv} />
    </div>
  );
}
