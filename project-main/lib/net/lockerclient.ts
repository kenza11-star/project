// Klien loker sisi pemain lokal (logika murni; API & jam disuntikkan; dites di scripts/test-lockers.js).
//
// Tanggung jawab: (1) menyimpan snapshot klaim loker TERBARU dari server (urut jam server, snapshot lama dibuang), (2) meminta klaim/lepas ke server
// secara BERURUTAN (antrean: klaim -> lepas -> klaim tidak pernah tertukar), (3) memperbarui lease selama pemain bersembunyi dan memberi tahu bila
// server ternyata memberi loker itu ke orang lain, (4) mengulang permintaan lepas yang gagal. TIDAK memutuskan siapa boleh masuk: itu server.
import { LOCKER_API_TIMEOUT_MS, LOCKER_P2P_BEAT_MS, LOCKER_P2P_SETTLE_MS, LOCKER_P2P_TTL_MS, LOCKER_RENEW_MS, LOCKER_SERVER_RETRY_MS, lockerP2P, sameLockers, sanitizeLockerP2P, sanitizeLockers, type LockerMap, type LockerP2PMsg, type LockerReply, type LockerRequest } from './lockers';

export interface LockerClock { now?(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }

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
  /** Jalur cadangan peer-to-peer (pesan realtime room). `peers()` = id pemain remote yang ONLINE di roster. Tanpa ini: server mati = tidak ada cadangan. */
  p2p?: { send(msg: LockerP2PMsg): void; peers(): string[] };
  apiTimeoutMs?: number;
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
  private downUntil = -Infinity;      // server dianggap tidak tersedia sampai jam ini (pakai P2P)
  private p2pMine: { key: string; held: boolean; since: number } | null = null;
  private p2pLostTo: string | null = null;
  private peerClaims = new Map<string, { uid: string; at: number }>();
  private beat: unknown = null;
  private srvKeys = new Set<string>();  // loker yang kita klaim LEWAT SERVER dan belum dilepas (harus dilepas di server juga walau server sedang 'down')

  constructor(private o: LockerClientOpts) {}

  get selfId() { return this.o.selfId; }
  snapshot(): LockerMap { return { ...this.map }; }
  /** Pemilik loker: snapshot server dulu, lalu klaim P2P yang masih hidup (peer ada di roster & beat terbaru), lalu klaim P2P kita sendiri. */
  ownerOf(key: string): string | null {
    const s = this.map[key]; if (s) return s;
    const p = this.peerOwner(key); if (p) return p;
    return this.p2pMine?.held && this.p2pMine.key === key ? this.o.selfId : null;
  }
  keyOf(uid: string): string | null {
    for (const k of Object.keys(this.map)) if (this.map[k] === uid) return k;
    for (const k of this.peerClaims.keys()) if (this.peerOwner(k) === uid) return k;
    return uid === this.o.selfId && this.p2pMine?.held ? this.p2pMine.key : null;
  }

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

