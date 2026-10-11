'use client';
import Modal from '../ui/Modal';
import { PLAYER_MODES, type PlayerMode } from '@/lib/game/players';

export default function PlayerModeModal({ mode, onPick, onClose }: { mode: PlayerMode; onPick: (m: PlayerMode) => void; onClose: () => void }) {
  return (
    <Modal title="MODE PEMAIN" onClose={onClose}>
      {PLAYER_MODES.map((m) => (
        <button key={m.mode} className={'gbtn big' + (m.mode === mode ? ' on' : '')} aria-pressed={m.mode === mode} onClick={() => onPick(m.mode)}>{m.label}</button>
      ))}
      <div className="note">Pilihan tersimpan di perangkat ini. Networking online belum tersedia: di mode 2-4 slot pemain lain tetap kosong dan belum bisa dimainkan.</div>
      <button className="gbtn" onClick={onClose}>Back</button>
    </Modal>
  );
}
