// Pompa polling ruang tunggu (logika murni, tanpa React; dites di scripts/test-poller.js). Dipakai hook useRoomSync.
//
// Jaminan (penyebab bug lama "host tidak melihat pemain yang masuk / 1/2 terus" ditutup di sini):
//  1. Pompa = setInterval, BUKAN rantai setTimeout: tidak ada jalur kode yang bisa membuat polling berhenti diam-diam.
//  2. Request yang macet > STUCK_MS ditinggalkan dan diganti request baru (hasil lama yang datang terlambat tetap aman: hanya diterapkan bila lebih baru).
//  3. Hasil usang (nomor lebih kecil dari yang sudah diterapkan) dibuang.
//  4. Gagal berkali-kali TIDAK mengeluarkan pemain dari room: hanya `err` + backoff. Keluar hanya bila server bilang room ditutup / kursi tak bisa dipulihkan.
//  5. kick() (kembali dari aplikasi lain, online lagi) menyegarkan SEKARANG.
import type { RoomSession, RoomStateView } from './roomtypes';

export const POLL_MS = 1500;
export const STUCK_MS = 8000;
export const PUMP_MS = 500;

export interface PollerClock { now(): number; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }
export const realPollClock: PollerClock = { now: () => Date.now(), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

export interface PollerDeps {
  room: RoomSession; selfId: string;
  fetchState(roomId: string): Promise<RoomStateView>;
  rejoin(code: string): Promise<unknown>;
  /** Snapshot baru (hanya dipanggil saat isinya berubah). */
  onView(v: RoomStateView): void;
  /** Galat sinkron saat ini; null = pulih. */
  onErr(msg: string | null): void;
  onPlaying(room: RoomSession): void;
  onGone(msg: string): void;
  /** Diagnostik opsional (tanpa rahasia): operasi, jumlah online dari server, galat. */
  onDiag?(ev: string, data?: Record<string, unknown>): void;
  clock?: PollerClock;
}
const codeOf = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '');
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Gagal sinkron dengan server');

export class RoomPoller {
  private seq = 0; private applied = 0; private startedAt = 0; private lastPollAt = -1e9;
  private inflight = false; private misses = 0; private rejoined = false; private lastSig = '';
  private stopped = false; private finished = false; private timer: unknown = null; private lastServerTime = 0;
  polls = 0; // jumlah request yang dimulai (untuk tes)
  private clock: PollerClock;
  constructor(private d: PollerDeps) { this.clock = d.clock ?? realPollClock; }

  start() { this.timer = this.clock.setInterval(() => this.pump(false), PUMP_MS); this.pump(true); }
  stop() { this.stopped = true; if (this.timer != null) this.clock.clearInterval(this.timer); this.timer = null; }
  kick() { this.misses = 0; this.pump(true); }

  private dead() { return this.stopped || this.finished; }
  private finish(fn: () => void) { if (this.dead()) return; this.finished = true; fn(); }

  private pump(force: boolean) {
    if (this.dead()) return;
    const now = this.clock.now();
    if (this.inflight && now - this.startedAt < STUCK_MS) return;                       // sedang berjalan normal
    const gap = this.misses ? Math.min(5000, POLL_MS * (1 + this.misses)) : POLL_MS;     // backoff saat server bermasalah
    if (!force && !this.inflight && now - this.lastPollAt < gap) return;
    this.lastPollAt = now;
    void this.poll();
  }

  private async poll() {
    const my = ++this.seq; this.polls++;
    this.inflight = true; this.startedAt = this.clock.now();
    const room = this.d.room;
    try {
      const s = await this.d.fetchState(room.roomId);
      if (this.dead() || my < this.applied) return;
      // Snapshot yang lebih TUA menurut jam server (mis. instance serverless lain yang lambat) tidak boleh menimpa yang sudah diterapkan.
      const st = s.server_time ? Date.parse(s.server_time) : NaN;
      if (Number.isFinite(st)) { if (st < this.lastServerTime - 1500) { this.d.onDiag?.('stale_snapshot_dropped', { server_time: s.server_time }); return; } this.lastServerTime = st; }
      this.applied = my; this.misses = 0; this.rejoined = false; this.d.onErr(null);
      const sig = JSON.stringify([s.status, s.host_id, s.max_players, s.members, s.online_count, s.can_start, s.dbg]);
      if (sig !== this.lastSig) { this.lastSig = sig; this.d.onView(s); this.d.onDiag?.('view', { online: s.online_count ?? s.members.filter((m) => m.online).length, members: s.members.length, status: s.status, server_time: s.server_time, backend: s.backend, build: s.build, via: s.via }); }
      if (s.status === 'closed') { this.finish(() => this.d.onGone('Room ditutup.')); return; }
      if (s.status === 'playing') {
        this.finish(() => this.d.onPlaying({ ...room, status: 'playing', slot: s.members.find((m) => m.id === this.d.selfId)?.slot ?? room.slot, hostId: s.host_id }));
        return;
      }
    } catch (e) {
      if (this.dead() || my < this.applied) return;
      this.applied = my;
      const c = codeOf(e);
      this.d.onDiag?.('poll_error', { code: c || 'network', msg: msgOf(e).slice(0, 120) });
      if (c === 'room_closed') { this.finish(() => this.d.onGone('Room ditutup.')); return; }
      if (c === 'not_member') {
        // Kursi terlepas (mis. koneksi lama putus): coba gabung ulang SEKALI sebelum menyerah.
        if (!this.rejoined) {
          this.rejoined = true; this.d.onDiag?.('rejoin', { code: room.code });
          try { await this.d.rejoin(room.code); } catch (e2) { this.finish(() => this.d.onGone(e2 instanceof Error && e2.message ? e2.message : 'Kamu keluar dari room.')); return; }
        } else { this.finish(() => this.d.onGone('Kamu tidak lagi ada di room ini.')); return; }
      } else {
        this.misses++;
        this.d.onErr(c === 'unauthorized' ? 'Sesi login bermasalah' : msgOf(e));
      }
    } finally {
      if (my === this.seq) this.inflight = false;
    }
  }
}
