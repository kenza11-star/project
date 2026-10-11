'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { validateName, type Profile } from '@/lib/profile';
import { checkImage } from '@/lib/image';

export default function ProfileEditModal({ profile, onSave, onAvatar, onClose }: {
  profile: Profile; onSave: (p: Profile) => void; onAvatar: (f: File) => void; onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const save = () => {
    const e = validateName(name);
    if (e) { setErr(e); return; }
    onSave({ name: name.trim(), uid: profile.uid }); onClose();
  };
  return (
    <Modal title="EDIT PROFILE" onClose={onClose}>
      <label className="lbl">USERNAME</label>
      <input className="inp" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      <label className="lbl">UID (OTOMATIS, UNIK PER PERANGKAT)</label>
      <input className="inp" value={profile.uid} readOnly />
      <input ref={file} type="file" hidden accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const m = checkImage(f); if (m) setErr(m); else { setErr(null); onAvatar(f); } }} />
      <button className="gbtn" onClick={() => file.current?.click()}><Upload size={18} /> Foto profil</button>
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="gbtn" onClick={onClose}>Batal</button><button className="gbtn" onClick={save}>Simpan</button></div>
    </Modal>
  );
}
