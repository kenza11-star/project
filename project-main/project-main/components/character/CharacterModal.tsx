'use client';
import { useRef, type ChangeEvent } from 'react';
import { Upload, RotateCcw } from 'lucide-react';
import Modal from '../ui/Modal';
import { DEFAULT_MODEL_LABEL } from '@/lib/3d/character';

interface Props {
  modelName: string | null; loading: number | null;
  onModel: (f: File) => void; onResetModel: () => void; onClose: () => void;
}
export default function CharacterModal(p: Props) {
  const m = useRef<HTMLInputElement>(null);
  const pick = (cb: (f: File) => void) => (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) cb(f); };
  return (
    <Modal side title="CHARACTER" onClose={p.onClose}>
      <div className="note">Preview 3D langsung: lihat karakter di tengah layar. Format .glb, .gltf (embedded), atau .vrm, maks 40 MB.</div>
      <div className="cur">Karakter: {p.modelName || DEFAULT_MODEL_LABEL}</div>
      <input ref={m} type="file" hidden accept=".glb,.gltf,.vrm" onChange={pick(p.onModel)} />
      <button className="gbtn" disabled={p.loading !== null} onClick={() => m.current?.click()}><Upload size={18} /> Upload / ganti karakter</button>
      {p.loading !== null && <div className="bar"><i style={{ width: `${Math.round(p.loading * 100)}%` }} /></div>}
      {p.modelName && <button className="gbtn" disabled={p.loading !== null} onClick={p.onResetModel}><RotateCcw size={18} /> Kembali ke default (James)</button>}
      <small className="hint">Model default: James oleh StormierTunic16 (CC BY 4.0).</small>
    </Modal>
  );
}
