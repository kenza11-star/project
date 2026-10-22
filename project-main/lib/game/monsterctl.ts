// Pengendali monster (murni): memilih otoritas, menjalankan simulasi (hanya otoritas), mengirim snapshot/tangkapan lewat adapter jaringan,
// dan menyediakan 'view' yang sama untuk render di semua klien. Single-player = otoritas lokal tanpa jaringan.
import * as CFG from './config';
import { MonsterSim, type MonAnim, type MonState, type PlayerObs, MON_STATES } from './monster';
import { JS_TOTAL, dangerOf } from './monsterfx';
import { CatchLedger, MonsterReplica, RateLimit, electAuthority, sanitizeMonsterMsg, type CatchInfo, type MonSnapMsg, type PeerInfo } from './monstersync';

export interface MonsterNetIO { selfId: string; selfSlot: number; peers(): PeerInfo[]; send(msg: object): void; onMessage(fn: (from: string, raw: unknown) => void): () => void }
export interface MonView { active: boolean; x: number; z: number; yaw: number; state: MonState; anim: MonAnim; speed: number; targetId: string; stale: boolean; authority: boolean; level: number; onStairs: boolean }
/** Setelah tertangkap pemain kebal selama: jumpscare + jeda respawn + MONSTER_GRACE (dihitung otoritas, jadi tidak bergantung jam klien korban). */
export const GRACE_AFTER_CATCH = JS_TOTAL + 2.5 + CFG.MONSTER_GRACE;

export class MonsterController {
  readonly view: MonView = { active: false, x: 0, z: 0, yaw: 0, state: 'patrol', anim: 'idle', speed: 0, targetId: '', stale: false, authority: false, level: CFG.MONSTER_LEVEL, onStairs: false };
  /** Dipanggil pada korban saat tertangkap. drag = true: tangkapan ini akan diikuti seretan ke ruangan lain (TAHAP 2). */
  onCatchSelf: ((drag: boolean) => void) | null = null;
  /** TAHAP 4: dipanggil di SEMUA klien (korban, pemain lain, otoritas) tepat SEKALI per kejadian tangkapan (pesan kirim-ulang disaring ledger), dengan lokasi kejadian. Dasar audio tangkapan spasial. */
  onCatch: ((ev: CatchInfo) => void) | null = null;
  private sim: MonsterSim | null = null; private replica = new MonsterReplica(); private ledger = new CatchLedger(); private rate = new RateLimit(40, 1000);
  private epoch = 1; private seq = 0; private acc = 0; private force = true; private pendingCatch: { at: number; msg: object }[] = [];
  private grace = new Map<string, number>(); private wasCaught = new Map<string, boolean>(); private unsub: (() => void) | null = null; private lastState: MonState = 'patrol';
  constructor(private make: () => MonsterSim, private net: MonsterNetIO | null, private now: () => number) {
    if (net) this.unsub = net.onMessage((from, raw) => this.onMessage(from, raw));
  }
  dispose() { this.unsub?.(); this.unsub = null; this.sim = null; this.pendingCatch.length = 0; this.wasCaught.clear(); }
  get isAuthority(): boolean { return this.view.authority; }
  authorityId(): string { return this.net ? electAuthority(this.net.selfId, this.net.selfSlot, this.net.peers()) : 'local'; }
  graceOf(id: string): number { const u = this.grace.get(id); return u === undefined ? 0 : Math.max(0, (u - this.now()) / 1000); }

