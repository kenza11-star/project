// KLIEN (browser). Merakit NetSession untuk PlayScene: RoomClient + transport Supabase + heartbeat + sambung ulang yang mendaftar ulang keanggotaan.
import { RoomClient } from './roomclient';
import { SupabaseTransport } from './supabaseTransport';
import { heartbeat, joinRoom, leaveRoom, leaveRoomOnUnload, type RoomSession } from './roomapi';
import { HEARTBEAT_MS } from './roomrules';
import { currentIdToken } from '@/lib/auth/firebaseClient';
import type { NetSession } from './session';

export async function startNetSession(room: RoomSession, selfId: string, selfName: string): Promise<NetSession> {
  const client = new RoomClient({
    selfId,
    factory: () => new SupabaseTransport(room.roomId, selfId),
    // Sebelum tiap percobaan sambung ulang: segarkan token dan daftar ulang keanggotaan (idempoten; slot yang sama bila masih milik kita).
    beforeReconnect: async () => { await currentIdToken(true); await joinRoom(room.code); },
  });
  let hb: ReturnType<typeof setInterval> | null = null, stopped = false;
  const beat = async () => {
    try { const r = await heartbeat(room.roomId); if (!r.active && !stopped) await joinRoom(room.code); } catch { /* jaringan putus: RoomClient menangani reconnect */ }
  };
  const onHide = () => { void leaveRoomOnUnload(room.roomId); };
  hb = setInterval(() => { void beat(); }, HEARTBEAT_MS);
  window.addEventListener('pagehide', onHide);
  await client.start();
  return {
    client, roomId: room.roomId, code: room.code, seed: room.seed, slot: room.slot, maxPlayers: room.maxPlayers, selfName,
    leave: async () => {
      stopped = true; if (hb) clearInterval(hb); hb = null; window.removeEventListener('pagehide', onHide);
      await client.stop();
      try { await leaveRoom(room.roomId); } catch { /* best-effort */ }
    },
  };
}