  private nowMs(): number { return this.o.clock.now ? this.o.clock.now() : Date.now(); }
  private serverDown(): boolean { return this.nowMs() < this.downUntil; }
  private markDown(): void { this.downUntil = this.nowMs() + LOCKER_SERVER_RETRY_MS; }
  /** Panggil API dengan batas waktu: server menggantung tidak boleh menyumbat antrean. */
  private callApi(req: LockerRequest): Promise<LockerReply> {
    return new Promise<LockerReply>((resolve, reject) => {
      let done = false;
      const h = this.o.clock.setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, this.o.apiTimeoutMs ?? LOCKER_API_TIMEOUT_MS);
      this.o.api(req).then((r) => { if (!done) { done = true; this.o.clock.clearTimeout(h); resolve(r); } }, (e) => { if (!done) { done = true; this.o.clock.clearTimeout(h); reject(e); } });
    });
  }

  /** Minta masuk loker. Server memutuskan; bila server/tabel tidak tersedia -> jalur P2P (TIDAK pernah menolak semua loker). */
  claim(key: string): Promise<ClaimResult> {
    return this.enqueue(async (): Promise<ClaimResult> => {
      if (this.disposed) return { ok: false, reason: 'unavailable' };
      if (!this.serverDown()) {
        try {
          const r = await this.callApi({ locker: key, action: 'enter' });
          this.ingest(r);
          if (r.ok === true) { this.p2pMine = null; this.srvKeys.add(key); this.announce('hold', key); this.o.poke?.(); return { ok: true }; }
          return { ok: false, reason: 'occupied', owner: typeof r.owner === 'string' ? r.owner : null };
        } catch { this.markDown(); }
      }
      return this.claimP2P(key);
    });
  }

  // ---- jalur cadangan peer-to-peer ----
  private p2pPeers(): string[] { try { return (this.o.p2p?.peers() ?? []).filter((x) => x !== this.o.selfId); } catch { return []; } }
  private announce(a: 'claim' | 'hold' | 'rel', k?: string): void { try { this.o.p2p?.send(lockerP2P(a, k)); } catch { /* abaikan */ } }
  private peerOwner(key: string): string | null {
    const pc = this.peerClaims.get(key); if (!pc) return null;
    if (this.nowMs() - pc.at >= LOCKER_P2P_TTL_MS || !this.p2pPeers().includes(pc.uid)) return null; // beat berhenti / pemain hilang dari roster = kosong
    return pc.uid;
  }
  private async claimP2P(key: string): Promise<ClaimResult> {
    const taken = this.peerOwner(key) ?? (this.map[key] && this.map[key] !== this.o.selfId && this.p2pPeers().includes(this.map[key]) ? this.map[key] : null);
    if (taken) return { ok: false, reason: 'occupied', owner: taken };
    this.p2pLostTo = null;
    this.p2pMine = { key, held: false, since: this.nowMs() };
    for (const k of [...this.peerClaims.keys()]) if (this.peerClaims.get(k)?.uid === this.o.selfId) this.peerClaims.delete(k);
    this.announce('claim', key);
    if (this.p2pPeers().length > 0) await new Promise<void>((res) => { this.o.clock.setTimeout(res, LOCKER_P2P_SETTLE_MS); }); // tunggu klaim serentak
    if (this.disposed) { this.p2pMine = null; return { ok: false, reason: 'unavailable' }; }
    const m = this.p2pMine;
    if (!m || m.key !== key) return { ok: false, reason: 'occupied', owner: this.p2pLostTo };
    m.held = true; m.since = this.nowMs();
    this.announce('hold', key);
    return { ok: true };
  }
  /** Pesan P2P dari pemain lain (`from` = identitas dari saluran, bukan isi pesan). */
  onPeerMsg(from: string, raw: unknown): void {
    if (this.disposed || from === this.o.selfId) return;
    const m = sanitizeLockerP2P(raw); if (!m) return;
    let changed = false;
    if (m.a === 'rel') {
      for (const [k, v] of [...this.peerClaims]) if (v.uid === from && (m.k === null || m.k === k)) { this.peerClaims.delete(k); changed = true; }
    } else if (m.k) {
      const k = m.k, mine = this.p2pMine && this.p2pMine.key === k ? this.p2pMine : null;
      const holdingServer = this.holding?.key === k && !mine; // dipegang lewat server: kita pemegang mapan
      if (mine || holdingServer) {
        const established = holdingServer || (mine!.held && this.nowMs() - mine!.since >= LOCKER_P2P_SETTLE_MS);
        const peerWins = !established && from < this.o.selfId;
        if (!peerWins) { this.announce('hold', k); return; } // kita menang / sudah mapan: peer akan mengalah setelah melihat `hold` kita
        // peer menang (klaim serentak, uid lebih kecil): kita mengalah
        const wasHeld = mine!.held; this.p2pMine = null; this.p2pLostTo = from;
        this.peerClaims.set(k, { uid: from, at: this.nowMs() });
        if (wasHeld) { const h = this.holding; if (h && h.key === k) { this.stopHold(); try { h.onLost(from); } catch { /* abaikan */ } } }
        changed = true;
      } else {
        for (const [kk, v] of [...this.peerClaims]) if (v.uid === from && kk !== k) { this.peerClaims.delete(kk); changed = true; } // 1 pemain = 1 loker
        const prev = this.peerClaims.get(k);
        this.peerClaims.set(k, { uid: from, at: this.nowMs() });
        if (!prev || prev.uid !== from) changed = true;
      }
    }
    if (changed) { try { this.o.onChange?.(); } catch { /* abaikan */ } }
  }

  /** Lepas loker `key` (keluar) atau semua milik kita (key null: tertangkap / restart). Gagal -> diulang beberapa kali; sisanya ditutup lease/disconnect di server. */
  release(key: string | null): void {
    if (key === null || this.holding?.key === key) this.stopHold();
    if (key === null || this.p2pMine?.key === key) this.p2pMine = null;
    this.announce('rel', key ?? undefined); // P2P: langsung (tidak menunggu antrean server)
    const viaServer = key === null ? this.srvKeys.size > 0 : this.srvKeys.has(key);
    if (key === null) this.srvKeys.clear(); else this.srvKeys.delete(key);
    void this.enqueue(async () => {
      for (let i = 0; ; i++) {
        if (this.disposed || (i === 0 && !viaServer && this.serverDown())) return; // tak pernah klaim di server & server down: cukup P2P (jangan menyumbat antrean)
        try {
          const r = await this.callApi(key === null ? { action: 'release' } : { locker: key, action: 'exit' });
          this.ingest(r); this.o.poke?.(); return;
        } catch {
          if (this.disposed || i >= (this.o.releaseRetries ?? RELEASE_WAITS_MS.length)) { this.markDown(); return; }
          await new Promise<void>((res) => { this.o.clock.setTimeout(res, RELEASE_WAITS_MS[Math.min(i, RELEASE_WAITS_MS.length - 1)]); });
        }
      }
    });
  }

  hold(key: string, onLost: (owner: string | null) => void): void {
    this.stopHold();
    this.holding = { key, onLost };
    this.timer = this.o.clock.setInterval(() => { void this.renew(key); }, LOCKER_RENEW_MS);
    if (this.o.p2p) { this.announce('hold', key); this.beat = this.o.clock.setInterval(() => { if (this.holding?.key === key) this.announce('hold', key); }, LOCKER_P2P_BEAT_MS); }
  }
  stopHold(): void {
    if (this.timer !== null) this.o.clock.clearInterval(this.timer);
    if (this.beat !== null) this.o.clock.clearInterval(this.beat);
    this.timer = null; this.beat = null; this.holding = null;
  }
  private renew(key: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed || this.holding?.key !== key) return;           // sudah keluar saat giliran ini tiba
      if (this.serverDown()) return;                                     // mode P2P: kehidupan klaim dijaga beat `hold`
      try {
        const r = await this.callApi({ locker: key, action: 'enter' });
        this.ingest(r);
        const h = this.holding;
        if (r.ok !== true && h && h.key === key) { this.stopHold(); h.onLost(typeof r.owner === 'string' ? r.owner : null); } // server memberi loker ini ke orang lain
      } catch { this.markDown(); /* server gagal: beralih ke P2P; dicoba lagi setelah LOCKER_SERVER_RETRY_MS */ }
    });
  }

  dispose(): void { if (this.p2pMine || this.holding) this.announce('rel'); this.stopHold(); this.p2pMine = null; this.peerClaims.clear(); this.disposed = true; }
}
