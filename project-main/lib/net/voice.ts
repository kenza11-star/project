// Voice chat real-time (WebRTC mesh, maks 5 peer). Sinyal lewat RoomClient (realtime). Perfect-negotiation. Hanya klien (browser).
// Mic dan audio (output) terpisah: listen() = ikut mendengar tanpa getUserMedia; toggle() = mic.
import type { RtcMsg } from './voicemsg';

export type MicState = 'off' | 'on' | 'muted' | 'denied';
interface P { pc: RTCPeerConnection; audio: HTMLAudioElement; making: boolean; polite: boolean; tx: RTCRtpTransceiver | null; pending: RTCIceCandidateInit[]; ignore: boolean; chain: Promise<void>; retry: number; t0: number; }

// TURN opsional via env (NEXT_PUBLIC_* harus ditulis literal agar di-inline Next.js). URL boleh dipisah koma.
const TURN_URL = process.env.NEXT_PUBLIC_TURN_URL, TURN_USER = process.env.NEXT_PUBLIC_TURN_USER, TURN_CRED = process.env.NEXT_PUBLIC_TURN_CRED;
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    ...(TURN_URL ? [{ urls: TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: TURN_USER, credential: TURN_CRED }]
      // cadangan publik bila TURN sendiri belum diatur (jaringan seluler/CGNAT sering tidak bisa tembus hanya dengan STUN)
      : [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }]),
  ],
};
const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

