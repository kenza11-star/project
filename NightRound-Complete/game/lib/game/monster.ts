// Simulasi monster (otoritatif, tanpa three/DOM): patroli -> deteksi -> kejar -> cari -> kembali patroli, dan penangkapan.
// Dijalankan HANYA oleh klien otoritas (single-player: lokal; multiplayer: pemain slot terendah yang online, lihat monsterctl.ts).
// Semua klien lain hanya menerima snapshot. Deterministik per seed (rng sendiri) dan dites dengan GLB asli.
import * as CFG from './config';
import type { CollisionWorld } from './collision';
import type { MonsterNav, Pt } from './monsternav';
import { makeRng, type Rng } from './rng';
import { stairHeight, stairU, STAIR_SPEED_MUL, type StairDef } from './stairs';
import { planDrag, type DragEnv, type DragPlan } from './dragplan';

export type MonState = 'patrol' | 'watch' | 'investigate' | 'chase' | 'search' | 'catch' | 'drag';
/** Urutan = nomor di snapshot jaringan: JANGAN diubah, hanya tambah di akhir ('drag' = TAHAP 2, menyeret korban). */
export const MON_STATES: MonState[] = ['patrol', 'watch', 'investigate', 'chase', 'search', 'catch', 'drag'];
export type MonAnim = 'idle' | 'walk' | 'run' | 'grab' | 'drag';
/** caught = pemain sedang dalam state tertangkap (jumpscare / diseret / menunggu bangun): tidak boleh ditangkap lagi sampai state itu selesai. */
export interface PlayerObs { id: string; x: number; z: number; level: number; gait: string; crouch: boolean; hidden: boolean; grace: number; stairs?: boolean; caught?: boolean }
/** Dunia: dipanggil saat monster terhalang pintu. true = ada pintu di depan yang dibuka / sedang membuka (monster menunggu sebentar). */
export interface MonsterEnv { openDoorNear(x: number, z: number, level: number, dx: number, dz: number): boolean }
export type MonEvent = { type: 'catch'; id: string; drag?: boolean } | { type: 'state'; from: MonState; to: MonState } | { type: 'drag'; phase: 'start' | 'arrive' | 'abort'; id: string; x: number; z: number };
export interface MonSnap { x: number; z: number; yaw: number; state: MonState; targetId: string; wp: number; lv: number; os: number }
/** Dua lantai: navigasi lantai bawah + tangga. Tanpa ini monster hanya patroli di lantai atas (perilaku lama). */
export interface MonsterMulti { navLo: MonsterNav; stair: StairDef }
/** Tinggi lantai di bawah monster (dipakai tampilan 3D & suara langkah): lantai level, atau tinggi anak tangga saat di tangga. */
export function monsterFloorY(S: StairDef | null, level: number, onStairs: boolean, x: number): number {
  return S && onStairs ? stairHeight(S, stairU(S, x)) : (CFG.LEVEL_Y[level] ?? 0);
}
const MOUTH = 0.6;   // jarak titik 'mulut' tangga dari ujung tangga (sama dengan world.stairTop)

