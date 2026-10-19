'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { validateName, type Profile } from '@/lib/profile';
import { checkImage } from '@/lib/image';

// account = null -> mode guest (tanpa username & ID).
export default function ProfileEditModal({ profile, account, onSave, onAvatar, onClose }: {
  profile: Profile; account: { id: string; name: string } | null; onSave: (p: Profile) => void; onAvatar: (f: File) => void; onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const save = () => {
    const e = validateName(name);
    if (e) { setErr(e); return; }
    onSave({ name: name.trim() }); onClose();
  };
  return (
    <Modal title="EDIT PROFILE" onClose={onClose}>
      <label className="lbl">DISPLAY NAME</label>
      <input className="inp" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      <label className="lbl">USERNAME</label>
      <input className="inp" value={account ? account.name : 'Guest'} readOnly />
      <label className="lbl">ID</label>
      <input className="inp" value={account ? account.id : '—'} readOnly />
      {!account && <div className="note">Guest mode tidak punya ID. Login / daftar untuk mendapatkan ID.</div>}
      <input ref={file} type="file" hidden accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const m = checkImage(f); if (m) setErr(m); else { setErr(null); onAvatar(f); } }} />
      <button className="gbtn" onClick={() => file.current?.click()}><Upload size={18} /> Foto profil</button>
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="gbtn" onClick={onClose}>Batal</button><button className="gbtn" onClick={save}>Simpan</button></div>
    </Modal>
  );
}
