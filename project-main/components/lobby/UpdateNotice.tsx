'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Modal from '../ui/Modal';
import { APP_VERSION } from '@/lib/config/appversion';
import { LATER_KEY, clientVersion, isAppRuntime, parseLater, shouldShow, type UpdateInfo } from '@/lib/net/appupdate';

// Popup "Update tersedia" (TIDAK wajib). Dipasang hanya di Lobby (tidak pernah di PlayScene) dan hanya mengambil data SEKALI saat `enabled`.
// Semua galat (jaringan, JSON, localStorage) ditelan diam-diam: game jalan normal, tanpa error di console.
export default function UpdateNotice({ enabled }: { enabled: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let on = true;
    (async () => {
      try {
        const ua = navigator.userAgent || '';
        if (!isAppRuntime(ua, !!window.matchMedia?.('(display-mode: standalone)').matches)) return; // web biasa: tidak ada popup
        const r = await fetch('/api/app-update?v=' + encodeURIComponent(clientVersion(ua, APP_VERSION)), { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as UpdateInfo;
        let later = null; try { later = parseLater(localStorage.getItem(LATER_KEY)); } catch { /* diam */ }
        if (on && shouldShow(j, later, Date.now())) setInfo(j);
      } catch { /* diam */ }
    })();
    return () => { on = false; };
  }, [enabled]);
  if (!info) return null;
  const later = () => { try { localStorage.setItem(LATER_KEY, JSON.stringify({ v: info.version, t: Date.now() })); } catch { /* diam */ } setInfo(null); };
  const now = () => { try { window.open(info.url, '_blank', 'noopener'); } catch { /* diam */ } setInfo(null); };
  return (
    <Modal title={`UPDATE TERSEDIA v${info.version}`} onClose={later} closeLabel="Nanti">
      {info.message && <div className="note">{info.message}</div>}
      {!!info.notes?.length && <div className="note">{info.notes.map((n, i) => <div key={i}>• {n}</div>)}</div>}
      <div className="row"><button className="gbtn" onClick={later}>Later</button><button className="gbtn" onClick={now}><Download size={16} /> Update Now</button></div>
    </Modal>
  );
}
