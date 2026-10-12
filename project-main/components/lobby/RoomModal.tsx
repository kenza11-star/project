'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, DoorOpen, Play, Plus, Users } from 'lucide-react';
import Modal from '../ui/Modal';
import { createRoom, joinRoom, leaveRoom, startRoom, RoomApiError, type RoomSession } from '@/lib/net/roomapi';
import { getSupabase } from '@/lib/net/supabaseClient';
import { fetchRoomSnapshot, type RoomSnapshot } from '@/lib/net/members';
import { normalizeRoomCode, ROOM_CODE_LEN } from '@/lib/net/roomrules';

// Ruang tunggu multiplayer online: buat room (host) atau gabung dengan kode. Data anggota dibaca dari Supabase (RLS), tulis lewat API server.
// `onReady` dipanggil saat game dimulai (host menekan START, atau status room menjadi 'playing' untuk anggota lain).
type Phase = { k: 'menu' } | { k: 'join' } | { k: 'busy'; text: string } | { k: 'wait'; room: RoomSession };

export default function RoomModal({ mode, selfId, onReady, onClose, toast }: {
  mode: number; selfId: string; onReady: (room: RoomSession) => void; onClose: () => void; toast: (m: string, k?: 'ok' | 'err') => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'menu' });
  const [code, setCode] = useState('');
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const alive = useRef(true), handedOver = useRef(false), roomRef = useRef<RoomSession | null>(null);
  const readyRef = useRef(onReady); readyRef.current = onReady; // callback dari induk berubah tiap render; polling tidak boleh ikut restart
  const toastRef = useRef(toast); toastRef.current = toast;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const err = useCallback((e: unknown) => { toast(e instanceof RoomApiError ? e.message : 'Gagal. Coba lagi.', 'err'); }, [toast]);
  const handOver = useCallback((room: RoomSession) => { if (handedOver.current) return; handedOver.current = true; readyRef.current(room); }, []);
  const enter = useCallback((room: RoomSession) => {
    roomRef.current = room;
    if (room.status === 'playing') handOver(room); // gabung ke room yang sudah berjalan / reconnect: langsung masuk game
    else setPhase({ k: 'wait', room });
  }, [handOver]);

  const create = async () => {
    setPhase({ k: 'busy', text: 'Membuat room...' });
    try { enter(await createRoom(mode)); } catch (e) { err(e); if (alive.current) setPhase({ k: 'menu' }); }
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    if (!c) { toast(`Kode room ${ROOM_CODE_LEN} karakter (huruf/angka).`, 'err'); return; }
    setPhase({ k: 'busy', text: 'Bergabung...' });
    try { enter(await joinRoom(c)); } catch (e) { err(e); if (alive.current) setPhase({ k: 'join' }); }
  };
  // Tutup / batal saat sudah di dalam room = keluar room (kecuali game dimulai).
  const leaveAndClose = useCallback(() => {
    const r = roomRef.current;
    if (r && !handedOver.current) void leaveRoom(r.roomId).catch(() => {});
    onClose();
  }, [onClose]);

  // Ruang tunggu: polling status & anggota tiap 2 dtk (REST + RLS, ringan; tidak perlu Realtime untuk lobi).
  const room = phase.k === 'wait' ? phase.room : null;
  useEffect(() => {
    if (!room) return;
    let stop = false, misses = 0, t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const sb = await getSupabase();
        const s = await fetchRoomSnapshot(sb, room.roomId);
        if (stop) return;
        if (!s) { if (++misses >= 4) { toastRef.current('Room tidak lagi tersedia.', 'err'); roomRef.current = null; setPhase({ k: 'menu' }); return; } }
        else {
          misses = 0; setSnap(s);
          if (s.status === 'closed') { toastRef.current('Room ditutup.', 'err'); roomRef.current = null; setPhase({ k: 'menu' }); return; }
          if (s.status === 'playing') { handOver({ ...room, status: 'playing' }); return; }
        }
      } catch { /* jaringan: coba lagi di tick berikut */ }
      if (!stop) t = setTimeout(tick, 2000);
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [room, handOver]);

  const isHost = !!room && !!snap ? snap.hostId === selfId : !!room && room.hostId === selfId;
  const start = async () => {
    if (!room) return;
    try { await startRoom(room.roomId); handOver({ ...room, status: 'playing' }); } catch (e) { err(e); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(room!.code); toast('Kode disalin'); } catch { toast('Salin manual: ' + room!.code); } };

  return (
    <Modal title={phase.k === 'wait' ? 'ROOM ' + phase.room.code : 'MULTIPLAYER ONLINE'} onClose={phase.k === 'wait' ? leaveAndClose : onClose}>
      {phase.k === 'menu' && (<>
        <button className="gbtn big" disabled={mode < 2} onClick={create}><Plus size={20} /> Buat room ({mode >= 2 ? mode + ' pemain' : 'pilih 2-4 pemain'})</button>
        <button className="gbtn big" onClick={() => setPhase({ k: 'join' })}><DoorOpen size={20} /> Gabung dengan kode</button>
        <div className="note">Maksimal 4 pemain per room. Semua pemain memakai model karakter yang sama.</div>
        <button className="gbtn" onClick={onClose}>Back</button>
      </>)}
      {phase.k === 'join' && (<>
        <label className="lbl">KODE ROOM</label>
        <input className="inp" value={code} autoFocus maxLength={ROOM_CODE_LEN + 1} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') void join(); }} />
        <div className="row"><button className="gbtn" onClick={() => setPhase({ k: 'menu' })}>Back</button><button className="gbtn" onClick={join}>Gabung</button></div>
      </>)}
      {phase.k === 'busy' && <div className="note">{phase.text}</div>}
      {phase.k === 'wait' && (<>
        <div className="row"><button className="gbtn" onClick={copy}><Copy size={16} /> Salin kode</button></div>
        <div className="ftitle"><Users size={14} /> PEMAIN ({snap ? snap.members.length : 1}/{phase.room.maxPlayers})</div>
        <div className="fscroll">
          {(snap?.members ?? []).map((m) => (
            <div className="frow" key={m.id}><span className="fname" style={{ cursor: 'default' }}>{m.name}{m.id === selfId ? ' (kamu)' : ''}</span>{m.host && <span className="tag">HOST</span>}</div>
          ))}
          {!snap && <div className="empty">Memuat...</div>}
        </div>
        {isHost
          ? <button className="gbtn big" onClick={start}><Play size={20} /> Mulai</button>
          : <div className="note">Menunggu host memulai permainan...</div>}
        <button className="gbtn" onClick={leaveAndClose}>Keluar room</button>
      </>)}
    </Modal>
  );
}
