'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, DoorOpen, Play, Plus, Share2, Users } from 'lucide-react';
import Modal from '../ui/Modal';
import { createRoom, joinRoom, leaveRoom, startRoom, fetchRoomState, RoomApiError, type RoomSession, type RoomStateView } from '@/lib/net/roomapi';
import { normalizeRoomCode, ROOM_CODE_LEN } from '@/lib/net/roomrules';

// Ruang tunggu multiplayer online: buat room (host), gabung dengan kode, atau masuk lewat undangan teman (`initial`).
// Daftar pemain diambil dari SERVER (GET /api/rooms/state, tiap 1,5 dtk; sekaligus heartbeat) -- bukan dari RLS browser -- dan dilaporkan ke Lobby
// (`onView`) supaya karakter 3D semua pemain tampil di lobby. `onReady` dipanggil saat game dimulai (host menekan MULAI, atau status room jadi 'playing').
type Phase = { k: 'menu' } | { k: 'join' } | { k: 'busy'; text: string } | { k: 'wait'; room: RoomSession };

const POLL_MS = 1500;
const MAX_MISSES = 10; // gagal berturut-turut (dihitung hanya saat halaman terlihat) sebelum menyerah

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* jatuh ke cara lama (HTTP / izin ditolak) */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export default function RoomModal({ mode, selfId, initial, onReady, onRoom, onView, onClose, toast }: {
  mode: number; selfId: string; initial?: RoomSession | null;
  onReady: (room: RoomSession) => void;
  onRoom: (room: RoomSession | null) => void;      // room aktif di ruang tunggu (null = tidak ada) -> dipakai Lobby untuk mengirim undangan
  onView: (view: RoomStateView | null) => void;    // snapshot server terbaru -> dipakai Lobby untuk avatar 3D
  onClose: () => void; toast: (m: string, k?: 'ok' | 'err') => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'menu' });
  const [code, setCode] = useState('');
  const [view, setView] = useState<RoomStateView | null>(null);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true), handedOver = useRef(false), roomRef = useRef<RoomSession | null>(null);
  const readyRef = useRef(onReady); readyRef.current = onReady; // callback induk berubah tiap render; polling tidak boleh ikut restart
  const toastRef = useRef(toast); toastRef.current = toast;
  const onRoomRef = useRef(onRoom); onRoomRef.current = onRoom;
  const onViewRef = useRef(onView); onViewRef.current = onView;
  useEffect(() => { alive.current = true; return () => { alive.current = false; onViewRef.current(null); }; }, []);

  const err = useCallback((e: unknown) => { toast(e instanceof RoomApiError ? e.message : 'Gagal. Coba lagi.', 'err'); }, [toast]);
  const handOver = useCallback((room: RoomSession) => { if (handedOver.current) return; handedOver.current = true; onRoomRef.current(null); readyRef.current(room); }, []);
  const enter = useCallback((room: RoomSession) => {
    roomRef.current = room; onRoomRef.current(room);
    if (room.status === 'playing') handOver(room); // gabung ulang ke room yang sudah berjalan (reconnect anggota lama): langsung masuk game
    else setPhase({ k: 'wait', room });
  }, [handOver]);

  // Masuk lewat undangan / dibuka dari tombol Invite: room sudah ada.
  const initialId = initial?.roomId;
  useEffect(() => { if (initial && !roomRef.current) enter(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initialId]);

  const create = async () => {
    setPhase({ k: 'busy', text: 'Membuat room...' });
    try { enter(await createRoom(mode)); } catch (e) { err(e); if (alive.current) setPhase({ k: 'menu' }); }
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    if (!c) { toast(`Kode room ${ROOM_CODE_LEN} karakter (huruf/angka).`, 'err'); return; }
    setPhase({ k: 'busy', text: 'Bergabung...' });
    try { enter(await joinRoom(c)); } catch (e) { err(e); if (alive.current) setPhase({ k: 'join' }); } // room_full / room_started / tidak ditemukan: pesan jelas dari server
  };
  // Tutup / batal saat sudah di dalam room = keluar room (kecuali game dimulai).
  const leaveAndClose = useCallback(() => {
    const r = roomRef.current;
    if (r && !handedOver.current) void leaveRoom(r.roomId).catch(() => {});
    roomRef.current = null; onRoomRef.current(null);
    onClose();
  }, [onClose]);

  // Ruang tunggu: polling server tiap 1,5 dtk. Satu loop per room; tidak ada request bertumpuk (setTimeout berantai, bukan setInterval).
  // Polling ini SEKALIGUS heartbeat. Di HP, saat pemain pindah ke WhatsApp (salin/bagikan kode) browser membekukan tab sehingga heartbeat berhenti;
  // karena itu begitu halaman terlihat lagi (visibilitychange / focus / pageshow / online) polling dijalankan SEGERA, tanpa menunggu timer yang tertunda.
  const room = phase.k === 'wait' ? phase.room : null;
  useEffect(() => {
    if (!room) return;
    let stop = false, finished = false, busy = false, misses = 0, rejoined = false, t: ReturnType<typeof setTimeout> | undefined;
    const back = (msg: string) => { finished = true; toastRef.current(msg, 'err'); roomRef.current = null; onRoomRef.current(null); onViewRef.current(null); setView(null); setPhase({ k: 'menu' }); };
    const schedule = (ms: number) => { if (stop || finished) return; clearTimeout(t); t = setTimeout(() => { void tick(); }, ms); };
    const tick = async () => {
      if (stop || finished || busy) return;
      busy = true;
      try {
        const s = await fetchRoomState(room.roomId);
        if (stop) return;
        misses = 0; rejoined = false; setView(s); onViewRef.current(s);
        if (s.status === 'closed') { back('Room ditutup.'); return; }
        if (s.status === 'playing') { finished = true; handOver({ ...room, status: 'playing', slot: s.members.find((m) => m.id === selfId)?.slot ?? room.slot, hostId: s.host_id }); return; }
      } catch (e) {
        if (stop) return;
        const c = e instanceof RoomApiError ? e.code : '';
        if (c === 'room_closed') { back('Room ditutup.'); return; }
        if (c === 'not_member') { // kursi terlepas (mis. koneksi lama putus): coba gabung ulang SEKALI sebelum menyerah
          if (!rejoined) { rejoined = true; try { await joinRoom(room.code); } catch (e2) { if (!stop) { back(e2 instanceof RoomApiError ? e2.message : 'Kamu keluar dari room.'); return; } } }
          else { back('Kamu tidak lagi ada di room ini.'); return; }
        } else if (!document.hidden && ++misses >= MAX_MISSES) { back('Koneksi ke server terputus.'); return; } // saat tab di latar belakang, kegagalan jaringan tidak dihitung
      } finally { busy = false; }
      schedule(misses ? Math.min(5000, POLL_MS * (1 + misses)) : POLL_MS);
    };
    const wake = () => { if (stop || finished || document.hidden) return; misses = 0; clearTimeout(t); void tick(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake); window.addEventListener('pageshow', wake); window.addEventListener('online', wake);
    void tick();
    return () => {
      stop = true; clearTimeout(t);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake); window.removeEventListener('online', wake);
    };
  }, [room, handOver, selfId]);

  const members = view?.members ?? [];
  const onlineCount = members.filter((m) => m.online).length;
  const isHost = !!room && (view ? view.host_id === selfId : room.hostId === selfId);
  const start = async () => {
    if (!room || starting) return;
    setStarting(true);
    try { const r = await startRoom(room.roomId); void r; handOver({ ...room, status: 'playing' }); }
    catch (e) { err(e); } finally { if (alive.current) setStarting(false); }
  };
  const copy = async () => { const ok = await copyText(room!.code); toast(ok ? 'Kode disalin: ' + room!.code : 'Salin manual: ' + room!.code, ok ? 'ok' : 'err'); };
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';
  const share = async () => { try { await navigator.share({ title: 'Ajak main', text: `Gabung room game saya. Kode room: ${room!.code}` }); } catch { /* dibatalkan pengguna */ } };

  return (
    <Modal side={phase.k === 'wait'} title={phase.k === 'wait' ? 'ROOM ' + phase.room.code : 'MULTIPLAYER ONLINE'} onClose={phase.k === 'wait' ? leaveAndClose : onClose}>
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
        <div className="row"><button className="gbtn" onClick={copy}><Copy size={16} /> Salin kode</button>{canShare && <button className="gbtn" onClick={share}><Share2 size={16} /> Bagikan</button>}</div>
        <div className="ftitle"><Users size={14} /> PEMAIN ({view ? onlineCount : 1}/{view?.max_players ?? phase.room.maxPlayers})</div>
        <div className="fscroll">
          {members.map((m) => (
            <div className="frow" key={m.id} style={m.online ? undefined : { opacity: 0.5 }}>
              <span className="fname" style={{ cursor: 'default' }}>{m.name}{m.id === selfId ? ' (kamu)' : ''}{m.online ? '' : ' · menyambung...'}</span>{m.host && <span className="tag">HOST</span>}
            </div>
          ))}
          {!view && <div className="empty">Memuat...</div>}
        </div>
        {isHost
          ? <button className="gbtn big" onClick={start} disabled={starting || onlineCount < 2}><Play size={20} /> {onlineCount < 2 ? 'Menunggu pemain...' : 'Mulai'}</button>
          : <div className="note">Menunggu host memulai permainan...</div>}
        <button className="gbtn" onClick={leaveAndClose}>Keluar room</button>
      </>)}
    </Modal>
  );
}
