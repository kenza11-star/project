"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonsterSim = exports.MON_STATES = void 0;
exports.doorAhead = doorAhead;
// Simulasi monster (otoritatif, tanpa three/DOM): patroli -> deteksi -> kejar -> cari -> kembali patroli, dan penangkapan.
// Dijalankan HANYA oleh klien otoritas (single-player: lokal; multiplayer: pemain slot terendah yang online, lihat monsterctl.ts).
// Semua klien lain hanya menerima snapshot. Deterministik per seed (rng sendiri) dan dites dengan GLB asli.
const CFG = __importStar(require("./config"));
const rng_1 = require("./rng");
exports.MON_STATES = ['patrol', 'watch', 'investigate', 'chase', 'search', 'catch'];
/** Pintu terdekat di depan arah gerak (jarak <= maxD): dipakai dunia & test agar monster membuka pintu yang benar-benar menghalangi, bukan pintu tetangga. */
function doorAhead(doors, x, z, dx, dz, maxD = 1.6) {
    let best = null, bd = maxD;
    for (const d of doors) {
        const ox = d.cx - x, oz = d.cz - z, dist = Math.hypot(ox, oz);
        if (dist < bd && ox * dx + oz * dz > -0.3 * dist) {
            bd = dist;
            best = d;
        }
    }
    return best;
}
const wrap = (a) => { while (a > Math.PI)
    a -= 2 * Math.PI; while (a < -Math.PI)
    a += 2 * Math.PI; return a; };