/** Pintu terdekat di depan arah gerak (jarak <= maxD): dipakai dunia & test agar monster membuka pintu yang benar-benar menghalangi, bukan pintu tetangga. */
export function doorAhead<T extends { cx: number; cz: number }>(doors: readonly T[], x: number, z: number, dx: number, dz: number, maxD = 1.6): T | null {
  let best: T | null = null, bd = maxD;
  for (const d of doors) { const ox = d.cx - x, oz = d.cz - z, dist = Math.hypot(ox, oz); if (dist < bd && ox * dx + oz * dz > -0.3 * dist) { bd = dist; best = d; } }
  return best;
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class MonsterSim {
  x = 0; z = 0; yaw = 0; state: MonState = 'patrol'; targetId = ''; speed = 0;
  level: number; onStairs = false; lastSeenLv: number; readonly topLevel: number; readonly wpLv: number[] = [];
  get enabled(): boolean { return this.waypoints.length > 0; }
  readonly rng: Rng; readonly waypoints: Pt[] = []; wp = 0;
  lastSeen: Pt | null = null;
  private path: Pt[] = []; private pi = 0; private repathT = 0; private timer = 0; private lostT = 0; private stuckT = 0; private clock = 0; private baseYaw = 0; private goal: Pt | null = null; private climbDir = 0;
  private dragPlan: DragPlan | null = null; private dragGoal: Pt | null = null;   // rencana seret (dipilih saat menangkap) & tujuan yang sedang dituju
  private noCross = 0;   // sampai kapan tidak menuju waypoint di lantai lain (tangga tak terjangkau dari sini)
  private bad = new Map<number, number>();   // waypoint yang gagal dijangkau -> sampai kapan dihindari

  constructor(readonly nav: MonsterNav, readonly cw: CollisionWorld, level: number, seed: number, readonly env: MonsterEnv, awayFrom?: Pt, readonly multi?: MonsterMulti, readonly drag?: DragEnv) {
    this.level = level; this.topLevel = level; this.lastSeenLv = level;
    this.rng = makeRng((seed ^ 0x6d6f6e) >>> 0);
    if (this.nav.count === 0) return; // lantai tidak terjangkau dari titik awal: monster dinonaktifkan (enabled = false)
    const up: Pt[] = [];
    for (let tries = 0; tries < 800 && up.length < 12; tries++) {
      const p = this.nav.randomPoint(this.rng);
      if (up.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 7)) up.push(p);
    }
    // urutan kunjungan: tetangga terdekat mulai dari titik terjauh dari 'awayFrom' (mis. ujung tangga) supaya pemain tidak langsung bertemu monster
    const orderFrom = (pts: Pt[], first: number): Pt[] => {
      const left = pts.map((_, i) => i).filter((i) => i !== first), order = [first];
      while (left.length) { const c = pts[order[order.length - 1]]; left.sort((a, b) => Math.hypot(pts[a].x - c.x, pts[a].z - c.z) - Math.hypot(pts[b].x - c.x, pts[b].z - c.z)); order.push(left.shift()!); }
      return order.map((i) => pts[i]);
    };
    let cur = 0; if (awayFrom) { let bd = -1; up.forEach((p, i) => { const d = Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z); if (d > bd) { bd = d; cur = i; } }); }
    for (const p of orderFrom(up, cur)) { this.waypoints.push(p); this.wpLv.push(level); }
    // lantai bawah: setelah selesai keliling lantai atas, monster turun lewat tangga dan keliling lantai bawah, lalu naik lagi
    if (this.multi && this.multi.navLo.count > 0) {
      const lo: Pt[] = [], nl = this.multi.navLo;
      for (let tries = 0; tries < 800 && lo.length < 12; tries++) {
        const p = nl.randomPoint(this.rng);
        if (lo.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 7)) lo.push(p);
      }
      if (lo.length) {
        const m = this.mouth(0); let near = 0, bd = 1e9; lo.forEach((p, i) => { const d = Math.hypot(p.x - m.x, p.z - m.z); if (d < bd) { bd = d; near = i; } });
        for (const p of orderFrom(lo, near)) { this.waypoints.push(p); this.wpLv.push(0); }
      }
    }
    this.x = this.waypoints[0].x; this.z = this.waypoints[0].z; this.wp = this.waypoints.length > 1 ? 1 : 0; this.yaw = this.baseYaw = this.rng.range(-Math.PI, Math.PI);
  }
  /** Mulut tangga di lantai itu (titik datar tepat di luar ujung tangga). */
  private mouth(level: number): Pt { const S = this.multi!.stair; return level === this.topLevel ? { x: S.bx + S.sgn * (S.run + MOUTH), z: S.zc } : { x: S.bx - S.sgn * MOUTH, z: S.zc }; }
  private navOf(level: number): MonsterNav { return this.multi && level !== this.topLevel ? this.multi.navLo : this.nav; }
  /** Tinggi lantai di bawah monster. */
  get y(): number { return monsterFloorY(this.multi ? this.multi.stair : null, this.level, this.onStairs, this.x); }

  get anim(): MonAnim { return this.state === 'catch' ? 'grab' : this.state === 'drag' ? 'drag' : this.speed > 2.4 ? 'run' : this.speed > 0.3 ? 'walk' : 'idle'; }
  snapshot(): MonSnap { return { x: this.x, z: this.z, yaw: this.yaw, state: this.state, targetId: this.targetId, wp: this.wp, lv: this.level, os: this.onStairs ? 1 : 0 }; }
  /** Dipakai otoritas baru (host berpindah): lanjut dari posisi snapshot terakhir sebagai patroli. */
  restore(s: { x: number; z: number; yaw: number; wp?: number; lv?: number; os?: number }) {
    let lv = this.multi && (s.lv === 0 || s.lv === this.topLevel) ? s.lv : this.topLevel, px = s.x, pz = s.z;
    if (this.multi && s.os) { lv = stairU(this.multi.stair, s.x) < this.multi.stair.run / 2 ? 0 : this.topLevel; const m = this.mouth(lv); px = m.x; pz = m.z; }   // sedang di tangga: lanjut dari mulut terdekat
    this.level = lv; this.onStairs = false; this.climbDir = 0; this.dragPlan = null; this.dragGoal = null;
    const p = this.navOf(lv).snap(px, pz, 4); this.x = p ? p.x : px; this.z = p ? p.z : pz; this.yaw = s.yaw; this.state = 'patrol'; this.targetId = ''; this.speed = 0; this.path = []; this.goal = null; this.lastSeen = null; this.timer = 0;
    if (s.wp !== undefined && s.wp >= 0 && s.wp < this.waypoints.length) this.wp = s.wp; else this.nearestWp();
  }
  private nearestWp() { let b = 0, bd = 1e9; this.waypoints.forEach((p, i) => { const d = Math.hypot(p.x - this.x, p.z - this.z) + (this.wpLv[i] !== this.level ? 1e4 : 0); if (d < bd) { bd = d; b = i; } }); this.wp = b; }
  private set(s: MonState, ev: MonEvent[]) { if (s !== this.state) { ev.push({ type: 'state', from: this.state, to: s }); this.state = s; this.path = []; this.goal = null; this.stuckT = 0; this.repathT = 0; } }

  /** Syarat tangkap: garis monster->pemain bebas dinding DAN furniture/pintu (tidak boleh menangkap tembus benda). */
  private catchLos(px: number, pz: number): boolean { return this.los(px, pz) && (this.onStairs || !this.cw.obbSegmentBlocked(this.x, this.z, px, pz, this.level, 0.02)); }
  private los(px: number, pz: number): boolean { if (this.onStairs) return true; return !this.cw.segmentBlocked(this.x, this.z, px, pz, this.level, 0.02); }
  /** Pemain di lantai yang sama (atau sama-sama di tangga), tidak bersembunyi, tidak kebal. */
  private eligible(p: PlayerObs) { return (this.onStairs ? !!p.stairs : p.level === this.level) && !p.hidden && p.grace <= 0 && !p.caught; }
  /** 'seen' (pandangan/terasa), 'heard' (suara), atau null. */
  private perceive(p: PlayerObs): 'seen' | 'heard' | null {
    if (p.hidden || p.grace > 0 || p.caught) return null;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const hr = p.gait === 'run' ? CFG.MONSTER_HEAR_RUN : p.crouch ? CFG.MONSTER_HEAR_CROUCH : p.gait === 'walk' ? CFG.MONSTER_HEAR_WALK : 0;
    if (!this.eligible(p)) {
      // beda lantai: suara menembus lantai (jarak lebih pendek) -> monster mendatangi lewat tangga
      return this.multi && !this.onStairs && hr > 0 && d <= hr * 0.6 ? 'heard' : null;
    }
    if (d <= CFG.MONSTER_SIGHT_RANGE) {
      const inFov = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw)) <= (CFG.MONSTER_FOV_DEG * Math.PI) / 360;
      if ((d <= CFG.MONSTER_SENSE_RADIUS || inFov || this.state === 'chase') && this.los(p.x, p.z)) return 'seen';
    }
    if (hr > 0 && d <= (this.los(p.x, p.z) ? hr : hr * 0.5)) return 'heard';
    return null;
  }

  update(dt: number, players: PlayerObs[]): MonEvent[] {
    const ev: MonEvent[] = []; if (!this.enabled) return ev; this.clock += dt;
    if (this.state === 'catch') { this.speed = 0; if ((this.timer -= dt) <= 0) { if (this.dragPlan) this.beginDrag(ev); else this.relocate(players, ev); } return ev; }
    if (this.state === 'drag') { this.runDrag(dt, ev); return ev; }   // fokus menyeret: tidak menanggapi pemain lain sampai selesai
    let seenP: PlayerObs | null = null, seenD = 1e9, heardP: PlayerObs | null = null, heardD = 1e9;
    for (const p of players) { const k = this.perceive(p); if (!k) continue; const d = Math.hypot(p.x - this.x, p.z - this.z); if (k === 'seen' && d < seenD) { seenP = p; seenD = d; } else if (k === 'heard' && d < heardD) { heardP = p; heardD = d; } }
    if (this.state === 'chase') {
      const cur = players.find((p) => p.id === this.targetId) || null, curK = cur ? this.perceive(cur) : null;
      if (seenP && (!cur || curK !== 'seen' || seenD < Math.hypot(cur.x - this.x, cur.z - this.z) * 0.7)) { this.targetId = seenP.id; this.lastSeen = { x: seenP.x, z: seenP.z }; this.lastSeenLv = seenP.level; this.lostT = 0; }
      else if (cur && curK) { this.lastSeen = { x: cur.x, z: cur.z }; this.lastSeenLv = cur.level; this.lostT = 0; }
      else if (cur && this.multi && !this.onStairs && !cur.hidden && cur.grace <= 0 && cur.level !== this.level) { this.lastSeen = { x: cur.x, z: cur.z }; this.lastSeenLv = cur.level; this.lostT += dt * 0.25; }   // target pindah lantai: ikuti lewat tangga (kehilangan jejak lebih lambat)
      else this.lostT += dt;
      if (this.lostT >= CFG.MONSTER_LOSE_TIME) { this.set('search', ev); this.timer = CFG.MONSTER_SEARCH_TIME; this.targetId = ''; }
    } else if (seenP) { this.set('chase', ev); this.targetId = seenP.id; this.lastSeen = { x: seenP.x, z: seenP.z }; this.lastSeenLv = seenP.level; this.lostT = 0; }
    else if (heardP && (this.state === 'patrol' || this.state === 'watch' || this.state === 'search')) { this.set('investigate', ev); this.lastSeen = { x: heardP.x, z: heardP.z }; this.lastSeenLv = heardP.level; }
    // tangkap (divalidasi di sini oleh otoritas: jarak + garis pandang + target sah)
    if (this.state === 'chase') for (const p of players) {
      if (!this.eligible(p)) continue; const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d <= CFG.MONSTER_CATCH_RADIUS && this.catchLos(p.x, p.z)) {
        this.set('catch', ev); this.targetId = p.id; this.speed = 0; this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
        // TAHAP 2: pilih tujuan seret SEKARANG (otoritas yang memutuskan). Tidak ada tujuan valid / di tangga / fitur mati -> perilaku lama (pindah & patroli).
        this.dragPlan = CFG.MONSTER_DRAG_ENABLED && this.drag && !this.onStairs ? planDrag(this.navOf(this.level), this.cw, this.drag, { x: this.x, z: this.z }, this.level, this.rng) : null;
        this.timer = this.dragPlan ? CFG.MONSTER_DRAG_START : CFG.MONSTER_RESET_TIME;
        ev.push({ type: 'catch', id: p.id, drag: !!this.dragPlan }); return ev;
      }
    }
    switch (this.state) {
      case 'patrol': this.goTo(dt, this.waypoints[this.wp], CFG.MONSTER_PATROL_SPEED, ev, () => { this.set('watch', ev); this.timer = this.rng.range(1.5, 3.5); this.baseYaw = this.yaw; }, false, this.wpLv[this.wp] ?? this.level); break;
      case 'watch': if (this.onStairs) { this.climb(dt, CFG.MONSTER_PATROL_SPEED); break; } this.speed = 0; this.yaw = this.baseYaw + Math.sin(this.clock * 1.1) * 0.9; if ((this.timer -= dt) <= 0) { this.wp = this.nextWp(); this.set('patrol', ev); } break;
      case 'investigate': this.goTo(dt, this.lastSeen, CFG.MONSTER_INVESTIGATE_SPEED, ev, () => { this.set('search', ev); this.timer = CFG.MONSTER_SEARCH_TIME * 0.6; this.baseYaw = this.yaw; }, false, this.lastSeenLv); break;
      case 'chase': this.goTo(dt, this.lastSeen, CFG.MONSTER_CHASE_SPEED, ev, () => { /* tiba di titik terakhir: tunggu sampai lostT habis -> search */ this.speed = 0; }, true, this.lastSeenLv); break;
      case 'search': if (this.onStairs) { this.climb(dt, CFG.MONSTER_PATROL_SPEED); break; } this.speed = 0; this.yaw = this.baseYaw + Math.sin(this.clock * 1.4) * 1.2; if ((this.timer -= dt) <= 0) { this.nearestWp(); this.set('patrol', ev); } break;
    }
    return ev;
  }
  private nextWp(): number { for (let k = 1; k <= this.waypoints.length; k++) { const i = (this.wp + k) % this.waypoints.length; if ((this.bad.get(i) ?? 0) <= this.clock && !(this.noCross > this.clock && (this.wpLv[i] ?? this.level) !== this.level)) return i; } return (this.wp + 1) % this.waypoints.length; }
  // ---- seret (TAHAP 2): jumpscare selesai -> monster berjalan ke tujuan (memakai goTo/nav/pintu yang sama dengan patroli) -> berhenti -> kembali patroli ----
  private beginDrag(ev: MonEvent[]) {
    const plan = this.dragPlan!; this.dragPlan = null;
    this.set('drag', ev); this.dragGoal = plan.goal; this.path = plan.path; this.pi = 0; this.goal = { x: plan.goal.x, z: plan.goal.z }; this.repathT = 1.5; this.timer = CFG.MONSTER_DRAG_MAX_SECONDS;
    ev.push({ type: 'drag', phase: 'start', id: this.targetId, x: this.x, z: this.z });
  }
  private runDrag(dt: number, ev: MonEvent[]) {
    if (!this.dragGoal || (this.timer -= dt) <= 0) { this.endDrag(ev, 'abort'); return; }
    this.goTo(dt, this.dragGoal, CFG.MONSTER_DRAG_SPEED, ev, () => this.endDrag(ev, 'arrive'), false, this.level);
  }
  /** Seretan selesai (sampai / terhalang / kehabisan waktu): korban dibiarkan di tempat, monster berhenti sebentar lalu kembali patroli dari waypoint terdekat. */
  private endDrag(ev: MonEvent[], phase: 'arrive' | 'abort') {
    if (this.state !== 'drag') return;
    ev.push({ type: 'drag', phase, id: this.targetId, x: this.x, z: this.z });
    this.dragGoal = null; this.targetId = ''; this.lastSeen = null; this.speed = 0; this.nearestWp();
    this.set('watch', ev); this.timer = this.rng.range(1.5, 3.5); this.baseYaw = this.yaw;   // 'watch' -> patroli (alur lama)
  }
  private relocate(players: PlayerObs[], ev: MonEvent[]) {
    // titik patroli terjauh dari semua pemain (beda lantai dihitung jauh)
    let b = 0, bd = -1; this.waypoints.forEach((p, i) => { const d = Math.min(...players.map((q) => Math.hypot(q.x - p.x, q.z - p.z) + (q.level !== (this.wpLv[i] ?? this.level) ? 25 : 0)), 1e9); if (d > bd) { bd = d; b = i; } });
    this.x = this.waypoints[b].x; this.z = this.waypoints[b].z; this.level = this.wpLv[b] ?? this.level; this.onStairs = false; this.climbDir = 0;
    this.wp = (b + 1) % this.waypoints.length; this.targetId = ''; this.lastSeen = null; this.speed = 0; this.set('patrol', ev);
  }
  /** Mulai menaiki/menuruni tangga dari mulutnya (dir: +1 naik, -1 turun). */
  private enterStairs(dir: number) {
    const S = this.multi!.stair, m = this.mouth(dir > 0 ? 0 : this.topLevel);
    this.onStairs = true; this.climbDir = dir; this.x = m.x; this.z = m.z; this.yaw = Math.atan2(S.sgn * dir, 0); this.path = []; this.goal = null; this.stuckT = 0; this.speed = 0;
  }
  private leaveStairs(level: number) { const m = this.mouth(level); this.x = m.x; this.z = m.z; this.level = level; this.onStairs = false; this.climbDir = 0; this.path = []; this.goal = null; this.stuckT = 0; this.repathT = 0; }
  /** Di tangga: maju lurus sepanjang tangga (tanpa collision grid), sedikit lebih lambat; sampai di ujung -> pindah lantai. */
  private climb(dt: number, speed: number) {
    const S = this.multi!.stair, sp = speed * STAIR_SPEED_MUL, u = stairU(S, this.x) + this.climbDir * sp * dt;
    this.speed = sp; this.x = S.bx + S.sgn * u; this.z = S.zc; this.yaw = Math.atan2(S.sgn * this.climbDir, 0);
    if (this.climbDir > 0 && u >= S.run + MOUTH) this.leaveStairs(this.topLevel);
    else if (this.climbDir < 0 && u <= -MOUTH) this.leaveStairs(0);
  }
  private goTo(dt: number, goal0: Pt | null, speed: number, ev: MonEvent[], onArrive: () => void, chase = false, goalLv = this.level) {
    if (this.onStairs) { this.climb(dt, speed); return; }
    if (!goal0) { this.speed = 0; return; }
    let goal = goal0;
    if (this.multi && goalLv !== this.level) {            // tujuan di lantai lain: menuju mulut tangga lalu naik/turun
      goal = this.mouth(this.level); const dm = Math.hypot(goal.x - this.x, goal.z - this.z);
      if (dm < 0.6 || (dm < 1.6 && this.path.length && this.pi >= this.path.length)) { this.enterStairs(this.level === this.topLevel ? -1 : 1); return; }
    } else if (Math.hypot(goal.x - this.x, goal.z - this.z) < (chase ? 0.5 : 0.7)) { onArrive(); return; }
    if (!this.path.length || this.pi >= this.path.length || (this.repathT -= dt) <= 0 || !this.goal || Math.hypot(this.goal.x - goal.x, this.goal.z - goal.z) > 0.8) {
      this.repathT = chase ? 0.35 : 1.5; this.goal = { x: goal.x, z: goal.z }; const p = this.navOf(this.level).path(this.x, this.z, goal.x, goal.z);
      if (!p) { this.unreachable(ev); return; } this.path = p; this.pi = 0;
    }
    const t = this.path[this.pi], dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
    if (d < (this.pi < this.path.length - 1 ? 0.12 : 0.25)) { this.pi++; return; }   // sudut jalur (celah pintu) dilewati tepat di titiknya, bukan dipotong
    const want = Math.atan2(dx, dz), turn = (chase ? 9 : 5) * dt, diff = wrap(want - this.yaw); this.yaw += Math.abs(diff) <= turn ? diff : Math.sign(diff) * turn;
    const aligned = Math.abs(wrap(want - this.yaw)) < 0.9, sp = aligned ? speed : speed * 0.3, step = Math.min(sp * dt, d), ux = dx / d, uz = dz / d, R = CFG.MONSTER_RADIUS;
    const ox = this.x, oz = this.z;
    if (this.cw.blocked(ox, oz, R, this.level)) { const f = this.cw.freePoint(ox, oz, R, this.level, 1.5); if (f) { this.x = f.x; this.z = f.z; } }   // terjepit di collider (furnitur/pintu bergeser): dorong keluar
    else this.cw.slide(this, ux * step, uz * step, R, this.level);   // sweep per sub-langkah + slide di permukaan
    const moved = Math.hypot(this.x - ox, this.z - oz); this.speed = moved / Math.max(dt, 1e-6);
    if (moved < step * 0.25) {
      this.stuckT += dt;
      if (this.stuckT > 0.3) { if (this.env.openDoorNear(this.x, this.z, this.level, ux, uz)) this.stuckT = -1.0; /* tunggu pintu terbuka */ }
      if (this.stuckT > 1.2 && this.stuckT - dt <= 1.2) { this.path = []; this.repathT = 0; const f = this.cw.freePoint(this.x, this.z, R + 0.05, this.level, 0.6); if (f) { this.x = f.x; this.z = f.z; } }   // macet: repath + nudge
      if (this.stuckT > 2.2) this.unreachable(ev);
    } else if (this.stuckT > 0) this.stuckT = 0;
  }
  /** Tujuan tidak terjangkau (pintu terkunci / jalur buntu): hindari titik itu sebentar lalu lanjut. */
  private unreachable(ev: MonEvent[]) {
    this.stuckT = 0; this.path = []; this.goal = null;
    if (this.state === 'patrol') {
      if (this.multi && (this.wpLv[this.wp] ?? this.level) !== this.level) this.noCross = this.clock + 45;   // jalan ke tangga buntu: keliling lantai ini dulu, coba lagi nanti
      else this.bad.set(this.wp, this.clock + 60);
      this.wp = this.nextWp();
    }
    else if (this.state === 'chase') this.lostT = CFG.MONSTER_LOSE_TIME;
    else if (this.state === 'drag') this.endDrag(ev, 'abort');   // jalur terblokir (pintu terkunci / furnitur bergeser): berhenti di tempat
    else { this.set('search', ev); this.timer = 2; this.baseYaw = this.yaw; }
  }
}