export class VoiceMesh {
  state: MicState = 'off';
  /** true = output audio hidup (mendengar voice chat). */
  listening = false;
  private joined = false;
  private stream: MediaStream | null = null;
  private peers = new Map<string, P>();
  private known = new Set<string>();
  private ctx: AudioContext | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  private iv: ReturnType<typeof setInterval> | null = null;
  constructor(private selfId: string, private send: (m: RtcMsg) => boolean, private onState: () => void, private onFail?: (id: string) => void) {
    try { const AC = window.AudioContext ?? (window as any).webkitAudioContext; if (AC) this.ctx = new AC(); } catch { /* abaikan */ }
    if (typeof window !== 'undefined') { for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, this.unlock, true); document.addEventListener('visibilitychange', this.onVisible); }
  }

  /** true bila minimal satu peer tersambung (untuk indikator tombol). */
  get connected(): boolean { for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') return true; return false; }

  /** Tap/gesture pertama: lanjutkan AudioContext + ulang play() audio remote yang diblokir autoplay. */
  private unlock = () => {
    void this.ctx?.resume().catch(() => {});
    if (this.listening) for (const p of this.peers.values()) if (p.audio.srcObject && p.audio.paused) void p.audio.play().catch(() => {});
  };
  private onVisible = () => { if (document.visibilityState === 'visible') { this.unlock(); const t = this.stream?.getAudioTracks()[0]; if (this.state !== 'off' && this.state !== 'denied' && (!t || t.readyState === 'ended')) void this.reacquire(); } };
  private later(fn: () => void, ms: number) { const h = setTimeout(() => { this.timers.delete(h); if (!this.disposed) fn(); }, ms); this.timers.add(h); }

  private join(online: string[]) {
    if (this.joined) return;
    this.joined = true;
    for (const id of online) { this.known.add(id); this.send({ t: 'rtc', to: id, k: 'h' }); }
    // sinyal bisa hilang (Realtime belum siap / paket jatuh): ulangi 'h' ke peer yang belum tersambung & coba putar ulang audio yang diblokir
    this.iv = setInterval(() => {
      if (this.disposed) return;
      for (const id of this.known) { const p = this.peers.get(id); if (!p || (p.pc.connectionState !== 'connected' && Date.now() - p.t0 > 6000)) this.send({ t: 'rtc', to: id, k: 'h' }); }
      if (this.listening) for (const p of this.peers.values()) if (p.audio.srcObject && p.audio.paused) void p.audio.play().catch(() => {});
    }, 4000);
  }

  /** Audio ON/OFF: join recvonly tanpa getUserMedia dan tanpa izin mic. */
  listen(online: string[], on = true): void {
    this.listening = on;
    for (const p of this.peers.values()) p.audio.muted = !on;
    if (on) { this.join(online); this.unlock(); }
    this.onState();
  }

  /** Mic: tap pertama menyalakan mic (+ audio otomatis). Tap berikutnya: bisu / buka bisu. */
  async toggle(online: string[]): Promise<void> {
    if (!this.stream || this.state === 'denied' || this.state === 'off') {
      this.listening = true; for (const p of this.peers.values()) p.audio.muted = false;
      try { this.stream = await navigator.mediaDevices.getUserMedia(MIC); this.state = 'on'; this.watch(); this.attachAll(); }
      catch { this.stream = null; this.state = 'denied'; } // tetap bisa mendengar
      this.join(online); this.unlock(); this.onState();
      return;
    }
    const on = this.state !== 'on'; this.stream.getAudioTracks().forEach((t) => (t.enabled = on)); this.state = on ? 'on' : 'muted'; this.onState();
  }

  private track(): MediaStreamTrack | null { return this.stream?.getAudioTracks()[0] ?? null; }
  private attach(p: P) { const t = this.track(); if (!p.tx || !t) return; try { p.tx.direction = 'sendrecv'; } catch { /* */ } void p.tx.sender.replaceTrack(t).catch(() => {}); }
  private attachAll() { for (const p of this.peers.values()) this.attach(p); }
  /** Track mic berhenti (telepon masuk / tab pindah): ambil ulang + replaceTrack ke semua peer. */
  private watch() { const t = this.track(); if (t) t.onended = () => { void this.reacquire(); }; }
  private async reacquire() {
    if (this.disposed || this.state === 'off' || this.state === 'denied') return;
    const was = this.state;
    try {
      const s = await navigator.mediaDevices.getUserMedia(MIC);
      this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      this.stream = s; s.getAudioTracks().forEach((t) => (t.enabled = was === 'on'));
      this.watch(); this.attachAll();
    } catch { this.later(() => { void this.reacquire(); }, 3000); }
  }

  /** Sinkron daftar online: tutup peer yang keluar; peer baru masuk -> kirim 'h' bila kita sudah join. */
  syncPeers(online: string[]) {
    for (const id of [...this.peers.keys()]) if (!online.includes(id)) this.drop(id);
    for (const id of [...this.known]) if (!online.includes(id)) this.known.delete(id);
    for (const id of online) if (!this.known.has(id)) { this.known.add(id); if (this.joined) this.send({ t: 'rtc', to: id, k: 'h' }); }
  }

  handle(from: string, m: RtcMsg) {
    if (this.disposed) return;
    if (m.k === 'h') {
      const p = this.peers.get(from);
      if (!p) { this.make(from); return; }
      if (p.pc.connectionState === 'closed' || p.pc.connectionState === 'failed' || (p.pc.connectionState !== 'connected' && Date.now() - p.t0 > 6000)) { this.drop(from); this.make(from); return; } // macet >6 dtk (offer/jawaban hilang): bangun ulang
      if (p.pc.connectionState !== 'connected') { try { p.pc.restartIce(); } catch { /* */ } } // jangan putus koneksi sehat
      return;
    }
    const p = this.peers.get(from) ?? this.make(from, false);
    p.chain = p.chain.then(() => this.signal(from, p, m)); // sinyal diserialkan per peer
  }

  private async flush(p: P) { const q = p.pending.splice(0); for (const c of q) await p.pc.addIceCandidate(c).catch(() => {}); }

  private async signal(from: string, p: P, m: RtcMsg, retried = false) {
    const pc = p.pc, d = m.d as any;
    try {
      if (m.k === 'o' || m.k === 'a') {
        if (!d || typeof d.sdp !== 'string' || typeof d.type !== 'string') return;
        const collide = m.k === 'o' && (p.making || pc.signalingState !== 'stable');
        p.ignore = collide && !p.polite;
        if (p.ignore) return;
        await pc.setRemoteDescription({ type: m.k === 'o' ? 'offer' : 'answer', sdp: d.sdp });
        await this.flush(p);
        if (m.k === 'o') {
          if (!p.tx) { p.tx = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio') ?? null; }
          this.attach(p);
          await pc.setLocalDescription();
          this.send({ t: 'rtc', to: from, k: 'a', d: { type: 'answer', sdp: pc.localDescription!.sdp } });
        }
      } else if (m.k === 'i' && d && typeof d.candidate === 'string') {
        const c: RTCIceCandidateInit = { candidate: d.candidate, sdpMid: d.sdpMid ?? null, sdpMLineIndex: d.sdpMLineIndex ?? null };
        if (p.ignore) return;
        if (!pc.remoteDescription) p.pending.push(c); else await pc.addIceCandidate(c).catch(() => {}); // antre sampai setRemoteDescription selesai
      }
    } catch {
      // negosiasi gagal (mis. peer refresh -> sidik jari DTLS berubah): bangun ulang koneksi sekali
      if (retried || this.peers.get(from) !== p) return;
      this.drop(from);
      if (m.k === 'o') { const np = this.make(from, false); np.chain = np.chain.then(() => this.signal(from, np, m, true)); } else this.make(from);
    }
  }

  private make(id: string, offer = true): P {
    const pc = new RTCPeerConnection(ICE), audio = new Audio();
    audio.autoplay = true; audio.muted = !this.listening; audio.setAttribute('playsinline', ''); (audio as any).playsInline = true;
    const p: P = { pc, audio, making: false, polite: this.selfId > id, tx: null, pending: [], ignore: false, chain: Promise.resolve(), retry: 0, t0: Date.now() };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void audio.play().catch(() => {}); };
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', to: id, k: 'i', d: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } }); };
    pc.onnegotiationneeded = async () => { try { p.making = true; await pc.setLocalDescription(); this.send({ t: 'rtc', to: id, k: 'o', d: { type: 'offer', sdp: pc.localDescription!.sdp } }); } catch { /* abaikan */ } finally { p.making = false; } };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'disconnected') this.later(() => { if (this.peers.get(id) === p && pc.iceConnectionState === 'disconnected') { try { pc.restartIce(); } catch { /* */ } } }, 4000); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') p.retry = 0;
      if (pc.connectionState === 'failed' && this.peers.get(id) === p) {
        this.drop(id); this.onFail?.(id);
        if (this.joined && this.known.has(id) && p.retry < 2) this.later(() => { if (!this.peers.has(id) && this.known.has(id)) { this.make(id).retry = p.retry + 1; } }, 2500);
      }
      this.onState();
    };
    this.peers.set(id, p);
    if (offer) { p.tx = pc.addTransceiver('audio', { direction: 'sendrecv' }); this.attach(p); } // jawaban: transceiver dibuat oleh offer remote (lihat signal)
    return p;
  }
  private drop(id: string) { const p = this.peers.get(id); if (!p) return; this.peers.delete(id); p.pc.onconnectionstatechange = null; p.pc.onnegotiationneeded = null; try { p.pc.close(); } catch { /* */ } p.audio.srcObject = null; this.onState(); }
  dispose() {
    this.disposed = true;
    for (const h of this.timers) clearTimeout(h); this.timers.clear();
    if (this.iv) { clearInterval(this.iv); this.iv = null; }
    if (typeof window !== 'undefined') { for (const ev of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(ev, this.unlock, true); document.removeEventListener('visibilitychange', this.onVisible); }
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); this.stream = null;
    void this.ctx?.close().catch(() => {}); this.ctx = null;
    this.joined = false; this.listening = false; this.state = 'off';
  }
}
