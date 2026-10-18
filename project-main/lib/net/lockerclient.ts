// Klien loker sisi pemain lokal (logika murni; API & jam disuntikkan; dites di scripts/test-lockers.js).
//
// Tanggung jawab: (1) menyimpan snapshot klaim loker TERBARU dari server (urut jam server, snapshot lama dibuang), (2) meminta klaim/lepas ke server
// secara BERURUTAN (antrean: klaim -> lepas -> klaim tidak pernah tertukar), (3) memperbarui lease selama pemain bersembunyi dan memberi tahu bila
// server ternyata memberi loker itu ke orang lain, (4) mengulang permintaan lepas yang gagal. TIDAK memutuskan siapa boleh masuk: itu server.
import { LOCKER_RENEW_MS, sameLockers, sanitizeLockers, type LockerMap, type LockerReply, type LockerRequest } from './lockers';

export interface LockerClock { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }

export type ClaimResult = { ok: true } | { ok: false; reason: 'occupied'; owner: string | null } | { ok: false; reason: 'unavailable' };

/** Yang dibutuhkan dunia game dari sistem loker online (diberikan PlayScene; null = Single Player / offline = perilaku lokal lama). */
export interface LockerGate {
  selfId: string;
  /** Pemilik loker menurut snapshot server terakhir (null = kosong). */
  ownerOf(key: string): string | null;
  /** Loker yang sedang dipegang pemain `uid` menurut snapshot server (null = tidak ada). */
  keyOf(uid: string): string | null;
  claim(key: string): Promise<ClaimResult>;
  /** Lepas (key) atau lepas semua milik kita (null). Tidak menunggu; diulang bila gagal. */
  release(key: string | null): void;
  /** Perbarui lease berkala selama bersembunyi; `onLost` dipanggil bila server memberi loker itu ke pemain lain. */
  hold(key: string, onLost: (owner: string | null) => void): void;
  stopHold(): void;
  /** Pemain lokal sedang dalam keadaan bermain (bukan tertangkap/loading). */
  alive(): boolean;
}

export interface LockerClientOpts {
  selfId: string;
  api: (req: LockerRequest) => Promise<LockerReply>;
  clock: LockerClock;
  /** Dipanggil setelah klaim/lepas berhasil: beri tahu pemain lain (colekan) supaya sinkron cepat. */
  poke?: () => void;
  /** Dipanggil bila snapshot berubah (untuk render ulang). */
  onChange?: () => void;
  releaseRetries?: number;
}

const RELEASE_WAITS_MS = [500, 1000, 2000];

export class LockerClient {
  private map: LockerMap = {};
  private at = -Infinity;           // jam server snapshot yang sedang dipakai
  private chain: Promise<unknown> = Promise.resolve();
  private holding: { key: string; onLost: (owner: string | null) => void } | null = null;
  private timer: unknown = null;
  private disposed = false;
  droppedStale = 0;

  constructor(private o: LockerClientOpts) {}

  get selfId() { return this.o.selfId; }
  snapshot(): LockerMap { return { ...this.map }; }
  ownerOf(key: string): string | null { return this.map[key] ?? null; }
  keyOf(uid: string): string | null { for (const k of Object.keys(this.map)) if (this.map[k] === uid) return k; return null; }

  /** Snapshot dari /sync atau balasan operasi. Snapshot dengan jam server LEBIH LAMA dari yang sudah dipakai dibuang (tanpa jam = diterima). */
  apply(raw: unknown, serverMs: number): void {
    if (this.disposed) return;
    const m = sanitizeLockers(raw); if (!m) return;
    if (Number.isFinite(serverMs)) { if (serverMs < this.at) { this.droppedStale++; return; } this.at = serverMs; }
    if (sameLockers(this.map, m)) return;
    this.map = m; try { this.o.onChange?.(); } catch { /* abaikan */ }
  }
  private ingest(r: LockerReply) { this.apply(r.lockers, r.server_time ? Date.parse(r.server_time) : NaN); }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  /** Minta masuk loker. Galat jaringan/server = 'unavailable' (gagal-aman: pemain TIDAK masuk). */
  claim(key: string): Promise<ClaimResult> {
    return this.enqueue(async (): Promise<ClaimResult> => {
      if (this.disposed) return { ok: false, reason: 'unavailable' };
      try {
        const r = await this.o.api({ locker: key, action: 'enter' });
        this.ingest(r);
        if (r.ok === true) { this.o.poke?.(); return { ok: true }; }
        return { ok: false, reason: 'occupied', owner: typeof r.owner === 'string' ? r.owner : null };
      } catch { return { ok: false, reason: 'unavailable' }; }
    });
  }

  /** Lepas loker `key` (keluar) atau semua milik kita (key null: tertangkap / restart). Gagal -> diulang beberapa kali; sisanya ditutup lease/disconnect di server. */
  release(key: string | null): void {
    if (key === null || this.holding?.key === key) this.stopHold();
    void this.enqueue(async () => {
      for (let i = 0; ; i++) {
        try {
          const r = await this.o.api(key === null ? { action: 'release' } : { locker: key, action: 'exit' });
          this.ingest(r); this.o.poke?.(); return;
        } catch {
          if (this.disposed || i >= (this.o.releaseRetries ?? RELEASE_WAITS_MS.length)) return;
          await new Promise<void>((res) => { this.o.clock.setTimeout(res, RELEASE_WAITS_MS[Math.min(i, RELEASE_WAITS_MS.length - 1)]); });
        }
      }
    });
  }

  hold(key: string, onLost: (owner: string | null) => void): void {
    this.stopHold();
    this.holding = { key, onLost };
    this.timer = this.o.clock.setInterval(() => { void this.renew(key); }, LOCKER_RENEW_MS);
  }
  stopHold(): void {
    if (this.timer !== null) this.o.clock.clearInterval(this.timer);
    this.timer = null; this.holding = null;
  }
  private renew(key: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed || this.holding?.key !== key) return;           // sudah keluar saat giliran ini tiba
      try {
        const r = await this.o.api({ locker: key, action: 'enter' });
        this.ingest(r);
        const h = this.holding;
        if (r.ok !== true && h && h.key === key) { this.stopHold(); h.onLost(typeof r.owner === 'string' ? r.owner : null); } // server memberi loker ini ke orang lain
      } catch { /* jaringan putus sesaat: coba lagi di tick berikut (lease 40 dtk, perbarui tiap 10 dtk) */ }
    });
  }

  dispose(): void { this.stopHold(); this.disposed = true; }
}
