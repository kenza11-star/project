// Protokol sinkronisasi pemain (logika murni, tanpa three/react; dites di scripts/test-net.js).
//
// Prinsip:
//  - Hanya data kecil yang dikirim: posisi, rotasi, status animasi. MODEL 3D TIDAK dikirim: semua pemain memakai model default yang sama
//    (lib/character/config.ts), jadi tiap klien merender salinan model itu sendiri (satu instance per pemain).
//  - Semua pesan masuk dianggap TIDAK DIPERCAYA: wajib lewat sanitizeState() (tipe, NaN/Infinity, batas dunia).
//  - Identitas pengirim TIDAK diambil dari isi pesan, tetapi dari saluran (topik) tempat pesan diterima (lihat RoomTransport.onState).

export const PROTOCOL_VERSION = 1;
export const MAX_ROOM_PLAYERS = 4;
export const SEND_INTERVAL_MS = 100;      // 10 Hz
export const KEEPALIVE_MS = 1000;         // tetap kirim 1x/dtk walau diam, supaya pemain yang baru masuk/reconnect langsung dapat posisi
export const STALE_MS = 6000;             // tidak ada data > 6 dtk padahal masih online -> ditandai stale
export const WORLD_LIMIT = 500;           // |koordinat| maksimum yang diterima (m)

export const MAX_SPEED = 8;               // m/dtk, batas kecepatan horizontal yang diterima (lari normal jauh di bawah ini)
export const STEP_SLACK = 1.5;            // m, toleransi jitter / tangga
export const MIN_RECV_GAP_MS = 20;        // pesan dari satu pemain lebih rapat dari ini (>50 Hz) dibuang sebagai banjir

export type Gait = 0 | 1 | 2; // 0 diam, 1 jalan, 2 lari
export interface NetState {
  v: number;       // versi protokol
  ep: number;      // "epoch": acak per sesi koneksi pengirim (seq direset saat pengirim reconnect/refresh)
  seq: number;     // naik 1 tiap pesan dalam satu epoch (pesan lama/duplikat dibuang)
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  gait: Gait; crouch: boolean; hide: boolean;
  level: number;   // 0 lantai bawah, 1 mezzanine
  model: string;   // id model (selalu 'default' selama karakter terkunci)
}

const num = (v: unknown, lim: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);

/** Validasi + normalisasi pesan dari jaringan. null = buang. */
export function sanitizeState(raw: unknown): NetState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== PROTOCOL_VERSION) return null;
  const ep = num(r.ep, 2 ** 31), seq = num(r.seq, 2 ** 40);
  const x = num(r.x, WORLD_LIMIT), y = num(r.y, WORLD_LIMIT), z = num(r.z, WORLD_LIMIT);
  const yaw = num(r.yaw, 1e4), pitch = num(r.pitch, 10);
  if (ep === null || seq === null || x === null || y === null || z === null || yaw === null || pitch === null) return null;
  const gait = r.gait === 1 || r.gait === 2 ? r.gait : 0;
  const level = r.level === 1 ? 1 : 0;
  const model = typeof r.model === 'string' && r.model.length <= 32 ? r.model : 'default';
  return { v: PROTOCOL_VERSION, ep, seq, x, y, z, yaw, pitch: Math.max(-1.6, Math.min(1.6, pitch)), gait, crouch: r.crouch === true, hide: r.hide === true, level, model };
}

export const sanitizeName = (s: unknown): string => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N}_.\- ]/gu, '').trim().slice(0, 16) : '') || 'PLAYER';

export interface MemberInfo { id: string; name: string; slot: number }

/** Dua keadaan lokal dianggap sama (tidak perlu dikirim ulang) bila selisih di bawah ambang. */
export function stateChanged(a: Omit<NetState, 'v' | 'ep' | 'seq'> | null, b: Omit<NetState, 'v' | 'ep' | 'seq'>): boolean {
  if (!a) return true;
  return Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01 || Math.abs(a.z - b.z) > 0.01 || Math.abs(a.yaw - b.yaw) > 0.01 || Math.abs(a.pitch - b.pitch) > 0.01
    || a.gait !== b.gait || a.crouch !== b.crouch || a.hide !== b.hide || a.level !== b.level || a.model !== b.model;
}

/**
 * Anti-teleport / speed-hack di sisi PENERIMA (pesan jaringan tidak dipercaya). Perpindahan yang melebihi MAX_SPEED*dt + STEP_SLACK dipotong
 * ke batas itu sepanjang arah yang sama, jadi pemain curang tampak bergerak cepat menuju titik tujuan, bukan "menembus" dunia seketika.
 * Gerak sah (termasuk reconnect setelah jeda: dt besar = anggaran besar) lolos tanpa perubahan. Ini perlindungan tampilan, bukan anti-cheat penuh.
 */
export function clampStep(prev: NetState, next: NetState, dtMs: number): { state: NetState; clamped: boolean } {
  const dt = Math.max(0, Math.min(dtMs, 60_000)) / 1000;
  const budget = MAX_SPEED * dt + STEP_SLACK;
  const dx = next.x - prev.x, dz = next.z - prev.z, d = Math.hypot(dx, dz);
  if (d <= budget) return { state: next, clamped: false };
  const k = budget / d;
  return { state: { ...next, x: prev.x + dx * k, z: prev.z + dz * k }, clamped: true };
}
