'use client';
import { useState } from 'react';
import { Trash2, UserPlus, User } from 'lucide-react';
import Modal from '../ui/Modal';
import { userName, type Social } from '@/lib/social/logic';

export default function FriendOptionsModal({ uid, social, onInvite, onRemove, onClose }: {
  uid: string; social: Social; onInvite: () => void; onRemove: () => void; onClose: () => void;
}) {
  const [view, setView] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const name = userName(uid);
  return (
    <Modal title={name} onClose={onClose}>
      {confirm ? (
        <>
          <div className="note">Hapus {name} dari daftar teman?</div>
          <div className="row"><button className="gbtn" onClick={() => setConfirm(false)}>Batal</button><button className="gbtn danger" onClick={() => { onRemove(); onClose(); }}>Hapus</button></div>
        </>
      ) : (
        <>
          <button className="gbtn" onClick={() => { onInvite(); onClose(); }}><UserPlus size={18} /> Invite</button>
          <button className="gbtn" onClick={() => setView(!view)}><User size={18} /> View profile</button>
          {view && <div className="result"><div><b>{name}</b><br /><small>UID: {uid}</small><br /><small>Status: {social.party === uid ? 'IN PARTY' : 'TEMAN'}</small></div></div>}
          <button className="gbtn danger" onClick={() => setConfirm(true)}><Trash2 size={18} /> Remove friend</button>
        </>
      )}
    </Modal>
  );
}
