// Simulasi monster (otoritatif, tanpa three/DOM): patroli -> deteksi -> kejar -> cari -> kembali patroli, dan penangkapan.
// Dijalankan HANYA oleh klien otoritas (single-player: lokal; multiplayer: pemain slot terendah yang online, lihat monsterctl.ts).
// Semua klien lain hanya menerima snapshot. Deterministik per seed (rng sendiri) dan dites dengan GLB asli.
import * as CFG from './config';
import type { CollisionWorld } from './collision';
import type { MonsterNav, Pt } from './monsternav';
import { makeRng, type Rng } from './rng';

export type MonState = 'patrol' | 'watch' | 'investigate' | 'chase' | 'search' | 'catch';
export const MON_STATES: MonState[] = ['patrol', 'watch', 'investigate', 'chase', 'search', 'catch'];
export type MonAnim = 'idle' | 'walk' | 'run' | 'grab';
export interface PlayerObs { id: string; x: number; z: number; level: number; gait: string; crouch: boolean; hidden: boolean; grace: number }
/** Dunia: dipanggil saat monster terhalang pintu. true = ada pintu di depan yang dibuka / sedang membuka (monster menunggu sebentar). */
export interface MonsterEnv { openDoorNear(x: number, z: number, level: number, dx: number, dz: number): boolean }
export type MonEvent = { type: 'catch'; id: string } | { type: 'state'; from: MonState; to: MonState };
export interface MonSnap { x: number; z: number; yaw: number; state: MonState; targetId: string; wp: number }

