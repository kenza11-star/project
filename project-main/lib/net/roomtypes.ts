// Tipe data room yang dipakai klien (dipisah dari roomapi.ts supaya logika murni seperti roompoller.ts bisa dites tanpa memuat Firebase/fetch).
export interface RoomSession { roomId: string; code: string; seed: number; maxPlayers: number; status: 'waiting' | 'playing' | 'closed'; slot: number; hostId: string; via?: 'main' | 'relay' }
export interface RoomMemberView { id: string; slot: number; name: string; host: boolean; online: boolean }
export interface RoomStateView { room_id: string; code: string; status: 'waiting' | 'playing' | 'closed'; host_id: string; max_players: number; seed: number; members: RoomMemberView[]; active: boolean }
