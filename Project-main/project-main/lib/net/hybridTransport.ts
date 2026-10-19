// KLIEN (browser). RoomTransport HYBRID: relai Postgres lewat API (SELALU tersedia) + Supabase Realtime (jalur cepat, opsional).
//
// Mengapa hybrid: transport Realtime private + Third-Party Auth Firebase belum pernah terbukti tersambung di produksi (lihat docs); saat gagal,
// daftar "online" kosong dan pemain lain tak pernah tampil ("1/2 online - MENYAMBUNG ULANG"). Sekarang:
//  - Siapa yang ONLINE & siapa anggota sah = dari DATABASE (heartbeat server), sama persis dengan yang dilihat ruang tunggu. Realtime presence tidak dipakai.
//  - Posisi/event dunia dikirim lewat Realtime bila tersambung (10 Hz), DAN lewat relai Postgres: pelan (1 Hz) bila semua penerima sehat,
//    cepat (4 Hz) bila ada penerima yang tidak menerima Realtime. Penerima menggabung kedua jalur; duplikat dibuang oleh RoomClient (ep/seq) dan WorldSync.
//  - Logika murni + dependensi disuntikkan -> dites di scripts/test-relay.js.
import type { RoomTransport, TransportEvents, Clock } from './roomclient';
import type { MemberInfo } from './protocol';
import { isWorldMsg } from './worldsync';
import { isMonsterMsg } from './monsterproto';
import { isLockerMsg, sanitizeLockers } from './lockers';

export interface RelayMember { id: string; slot: number; name: string; host: boolean; online: boolean }
export interface RelayResponse { status: 'waiting' | 'playing' | 'closed'; members: RelayMember[]; states: Record<string, unknown>; world: { id: number; from: string; msg: unknown }[]; cursor: number; need_relay: boolean; lockers?: unknown; server_time?: string }
export interface RelayRequest { roomId: string; state?: object | null; world?: object[]; since: number; need: boolean }
export interface RelayDeps {
  roomId: string; selfId: string; clock: Clock;
  sync(req: RelayRequest): Promise<RelayResponse>;
  /** Transport Realtime baru (belum dibuka). null = tidak tersedia (mis. Supabase belum dikonfigurasi). */
  realtime(): RoomTransport | null;
}

export const FAST_MS = 250;        // relai cepat: ada penerima tanpa Realtime
export const SLOW_MS = 1500;       // relai lambat: semua sehat (juga heartbeat + daftar online)
export const PUSH_SLOW_MS = 1000;  // pengirim yang sehat tetap mengisi relai minimal 1x/dtk
export const RT_SILENCE_MS = 3500; // peer online tapi tidak ada pesan Realtime selama ini -> Realtime dianggap tidak mengantar
export const RT_RETRY_MS = 15_000;
const MAX_FAILS = 3;               // sync gagal berturut-turut -> putus (RoomClient akan sambung ulang)
const WORLD_QUEUE_MAX = 30;

export class HybridTransport implements RoomTransport {
  private ev: TransportEvents | null = null;
  private closed = false;
  private rt: RoomTransport | null = null;
  private rtUp = false;
  private rtTimer: unknown = null;
  private loop: unknown = null;
  private lastRt = new Map<string, number>();
  private latest: object | null = null; private latestSeq = -1; private pushedSeq = -1; private pushedAt = -1e9;
  private worldQ: object[] = [];
  private since = -1;
  private fails = 0;
  private needRelay = false;     // server: ada anggota lain yang membutuhkan relai cepat
  private degraded = false;      // kita sendiri tidak menerima Realtime dari peer online
  private online = new Set<string>();
  private inflight = false;
  private again = false;       // ada colekan saat sinkron sedang berjalan: ulangi segera setelah selesai
  constructor(private d: RelayDeps) {}

  /** Untuk diagnostik/HUD/tes. */
  get realtimeUp() { return this.rtUp; }
  get mode(): 'fast' | 'slow' { return this.degraded || this.needRelay ? 'fast' : 'slow'; }

  async open(ev: TransportEvents): Promise<void> {
    this.ev = ev; this.closed = false; this.fails = 0; this.since = -1;
    ev.onStatus('connecting');
    await this.once();                       // sync pertama: gagal (bukan anggota / jaringan) -> melempar, RoomClient menjadwalkan sambung ulang
    if (this.closed) return;
    ev.onStatus('connected');
    this.schedule();
    void this.tryRealtime();
  }

  send(msg: object) {
    if (this.closed) return;
    if (isLockerMsg(msg)) { if (this.rtUp) { try { this.rt?.send(msg); } catch { /* tanpa realtime: pemain lain memperbarui lewat relai (<= 1,5 dtk) */ } } return; } // colekan loker: hanya realtime, tidak masuk antrean relai
    if (isMonsterMsg(msg)) { if (this.rtUp) { try { this.rt?.send(msg); } catch { /* jalur realtime putus: monster tidak tersinkron (pengikut menyembunyikannya), state pemain tidak terganggu */ } } return; } // bukan state pemain & bukan event dunia: jangan masuk antrean relai
    if (isWorldMsg(msg)) {
      if (this.worldQ.length >= WORLD_QUEUE_MAX) this.worldQ.shift();
      this.worldQ.push(msg);
    } else {
      this.latest = msg; this.latestSeq = Number((msg as { seq?: number }).seq ?? -1);
    }
    if (this.rtUp) { try { this.rt?.send(msg); } catch { /* relai tetap membawa */ } }
  }