  /** TAHAP 3: pemain yang tadinya 'tertangkap' lalu bangun (caught true -> false) kebal CAPTURE_GRACE detik. Dihitung di sisi otoritas dari flag yang sudah ada (cg), jadi tanpa pesan baru. */
  private trackWake(self: PlayerObs, remotes: PlayerObs[], now: number) {
    this.markCaught(self, now); for (const r of remotes) this.markCaught(r, now);
    if (this.wasCaught.size > remotes.length + 1) for (const id of this.wasCaught.keys()) if (id !== self.id && !remotes.some((r) => r.id === id)) this.wasCaught.delete(id);   // pemain keluar/putus: state dibuang
  }
  private markCaught(p: PlayerObs, now: number) {
    const was = this.wasCaught.get(p.id), c = !!p.caught;
    if (was && !c) { const until = now + CFG.CAPTURE_GRACE * 1000; if (until > (this.grace.get(p.id) ?? 0)) this.grace.set(p.id, until); }
    this.wasCaught.set(p.id, c);
  }
  private onMessage(from: string, raw: unknown) {
    const net = this.net; if (!net || from === net.selfId) return;
    const now = this.now(); if (!this.rate.allow(from, now)) return;
    const m = sanitizeMonsterMsg(raw); if (!m) return;
    if (from !== this.authorityId()) return;                      // hanya otoritas yang sah yang boleh mengatur monster / menangkap
    if (m.t === 'm') { this.replica.push(m, now); if (this.sim) { /* otoritas lain menang (slot lebih rendah): lepas */ } }
    else if (this.ledger.accept(m, now)) {
      if (m.id === net.selfId) { this.grace.set(m.id, now + GRACE_AFTER_CATCH * 1000); this.onCatchSelf?.(m.dg === 1); }   // hanya KORBAN yang kena jumpscare
      const v = this.view, known = m.cx !== undefined && m.cz !== undefined, fb = !known && v.active && !v.stale;   // lokasi dari pesan; pesan lama -> posisi monster di replika
      this.onCatch?.({ key: m.e + ':' + m.s + ':' + m.id, id: m.id, x: known ? m.cx! : fb ? v.x : NaN, z: known ? m.cz! : fb ? v.z : NaN, level: m.cl !== undefined ? m.cl : v.level, drag: m.dg === 1 });
    }
  }
  private send(msg: object) { try { this.net?.send(msg); } catch { /* jaringan putus: abaikan */ } }
  private snapMsg(s: MonSnapMsg['st'], sim: MonsterSim): MonSnapMsg {
    return { v: 1, t: 'm', e: this.epoch, s: ++this.seq, x: +sim.x.toFixed(3), z: +sim.z.toFixed(3), yw: +sim.yaw.toFixed(3), st: s, tg: sim.targetId, sp: +sim.speed.toFixed(2), wp: sim.wp, lv: sim.level, os: sim.onStairs ? 1 : 0 };
  }
  /** Dipanggil tiap frame. self = pemain lokal; remotes = pemain lain (posisi dari jaringan). */
  update(dt: number, self: PlayerObs, remotes: PlayerObs[]) {
    const v = this.view, now = this.now(), auth = this.net ? this.authorityId() === this.net.selfId : true;
    if (auth && !this.sim) {                                       // menjadi otoritas (awal, atau host sebelumnya keluar)
      this.sim = this.make(); const last = this.replica.sample(now);
      if (last && !last.stale) { this.sim.restore({ x: last.x, z: last.z, yaw: last.yaw, lv: last.level, os: last.onStairs ? 1 : 0 }); this.epoch = this.replica.epoch + 1; } else this.epoch = Math.max(this.epoch, this.replica.epoch + 1);
      this.seq = 0; this.force = true; this.lastState = this.sim.state;
    } else if (!auth && this.sim) { this.sim = null; this.pendingCatch.length = 0; }
    v.authority = auth;
    this.trackWake(self, remotes, now);
    if (auth && this.sim) {
      const sim = this.sim; v.active = sim.enabled;
      if (sim.enabled) {
        const obs = [self, ...remotes].map((p) => ({ ...p, grace: Math.max(p.grace, this.graceOf(p.id)) }));
        for (const e of sim.update(dt, obs)) {
          if (e.type === 'catch') {                                // validasi sudah dilakukan sim: jarak + garis pandang + target sah (tidak hidden/kebal)
            this.grace.set(e.id, now + GRACE_AFTER_CATCH * 1000);
            const msg = { v: 1, t: 'mc', e: this.epoch, s: ++this.seq, id: e.id, dg: e.drag ? 1 : 0, cx: +sim.x.toFixed(2), cz: +sim.z.toFixed(2), cl: sim.level };   // cx/cz/cl = lokasi kejadian (TAHAP 4)
            if (this.net) { this.send(msg); this.pendingCatch.push({ at: now + 150, msg }, { at: now + 300, msg }); }   // kirim ulang (pesan hilang) — penerima menyaring duplikat
            if (e.id === (this.net ? this.net.selfId : self.id)) this.onCatchSelf?.(!!e.drag);
            this.onCatch?.({ key: msg.e + ':' + msg.s + ':' + msg.id, id: e.id, x: sim.x, z: sim.z, level: sim.level, drag: !!e.drag });   // otoritas tidak menerima pesannya sendiri -> panggil langsung (sekali)
          } else if (e.type === 'state' || e.type === 'drag') this.force = true;
        }
        if (this.net) {
          for (let i = this.pendingCatch.length - 1; i >= 0; i--) if (now >= this.pendingCatch[i].at) { this.send(this.pendingCatch[i].msg); this.pendingCatch.splice(i, 1); }
          this.acc += dt; if (this.force || this.acc >= 1 / CFG.MONSTER_NET_HZ) { this.acc = 0; this.force = false; this.send(this.snapMsg(MON_STATES.indexOf(sim.state) as MonSnapMsg['st'], sim)); }
        }
        v.x = sim.x; v.z = sim.z; v.yaw = sim.yaw; v.state = sim.state; v.anim = sim.anim; v.speed = sim.speed; v.targetId = sim.targetId; v.stale = false; v.level = sim.level; v.onStairs = sim.onStairs;
      }
    } else {
      const s = this.replica.sample(now);
      if (s) { v.active = !s.stale; v.x = s.x; v.z = s.z; v.yaw = s.yaw; v.state = s.state; v.anim = s.anim; v.speed = s.speed; v.targetId = s.targetId; v.stale = s.stale; v.level = s.level; v.onStairs = s.onStairs; } else v.active = false;
    }
  }
  /** Bahaya 0..1 untuk pemain ini (jarak ke monster, dikejar, beda lantai). */
  dangerFor(p: PlayerObs): number {
    const v = this.view; if (!v.active) return 0;
    return dangerOf(Math.hypot(p.x - v.x, p.z - v.z), v.state === 'chase' && v.targetId === p.id, p.level === v.level || v.onStairs || !!p.stairs);
  }
}