class MonsterSim {
    get enabled() { return this.waypoints.length > 0; }
    constructor(nav, cw, level, seed, env, awayFrom) {
        this.nav = nav;
        this.cw = cw;
        this.level = level;
        this.env = env;
        this.x = 0;
        this.z = 0;
        this.yaw = 0;
        this.state = 'patrol';
        this.targetId = '';
        this.speed = 0;
        this.waypoints = [];
        this.wp = 0;
        this.lastSeen = null;
        this.path = [];
        this.pi = 0;
        this.repathT = 0;
        this.timer = 0;
        this.lostT = 0;
        this.stuckT = 0;
        this.clock = 0;
        this.baseYaw = 0;
        this.goal = null;
        this.bad = new Map(); // waypoint yang gagal dijangkau -> sampai kapan dihindari
        this.rng = (0, rng_1.makeRng)((seed ^ 0x6d6f6e) >>> 0);
        if (this.nav.count === 0)
            return; // lantai tidak terjangkau dari titik awal: monster dinonaktifkan (enabled = false)
        for (let tries = 0; tries < 800 && this.waypoints.length < 12; tries++) {
            const p = this.nav.randomPoint(this.rng);
            if (this.waypoints.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 7))
                this.waypoints.push(p);
        }
        // urutan kunjungan: tetangga terdekat mulai dari titik terjauh dari 'awayFrom' (mis. ujung tangga) supaya pemain tidak langsung bertemu monster
        let cur = 0;
        if (awayFrom) {
            let bd = -1;
            this.waypoints.forEach((p, i) => { const d = Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z); if (d > bd) {
                bd = d;
                cur = i;
            } });
        }
        const left = this.waypoints.map((p, i) => i).filter((i) => i !== cur), order = [cur];
        while (left.length) {
            const c = this.waypoints[order[order.length - 1]];
            left.sort((a, b) => Math.hypot(this.waypoints[a].x - c.x, this.waypoints[a].z - c.z) - Math.hypot(this.waypoints[b].x - c.x, this.waypoints[b].z - c.z));
            order.push(left.shift());
        }
        const wps = order.map((i) => this.waypoints[i]);
        this.waypoints.length = 0;
        this.waypoints.push(...wps);
        this.x = this.waypoints[0].x;
        this.z = this.waypoints[0].z;
        this.wp = this.waypoints.length > 1 ? 1 : 0;
        this.yaw = this.baseYaw = this.rng.range(-Math.PI, Math.PI);
    }
    get anim() { return this.state === 'catch' ? 'grab' : this.speed > 2.4 ? 'run' : this.speed > 0.3 ? 'walk' : 'idle'; }
    snapshot() { return { x: this.x, z: this.z, yaw: this.yaw, state: this.state, targetId: this.targetId, wp: this.wp }; }
    /** Dipakai otoritas baru (host berpindah): lanjut dari posisi snapshot terakhir sebagai patroli. */
    restore(s) {
        const p = this.nav.snap(s.x, s.z, 4);
        this.x = p ? p.x : s.x;
        this.z = p ? p.z : s.z;
        this.yaw = s.yaw;
        this.state = 'patrol';
        this.targetId = '';
        this.speed = 0;
        this.path = [];
        this.goal = null;
        this.lastSeen = null;
        this.timer = 0;
        if (s.wp !== undefined && s.wp >= 0 && s.wp < this.waypoints.length)
            this.wp = s.wp;
        else
            this.nearestWp();
    }
    nearestWp() { let b = 0, bd = 1e9; this.waypoints.forEach((p, i) => { const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < bd) {
        bd = d;
        b = i;
    } }); this.wp = b; }
    set(s, ev) { if (s !== this.state) {
        ev.push({ type: 'state', from: this.state, to: s });
        this.state = s;
        this.path = [];
        this.goal = null;
        this.stuckT = 0;
        this.repathT = 0;
    } }
    los(px, pz) { return !this.cw.segmentBlocked(this.x, this.z, px, pz, this.level, 0.02); }
    eligible(p) { return p.level === this.level && !p.hidden && p.grace <= 0; }
    /** 'seen' (pandangan/terasa), 'heard' (suara), atau null. */
    perceive(p) {
        if (!this.eligible(p))
            return null;
        const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
        if (d <= CFG.MONSTER_SIGHT_RANGE) {
            const inFov = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw)) <= (CFG.MONSTER_FOV_DEG * Math.PI) / 360;
            if ((d <= CFG.MONSTER_SENSE_RADIUS || inFov || this.state === 'chase') && this.los(p.x, p.z))
                return 'seen';
        }
        const hr = p.gait === 'run' ? CFG.MONSTER_HEAR_RUN : p.crouch ? CFG.MONSTER_HEAR_CROUCH : p.gait === 'walk' ? CFG.MONSTER_HEAR_WALK : 0;
        if (hr > 0 && d <= (this.los(p.x, p.z) ? hr : hr * 0.5))
            return 'heard';
        return null;
    }
    update(dt, players) {
        const ev = [];
        if (!this.enabled)
            return ev;
        this.clock += dt;
        if (this.state === 'catch') {
            this.speed = 0;
            if ((this.timer -= dt) <= 0)
                this.relocate(players, ev);
            return ev;
        }
        let seenP = null, seenD = 1e9, heardP = null, heardD = 1e9;
        for (const p of players) {
            const k = this.perceive(p);
            if (!k)
                continue;
            const d = Math.hypot(p.x - this.x, p.z - this.z);
            if (k === 'seen' && d < seenD) {
                seenP = p;
                seenD = d;
            }
            else if (k === 'heard' && d < heardD) {
                heardP = p;
                heardD = d;
            }
        }
        if (this.state === 'chase') {
            const cur = players.find((p) => p.id === this.targetId) || null, curK = cur ? this.perceive(cur) : null;
            if (seenP && (!cur || curK !== 'seen' || seenD < Math.hypot(cur.x - this.x, cur.z - this.z) * 0.7)) {
                this.targetId = seenP.id;
                this.lastSeen = { x: seenP.x, z: seenP.z };
                this.lostT = 0;
            }
            else if (cur && curK) {
                this.lastSeen = { x: cur.x, z: cur.z };
                this.lostT = 0;
            }
            else
                this.lostT += dt;
            if (this.lostT >= CFG.MONSTER_LOSE_TIME) {
                this.set('search', ev);
                this.timer = CFG.MONSTER_SEARCH_TIME;
                this.targetId = '';
            }
        }
        else if (seenP) {
            this.set('chase', ev);
            this.targetId = seenP.id;
            this.lastSeen = { x: seenP.x, z: seenP.z };
            this.lostT = 0;
        }
        else if (heardP && (this.state === 'patrol' || this.state === 'watch' || this.state === 'search')) {
            this.set('investigate', ev);
            this.lastSeen = { x: heardP.x, z: heardP.z };
        }
        // tangkap (divalidasi di sini oleh otoritas: jarak + garis pandang + target sah)
        if (this.state === 'chase')
            for (const p of players) {
                if (!this.eligible(p))
                    continue;
                const d = Math.hypot(p.x - this.x, p.z - this.z);
                if (d <= CFG.MONSTER_CATCH_RADIUS && this.los(p.x, p.z)) {
                    this.set('catch', ev);
                    this.targetId = p.id;
                    this.timer = CFG.MONSTER_RESET_TIME;
                    this.speed = 0;
                    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
                    ev.push({ type: 'catch', id: p.id });
                    return ev;
                }
            }
        switch (this.state) {
            case 'patrol':
                this.goTo(dt, this.waypoints[this.wp], CFG.MONSTER_PATROL_SPEED, ev, () => { this.set('watch', ev); this.timer = this.rng.range(1.5, 3.5); this.baseYaw = this.yaw; });
                break;
            case 'watch':
                this.speed = 0;
                this.yaw = this.baseYaw + Math.sin(this.clock * 1.1) * 0.9;
                if ((this.timer -= dt) <= 0) {
                    this.wp = this.nextWp();
                    this.set('patrol', ev);
                }
                break;
            case 'investigate':
                this.goTo(dt, this.lastSeen, CFG.MONSTER_INVESTIGATE_SPEED, ev, () => { this.set('search', ev); this.timer = CFG.MONSTER_SEARCH_TIME * 0.6; this.baseYaw = this.yaw; });
                break;
            case 'chase':
                this.goTo(dt, this.lastSeen, CFG.MONSTER_CHASE_SPEED, ev, () => { /* tiba di titik terakhir: tunggu sampai lostT habis -> search */ this.speed = 0; }, true);
                break;
            case 'search':
                this.speed = 0;
                this.yaw = this.baseYaw + Math.sin(this.clock * 1.4) * 1.2;
                if ((this.timer -= dt) <= 0) {
                    this.nearestWp();
                    this.set('patrol', ev);
                }
                break;
        }
        return ev;
    }
    nextWp() { for (let k = 1; k <= this.waypoints.length; k++) {
        const i = (this.wp + k) % this.waypoints.length;
        if ((this.bad.get(i) ?? 0) <= this.clock)
            return i;
    } return (this.wp + 1) % this.waypoints.length; }
    relocate(players, ev) {
        let b = 0, bd = -1;
        this.waypoints.forEach((p, i) => { const d = Math.min(...players.map((q) => Math.hypot(q.x - p.x, q.z - p.z)), 1e9); if (d > bd) {
            bd = d;
            b = i;
        } });
        this.x = this.waypoints[b].x;
        this.z = this.waypoints[b].z;
        this.wp = (b + 1) % this.waypoints.length;
        this.targetId = '';
        this.lastSeen = null;
        this.speed = 0;
        this.set('patrol', ev);
    }
    goTo(dt, goal, speed, ev, onArrive, chase = false) {
        if (!goal) {
            this.speed = 0;
            return;
        }
        if (Math.hypot(goal.x - this.x, goal.z - this.z) < (chase ? 0.5 : 0.7)) {
            onArrive();
            return;
        }
        if (!this.path.length || this.pi >= this.path.length || (this.repathT -= dt) <= 0 || !this.goal || Math.hypot(this.goal.x - goal.x, this.goal.z - goal.z) > 0.8) {
            this.repathT = chase ? 0.35 : 1.5;
            this.goal = { x: goal.x, z: goal.z };
            const p = this.nav.path(this.x, this.z, goal.x, goal.z);
            if (!p) {
                this.unreachable(ev);
                return;
            }
            this.path = p;
            this.pi = 0;
        }
        const t = this.path[this.pi], dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
        if (d < 0.25) {
            this.pi++;
            return;
        }
        const want = Math.atan2(dx, dz), turn = (chase ? 9 : 5) * dt, diff = wrap(want - this.yaw);
        this.yaw += Math.abs(diff) <= turn ? diff : Math.sign(diff) * turn;
        const aligned = Math.abs(wrap(want - this.yaw)) < 0.9, sp = aligned ? speed : speed * 0.3, step = Math.min(sp * dt, d), ux = dx / d, uz = dz / d, R = CFG.MONSTER_RADIUS;
        const ox = this.x, oz = this.z;
        let nx = ox + ux * step, nz = oz + uz * step;
        if (!this.cw.blocked(nx, nz, R, this.level)) {
            this.x = nx;
            this.z = nz;
        }
        else if (!this.cw.blocked(nx, oz, R, this.level))
            this.x = nx;
        else if (!this.cw.blocked(ox, nz, R, this.level))
            this.z = nz;
        const moved = Math.hypot(this.x - ox, this.z - oz);
        this.speed = moved / Math.max(dt, 1e-6);
        if (moved < step * 0.25) {
            this.stuckT += dt;
            if (this.stuckT > 0.3) {
                if (this.env.openDoorNear(this.x, this.z, this.level, ux, uz))
                    this.stuckT = -1.0; /* tunggu pintu terbuka */
            }
            if (this.stuckT > 2.2)
                this.unreachable(ev);
        }
        else if (this.stuckT > 0)
            this.stuckT = 0;
    }
    /** Tujuan tidak terjangkau (pintu terkunci / jalur buntu): hindari titik itu sebentar lalu lanjut. */
    unreachable(ev) {
        this.stuckT = 0;
        this.path = [];
        this.goal = null;
        if (this.state === 'patrol') {
            this.bad.set(this.wp, this.clock + 60);
            this.wp = this.nextWp();
        }
        else if (this.state === 'chase')
            this.lostT = CFG.MONSTER_LOSE_TIME;
        else {
            this.set('search', ev);
            this.timer = 2;
            this.baseYaw = this.yaw;
        }
    }
}
exports.MonsterSim = MonsterSim;
