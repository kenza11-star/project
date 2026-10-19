'use client';
import { Lock } from 'lucide-react';
import Modal from '../ui/Modal';
import { PLAYER_MODES, type PlayerMode } from '@/lib/game/players';

// guest: hanya Single Player yang bisa dipilih; mode multiplayer terkunci sampai login.
export default function PlayerModeModal({ mode, guest, onPick, onLogin, onClose, onOnline }: {
  mode: PlayerMode; guest?: boolean; onPick: (m: PlayerMode) => void; onLogin: () => void; onClose: () => void; onOnline?: () => void;
}) {
  return (
    <Modal title="MODE PEMAIN" onClose={onClose}>
      {PLAYER_MODES.map((m) => {
        const locked = !!guest && m.mode > 1;
        return (
          <button key={m.mode} className={'gbtn big' + (m.mode === mode ? ' on' : '')} aria-pressed={m.mode === mode} disabled={locked}
            style={locked ? { opacity: 0.5 } : undefined} onClick={() => onPick(m.mode)}>{locked && <Lock size={16} />} {m.label}</button>
        );
      })}
      {guest
        ? <div className="note">Guest hanya bisa Single Player. Login untuk membuka multiplayer dan fitur teman.</div>
        : <div className="note">{onOnline ? 'Mode 2-4: tekan Play untuk membuat room online, atau gabung dengan kode.' : 'Pilihan tersimpan di perangkat ini. Server multiplayer belum dikonfigurasi: di mode 2-4 slot pemain lain tetap kosong dan belum bisa dimainkan.'}</div>}
      {onOnline && !guest && <button className="gbtn" onClick={onOnline}>Room online (buat / gabung)</button>}
      {guest && <button className="gbtn" onClick={onLogin}>Masuk / Daftar</button>}
      <button className="gbtn" onClick={onClose}>Back</button>
    </Modal>
  );
}
