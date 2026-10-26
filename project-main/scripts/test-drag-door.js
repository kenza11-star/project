// Uji regresi: monster menyeret korban melewati pintu tertutup tidak boleh membeku menunggu pintu.
// Meniru World.stepDoor + monsterGateDoor/monsterOpenDoor dengan pintu & GLB asli; korban = titik jejak 1,4 m di belakang monster (seperti PlayScene).
// Argumen 'old' = perilaku lama (korban yang diseret ikut menahan daun pintu).
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const D = require(G + '/door.js');
const { DragTrail } = require(G + '/dragplan.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const { cw, md } = buildWorld();
const S = md.stair, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, LV = CFG.MONSTER_LEVEL;
const nav = new MonsterNav(cw, LV, md.colliders.filter((c) => c.obb.level === LV).map((c) => c.obb), top);
const R = CFG.MONSTER_RADIUS, DT = 1 / 30, FIXED = process.argv[2] !== 'old';

function mkDoors(victimRef) {
  const rts = md.doors.filter((d) => d.level === LV).map((d) => {
    const leaf = { hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: d.closedObb.hx };
    return { d, leaf, vis: { ...leaf, half: 0.04 }, obb: cw.obbs.find((o) => o.id === 'door:' + d.name), t: 0, target: 0, pend: false };
  });
  // = World.stepDoor (bagian sapuan daun). `dragged` = pemain yang sedang diseret monster.
  const step = (rt, dt, mon, victim, dragged) => {
    if (rt.t !== rt.target) {
      const base = rt.d.openTime || 0.7, rate = dt / (rt.target ? base * CFG.DOOR_OPEN_SLOW : base * CFG.DOOR_CLOSE_SCALE);
      const nt = rt.target ? Math.min(1, rt.t + rate) : Math.max(0, rt.t - rate);
      const hitMon = !rt.target && D.sweepHitsPlayer(rt.vis, D.ease(rt.t), D.ease(nt), mon.x, mon.z, R + 0.02);
      const hitPl = !(FIXED && dragged) && D.sweepHitsPlayer(rt.vis, D.ease(rt.t), D.ease(nt), victim.x, victim.z, CFG.PLAYER_RADIUS + 0.02);
      if (!hitPl && !hitMon) rt.t = nt;
    }
    const a = D.ease(rt.t); D.applyPose(rt.obb, rt.leaf, a);
    if (!rt.obb.enabled) { const inside = cw.constructor.distToObb(rt.obb, mon.x, mon.z) < R + 0.03; rt.pend = inside; if (!inside) rt.obb.enabled = true; }
  };
  const env = {
    openDoorNear(x, z, level, dx, dz) { const cand = rts.filter((r) => r.d.level === level && r.t < 0.98), hit = doorAhead(cand.map((r) => r.d), x, z, dx, dz, 1.6); if (!hit) return false; const rt = cand.find((r) => r.d === hit); if (rt.d.locked) return false; rt.target = 1; return true; },
    gateDoor(x, z, level, dx, dz) {
      const RR = R + 0.12;
      for (const rt of rts) { if (rt.d.level !== level || rt.t >= 0.98) continue; let hit = false;
        for (const s of [0.2, 0.5, 0.85, 1.3]) { const px = x + dx * s, pz = z + dz * s; if (D.leafDist(rt.leaf, 0, px, pz) < RR || D.leafDist(rt.leaf, D.ease(rt.t), px, pz) < RR) { hit = true; break; } }
        if (!hit) continue; if (rt.d.locked) return false; if (rt.target === 0) rt.target = 1; return true; }
      return false;
    },
    // = World.monsterDoorBackoff (argumen 'nobo' = tanpa perbaikan)
    doorBackoff(x, z, level, dx, dz) {
      if (process.argv[2] === 'nobo') return null;
      const cand = rts.filter((r) => r.d.level === level && r.t < 0.98 && !r.d.locked), hit = doorAhead(cand.map((r) => r.d), x, z, dx, dz, 1.9); if (!hit) return null;
      const rt = cand.find((r) => r.d === hit), g = rt.leaf, nx = Math.cos(g.yaw), nz = -Math.sin(g.yaw), lx = Math.sin(g.yaw), lz = Math.cos(g.yaw);
      const rx = x - g.hingeX, rz = z - g.hingeZ, perp = rx * nx + rz * nz, along = rx * lx + rz * lz, side = Math.sign(perp), sw = Math.sign(Math.sin(g.openRad));
      if (!side || side !== sw || along < -R || along > g.len + R) return null;
      if ((dx * nx + dz * nz) * side > -0.55 || Math.abs(perp) > 1.9) return null;
      const need = g.len + R + 0.2 - Math.abs(perp); if (need <= 0) return null;
      if (rt.target === 0) rt.target = 1;
      return { bx: nx * side, bz: nz * side, dist: need };
    },
  };
  const restore = () => { for (const r of rts) { r.t = 0; r.target = 0; r.pend = false; r.obb.enabled = true; D.applyPose(r.obb, r.leaf, 0); } };
  return { rts, env, step, restore };
}

let embedded = 0, tested = 0, arrived = 0, worstStall = 0, stalled = []; const bad = [];
for (const door of md.doors.filter((q) => q.level === LV && !q.locked)) for (const [dist, sgn] of [[3.4, 1], [3.4, -1], [2.2, 1], [2.2, -1], [1.6, 1], [1.6, -1], [1.2, 1], [1.2, -1], [0.9, 1], [0.9, -1]]) {
  const A = nav.snap(door.cx - sgn * door.nx * dist, door.cz - sgn * door.nz * dist, 1), B = nav.snap(door.cx + sgn * door.nx * dist, door.cz + sgn * door.nz * dist, 1);
  const P = A && B ? nav.path(A.x, A.z, B.x, B.z) : null;
  let len = 0; if (P) { let px = A.x, pz = A.z; for (const q of P) { len += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; } }
  if (!P || len > 2 * dist + 2.5) continue; tested++;   // hanya pasangan titik yang benar-benar menembus pintu ini (snap nav bisa melompat / rute memutar)   // titik harus benar-benar di dua sisi pintu (snap nav bisa melompat jauh)
  const W = mkDoors(), s = new MonsterSim(nav, cw, LV, 5, W.env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z);
  s.state = 'drag'; s.dragGoal = { x: B.x, z: B.z }; s.timer = 90; s.targetId = 'p';
  const trail = new DragTrail(); trail.seed(A.x, A.z); const victim = { x: A.x, z: A.z };
  let stall = 0, worst = 0, done = false;
  for (let i = 0; i < 30 * 60 && !done; i++) {
    const b = trail.behind(); if (b) { victim.x = b.x; victim.z = b.z; }
    W.rts.forEach((r) => { if (r.t !== r.target || r.pend) W.step(r, DT, s, victim, true); });
    const ox = s.x, oz = s.z; const ev = s.update(DT, []); trail.push(s.x, s.z); if (cw.blocked(s.x, s.z, R * 0.9, LV)) embedded += DT;
    if (Math.hypot(s.x - ox, s.z - oz) < 0.002) { stall += DT; worst = Math.max(worst, stall); } else stall = 0;
    if (ev.some((e) => e.type === 'drag' && e.phase === 'arrive') || s.state !== 'drag') done = s.state !== 'drag' && Math.hypot(s.x - B.x, s.z - B.z) < 1.0;
  }
  if (done) arrived++; else { bad.push(door.name); if (process.env.DBG) console.log(door.name, dist, sgn, 'state', s.state, 'pos', s.x.toFixed(2), s.z.toFixed(2), 'A', A.x.toFixed(2), A.z.toFixed(2), 'B', B.x.toFixed(2), B.z.toFixed(2), 'doorT', W.rts.find((r) => r.d === door).t.toFixed(2)); }
  worstStall = Math.max(worstStall, worst); if (worst > 2.5) stalled.push(door.name + (sgn > 0 ? '+' : '-') + dist + ':' + worst.toFixed(1) + 's');
  W.restore();
}
console.log(`terjepit daun: ${embedded.toFixed(1)} dtk total`);
console.log(`diuji ${tested} pintu; sampai ${arrived}; macet terlama ${worstStall.toFixed(1)} dtk${stalled.length ? '; macet >2.5 dtk: ' + stalled.join(' ') : ''}`);
ok(tested >= 60, `diuji ${tested} pintu`);
ok(arrived === tested, `seretan melewati pintu: ${arrived}/${tested}${bad.length ? ' (gagal: ' + bad.join(',') + ')' : ''}`);
ok(stalled.length === 0, `monster tidak membeku >2,5 dtk di depan pintu saat menyeret: ${stalled.join(' ')}`);
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
