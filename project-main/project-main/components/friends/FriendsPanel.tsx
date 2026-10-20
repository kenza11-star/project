'use client';
import { Lock, Plus, UserPlus } from 'lucide-react';
import { userName, type Social } from '@/lib/social/logic';

export default function FriendsPanel({ social, locked, onAdd, onOpen, onInvite }: {
  social: Social; locked?: boolean; onAdd: () => void; onOpen: (uid: string) => void; onInvite: (uid: string) => void;
}) {
  return (
    <div className="fp">
      <button className="gbtn" onClick={onAdd} disabled={locked} aria-disabled={locked} style={locked ? { opacity: 0.5 } : undefined}>{locked ? <Lock size={18} /> : <UserPlus size={18} />} Tambah teman</button>
      <div className="flist">
        <div className="ftitle">TEMAN GAME ({locked ? 0 : social.friends.length})</div>
        <div className="fscroll">
          {locked && <div className="empty">Login dulu untuk memakai fitur teman.</div>}
          {!locked && social.friends.length === 0 && <div className="empty">Belum ada teman. Tekan Tambah teman.</div>}
          {!locked && social.friends.map((uid) => (
            <div className="frow" key={uid}>
              <button className="fname" onClick={() => onOpen(uid)}>{userName(uid)}</button>
              {social.party === uid ? <span className="tag">IN PARTY</span>
                : social.invited.includes(uid) ? <span className="tag dim">DIUNDANG</span>
                : <button className="plus" aria-label={`Undang ${userName(uid)}`} onClick={() => onInvite(uid)}><Plus size={16} /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
