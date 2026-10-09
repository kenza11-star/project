'use client';
import Modal from '../ui/Modal';

export default function DemoMenu({ actions, onClose }: { actions: { label: string; run: () => void }[]; onClose: () => void }) {
  return (
    <Modal title="MODE DEMO" onClose={onClose}>
      <div className="note">Simulasi lokal untuk menguji alur teman/invite. Data hanya ada di perangkat ini dan tidak tersinkron real-time antar perangkat.</div>
      {actions.map((a) => <button key={a.label} className="gbtn" onClick={a.run}>{a.label}</button>)}
    </Modal>
  );
}
