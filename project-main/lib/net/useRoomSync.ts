'use client';
// Sinkron ruang tunggu room (polling server). Hidup di level LOBBY, bukan di dalam modal: menutup/menyembunyikan panel room, membuka panel lain
// (teman, profil, dll.) atau berpindah aplikasi TIDAK menghentikan sinkron. Polling ini sekaligus heartbeat (server menandai kita "online").
//
// Logika polling ada di roompoller.ts (murni, dites di scripts/test-poller.js); file ini hanya menyambungkannya ke React.
// Kenapa ditulis ulang (bug "host tidak melihat pemain yang masuk / 1/2 terus"):
//  * Dulu polling = rantai setTimeout di dalam RoomModal. Rantai itu bisa mati diam-diam (request/token menggantung di HP, hasil tick usang dibuang
//    tanpa menjadwalkan ulang) dan ikut MATI setiap modal ditutup / diganti panel lain -> daftar pemain host membeku di data lama.
//  * Sekarang: pompa setInterval 1 dtk yang tidak pernah berhenti sendiri; request macet >8 dtk ditinggalkan dan diganti baru; hasil hanya diterapkan
//    bila lebih baru dari yang sudah diterapkan; gagal berkali-kali TIDAK mengeluarkan pemain dari room (hanya "menyambung ulang..." + backoff).
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRoomState, joinRoom, syncRoom, RoomApiError, type RoomSession, type RoomStateView } from './roomapi';
import { RoomPoller } from './roompoller';

export interface RoomSyncHandlers {
  /** Room sudah dimulai (status 'playing') -> masuk game. */
  onPlaying(room: RoomSession): void;
  /** Room hilang (ditutup / kursi tidak bisa dipulihkan). */
  onGone(message: string): void;
}

/** Sumber state ruang tunggu dengan DUA jalur server independen: /api/rooms/state, dan bila itu gagal (galat server) /api/rooms/sync (endpoint & fungsi SQL berbeda).
 *  Satu endpoint yang rusak/404/timeout tidak lagi membuat host buta terhadap pemain yang masuk. Galat sah (not_member, room_closed...) tetap diteruskan apa adanya. */
async function fetchViewRedundant(roomId: string): Promise<RoomStateView> {
  try { return await fetchRoomState(roomId); }
  catch (e) {
    if (!(e instanceof RoomApiError) || e.code !== 'server') throw e;
    try { return await syncRoom({ roomId, since: -1, need: false }); }
    catch (e2) { if (e2 instanceof RoomApiError && e2.code !== 'server') throw e2; throw e; }
  }
}

export function useRoomSync(room: RoomSession | null, selfId: string, handlers: RoomSyncHandlers) {
  const [view, setView] = useState<RoomStateView | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const hRef = useRef(handlers); hRef.current = handlers;
  const pRef = useRef<RoomPoller | null>(null);
  const roomId = room?.roomId ?? null;

  useEffect(() => {
    setView(null); setSyncErr(null);
    if (!room) { pRef.current = null; return; }
    const p = new RoomPoller({
      room, selfId, fetchState: fetchViewRedundant, rejoin: joinRoom,
      onView: setView, onErr: setSyncErr,
      onPlaying: (r) => hRef.current.onPlaying(r), onGone: (m) => hRef.current.onGone(m),
    });
    pRef.current = p;
    const wake = () => { if (!document.hidden) p.kick(); };      // kembali dari aplikasi lain: segarkan SEKARANG
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake); window.addEventListener('pageshow', wake); window.addEventListener('online', wake);
    // Layar HP yang mati membekukan tab (polling & heartbeat berhenti). Selama ada room, minta layar tetap menyala (bila browser mendukung); gagal = diabaikan.
    let lock: { release(): Promise<void> } | null = null, off = false;
    const grab = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (!wl || off || document.hidden || lock) return;
        const l = await wl.request('screen'); if (off) { void l.release().catch(() => {}); return; }
        lock = l; (l as unknown as EventTarget).addEventListener?.('release', () => { if (lock === l) lock = null; });
      } catch { /* tidak didukung / ditolak */ }
    };
    const regrab = () => { if (!document.hidden) void grab(); };
    document.addEventListener('visibilitychange', regrab);
    void grab();
    p.start();
    return () => {
      off = true; document.removeEventListener('visibilitychange', regrab); void lock?.release().catch(() => {}); lock = null;
      p.stop(); if (pRef.current === p) pRef.current = null;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake); window.removeEventListener('online', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, selfId]);

  const refresh = useCallback(() => pRef.current?.kick(), []);
  return { view, syncErr, refresh };
}
