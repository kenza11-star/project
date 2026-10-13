// KLIEN (browser). Merakit NetSession untuk PlayScene: RoomClient + transport Supabase + heartbeat + sambung ulang yang mendaftar ulang keanggotaan.
import { RoomClient, realClock } from './roomclient';
import { SupabaseTransport } from './supabaseTransport';
import { HybridTransport } from './hybridTransport';
import { heartbeat, joinRoom, leaveRoom, leaveRoomOnUnload, syncRoom, type RoomSession } from './roomapi';
import { HEARTBEAT_MS } from './roomrules';
import { currentIdToken } from '@/lib/auth/firebaseClient';
import { supabaseClientConfigured } from '@/lib/config/env';
import type { NetSession } from './session';

export async function startNetSession(room: RoomSession, selfId: string, selfName: string): Promise<NetSession> {
  const client = new RoomClient({
    selfId,
    // Hybrid: relai Postgres (selalu ada, sumber daftar online) + Supabase Realtime sebagai jalur cepat bila berhasil tersambung.
    factory: () => new HybridTransport({
      roomId: room.roomId, selfId, clock: realClock,
      sync: (req) => syncRoom(req),
      realtime: () => (supabaseClientConfigured() ? new SupabaseTransport(room.roomId, selfId) : null),
    }),
    // Sebelum tiap percobaan sambung ulang: segarkan token dan daftar ulang keanggotaan (idempoten; slot yang sama bila masih milik kita).
    beforeReconnect: async () => { await currentIdToken(true); await joinRoom(room.code); },
  });
  let hb: ReturnType<typeof setInterval> | null = null, stopped = false;
  const beat = async () => {
    try { const r = await heartbeat(room.roomId); if (!r.active && !stopped) await joinRoom(room.code); } catch { /* jaringan putus: RoomClient menangani reconnect */ }
  };
  // pagehide dengan persisted=true = halaman hanya masuk bfcache/background (bisa kembali): JANGAN keluar room. Keluar hanya saat halaman benar-benar ditutup.
  const onHide = (e: PageTransitionEvent) => { if (!e.persisted) void leaveRoomOnUnload(room.roomId); };
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
