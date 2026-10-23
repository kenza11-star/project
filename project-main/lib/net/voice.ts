// Voice chat real-time (WebRTC mesh, 2-6 pemain => maks 5 peer per klien). Sinyal lewat RoomClient (Realtime). Hanya klien (browser).
// Mic dan audio (output) terpisah: listen() = ikut mendengar tanpa getUserMedia; toggle() = mic.
//
// Desain (lihat docs/VOICE.md):
//  - Peran TETAP per pasangan: id lebih kecil = penawar (membuat offer), id lebih besar = penjawab. Tidak ada offer kembar saat setup, jadi tidak ada "glare".
//    Perfect-negotiation tetap dipakai untuk renegosiasi (ICE restart) bila dua sisi kebetulan menawar bersamaan.
//  - Setiap koneksi punya id sesi `g` (dipilih penawar). Pesan dengan `g` asing dibuang -> pesan lama tidak merusak koneksi baru.
//  - Transceiver audio SELALU sendrecv sejak awal; mic hanya replaceTrack (tanpa renegosiasi). Mic OFF = sender tanpa track; MUTED = track.enabled=false.
//  - Pesan sinyal lewat antrean keluar (diulang sampai Realtime siap, dibatasi lajunya) dan kandidat ICE dikirim berkelompok.
//  - Pemeliharaan berkala ringan (2 dtk): bangun ulang koneksi macet/gagal dengan backoff, bersihkan peer yang sudah keluar.
//  - Tanpa AudioContext: output suara hanya lewat elemen <audio> per peer, tidak bergantung pada AudioContext/AudioManager game.
import type { RtcMsg } from './voicemsg';

export type MicState = 'off' | 'on' | 'muted' | 'denied';
type Timer = ReturnType<typeof setTimeout>;
type ConnState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
interface P {
  id: string; pc: RTCPeerConnection; audio: HTMLAudioElement; g: string;
  init: boolean;            // true = kita penawar (id lebih kecil)
  polite: boolean; making: boolean; ignore: boolean; hold: boolean;
  tx: RTCRtpTransceiver | null; remote: MediaStream | null;
  pending: RTCIceCandidateInit[];                 // kandidat yang datang sebelum remoteDescription
  cand: [string, string | null, number | null][]; candT: Timer | null;  // kandidat lokal menunggu dikirim berkelompok
  chain: Promise<void>; t0: number; bad: number; restarted: boolean;
  lastOffer: string; lastAnswer: string;
}

// TURN opsional via env (NEXT_PUBLIC_* harus ditulis literal agar di-inline Next.js). URL boleh dipisah koma.
const TURN_URL = process.env.NEXT_PUBLIC_TURN_URL, TURN_USER = process.env.NEXT_PUBLIC_TURN_USER, TURN_CRED = process.env.NEXT_PUBLIC_TURN_CRED;
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    ...(TURN_URL ? [{ urls: TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: TURN_USER, credential: TURN_CRED }]
      // cadangan publik bila TURN sendiri belum diatur (jaringan seluler/CGNAT sering tidak bisa tembus hanya dengan STUN). Produksi: atur TURN sendiri.
      : [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }]),
  ],
};
const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

