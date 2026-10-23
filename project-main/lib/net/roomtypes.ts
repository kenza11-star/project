// Tipe data room yang dipakai klien (dipisah dari roomapi.ts supaya logika murni seperti roompoller.ts bisa dites tanpa memuat Firebase/fetch).
export interface RoomSession { roomId: string; code: string; seed: number; maxPlayers: number; status: 'waiting' | 'playing' | 'closed'; slot: number; hostId: string; via?: 'main' | 'relay'; /** Sidik jari backend yang membuat/menerima room (bukan rahasia). */ backend?: string }
export interface RoomMemberView { id: string; slot: number; name: string; host: boolean; online: boolean }
export interface RoomStateView {
  room_id: string; code: string; status: 'waiting' | 'playing' | 'closed'; host_id: string; max_players: number; seed: number; members: RoomMemberView[]; active: boolean;
  // Diisi SERVER (finalizeView di roomview.ts) -- klien memakainya apa adanya, bukan menghitung ulang dari karakter yang dirender / state lokal:
  online_count?: number;   // anggota yang benar-benar ONLINE menurut server
  member_count?: number;   // anggota yang masih memegang kursi (online + menyambung ulang)
  can_start?: boolean;     // server: status waiting & online_count >= 2
  server_time?: string;    // ISO; snapshot yang lebih tua dari yang sudah diterapkan dibuang
  backend?: string;        // sidik jari backend (hash host Supabase) -- host & joiner harus sama
  build?: string;          // id build server (commit Vercel) -- host & joiner harus sama
  dbg?: string;            // diagnostik sementara dari server
  via?: string;            // 'tables' | 'relay' | undefined (RPC)
}
