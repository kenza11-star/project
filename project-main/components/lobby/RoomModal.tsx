'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, DoorOpen, EyeOff, Play, Plus, Share2, Users } from 'lucide-react';
import Modal from '../ui/Modal';
import { createRoom, joinRoom, startRoom, RoomApiError, type RoomSession, type RoomStateView } from '@/lib/net/roomapi';
import { normalizeRoomCode, ROOM_CODE_LEN } from '@/lib/net/roomrules';
import { roomCounts } from '@/lib/net/roomcounts';

// Panel room multiplayer. TAMPILAN SAJA: status room (`room`), daftar pemain (`view`) dan polling server dipegang Lobby (lib/net/useRoomSync.ts),
// jadi menyembunyikan panel (tombol X) TIDAK keluar dari room dan tidak menghentikan sinkron. Panel bisa dibuka lagi lewat chip "ROOM xxxxxx" di lobby.
// Hanya tombol "Keluar room" yang benar-benar keluar.
type Phase = { k: 'menu' } | { k: 'join' } | { k: 'busy'; text: string };

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* jatuh ke cara lama (HTTP / izin ditolak) */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export default function RoomModal({ mode, selfId, room, view, syncErr, onEnter, onStarted, onLeave, onHide, toast }: {
  mode: number; selfId: string;
  room: RoomSession | null;                         // room aktif di ruang tunggu (null = belum ada: tampil menu buat/gabung)
  view: RoomStateView | null;                       // snapshot server terbaru (dari polling Lobby)
  syncErr: string | null;
  onEnter: (room: RoomSession) => void;             // berhasil buat/gabung room
  onStarted: (room: RoomSession) => void;           // host menekan Mulai
  onLeave: () => void;                              // keluar room (benar-benar)
  onHide: () => void;                               // sembunyikan panel (tetap di room)
  toast: (m: string, k?: 'ok' | 'err') => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'menu' });
  const [code, setCode] = useState('');
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const err = (e: unknown) => { toast(e instanceof RoomApiError ? e.message : 'Gagal. Coba lagi.', 'err'); };

  const create = async () => {
    setPhase({ k: 'busy', text: 'Membuat room...' });
    try { onEnter(await createRoom(mode)); } catch (e) { err(e); setPhase({ k: 'menu' }); }
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    if (!c) { toast(`Kode room ${ROOM_CODE_LEN} karakter (huruf/angka).`, 'err'); return; }
    setPhase({ k: 'busy', text: 'Bergabung...' });
    try { onEnter(await joinRoom(c)); } catch (e) { err(e); setPhase({ k: 'join' }); } // room_full / room_started / tidak ditemukan: pesan jelas dari server
  };

  const members = view?.members ?? [];
  const counts = roomCounts(view, room?.maxPlayers ?? 2); // angka DARI SERVER (sama dengan yang dilihat joiner/host lain)
  const onlineCount = counts.online;
  const isHost = !!room && (view ? view.host_id === selfId : room.hostId === selfId);
  const start = async () => {
    if (!room || starting) return;
    setStarting(true);
    try { await startRoom(room.roomId); onStarted({ ...room, status: 'playing' }); }
    catch (e) { err(e); } finally { if (alive.current) setStarting(false); }
  };
  const copy = async () => { const ok = await copyText(room!.code); toast(ok ? 'Kode disalin: ' + room!.code : 'Salin manual: ' + room!.code, ok ? 'ok' : 'err'); };
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';
  const share = async () => { try { await navigator.share({ title: 'Ajak main', text: `Gabung room game saya. Kode room: ${room!.code}` }); } catch { /* dibatalkan pengguna */ } };

  const waiting = !!room;
  return (
    <Modal side={waiting} title={room ? 'ROOM ' + room.code : 'MULTIPLAYER ONLINE'} closeLabel={waiting ? 'Sembunyikan' : 'Tutup'} onClose={onHide}>
      {!room && phase.k === 'menu' && (<>
        <button className="gbtn big" disabled={mode < 2} onClick={create}><Plus size={20} /> Buat room ({mode >= 2 ? mode + ' pemain' : 'pilih 2-4 pemain'})</button>
        <button className="gbtn big" onClick={() => setPhase({ k: 'join' })}><DoorOpen size={20} /> Gabung dengan kode</button>
        <div className="note">Maksimal 4 pemain per room. Semua pemain memakai model karakter yang sama.</div>
        <button className="gbtn" onClick={onHide}>Back</button>
      </>)}
      {!room && phase.k === 'join' && (<>
        <label className="lbl">KODE ROOM</label>
        <input className="inp" value={code} autoFocus maxLength={ROOM_CODE_LEN + 1} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') void join(); }} />
        <div className="row"><button className="gbtn" onClick={() => setPhase({ k: 'menu' })}>Back</button><button className="gbtn" onClick={join}>Gabung</button></div>
      </>)}
      {!room && phase.k === 'busy' && <div className="note">{phase.text}</div>}
      {room && (<>
        <div className="row"><button className="gbtn" onClick={copy}><Copy size={16} /> Salin kode</button>{canShare && <button className="gbtn" onClick={share}><Share2 size={16} /> Bagikan</button>}</div>
        <div className="ftitle"><Users size={14} /> PEMAIN ({counts.online}/{counts.max})</div>
        <div className="fscroll">
          {members.map((m) => (
            <div className="frow" key={m.id} style={m.online ? undefined : { opacity: 0.5 }}>
              <span className="fname" style={{ cursor: 'default' }}>{m.name}{m.id === selfId ? ' (kamu)' : ''}{m.online ? '' : ' · menyambung...'}</span>{m.host && <span className="tag">HOST</span>}
            </div>
          ))}
          {!view && <div className="empty">Memuat...</div>}
        </div>
        {syncErr && <div className="note">⚠ {syncErr}. Mencoba lagi...</div>}
        {view && <div className="note" style={{ fontSize: 9, opacity: 0.45, letterSpacing: 1 }}>v{process.env.NEXT_PUBLIC_BUILD_ID || 'dev'} · be {view.backend ?? '-'}{view.via ? ' · ' + view.via : ''}</div>}
        {isHost
          ? <button className="gbtn big" onClick={start} disabled={starting || !counts.ready}><Play size={20} /> {!counts.ready ? 'Menunggu pemain...' : 'Mulai'}</button>
          : <div className="note">Menunggu host memulai permainan...</div>}
        <button className="gbtn" onClick={onHide}><EyeOff size={16} /> Sembunyikan</button>
        <button className="gbtn" onClick={onLeave}>Keluar room</button>
      </>)}
    </Modal>
  );
}