const MAX_PEERS = 5;            // 6 pemain => 5 peer
const TICK_MS = 2000;           // pemeliharaan (ringan: hanya iterasi <= 5 peer)
const STUCK_MS = 14000;         // belum 'connected' selama ini -> bangun ulang
const DISC_RESTART_MS = 4000;   // 'disconnected' selama ini -> ICE restart (penawar)
const DISC_REBUILD_MS = 12000;  // 'disconnected' selama ini -> bangun ulang
const ABSENT_GRACE_MS = 6000;   // peer hilang dari daftar online: tunggu dulu (heartbeat bisa telat) sebelum koneksi ditutup
const SEEN_MS = 8000;           // peer yang baru saja mengirim sinyal dianggap hadir walau daftar online belum memuatnya
const GATHER_WAIT_MS = 1200;    // tunggu kandidat ICE masuk ke SDP (sisanya dikirim menyusul)
const OUT_TTL_MS = 20000, OUT_GAP_MS = 100, OUT_MAX = 80;   // antrean sinyal: umur, jeda antar pesan (<= 10 pesan/dtk), kapasitas
const HELLO_GAP_MS = 2500, REBUILD_MIN_AGE_MS = 4000, EARLY_TTL_MS = 10000;
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const ICE_TO_CONN: Record<string, ConnState> = { new: 'new', checking: 'connecting', connected: 'connected', completed: 'connected', disconnected: 'disconnected', failed: 'failed', closed: 'closed' };
const stateOf = (pc: RTCPeerConnection): ConnState => ((pc.connectionState as ConnState | undefined) ?? ICE_TO_CONN[pc.iceConnectionState] ?? 'new');
const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : '');

export class VoiceMesh {
  state: MicState = 'off';
  /** true = output audio hidup (mendengar voice chat). */
  listening = false;
  private joined = false;
  private stream: MediaStream | null = null;
  private peers = new Map<string, P>();
  private online = new Set<string>();
  private seen = new Map<string, number>();
  private absent = new Map<string, number>();
  private backoff = new Map<string, { n: number; next: number }>();
  private helloAt = new Map<string, number>();
  private early = new Map<string, { at: number; list: RTCIceCandidateInit[] }>();
  private out: { m: RtcMsg; at: number }[] = [];
  private pumpT: Timer | null = null;
  private tickT: ReturnType<typeof setInterval> | null = null;
  private timers = new Set<Timer>();
  private disposed = false;
  private acquiring = false;
  private lastFailAt = 0;
  private readonly sess = rid();

  constructor(private selfId: string, private send: (m: RtcMsg) => boolean, private onState: () => void, private onFail?: (id: string) => void) {
    if (typeof window !== 'undefined') {
      for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, this.unlock, true);
      window.addEventListener('online', this.onNet);
      window.addEventListener('pageshow', this.onNet);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    this.tickT = setInterval(() => this.tick(), TICK_MS);
  }

  /** true bila minimal satu peer tersambung (untuk indikator tombol). */
  get connected(): boolean { for (const p of this.peers.values()) if (stateOf(p.pc) === 'connected') return true; return false; }

  private init = (id: string) => this.selfId < id;
  private later(fn: () => void, ms: number) { const h = setTimeout(() => { this.timers.delete(h); if (!this.disposed) fn(); }, ms); this.timers.add(h); }

  // ------------------------------------------------------------------ audio output / autoplay
  /** Putar audio remote bila belum jalan / diblokir autoplay. Aman dipanggil berulang. */
  private play(p: P) {
    const a = p.audio; if (!a.srcObject) return;
    const mute = !this.listening; if (a.muted !== mute) a.muted = mute;
    if (mute || !a.paused) return;
    try { const r = a.play(); if (r && typeof r.catch === 'function') r.catch(() => { /* diblokir autoplay: dicoba lagi saat gesture berikut / tick */ }); } catch { /* abaikan */ }
  }
  /** Gesture pertama player (tap/klik/tombol): lanjutkan semua audio remote yang diblokir autoplay. */
  private unlock = () => { if (this.listening) for (const p of this.peers.values()) this.play(p); };
  private onVisible = () => { if (document.visibilityState === 'visible') { this.unlock(); this.wake(); } };
  private onNet = () => { this.unlock(); this.wake(); };
  /** App kembali dari background / jaringan kembali: ambil ulang mic yang mati, dorong koneksi yang tidak sehat, jalankan pemeliharaan. */
  private wake() {
    if (this.disposed) return;
    const t = this.track();
    if ((this.state === 'on' || this.state === 'muted') && (!t || t.readyState === 'ended')) void this.reacquire();
    const now = Date.now();
    for (const p of this.peers.values()) if (p.init && stateOf(p.pc) !== 'connected' && now - p.t0 > 3000) { try { p.pc.restartIce(); } catch { /* */ } }
    this.tick();
  }

