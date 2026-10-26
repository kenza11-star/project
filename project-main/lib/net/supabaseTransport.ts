// KLIEN (browser). RoomTransport di atas Supabase Realtime (channel PRIVATE, dijaga RLS di supabase/schema.sql).
//  - room:<id>:ctl      : presence (siapa yang online).
//  - room:<id>:u:<uid>  : posisi milik <uid> (broadcast). Hanya <uid> yang boleh menulis; semua anggota boleh membaca.
//    Identitas pengirim = <uid> pada topik (ditegakkan RLS), bukan isi pesan -> pemain tidak bisa menyamar sebagai pemain lain.
// Anggota sah (nama, slot) dari database lewat fetchRoomSnapshot, bukan dari presence/pesan.
// CATATAN: modul ini belum bisa diuji tanpa proyek Supabase nyata. Logika klien di atasnya (RoomClient) diuji dengan transport tiruan.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabaseClient';
import { fetchRoomSnapshot } from './members';
import type { RoomTransport, TransportEvents } from './roomclient';

const SUBSCRIBE_TIMEOUT_MS = 10_000;
const MEMBERS_REFRESH_MS = 15_000;
const BROADCAST_EVENT = 's';

export class SupabaseTransport implements RoomTransport {
  private sb: SupabaseClient | null = null;
  private ev: TransportEvents | null = null;
  private ctl: RealtimeChannel | null = null;
  private own: RealtimeChannel | null = null;
  private peers = new Map<string, RealtimeChannel>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private ready = false;

  constructor(private roomId: string, private selfId: string) {}

  private topic(suffix: string) { return `room:${this.roomId}:${suffix}`; }

  private subscribe(ch: RealtimeChannel): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('subscribe_timeout')), SUBSCRIBE_TIMEOUT_MS);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(t);
          if (!this.ready) reject(new Error('subscribe_' + status));
          else if (!this.closed) this.ev?.onStatus('disconnected'); // putus setelah tersambung -> RoomClient menjadwalkan reconnect
        }
      });
    });
  }

  private async refreshMembers() {
    if (!this.sb || !this.ev || this.closed) return;
    const snap = await fetchRoomSnapshot(this.sb, this.roomId);
    if (!snap || this.closed) { if (!snap && this.ready) this.ev?.onStatus('disconnected'); return; }
    this.ev.onMembers(snap.members);
    for (const m of snap.members) if (m.id !== this.selfId && !this.peers.has(m.id)) await this.listen(m.id);
    for (const [id, ch] of this.peers) if (!snap.members.some((m) => m.id === id)) { this.peers.delete(id); void this.sb.removeChannel(ch); }
  }

  private async listen(uid: string) {
    if (!this.sb || this.peers.has(uid)) return;
    const ch = this.sb.channel(this.topic('u:' + uid), { config: { private: true } });
    ch.on('broadcast', { event: BROADCAST_EVENT }, (m: { payload?: unknown }) => { if (!this.closed) this.ev?.onState(uid, m.payload); });
    this.peers.set(uid, ch);
    try { await this.subscribe(ch); } catch { this.peers.delete(uid); void this.sb.removeChannel(ch); }
  }

  async open(ev: TransportEvents): Promise<void> {
    this.ev = ev; this.closed = false; this.ready = false;
    ev.onStatus('connecting');
    const sb = this.sb = await getSupabase();
    // 1) anggota sah dulu (gagal = bukan anggota / token tidak valid -> open() melempar -> RoomClient mencoba lagi)
    const snap = await fetchRoomSnapshot(sb, this.roomId);
    if (!snap) throw new Error('not_member');
    ev.onMembers(snap.members);
    // 2) channel milik sendiri (kirim) + presence
    const own = this.own = sb.channel(this.topic('u:' + this.selfId), { config: { private: true, broadcast: { self: false, ack: false } } });
    const ctl = this.ctl = sb.channel(this.topic('ctl'), { config: { private: true, presence: { key: this.selfId } } });
    const online = () => { const st = ctl.presenceState(); ev.onOnline(Object.keys(st)); };
    ctl.on('presence', { event: 'sync' }, online);
    ctl.on('presence', { event: 'join' }, ({ key }: { key: string }) => { if (key !== this.selfId && !this.peers.has(key)) void this.refreshMembers().catch(() => {}); });
    await Promise.all([this.subscribe(own), this.subscribe(ctl)]);
    this.ready = true;
    await ctl.track({ uid: this.selfId, at: Date.now() });
    // 3) dengarkan channel tiap anggota lain
    await Promise.all(snap.members.filter((m) => m.id !== this.selfId).map((m) => this.listen(m.id)));
    online();
    this.timer = setInterval(() => { void this.refreshMembers().catch(() => {}); }, MEMBERS_REFRESH_MS);
    ev.onStatus('connected');
  }

  send(msg: object) {
    if (!this.own || !this.ready || this.closed) return;
    void this.own.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: msg });
  }

  canSignal(): boolean { return !!this.own && this.ready && !this.closed; }

  async close() {
    this.closed = true; this.ready = false;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const sb = this.sb, ctl = this.ctl, chans = [this.own, ctl, ...this.peers.values()].filter(Boolean) as RealtimeChannel[];
    this.own = this.ctl = null; this.peers.clear();
    try { await ctl?.untrack(); } catch { /* abaikan */ }
    if (sb) await Promise.all(chans.map((c) => sb.removeChannel(c).catch(() => {})));
  }
}
