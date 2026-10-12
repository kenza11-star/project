// RoomClient: state machine sisi klien untuk satu room multiplayer (logika murni, transport disuntikkan; dites di scripts/test-net.js).
//
// Tanggung jawab: daftar pemain remote (maks MAX_ROOM_PLAYERS-1), pesan masuk divalidasi, interpolasi per pemain, pengiriman posisi lokal
// 10 Hz (+ keepalive), pemain masuk/keluar, dan RECONNECT otomatis dengan backoff. TIDAK bergantung pada pause menu: pengiriman berjalan dari timer
// sendiri, jadi membuka menu di game tidak menghentikan pengiriman posisi (pemain lain tidak melihat kita freeze).
import { KEEPALIVE_MS, MAX_ROOM_PLAYERS, PROTOCOL_VERSION, SEND_INTERVAL_MS, STALE_MS, sanitizeName, sanitizeState, stateChanged, type MemberInfo, type NetState } from './protocol';
import { SnapshotBuffer, type Sampled } from './interp';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'closed';
export type TransportStatus = 'connecting' | 'connected' | 'disconnected';

export interface TransportEvents {
  onStatus(s: TransportStatus): void;
  /** id pemain yang sedang online di room (presence). */
  onOnline(ids: string[]): void;
  /** daftar anggota room yang sah (dari database; sumber kebenaran nama/slot). */
  onMembers(members: MemberInfo[]): void;
  /** `from` = identitas pengirim yang diturunkan dari saluran, BUKAN dari isi pesan. */
  onState(from: string, raw: unknown): void;
}
export interface RoomTransport {
  open(ev: TransportEvents): Promise<void>;
  send(msg: object): void;
  close(): Promise<void>;
}

export interface Clock { now(): number; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h as any),
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as any),
};

export interface RemoteView { id: string; name: string; slot: number; stale: boolean; state: Sampled }
type LocalState = Omit<NetState, 'v' | 'ep' | 'seq'>;
export interface RoomClientOpts {
  selfId: string;
  factory: () => RoomTransport;
  clock?: Clock;
  /** dipanggil sebelum tiap percobaan sambung ulang (mis. segarkan token, daftar ulang keanggotaan lewat API). Melempar = percobaan dianggap gagal. */
  beforeReconnect?: () => Promise<void>;
  rand?: () => number;
}

export const backoffMs = (attempt: number, rand = Math.random) => Math.min(10000, 500 * 2 ** Math.min(attempt, 5)) + Math.floor(rand() * 300);

interface Peer { info: MemberInfo; buf: SnapshotBuffer; ep: number; seq: number; lastRecv: number }

export class RoomClient {
  status: NetStatus = 'idle';
  private clock: Clock;
  private rand: () => number;
  private t: RoomTransport | null = null;
  private members = new Map<string, MemberInfo>();
  private online = new Set<string>();
  private peers = new Map<string, Peer>();
  private local: LocalState | null = null;
  private lastSent: LocalState | null = null;
  private lastSentAt = -1e9;
  private seq = 0;
  private ep: number;
  private timer: unknown = null;
  private retryTimer: unknown = null;
  private attempt = 0;
  private gen = 0; // generasi koneksi: callback dari transport lama diabaikan
  private subs = new Set<() => void>();
  droppedInvalid = 0;

  constructor(private opts: RoomClientOpts) { this.clock = opts.clock ?? realClock; this.rand = opts.rand ?? Math.random; this.ep = 1 + Math.floor(this.rand() * 2 ** 30); }

  onChange(fn: () => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private emit() { this.subs.forEach((f) => { try { f(); } catch { /* pendengar tidak boleh merusak klien */ } }); }
  private setStatus(s: NetStatus) { if (this.status !== s) { this.status = s; this.emit(); } }

  async start(): Promise<void> {
    if (this.status !== 'idle') return;
    this.setStatus('connecting');
    this.timer = this.clock.setInterval(() => this.tick(), SEND_INTERVAL_MS);
    await this.connect(false);
  }

  private async connect(isRetry: boolean): Promise<void> {
    const gen = ++this.gen;
    try {
      if (isRetry && this.opts.beforeReconnect) await this.opts.beforeReconnect();
      if (this.status === 'closed' || gen !== this.gen) return;
      const t = this.opts.factory();
      this.t = t;
      const live = () => gen === this.gen && this.status !== 'closed';
      await t.open({
        onStatus: (s) => { if (live() && s === 'disconnected') this.lost(); },
        onOnline: (ids) => { if (live()) this.setOnline(ids); },
        onMembers: (m) => { if (live()) this.setMembers(m); },
        onState: (from, raw) => { if (live()) this.recv(from, raw); },
      });
      if (!live()) return;
      this.attempt = 0;
      this.lastSentAt = -1e9; // kirim posisi segera setelah tersambung (juga setelah reconnect)
      this.setStatus('online');
    } catch {
      if (this.status !== 'closed' && gen === this.gen) this.lost();
    }
  }

  private lost() {
    if (this.status === 'closed') return;
    this.gen++; // abaikan callback koneksi lama
    const old = this.t; this.t = null;
    old?.close().catch(() => {});
    this.setStatus('reconnecting');
    if (this.retryTimer) return;
    const wait = backoffMs(this.attempt++, this.rand);
    this.retryTimer = this.clock.setTimeout(() => { this.retryTimer = null; void this.connect(true); }, wait);
  }

  async stop(): Promise<void> {
    this.setStatus('closed');
    this.gen++;
    if (this.timer) this.clock.clearInterval(this.timer); this.timer = null;
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer); this.retryTimer = null;
    const t = this.t; this.t = null;
    this.peers.clear();
    try { await t?.close(); } catch { /* abaikan */ }
    this.emit();
  }

