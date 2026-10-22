// RoomClient: state machine sisi klien untuk satu room multiplayer (logika murni, transport disuntikkan; dites di scripts/test-net.js).
//
// Tanggung jawab: daftar pemain remote (maks MAX_ROOM_PLAYERS-1), pesan masuk divalidasi, interpolasi per pemain, pengiriman posisi lokal
// 10 Hz (+ keepalive), pemain masuk/keluar, dan RECONNECT otomatis dengan backoff. TIDAK bergantung pada pause menu: pengiriman berjalan dari timer
// sendiri, jadi membuka menu di game tidak menghentikan pengiriman posisi (pemain lain tidak melihat kita freeze).
import { isWorldMsg, type WorldMsg } from './worldsync';
import { isMonsterMsg } from './monsterproto';
import { LOCKER_POKE, isLockerMsg, type LockerMap, type LockerP2PMsg } from './lockers';
import { KEEPALIVE_MS, MAX_ROOM_PLAYERS, PROTOCOL_VERSION, SEND_INTERVAL_MS, STALE_MS, clampStep, MIN_RECV_GAP_MS, sanitizeName, sanitizeState, sanitizeChatText, type ChatItem, stateChanged, type MemberInfo, type NetState } from './protocol';
import { isRtcMsg, type RtcMsg } from './voicemsg';
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
  /** Snapshot klaim loker dari SERVER (otoritatif). `serverMs` = jam server balasan (NaN bila tidak ada) untuk mengurutkan snapshot. */
  onLockers?(lockers: LockerMap, serverMs: number): void;
}
export interface RoomTransport {
  open(ev: TransportEvents): Promise<void>;
  send(msg: object): void;
  close(): Promise<void>;
  /** Opsional: sinkron ke server SEKARANG (tanpa menunggu siklus berikut). Dipanggil saat pemain lain "mencolek" karena status loker berubah. */
  syncNow?(): void;
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

interface Peer { info: MemberInfo; buf: SnapshotBuffer; ep: number; seq: number; lastRecv: number; chatI: number }
export interface ChatEvent { id: string; name: string; text: string; self: boolean; at: number }
const CHAT_TTL_MS = 8000;

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
  droppedInvalid = 0; droppedFlood = 0; clampedMoves = 0;

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
        onLockers: (m, t) => { if (live()) for (const f of [...this.lockerFns]) { try { f(m, t); } catch { /* pendengar tidak boleh merusak klien */ } } },
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
      if (!p) { this.peers.set(w.id, { info: w, buf: new SnapshotBuffer(), ep: -1, seq: -1, lastRecv: this.clock.now(), chatI: -1 }); changed = true; }
      else if (p.info.name !== w.name || p.info.slot !== w.slot) { p.info = w; changed = true; }
    }
    if (changed) this.emit();
  }

  // ---- pesan masuk ----
  private recv(from: string, raw: unknown) {
    if (from === this.opts.selfId) return;
    const p = this.peers.get(from);
    if (isRtcMsg(raw)) { if (!p && !this.members.has(from)) return; const m = raw as RtcMsg; if (m.to === this.opts.selfId) for (const f of [...this.rtcFns]) { try { f(from, m); } catch { /* abaikan */ } } return; } // sinyal voice (WebRTC): hanya untuk penerima yang dituju; tetap diterima walau presence belum sampai (anggota sah)
    if (!p) return; // bukan anggota sah / belum online
    if (isLockerMsg(raw)) { if (typeof (raw as { a?: unknown }).a === 'string') { for (const f of [...this.lockerMsgFns]) { try { f(from, raw); } catch { /* pendengar tidak boleh merusak klien */ } } } else this.pokedBy(); return; } // "colek": status loker berubah -> sinkron ulang dari server (isi pesan tidak dipercaya, tidak ada isi)
    if (isWorldMsg(raw)) { for (const f of this.worldFns) f(from, raw); return; } // event dunia (worldsync.ts): divalidasi penerima
    if (isMonsterMsg(raw)) { for (const f of this.monFns) f(from, raw); return; } // monster (monstersync.ts): divalidasi penerima; hanya otoritas yang dipercaya
    const s = sanitizeState(raw);
    if (!s) { this.droppedInvalid++; return; }
    if (s.ep === p.ep && s.seq <= p.seq) return; // duplikat / terlambat
    if (s.ep !== p.ep) { p.buf.clear(); p.chatI = -1; } // pengirim reconnect/refresh: mulai buffer baru
    const now = this.clock.now();
    if (s.ep === p.ep && now - p.lastRecv < MIN_RECV_GAP_MS) { this.droppedFlood++; return; } // banjir pesan
    const prev = s.ep === p.ep ? p.buf.last : null;
    let st = s;
    if (prev) { const c = clampStep(prev, s, now - p.lastRecv); st = c.state; if (c.clamped) this.clampedMoves++; }
    p.ep = s.ep; p.seq = s.seq; p.lastRecv = now;
    if (s.cm) for (const c of s.cm) if (c.i > p.chatI) { p.chatI = c.i; this.pushChat({ id: p.info.id, name: p.info.name, text: c.t, self: false, at: Date.now() }); }
    p.buf.push(st, p.lastRecv);
  }

  // ---- loker/lemari (lib/net/lockers.ts): status DIPUTUSKAN server; klien hanya menerima snapshot dan saling mencolek agar sinkron cepat ----
  private lockerFns = new Set<(m: LockerMap, serverMs: number) => void>();
  private lastPokeIn = -1e9;
  onLockers(fn: (m: LockerMap, serverMs: number) => void): () => void { this.lockerFns.add(fn); return () => { this.lockerFns.delete(fn); }; }
  /** Beri tahu pemain lain bahwa status loker berubah (hanya jalur realtime; tanpa isi). */
  sendLockerPoke(): boolean { if (this.status !== 'online' || !this.t) return false; try { this.t.send(LOCKER_POKE); } catch { return false; } return true; }
  // ---- jalur cadangan P2P loker (lockers.ts): pesan klaim/hold/rel antar-pemain lewat realtime ----
  private lockerMsgFns = new Set<(from: string, raw: unknown) => void>();
  onLockerMsg(fn: (from: string, raw: unknown) => void): () => void { this.lockerMsgFns.add(fn); return () => { this.lockerMsgFns.delete(fn); }; }
  sendLockerMsg(msg: LockerP2PMsg): boolean { if (this.status !== 'online' || !this.t) return false; try { this.t.send(msg); } catch { return false; } return true; }
  /** Id pemain remote yang sedang online di roster (anggota sah ∩ online). */
  peerIds(): string[] { return [...this.peers.keys()]; }
  /** Minta transport sinkron ke server sekarang. */
  requestSync(): void { try { this.t?.syncNow?.(); } catch { /* abaikan */ } }
  private pokedBy() { const now = this.clock.now(); if (now - this.lastPokeIn < 300) return; this.lastPokeIn = now; this.requestSync(); } // dibatasi: colekan beruntun tidak membanjiri server

  // ---- event dunia ----
  private worldFns = new Set<(from: string, raw: unknown) => void>();
  /** Daftarkan penerima event dunia dari pemain lain. Mengembalikan fungsi untuk berhenti. */
  onWorld(fn: (from: string, raw: unknown) => void): () => void { this.worldFns.add(fn); return () => { this.worldFns.delete(fn); }; }
  /** Kirim event dunia ke room. false bila belum online (event tetap tercatat di WorldSync dan ikut digest berikutnya). */
  sendWorld(msg: WorldMsg): boolean { if (this.status !== 'online' || !this.t) return false; this.t.send(msg); return true; }
  // ---- monster (lantai atas): snapshot/tangkapan dari otoritas. Hanya lewat jalur realtime (tidak melewati API server) ----
  private monFns = new Set<(from: string, raw: unknown) => void>();
  onMonster(fn: (from: string, raw: unknown) => void): () => void { this.monFns.add(fn); return () => { this.monFns.delete(fn); }; }
  sendMonster(msg: object): boolean { if (this.status !== 'online' || !this.t) return false; this.t.send(msg); return true; }
  get selfId(): string { return this.opts.selfId; }
  /** Jumlah pemain remote yang sedang tercatat (untuk memicu digest saat ada yang baru masuk). */
  peerCount(): number { return this.peers.size; }

  // ---- chat (ikut state; lihat protocol.ts) ----
  private chatFns = new Set<(e: ChatEvent) => void>();
  private chatOut: (ChatItem & { at: number })[] = [];
  private chatSeq = 0;
  private lastChatAt = -1e9;
  onChat(fn: (e: ChatEvent) => void): () => void { this.chatFns.add(fn); return () => { this.chatFns.delete(fn); }; }
  private pushChat(e: ChatEvent) { for (const f of [...this.chatFns]) { try { f(e); } catch { /* abaikan */ } } }
  /** Kirim chat. false = kosong / terlalu cepat (anti-spam 0,8 dtk). */
  sendChat(raw: string, selfName: string): boolean {
    const t = sanitizeChatText(raw), now = this.clock.now();
    if (!t || now - this.lastChatAt < 800) return false;
    this.lastChatAt = now;
    this.chatOut.push({ i: ++this.chatSeq, t, at: now }); if (this.chatOut.length > 3) this.chatOut.shift();
    this.pushChat({ id: this.opts.selfId, name: selfName, text: t, self: true, at: Date.now() });
    return true;
  }
  // ---- voice: sinyal WebRTC lewat jalur realtime ----
  private rtcFns = new Set<(from: string, m: RtcMsg) => void>();
  onRtc(fn: (from: string, m: RtcMsg) => void): () => void { this.rtcFns.add(fn); return () => { this.rtcFns.delete(fn); }; }
  sendRtc(msg: RtcMsg): boolean { if (this.status !== 'online' || !this.t) return false; try { this.t.send(msg); } catch { return false; } return true; }

  // ---- pengiriman ----
  setLocal(s: LocalState) { this.local = s; }
  private tick() {
    if (this.status !== 'online' || !this.t || !this.local) return;
    const now = this.clock.now();
    this.chatOut = this.chatOut.filter((c) => now - c.at < CHAT_TTL_MS);
    const cur: LocalState = this.chatOut.length ? { ...this.local, cm: this.chatOut.map((c) => ({ i: c.i, t: c.t })) } : (({ cm: _cm, ...rest }) => rest)(this.local);
    if (!stateChanged(this.lastSent, cur) && now - this.lastSentAt < KEEPALIVE_MS) return;
    const msg: NetState = { v: PROTOCOL_VERSION, ep: this.ep, seq: ++this.seq, ...cur };
    try { this.t.send(msg); } catch { return; }
    this.lastSent = { ...cur }; this.lastSentAt = now;
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