  // ------------------------------------------------------------------ API publik (dipakai PlayScene)
  private join(online: string[]) {
    this.setOnline(online);
    if (this.joined) { this.tick(); return; }
    this.joined = true;
    this.tick();
  }

  /** Audio ON/OFF: join tanpa getUserMedia dan tanpa izin mic. */
  listen(online: string[], on = true): void {
    this.listening = on;
    for (const p of this.peers.values()) { p.audio.muted = !on; if (on) this.play(p); }
    if (on) { this.join(online); this.unlock(); }
    this.onState();
  }

  /** Mic: tap pertama menyalakan mic (+ audio otomatis). Tap berikutnya: bisu / buka bisu. */
  async toggle(online: string[]): Promise<void> {
    if (this.disposed || this.acquiring) return;
    if (!this.stream || this.state === 'denied' || this.state === 'off') {
      this.listening = true; for (const p of this.peers.values()) p.audio.muted = false;
      this.acquiring = true;
      try {
        const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
        if (!md || typeof md.getUserMedia !== 'function') throw new Error('no_mic');
        const s = await md.getUserMedia(MIC);
        if (this.disposed) { s.getTracks().forEach((t) => t.stop()); return; }
        this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
        this.stream = s; this.state = 'on'; this.watch(); this.attachAll();
      } catch { this.stream = null; this.state = 'denied'; } // tetap bisa mendengar
      finally { this.acquiring = false; }
      this.join(online); this.unlock(); this.onState();
      return;
    }
    const on = this.state !== 'on'; this.stream.getAudioTracks().forEach((t) => (t.enabled = on)); this.state = on ? 'on' : 'muted'; this.onState();
  }

  /** Sinkron daftar online: peer baru -> hubungkan; peer yang keluar -> ditutup (setelah masa tunggu singkat). */
  syncPeers(online: string[]) { this.setOnline(online); this.tick(); }
  private setOnline(online: string[]) { this.online = new Set(online.filter((x) => typeof x === 'string' && x !== this.selfId)); }