  /** Sinkron ke server sekarang (colekan loker dari pemain lain). Bila sedang sinkron, diulang sekali setelah selesai. */
  syncNow(): void {
    if (this.closed) return;
    if (this.inflight) { this.again = true; return; }
    if (this.loop) { this.d.clock.clearTimeout(this.loop); this.loop = null; }
    void this.cycle();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.loop) this.d.clock.clearTimeout(this.loop); this.loop = null;
    if (this.rtTimer) this.d.clock.clearTimeout(this.rtTimer); this.rtTimer = null;
    const rt = this.rt; this.rt = null; this.rtUp = false;
    try { await rt?.close(); } catch { /* abaikan */ }
  }

  // ---- Realtime (opsional) ----
  private async tryRealtime() {
    if (this.closed || this.rtUp) return;
    let t: RoomTransport | null = null;
    try { t = this.d.realtime(); } catch { t = null; }
    if (!t) return;
    this.rt = t;
    try {
      await t.open({
        onStatus: (s) => { if (this.rt !== t) return; if (s === 'disconnected') { this.rtUp = false; this.retryRealtimeLater(); } },
        onOnline: () => { /* online = dari database, bukan presence */ },
        onMembers: () => { /* anggota sah = dari database */ },
        onState: (from, raw) => { if (this.closed || this.rt !== t) return; this.lastRt.set(from, this.d.clock.now()); this.ev?.onState(from, raw); },
      });
      if (this.closed || this.rt !== t) { await t.close().catch(() => {}); return; }
      this.rtUp = true;
    } catch {
      this.rtUp = false;
      try { await t.close(); } catch { /* abaikan */ }
      if (this.rt === t) this.rt = null;
      this.retryRealtimeLater();
    }
  }
  private retryRealtimeLater() {
    if (this.closed || this.rtTimer) return;
    const old = this.rt; this.rt = null; void old?.close().catch(() => {});
    this.rtTimer = this.d.clock.setTimeout(() => { this.rtTimer = null; void this.tryRealtime(); }, RT_RETRY_MS);
  }

  // ---- relai ----
  private schedule() {
    if (this.closed || this.loop) return;
    const wait = this.mode === 'fast' ? FAST_MS : SLOW_MS;
    this.loop = this.d.clock.setTimeout(() => { this.loop = null; void this.cycle(); }, wait);
  }
  private async cycle() {
    if (this.closed) return;
    try { await this.once(); this.fails = 0; }
    catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'not_member' || code === 'room_closed' || code === 'unauthorized' || ++this.fails >= MAX_FAILS) {
        this.ev?.onStatus('disconnected'); return; // berhenti: RoomClient menutup transport ini dan menyambung ulang
      }
    }
    if (this.again && !this.closed) { this.again = false; if (this.loop) { this.d.clock.clearTimeout(this.loop); this.loop = null; } void this.cycle(); return; }
    this.schedule();
  }

  private async once(): Promise<void> {
    if (this.inflight) return; this.inflight = true;
    try {
      const now = this.d.clock.now();
      const push = this.latest && this.latestSeq !== this.pushedSeq && (this.mode === 'fast' || now - this.pushedAt >= PUSH_SLOW_MS);
      const world = this.mode === 'fast' ? this.worldQ.splice(0, 8) : (this.worldQ.length = 0, []); // sehat: event sudah lewat Realtime; digest 4 dtk menutup celah
      const req: RelayRequest = { roomId: this.d.roomId, state: push ? this.latest : null, world, since: this.since, need: this.degraded };
      let res: RelayResponse;
      try { res = await this.d.sync(req); }
      catch (e) { if (world.length) this.worldQ.unshift(...world); throw e; }
      if (this.closed) return;
      if (push) { this.pushedSeq = this.latestSeq; this.pushedAt = now; }
      this.since = res.cursor; this.needRelay = !!res.need_relay;
      if (res.status === 'closed') { const e = new Error('room_closed') as Error & { code?: string }; e.code = 'room_closed'; throw e; }
      const members: MemberInfo[] = res.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot }));
      const onlineIds = res.members.filter((m) => m.online).map((m) => m.id);
      this.online = new Set(onlineIds);
      this.ev?.onMembers(members); this.ev?.onOnline(onlineIds);
      if (res.lockers !== undefined) { const lk = sanitizeLockers(res.lockers); if (lk) this.ev?.onLockers?.(lk, res.server_time ? Date.parse(res.server_time) : NaN); } // snapshot otoritatif dari server
      for (const [uid, st] of Object.entries(res.states || {})) if (uid !== this.d.selfId) this.ev?.onState(uid, st);
      for (const w of res.world || []) if (w.from !== this.d.selfId) this.ev?.onState(w.from, w.msg);
      // sehatkah Realtime kita? (hanya bermakna bila ada peer online lain)
      const t = this.d.clock.now();
      this.degraded = onlineIds.some((id) => id !== this.d.selfId && t - (this.lastRt.get(id) ?? -1e9) > RT_SILENCE_MS);
    } finally { this.inflight = false; }
  }
}
