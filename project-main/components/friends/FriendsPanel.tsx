'use client';
import { useEffect, useState } from 'react';
import { Lock, Plus, User, UserPlus } from 'lucide-react';
import { userName, PRESENCE, AVATAR_CACHE, type Presence, type Social } from '@/lib/social/logic';

const COOLDOWN_MS = 5000; // jeda undangan per teman (server juga menolak < 5 dtk)
const LABEL: Record<Presence, string> = { online: 'Online', ingame: 'Dalam pertandingan', offline: 'Offline' };
const RANK: Record<Presence, number> = { online: 0, ingame: 1, offline: 2 };
const presOf = (uid: string): Presence => PRESENCE[uid] ?? 'online'; // tanpa data server (mode lokal/demo) dianggap online

export default function FriendsPanel({ social, locked, onAdd, onOpen, onInvite }: {
  social: Social; locked?: boolean; onAdd: () => void; onOpen: (uid: string) => void; onInvite: (uid: string) => void;
}) {
  const [cd, setCd] = useState<Record<string, number>>({}); // uid -> waktu cooldown habis (ms)
  const [now, setNow] = useState(0);
  const active = Object.keys(cd).length > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { const n = Date.now(); setNow(n); setCd((c) => { const k = Object.keys(c).filter((u) => c[u] > n); return k.length === Object.keys(c).length ? c : Object.fromEntries(k.map((u) => [u, c[u]])); }); }, 250);
    return () => clearInterval(t);
  }, [active]);
  const invite = (uid: string) => { const n = Date.now(); setNow(n); setCd((c) => ({ ...c, [uid]: n + COOLDOWN_MS })); onInvite(uid); };
  const friends = [...social.friends].sort((a, b) => RANK[presOf(a)] - RANK[presOf(b)]); // online dulu (urutan sama tetap stabil)
  return (
    <div className="fp">
      <button className="gbtn" onClick={onAdd} disabled={locked} aria-disabled={locked} style={locked ? { opacity: 0.5 } : undefined}>{locked ? <Lock size={18} /> : <UserPlus size={18} />} Tambah teman</button>
      <div className="flist">
        <div className="ftitle">TEMAN GAME ({locked ? 0 : social.friends.length})</div>
        <div className="fscroll">
          {locked && <div className="empty">Login dulu untuk memakai fitur teman.</div>}
          {!locked && social.friends.length === 0 && <div className="empty">Belum ada teman. Tekan Tambah teman.</div>}
          {!locked && friends.map((uid) => {
            const st = presOf(uid), src = AVATAR_CACHE[uid]?.src, left = cd[uid] ? Math.max(0, Math.ceil((cd[uid] - now) / 1000)) : 0;
            return (
              <div className="frow" key={uid}>
                <span className="favatar">{src ? <img src={src} alt="" /> : <User size={18} />}</span>
                <button className="fname" onClick={() => onOpen(uid)}><span className="fn">{userName(uid)}</span><span className={'fst ' + st}>{LABEL[st]}</span></button>
                {social.party === uid ? <span className="tag">IN PARTY</span>
                  : social.invited.includes(uid) && left === 0 ? <span className="tag dim">DIUNDANG</span>
                  : <button className="plus" aria-label={`Undang ${userName(uid)}`} disabled={st !== 'online' || left > 0} onClick={() => invite(uid)}>{left > 0 ? <span className="cd">{left}</span> : <Plus size={16} />}</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
