'use client';
import { userName, type Social } from '@/lib/social/logic';

export default function Notifications({ social, onReq, onInv }: {
  social: Social; onReq: (uid: string, ok: boolean) => void; onInv: (uid: string, ok: boolean) => void;
}) {
  const items = [
    ...social.incoming.map((uid) => ({ k: 'r', uid })),
    ...social.gameInvites.map((uid) => ({ k: 'i', uid })),
  ].slice(0, 2);
  if (!items.length) return null;
  return (
    <div className="notifs">
      {items.map(({ k, uid }) => (
        <div className="notif" key={k + uid}>
          <div>{userName(uid)} {k === 'r' ? 'mengikuti mu' : 'mengundang mu ke permainan'}</div>
          <div className="row">
            <button className="gbtn" onClick={() => (k === 'r' ? onReq(uid, false) : onInv(uid, false))}>Tolak</button>
            <button className="gbtn" onClick={() => (k === 'r' ? onReq(uid, true) : onInv(uid, true))}>Terima</button>
          </div>
        </div>
      ))}
    </div>
  );
}