  // ------------------------------------------------------------------ mic -> RTCRtpSender
  private track(): MediaStreamTrack | null { return this.stream?.getAudioTracks()[0] ?? null; }
  /** Transceiver selalu sendrecv (tanpa renegosiasi saat mic dinyalakan); track mic dipasang lewat replaceTrack. */
  private attach(p: P) {
    const tx = p.tx; if (!tx) return;
    try { if (tx.direction !== 'sendrecv') tx.direction = 'sendrecv'; } catch { /* */ }
    const t = this.track();
    if (t && tx.sender.track !== t) void tx.sender.replaceTrack(t).catch(() => {});
  }
  private attachAll() { for (const p of this.peers.values()) this.attach(p); }
  private detachAll() { for (const p of this.peers.values()) if (p.tx?.sender.track) void p.tx.sender.replaceTrack(null).catch(() => {}); }
  /** Track mic berhenti (telepon masuk / tab pindah): ambil ulang + replaceTrack ke semua peer. */
  private watch() { const t = this.track(); if (t) t.onended = () => { void this.reacquire(); }; }
  private async reacquire(attempt = 0) {
    if (this.disposed || this.acquiring || (this.state !== 'on' && this.state !== 'muted')) return;
    this.acquiring = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia(MIC);
      if (this.disposed) { s.getTracks().forEach((t) => t.stop()); return; }
      this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      this.stream = s; s.getAudioTracks().forEach((t) => (t.enabled = this.state === 'on'));
      this.watch(); this.attachAll();
    } catch (e) {
      const n = (e as { name?: string } | null)?.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') { this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); this.stream = null; this.state = 'denied'; this.detachAll(); this.onState(); }
      else if (!document.hidden && attempt < 6) this.later(() => { void this.reacquire(attempt + 1); }, Math.min(10000, 1500 * 2 ** attempt));
    } finally { this.acquiring = false; }
  }

  // ------------------------------------------------------------------ pemeliharaan
  private tick() {
    if (this.disposed) return;
    const now = Date.now();
    for (const [k, v] of this.early) if (now - v.at > EARLY_TTL_MS) this.early.delete(k);
    for (const [k, v] of this.seen) if (now - v > 60000) this.seen.delete(k);
    for (const id of new Set<string>([...this.online, ...this.peers.keys()])) {
      const p = this.peers.get(id);
      const here = this.online.has(id) || now - (this.seen.get(id) ?? 0) < SEEN_MS;
      if (!here) { // pemain keluar (atau daftar online telat): beri masa tunggu, lalu bersihkan
        if (!p) continue;
        const since = this.absent.get(id) ?? now; this.absent.set(id, since);
        if (stateOf(p.pc) !== 'connected' || now - since > ABSENT_GRACE_MS) this.drop(id);
        continue;
      }
      this.absent.delete(id);
      if (!p) { if (this.joined && this.peers.size < MAX_PEERS) this.connect(id); continue; }
      const st = stateOf(p.pc);
      if (st === 'connected') { p.bad = 0; continue; }
      if (!p.bad) p.bad = now;
      const age = now - p.t0, bad = now - p.bad;
      if (st === 'failed' || st === 'closed' || (st === 'disconnected' ? bad > DISC_REBUILD_MS : age > STUCK_MS)) { this.rebuild(id); continue; }
      if (st === 'disconnected' && p.init && bad > DISC_RESTART_MS && !p.restarted) { p.restarted = true; try { p.pc.restartIce(); } catch { /* */ } }
    }
    this.pump();
  }

  /** Penawar: buat koneksi + offer. Penjawab: minta penawar menawar (hello). */
  private connect(id: string) { if (this.init(id)) this.create(id, true, rid()); else this.hello(id, false); }
  private hello(id: string, force: boolean) {
    const now = Date.now(); if (now - (this.helloAt.get(id) ?? 0) < HELLO_GAP_MS) return;
    this.helloAt.set(id, now); this.post(id, 'h', force ? { r: 1 } : {});
  }
  /** Bangun ulang koneksi yang macet/gagal (backoff 3 dtk -> 30 dtk agar tidak ada loop). */
  private rebuild(id: string) {
    const now = Date.now(), b = this.backoff.get(id) ?? { n: 0, next: 0 };
    if (now < b.next) return;
    b.n++; b.next = now + Math.min(30000, 1500 * 2 ** Math.min(b.n, 5)); this.backoff.set(id, b);
    const keep = this.peers.has(id); this.drop(id);
    if (keep && this.joined && this.online.has(id)) { if (this.init(id)) this.create(id, true, rid()); else this.hello(id, true); }
  }

  // ------------------------------------------------------------------ sinyal masuk
  handle(from: string, m: RtcMsg) {
    if (this.disposed || from === this.selfId || !m || typeof from !== 'string') return;
    const d = (m.d && typeof m.d === 'object' ? m.d : {}) as Record<string, unknown>;
    this.seen.set(from, Date.now());
    if (m.k === 'h') { this.onHello(from, d.r === 1); return; }
    const g = str(d.g); if (!g) return;
    let p = this.peers.get(from);
    if (m.k === 'o') {
      if (typeof d.sdp !== 'string' || d.sdp.length > 20000) return;
      if (!p || p.g !== g) {
        if (this.init(from)) return;                    // kita penawar: offer dengan sesi asing = basi
        if (!p && this.peers.size >= MAX_PEERS) return;
        this.drop(from); p = this.create(from, false, g); // penjawab: sesi baru dari penawar (refresh/rebuild) menggantikan koneksi lama
      }
    } else if (m.k === 'a') {
      if (!p || p.g !== g || typeof d.sdp !== 'string' || d.sdp.length > 20000) return;
    } else if (m.k === 'i') {
      const list = this.parseCands(d.l);
      if (!list.length) return;
      if (!p || p.g !== g) { // kandidat mendahului offer: simpan sebentar, dipakai saat koneksi dengan `g` ini dibuat
        const key = from + '|' + g, e = this.early.get(key) ?? { at: Date.now(), list: [] };
        if (this.early.size < 30 && e.list.length < 80) { e.list.push(...list); this.early.set(key, e); }
        return;
      }
      p.chain = p.chain.then(() => this.addCands(p!, list)).catch(() => {});
      return;
    } else return;
    const pp = p;
    pp.chain = pp.chain.then(() => this.signal(pp, m, d)).catch(() => {});
  }

  private onHello(id: string, force: boolean) {
    if (!this.joined || !this.init(id)) return; // 'hello' = "tolong tawarkan koneksi"; hanya bermakna bagi penawar yang ikut voice
    const p = this.peers.get(id);
    if (!p) { if (this.peers.size < MAX_PEERS) this.create(id, true, rid()); return; }
    if (!force && Date.now() - p.t0 < REBUILD_MIN_AGE_MS) return; // koneksi baru dibuat: offer masih di jalan
    this.rebuild(id);
  }

  private parseCands(raw: unknown): RTCIceCandidateInit[] {
    const out: RTCIceCandidateInit[] = [];
    if (!Array.isArray(raw)) return out;
    for (const it of raw.slice(0, 40)) if (Array.isArray(it) && typeof it[0] === 'string' && it[0].length < 600) out.push({ candidate: it[0], sdpMid: typeof it[1] === 'string' ? it[1] : null, sdpMLineIndex: Number.isInteger(it[2]) ? (it[2] as number) : null });
    return out;
  }
  private async addCands(p: P, list: RTCIceCandidateInit[]) {
    if (this.peers.get(p.id) !== p || p.ignore) return;
    for (const c of list) { if (!p.pc.remoteDescription) { if (p.pending.length < 80) p.pending.push(c); } else await p.pc.addIceCandidate(c).catch(() => {}); } // antre sampai setRemoteDescription selesai
  }
  private async flush(p: P) { const q = p.pending.splice(0); for (const c of q) await p.pc.addIceCandidate(c).catch(() => {}); }

  private async signal(p: P, m: RtcMsg, d: Record<string, unknown>) {
    if (this.peers.get(p.id) !== p) return;
    const pc = p.pc, sdp = d.sdp as string;
    try {
      if (m.k === 'o') {
        const collide = p.making || pc.signalingState !== 'stable';
        p.ignore = collide && !p.polite;               // perfect negotiation: pihak tidak-sopan mengabaikan offer yang bertabrakan
        if (p.ignore) return;
        if (sdp === p.lastOffer && p.lastAnswer && pc.signalingState === 'stable') { this.post(p.id, 'a', { g: p.g, type: 'answer', sdp: p.lastAnswer }); return; } // offer duplikat: kirim ulang jawaban yang sama
        await pc.setRemoteDescription({ type: 'offer', sdp });
        if (this.peers.get(p.id) !== p) return;
        if (!p.tx) p.tx = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio' && t.mid !== null) ?? pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio') ?? null;
        this.attach(p);                                // sendrecv sejak awal (walau mic belum menyala) + track mic bila ada
        await this.flush(p);
        p.hold = true;
        try {
          await this.setLocal(pc, 'answer'); await this.gathered(pc);
          if (this.peers.get(p.id) !== p || pc.signalingState !== 'stable') return;
          p.lastOffer = sdp; p.lastAnswer = pc.localDescription!.sdp;
          this.post(p.id, 'a', { g: p.g, type: 'answer', sdp: p.lastAnswer });
        } finally { this.release(p); }
      } else if (m.k === 'a') {
        if (pc.signalingState !== 'have-local-offer') return; // jawaban duplikat/terlambat: abaikan (JANGAN merusak koneksi yang sehat)
        p.ignore = false;
        await pc.setRemoteDescription({ type: 'answer', sdp });
        await this.flush(p);
      }
    } catch {
      if (this.peers.get(p.id) === p) this.rebuild(p.id); // negosiasi gagal: bangun ulang (dengan backoff)
    }
  }

  // ------------------------------------------------------------------ sinyal keluar (antrean + laju terbatas)
  private post(to: string, k: RtcMsg['k'], d: Record<string, unknown>) {
    if (this.disposed) return;
    this.out.push({ m: { t: 'rtc', to, k, d: { ...d, s: this.sess } }, at: Date.now() });
    if (this.out.length > OUT_MAX) this.out.shift();
    this.pump();
  }
  private pump() {
    if (this.pumpT || this.disposed) return;
    const now = Date.now();
    while (this.out.length && now - this.out[0].at > OUT_TTL_MS) this.out.shift();
    const head = this.out[0]; if (!head) return;
    let ok = false; try { ok = this.send(head.m); } catch { ok = false; }
    if (ok) this.out.shift();
    if (this.out.length) { this.pumpT = setTimeout(() => { this.pumpT = null; this.pump(); }, ok ? OUT_GAP_MS : 400); }
  }

  private async setLocal(pc: RTCPeerConnection, type: 'offer' | 'answer') {
    try { await pc.setLocalDescription(); }
    catch (e) { if (pc.signalingState === 'closed') throw e; await pc.setLocalDescription(type === 'offer' ? await pc.createOffer() : await pc.createAnswer()); } // WebView lama tanpa setLocalDescription() implisit
  }
  /** Tunggu kandidat ICE terkumpul (maks GATHER_WAIT_MS) supaya masuk ke SDP: jauh lebih sedikit pesan sinyal. */
  private gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((res) => {
      const done = () => { clearTimeout(h); pc.removeEventListener('icegatheringstatechange', ch); res(); };
      const ch = () => { if (pc.iceGatheringState === 'complete') done(); };
      const h = setTimeout(done, GATHER_WAIT_MS);
      pc.addEventListener('icegatheringstatechange', ch);
    });
  }
  /** SDP sudah dikirim: kandidat yang sudah ada di SDP tidak perlu dikirim lagi; yang datang berikutnya dikirim berkelompok. */
  private release(p: P) { p.hold = false; p.cand.length = 0; if (p.candT) { clearTimeout(p.candT); p.candT = null; } }
  private flushCand(p: P) {
    if (p.candT) { clearTimeout(p.candT); p.candT = null; }
    if (p.hold || !p.cand.length || this.peers.get(p.id) !== p) return;
    this.post(p.id, 'i', { g: p.g, l: p.cand.splice(0, 40) });
    if (p.cand.length) this.flushCand(p);
  }

  private async negotiate(p: P) {
    if (this.disposed || this.peers.get(p.id) !== p) return;
    const pc = p.pc;
    try {
      p.making = true; p.hold = true;
      await this.setLocal(pc, 'offer'); await this.gathered(pc);
      if (this.peers.get(p.id) !== p || pc.signalingState !== 'have-local-offer') return;
      this.post(p.id, 'o', { g: p.g, type: 'offer', sdp: pc.localDescription!.sdp });
    } catch { /* tick membangun ulang bila macet */ }
    finally { p.making = false; this.release(p); }
  }

  // ------------------------------------------------------------------ RTCPeerConnection per peer
  private create(id: string, init: boolean, g: string): P {
    const pc = new RTCPeerConnection(ICE), audio = new Audio();
    audio.autoplay = true; audio.muted = !this.listening; audio.setAttribute('playsinline', ''); (audio as any).playsInline = true; audio.volume = 1;
    audio.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none'; // di DOM (WebView/Safari lebih andal), tidak terlihat
    try { document.body.appendChild(audio); } catch { /* */ }
    const p: P = { id, pc, audio, g, init, polite: !init, making: false, ignore: false, hold: false, tx: null, remote: null, pending: [], cand: [], candT: null, chain: Promise.resolve(), t0: Date.now(), bad: 0, restarted: false, lastOffer: '', lastAnswer: '' };
    const early = this.early.get(id + '|' + g); if (early) { p.pending.push(...early.list); this.early.delete(id + '|' + g); }
    pc.ontrack = (e) => {
      if (this.peers.get(id) !== p) return;
      let ms = e.streams && e.streams[0] ? e.streams[0] : null;
      if (!ms) { ms = p.remote ?? (p.remote = new MediaStream()); if (!ms.getTracks().includes(e.track)) ms.addTrack(e.track); }
      if (audio.srcObject !== ms) audio.srcObject = ms;
      e.track.onunmute = () => this.play(p);
      this.play(p);
    };
    pc.onicecandidate = (e) => {
      if (this.peers.get(id) !== p) return;
      if (e.candidate && e.candidate.candidate) p.cand.push([e.candidate.candidate, e.candidate.sdpMid ?? null, e.candidate.sdpMLineIndex ?? null]);
      if (p.hold) return;
      if (!e.candidate) this.flushCand(p); else if (!p.candT) p.candT = setTimeout(() => { p.candT = null; this.flushCand(p); }, 150);
    };
    pc.onnegotiationneeded = () => { void this.negotiate(p); };
    const st = () => {
      if (this.peers.get(id) !== p) return;
      const s = stateOf(pc);
      if (s === 'connected') { p.bad = 0; p.restarted = false; this.backoff.delete(id); this.play(p); }
      else if (s === 'failed') {
        this.later(() => this.tick(), 300);
        const now = Date.now(); if (now - this.lastFailAt > 20000) { this.lastFailAt = now; this.onFail?.(id); } // pemberitahuan dibatasi (tidak spam layar)
      }
      this.onState();
    };
    pc.onconnectionstatechange = st; pc.oniceconnectionstatechange = st;
    this.peers.set(id, p);
    if (init) { // penawar: transceiver sendrecv sejak awal (track mic ikut bila sudah ada) -> negotiationneeded -> offer
      const t = this.track();
      p.tx = t ? pc.addTransceiver(t, { direction: 'sendrecv', streams: this.stream ? [this.stream] : [] }) : pc.addTransceiver('audio', { direction: 'sendrecv' });
    }
    return p;
  }

  private drop(id: string) {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id); this.absent.delete(id);
    if (p.candT) clearTimeout(p.candT);
    p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = p.pc.onnegotiationneeded = p.pc.onicecandidate = p.pc.ontrack = null;
    try { p.pc.close(); } catch { /* */ }
    try { p.audio.pause(); } catch { /* */ }
    p.audio.srcObject = null; try { p.audio.remove(); } catch { /* */ }
    this.out = this.out.filter((x) => x.m.to !== id); // sinyal lama untuk koneksi ini tidak perlu dikirim lagi
    this.onState();
  }

  dispose() {
    this.disposed = true;
    for (const h of this.timers) clearTimeout(h); this.timers.clear();
    if (this.tickT) { clearInterval(this.tickT); this.tickT = null; }
    if (this.pumpT) { clearTimeout(this.pumpT); this.pumpT = null; }
    if (typeof window !== 'undefined') {
      for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this.unlock, true);
      window.removeEventListener('online', this.onNet); window.removeEventListener('pageshow', this.onNet);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); this.stream = null;
    this.out = []; this.early.clear(); this.seen.clear(); this.backoff.clear(); this.helloAt.clear(); this.online.clear();
    this.joined = false; this.listening = false; this.state = 'off';
  }
}
