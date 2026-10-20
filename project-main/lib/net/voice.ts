// Voice chat real-time (WebRTC mesh, maks 3 peer). Sinyal lewat RoomClient (realtime). Perfect-negotiation. Hanya klien (browser).
import type { RtcMsg } from './voicemsg';

export type MicState = 'off' | 'on' | 'muted' | 'denied';
interface P { pc: RTCPeerConnection; audio: HTMLAudioElement; making: boolean; polite: boolean }
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

export class VoiceMesh {
  state: MicState = 'off';
  private joined = false;
  private stream: MediaStream | null = null;
  private peers = new Map<string, P>();
  constructor(private selfId: string, private send: (m: RtcMsg) => boolean, private onState: () => void) {}

  /** Tap pertama: gabung (mic menyala). Tap berikutnya: bisu / buka bisu. */
  async toggle(online: string[]): Promise<void> {
    if (!this.joined) {
      this.joined = true;
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); this.state = 'on'; }
      catch { this.state = 'denied'; } // tetap bisa mendengar
      this.onState();
      for (const id of online) this.send({ t: 'rtc', to: id, k: 'h' });
      return;
    }
    if (!this.stream) return;
    const on = this.state !== 'on'; this.stream.getAudioTracks().forEach((t) => (t.enabled = on)); this.state = on ? 'on' : 'muted'; this.onState();
  }
  /** Peer yang keluar dari room: tutup koneksinya. */
  syncPeers(online: string[]) { for (const id of [...this.peers.keys()]) if (!online.includes(id)) this.drop(id); }

  handle(from: string, m: RtcMsg) {
    if (!this.joined) return;
    if (m.k === 'h') { this.drop(from); this.make(from); return; } // peer baru gabung: kita yang menawarkan
    const p = this.peers.get(from) ?? this.make(from, false);
    void this.signal(from, p, m);
  }
  private async signal(from: string, p: P, m: RtcMsg) {
    const pc = p.pc, d = m.d as any;
    try {
      if (m.k === 'o' || m.k === 'a') {
        if (!d || typeof d.sdp !== 'string' || typeof d.type !== 'string') return;
        const collide = m.k === 'o' && (p.making || pc.signalingState !== 'stable');
        if (collide && !p.polite) return;
        await pc.setRemoteDescription({ type: m.k === 'o' ? 'offer' : 'answer', sdp: d.sdp });
        if (m.k === 'o') { await pc.setLocalDescription(); this.send({ t: 'rtc', to: from, k: 'a', d: { type: 'answer', sdp: pc.localDescription!.sdp } }); }
      } else if (m.k === 'i' && d && typeof d.candidate === 'string') { await pc.addIceCandidate({ candidate: d.candidate, sdpMid: d.sdpMid ?? null, sdpMLineIndex: d.sdpMLineIndex ?? null }).catch(() => {}); }
    } catch { /* negosiasi gagal: diabaikan, 'h' berikutnya mengulang */ }
  }
  private make(id: string, offer = true): P {
    const pc = new RTCPeerConnection(ICE), audio = new Audio(); audio.autoplay = true;
    const p: P = { pc, audio, making: false, polite: this.selfId > id };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void audio.play().catch(() => {}); };
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', to: id, k: 'i', d: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } }); };
    pc.onnegotiationneeded = async () => { try { p.making = true; await pc.setLocalDescription(); this.send({ t: 'rtc', to: id, k: 'o', d: { type: 'offer', sdp: pc.localDescription!.sdp } }); } catch { /* abaikan */ } finally { p.making = false; } };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.drop(id); };
    this.peers.set(id, p);
    if (this.stream) this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream!)); else if (offer) pc.addTransceiver('audio', { direction: 'recvonly' });
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    return p;
  }
  private drop(id: string) { const p = this.peers.get(id); if (!p) return; this.peers.delete(id); try { p.pc.close(); } catch { /* */ } p.audio.srcObject = null; }
  dispose() { for (const id of [...this.peers.keys()]) this.drop(id); this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.joined = false; this.state = 'off'; }
}