  // ---- anggota & presence ----
  private setMembers(list: MemberInfo[]) {
    this.members.clear();
    for (const m of list) if (m && typeof m.id === 'string') this.members.set(m.id, { id: m.id, name: sanitizeName(m.name), slot: Math.max(0, Math.min(MAX_ROOM_PLAYERS - 1, m.slot | 0)) });
    this.rebuild();
  }
  private setOnline(ids: string[]) { this.online = new Set(ids.filter((x) => typeof x === 'string')); this.rebuild(); }
  /** Remote = anggota sah ∩ online, bukan diri sendiri, urut slot, maksimal MAX_ROOM_PLAYERS-1. */
  private rebuild() {
    const want = [...this.members.values()].filter((m) => m.id !== this.opts.selfId && this.online.has(m.id)).sort((a, b) => a.slot - b.slot).slice(0, MAX_ROOM_PLAYERS - 1);
    let changed = false;
    for (const id of [...this.peers.keys()]) if (!want.some((w) => w.id === id)) { this.peers.delete(id); changed = true; }
    for (const w of want) {
      const p = this.peers.get(w.id);
      if (!p) { this.peers.set(w.id, { info: w, buf: new SnapshotBuffer(), ep: -1, seq: -1, lastRecv: this.clock.now() }); changed = true; }
      else if (p.info.name !== w.name || p.info.slot !== w.slot) { p.info = w; changed = true; }
    }
    if (changed) this.emit();
  }

  // ---- pesan masuk ----
  private recv(from: string, raw: unknown) {
    if (from === this.opts.selfId) return;
    const p = this.peers.get(from);
    if (!p) return; // bukan anggota sah / belum online
    const s = sanitizeState(raw);
    if (!s) { this.droppedInvalid++; return; }
    if (s.ep === p.ep && s.seq <= p.seq) return; // duplikat / terlambat
    if (s.ep !== p.ep) p.buf.clear(); // pengirim reconnect/refresh: mulai buffer baru
    p.ep = s.ep; p.seq = s.seq; p.lastRecv = this.clock.now();
    p.buf.push(s, p.lastRecv);
  }

  // ---- pengiriman ----
  setLocal(s: LocalState) { this.local = s; }
  private tick() {
    if (this.status !== 'online' || !this.t || !this.local) return;
    const now = this.clock.now();
    if (!stateChanged(this.lastSent, this.local) && now - this.lastSentAt < KEEPALIVE_MS) return;
    const msg: NetState = { v: PROTOCOL_VERSION, ep: this.ep, seq: ++this.seq, ...this.local };
    try { this.t.send(msg); } catch { return; }
    this.lastSent = { ...this.local }; this.lastSentAt = now;
  }

  // ---- baca untuk renderer ----
  get remoteCount() { return this.peers.size; }
  /** Dipanggil tiap frame render. */
  sample(now = this.clock.now()): RemoteView[] {
    const out: RemoteView[] = [];
    for (const p of this.peers.values()) {
      const s = p.buf.sample(now);
      if (s) out.push({ id: p.info.id, name: p.info.name, slot: p.info.slot, stale: now - p.lastRecv > STALE_MS, state: s });
    }
    return out;
  }
  /** Daftar pemain untuk HUD/menu: remote yang online (walau belum ada data posisi). */
  roster(): { id: string; name: string; slot: number; stale: boolean }[] {
    const now = this.clock.now();
    return [...this.peers.values()].map((p) => ({ id: p.info.id, name: p.info.name, slot: p.info.slot, stale: now - p.lastRecv > STALE_MS }));
  }
}