/** Pintu terdekat di depan arah gerak (jarak <= maxD): dipakai dunia & test agar monster membuka pintu yang benar-benar menghalangi, bukan pintu tetangga. */
export function doorAhead<T extends { cx: number; cz: number }>(doors: readonly T[], x: number, z: number, dx: number, dz: number, maxD = 1.6): T | null {
  let best: T | null = null, bd = maxD;
  for (const d of doors) { const ox = d.cx - x, oz = d.cz - z, dist = Math.hypot(ox, oz); if (dist < bd && ox * dx + oz * dz > -0.3 * dist) { bd = dist; best = d; } }
  return best;
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class MonsterSim {
  x = 0; z = 0; yaw = 0; state: MonState = 'patrol'; targetId = ''; speed = 0;
  get enabled(): boolean { return this.waypoints.length > 0; }
  readonly rng: Rng; readonly waypoints: Pt[] = []; wp = 0;
  lastSeen: Pt | null = null;
  private path: Pt[] = []; private pi = 0; private repathT = 0; private timer = 0; private lostT = 0; private stuckT = 0; private clock = 0; private baseYaw = 0; private goal: Pt | null = null;
  private bad = new Map<number, number>();   // waypoint yang gagal dijangkau -> sampai kapan dihindari

  constructor(readonly nav: MonsterNav, readonly cw: CollisionWorld, readonly level: number, seed: number, readonly env: MonsterEnv, awayFrom?: Pt) {
    this.rng = makeRng((seed ^ 0x6d6f6e) >>> 0);
    if (this.nav.count === 0) return; // lantai tidak terjangkau dari titik awal: monster dinonaktifkan (enabled = false)
    for (let tries = 0; tries < 800 && this.waypoints.length < 12; tries++) {
      const p = this.nav.randomPoint(this.rng);
      if (this.waypoints.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 7)) this.waypoints.push(p);
    }
    // urutan kunjungan: tetangga terdekat mulai dari titik terjauh dari 'awayFrom' (mis. ujung tangga) supaya pemain tidak langsung bertemu monster
    let cur = 0; if (awayFrom) { let bd = -1; this.waypoints.forEach((p, i) => { const d = Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z); if (d > bd) { bd = d; cur = i; } }); }
    const left = this.waypoints.map((p, i) => i).filter((i) => i !== cur), order = [cur];
    while (left.length) { const c = this.waypoints[order[order.length - 1]]; left.sort((a, b) => Math.hypot(this.waypoints[a].x - c.x, this.waypoints[a].z - c.z) - Math.hypot(this.waypoints[b].x - c.x, this.waypoints[b].z - c.z)); order.push(left.shift()!); }
    const wps = order.map((i) => this.waypoints[i]); this.waypoints.length = 0; this.waypoints.push(...wps);
    this.x = this.waypoints[0].x; this.z = this.waypoints[0].z; this.wp = this.waypoints.length > 1 ? 1 : 0; this.yaw = this.baseYaw = this.rng.range(-Math.PI, Math.PI);
  }

  get anim(): MonAnim { return this.state === 'catch' ? 'grab' : this.speed > 2.4 ? 'run' : this.speed > 0.3 ? 'walk' : 'idle'; }
  snapshot(): MonSnap { return { x: this.x, z: this.z, yaw: this.yaw, state: this.state, targetId: this.targetId, wp: this.wp }; }
  /** Dipakai otoritas baru (host berpindah): lanjut dari posisi snapshot terakhir sebagai patroli. */
  restore(s: { x: number; z: number; yaw: number; wp?: number }) {
    const p = this.nav.snap(s.x, s.z, 4); this.x = p ? p.x : s.x; this.z = p ? p.z : s.z; this.yaw = s.yaw; this.state = 'patrol'; this.targetId = ''; this.speed = 0; this.path = []; this.goal = null; this.lastSeen = null; this.timer = 0;
    if (s.wp !== undefined && s.wp >= 0 && s.wp < this.waypoints.length) this.wp = s.wp; else this.nearestWp();
  }
  private nearestWp() { let b = 0, bd = 1e9; this.waypoints.forEach((p, i) => { const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < bd) { bd = d; b = i; } }); this.wp = b; }
  private set(s: MonState, ev: MonEvent[]) { if (s !== this.state) { ev.push({ type: 'state', from: this.state, to: s }); this.state = s; this.path = []; this.goal = null; this.stuckT = 0; this.repathT = 0; } }

  private los(px: number, pz: number): boolean { return !this.cw.segmentBlocked(this.x, this.z, px, pz, this.level, 0.02); }
  private eligible(p: PlayerObs) { return p.level === this.level && !p.hidden && p.grace <= 0; }
  /** 'seen' (pandangan/terasa), 'heard' (suara), atau null. */
  private perceive(p: PlayerObs): 'seen' | 'heard' | null {
    if (!this.eligible(p)) return null;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    if (d <= CFG.MONSTER_SIGHT_RANGE) {
      const inFov = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw)) <= (CFG.MONSTER_FOV_DEG * Math.PI) / 360;
      if ((d <= CFG.MONSTER_SENSE_RADIUS || inFov || this.state === 'chase') && this.los(p.x, p.z)) return 'seen';
    }
    const hr = p.gait === 'run' ? CFG.MONSTER_HEAR_RUN : p.crouch ? CFG.MONSTER_HEAR_CROUCH : p.gait === 'walk' ? CFG.MONSTER_HEAR_WALK : 0;
    if (hr > 0 && d <= (this.los(p.x, p.z) ? hr : hr * 0.5)) return 'heard';
    return null;
  }

  update(dt: number, players: PlayerObs[]): MonEvent[] {
    const ev: MonEvent[] = []; if (!this.enabled) return ev; this.clock += dt;
    if (this.state === 'catch') { this.speed = 0; if ((this.timer -= dt) <= 0) this.relocate(players, ev); return ev; }
    let seenP: PlayerObs | null = null, seenD = 1e9, heardP: PlayerObs | null = null, heardD = 1e9;
    for (const p of players) { const k = this.perceive(p); if (!k) continue; const d = Math.hypot(p.x - this.x, p.z - this.z); if (k === 'seen' && d < seenD) { seenP = p; seenD = d; } else if (k === 'heard' && d < heardD) { heardP = p; heardD = d; } }
    if (this.state === 'chase') {
      const cur = players.find((p) => p.id === this.targetId) || null, curK = cur ? this.perceive(cur) : null;
      if (seenP && (!cur || curK !== 'seen' || seenD < Math.hypot(cur.x - this.x, cur.z - this.z) * 0.7)) { this.targetId = seenP.id; this.lastSeen = { x: seenP.x, z: seenP.z }; this.lostT = 0; }
      else if (cur && curK) { this.lastSeen = { x: cur.x, z: cur.z }; this.lostT = 0; }
      else this.lostT += dt;
      if (this.lostT >= CFG.MONSTER_LOSE_TIME) { this.set('search', ev); this.timer = CFG.MONSTER_SEARCH_TIME; this.targetId = ''; }
    } else if (seenP) { this.set('chase', ev); this.targetId = seenP.id; this.lastSeen = { x: seenP.x, z: seenP.z }; this.lostT = 0; }
    else if (heardP && (this.state === 'patrol' || this.state === 'watch' || this.state === 'search')) { this.set('investigate', ev); this.lastSeen = { x: heardP.x, z: heardP.z }; }
    // tangkap (divalidasi di sini oleh otoritas: jarak + garis pandang + target sah)
    if (this.state === 'chase') for (const p of players) {
      if (!this.eligible(p)) continue; const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d <= CFG.MONSTER_CATCH_RADIUS && this.los(p.x, p.z)) { this.set('catch', ev); this.targetId = p.id; this.timer = CFG.MONSTER_RESET_TIME; this.speed = 0; this.yaw = Math.atan2(p.x - this.x, p.z - this.z); ev.push({ type: 'catch', id: p.id }); return ev; }
    }
    switch (this.state) {
      case 'patrol': this.goTo(dt, this.waypoints[this.wp], CFG.MONSTER_PATROL_SPEED, ev, () => { this.set('watch', ev); this.timer = this.rng.range(1.5, 3.5); this.baseYaw = this.yaw; }); break;
      case 'watch': this.speed = 0; this.yaw = this.baseYaw + Math.sin(this.clock * 1.1) * 0.9; if ((this.timer -= dt) <= 0) { this.wp = this.nextWp(); this.set('patrol', ev); } break;
      case 'investigate': this.goTo(dt, this.lastSeen, CFG.MONSTER_INVESTIGATE_SPEED, ev, () => { this.set('search', ev); this.timer = CFG.MONSTER_SEARCH_TIME * 0.6; this.baseYaw = this.yaw; }); break;
      case 'chase': this.goTo(dt, this.lastSeen, CFG.MONSTER_CHASE_SPEED, ev, () => { /* tiba di titik terakhir: tunggu sampai lostT habis -> search */ this.speed = 0; }, true); break;
      case 'search': this.speed = 0; this.yaw = this.baseYaw + Math.sin(this.clock * 1.4) * 1.2; if ((this.timer -= dt) <= 0) { this.nearestWp(); this.set('patrol', ev); } break;
    }
    return ev;
  }
  private nextWp(): number { for (let k = 1; k <= this.waypoints.length; k++) { const i = (this.wp + k) % this.waypoints.length; if ((this.bad.get(i) ?? 0) <= this.clock) return i; } return (this.wp + 1) % this.waypoints.length; }
  private relocate(players: PlayerObs[], ev: MonEvent[]) {
    let b = 0, bd = -1; this.waypoints.forEach((p, i) => { const d = Math.min(...players.map((q) => Math.hypot(q.x - p.x, q.z - p.z)), 1e9); if (d > bd) { bd = d; b = i; } });
    this.x = this.waypoints[b].x; this.z = this.waypoints[b].z; this.wp = (b + 1) % this.waypoints.length; this.targetId = ''; this.lastSeen = null; this.speed = 0; this.set('patrol', ev);
  }
  private goTo(dt: number, goal: Pt | null, speed: number, ev: MonEvent[], onArrive: () => void, chase = false) {
    if (!goal) { this.speed = 0; return; }
    if (Math.hypot(goal.x - this.x, goal.z - this.z) < (chase ? 0.5 : 0.7)) { onArrive(); return; }
    if (!this.path.length || this.pi >= this.path.length || (this.repathT -= dt) <= 0 || !this.goal || Math.hypot(this.goal.x - goal.x, this.goal.z - goal.z) > 0.8) {
      this.repathT = chase ? 0.35 : 1.5; this.goal = { x: goal.x, z: goal.z }; const p = this.nav.path(this.x, this.z, goal.x, goal.z);
      if (!p) { this.unreachable(ev); return; } this.path = p; this.pi = 0;
    }
    const t = this.path[this.pi], dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { this.pi++; return; }
    const want = Math.atan2(dx, dz), turn = (chase ? 9 : 5) * dt, diff = wrap(want - this.yaw); this.yaw += Math.abs(diff) <= turn ? diff : Math.sign(diff) * turn;
    const aligned = Math.abs(wrap(want - this.yaw)) < 0.9, sp = aligned ? speed : speed * 0.3, step = Math.min(sp * dt, d), ux = dx / d, uz = dz / d, R = CFG.MONSTER_RADIUS;
    const ox = this.x, oz = this.z; let nx = ox + ux * step, nz = oz + uz * step;
    if (!this.cw.blocked(nx, nz, R, this.level)) { this.x = nx; this.z = nz; }
    else if (!this.cw.blocked(nx, oz, R, this.level)) this.x = nx; else if (!this.cw.blocked(ox, nz, R, this.level)) this.z = nz;
    const moved = Math.hypot(this.x - ox, this.z - oz); this.speed = moved / Math.max(dt, 1e-6);
    if (moved < step * 0.25) {
      this.stuckT += dt;
      if (this.stuckT > 0.3) { if (this.env.openDoorNear(this.x, this.z, this.level, ux, uz)) this.stuckT = -1.0; /* tunggu pintu terbuka */ }
      if (this.stuckT > 2.2) this.unreachable(ev);
    } else if (this.stuckT > 0) this.stuckT = 0;
  }
  /** Tujuan tidak terjangkau (pintu terkunci / jalur buntu): hindari titik itu sebentar lalu lanjut. */
  private unreachable(ev: MonEvent[]) {
    this.stuckT = 0; this.path = []; this.goal = null;
    if (this.state === 'patrol') { this.bad.set(this.wp, this.clock + 60); this.wp = this.nextWp(); }
    else if (this.state === 'chase') this.lostT = CFG.MONSTER_LOSE_TIME;
    else { this.set('search', ev); this.timer = 2; this.baseYaw = this.yaw; }
  }
}
