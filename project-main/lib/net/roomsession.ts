// KLIEN (browser). Merakit NetSession untuk PlayScene: RoomClient + transport Supabase + heartbeat + sambung ulang yang mendaftar ulang keanggotaan.
import { RoomClient, realClock } from './roomclient';
import { SupabaseTransport } from './supabaseTransport';
import { HybridTransport } from './hybridTransport';
import { heartbeat, joinRoom, leaveRoom, leaveRoomOnUnload, lockerCall, syncRoom, type RoomSession } from './roomapi';
import { LockerClient } from './lockerclient';
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
      realtime: () => (room.via !== 'relay' && supabaseClientConfigured() ? new SupabaseTransport(room.roomId, selfId) : null), // room di relay blitz.cloud tidak ada di Supabase
    }),
    // Sebelum tiap percobaan sambung ulang: segarkan token dan daftar ulang keanggotaan (idempoten; slot yang sama bila masih milik kita).
    beforeReconnect: async () => { await currentIdToken(true); await joinRoom(room.code); },
  });
  // Loker/lemari: server memutuskan siapa boleh masuk. Snapshot status datang lewat relai sync (HybridTransport -> client.onLockers); klaim/lepas lewat /api/rooms/locker.
  const lockers = new LockerClient({ selfId, clock: realClock, api: (req) => lockerCall(room.roomId, req), poke: () => { client.sendLockerPoke(); },
    p2p: { send: (m) => { client.sendLockerMsg(m); }, peers: () => client.peerIds() } }); // server/tabel loker tidak tersedia -> klaim lewat pesan realtime (tidak menolak semua loker)
  const offLockers = client.onLockers((m, t) => lockers.apply(m, t));
  const offLockerMsg = client.onLockerMsg((from, raw) => lockers.onPeerMsg(from, raw));
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
    client, lockers, roomId: room.roomId, code: room.code, seed: room.seed, slot: room.slot, hostId: room.hostId, maxPlayers: room.maxPlayers, selfName,
    leave: async () => {
      stopped = true; if (hb) clearInterval(hb); hb = null; window.removeEventListener('pagehide', onHide);
      offLockers(); offLockerMsg(); lockers.dispose(); // leave_room di server juga melepas klaim kita (pemegang bukan anggota aktif = klaim tidak hidup)
      await client.stop();
      try { await leaveRoom(room.roomId); } catch { /* best-effort */ }
    },
  };
}
