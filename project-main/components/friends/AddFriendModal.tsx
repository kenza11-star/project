'use client';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import Modal from '../ui/Modal';
import { findUser, type Social } from '@/lib/social/logic';

export default function AddFriendModal({ social, selfUid, onSend, onClose }: {
  social: Social; selfUid: string; onSend: (uid: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ uid: string; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const search = () => {
    setRes(null);
    if (!/^\d{1,5}$/.test(q)) { setMsg('Masukkan UID (angka, maks 5 digit)'); return; }
    if (q === selfUid) { setMsg('Itu UID kamu sendiri'); return; }
    const u = findUser(q, selfUid);
    if (!u) { setMsg('UID tidak ditemukan'); return; }
    setMsg(null); setRes(u);
  };
  return (
    <Modal title="CARI UID" onClose={onClose}>
      <div className="row">
        <input className="inp" value={q} inputMode="numeric" maxLength={5} placeholder="12345" autoFocus
          onChange={(e) => setQ(e.target.value.replace(/\D/g, '').slice(0, 5))} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="gbtn" onClick={search}><Search size={18} /></button>
      </div>
      {msg && <div className="err">{msg}</div>}
      {res && (
        <div className="result">
          <div><b>{res.name}</b><br /><small>UID: {res.uid}</small></div>
          {social.friends.includes(res.uid) ? <span className="tag">TEMAN</span>
            : social.sent.includes(res.uid) ? <span className="tag dim">TERKIRIM</span>
            : <button className="plus big" aria-label="Kirim request" onClick={() => onSend(res.uid)}><Plus size={22} /></button>}
        </div>
      )}
      <small className="hint">UID demo: 12345, 23456, 34567, 45678</small>
    </Modal>
  );
}
