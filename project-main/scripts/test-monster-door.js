// Uji monster x pintu dengan pintu YANG SEBENARNYA (daun berayun, collision mengikuti sudut daun seperti World.stepDoor), GLB asli.
// 1) monster melewati pintu tertutup tanpa tersangkut; 2) pintu ditutup saat monster di ambang: monster TIDAK terdorong/terlempar.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const D = require(G + '/door.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md } = buildWorld();
const S = md.stair, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, LV = CFG.MONSTER_LEVEL;
const fixed1 = md.colliders.filter((c) => c.obb.level === LV).map((c) => c.obb);
const nav = new MonsterNav(cw, LV, fixed1, top);
const R = CFG.MONSTER_RADIUS, DT = 1 / 30, GUARD = process.argv[2] !== 'old'   // 'old' = tanpa penjagaan monster di stepDoor (memperlihatkan bug lama);

// Pintu nyata: meniru World.stepDoor (kecepatan, ease, collision aktif selama a < OPEN_FREE_FRAC, dan perlindungan monster di ambang).
function mkDoors(guard) {
  const rts = md.doors.filter((d) => d.level === LV).map((d) => {
    const leaf = { hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: d.closedObb.hx };
    const obb = cw.obbs.find((o) => o.id === 'door:' + d.name);
    return { d, leaf, vis: { ...leaf, half: 0.04 }, obb, t: 0, target: 0, pend: false, mon: null };
  });
  const step = (rt, dt) => {
    if (rt.t !== rt.target) {
      const base = rt.d.openTime || 0.7, rate = dt / (rt.target ? base * CFG.DOOR_OPEN_SLOW : base * CFG.DOOR_CLOSE_SCALE);
      const nt = rt.target ? Math.min(1, rt.t + rate) : Math.max(0, rt.t - rate);
      const hold = guard && rt.mon && !rt.target && D.sweepHitsPlayer(rt.vis, D.ease(rt.t), D.ease(nt), rt.mon.x, rt.mon.z, R + 0.02);
      if (!hold) rt.t = nt;
    }
    const a = D.ease(rt.t);
    if (D.doorBlocksAt(a)) {
      D.applyPose(rt.obb, rt.leaf, a);
      if (!rt.obb.enabled) { const inside = guard && rt.mon && cw.constructor.distToObb(rt.obb, rt.mon.x, rt.mon.z) < R + 0.03; rt.pend = !!inside; if (!inside) rt.obb.enabled = true; }
    } else { rt.obb.enabled = false; rt.pend = false; }
  };
  const env = { openDoorNear(x, z, level, dx, dz) {
    const cand = rts.filter((r) => r.d.level === level && r.t < 0.98), hit = doorAhead(cand.map((r) => r.d), x, z, dx, dz, 1.6); if (!hit) return false;
    const rt = cand.find((r) => r.d === hit); if (rt.d.locked) return false; rt.target = 1; return true; } };
  const restore = () => { for (const r of rts) { r.t = 0; r.target = 0; r.mon = null; r.pend = false; r.obb.enabled = true; D.applyPose(r.obb, r.leaf, 0); } };
  return { rts, env, step, restore };
}
const frames = (n, f) => { for (let i = 0; i < n; i++) f(i); };

section('Monster melewati pintu nyata (daun berayun) tanpa tersangkut');
{
  let tested = 0, good = 0, slow = []; const bad = [];
  for (const door of md.doors.filter((q) => q.level === LV && !q.locked)) {
    const A = nav.snap(door.cx - door.nx * 1.6, door.cz - door.nz * 1.6, 1), B = nav.snap(door.cx + door.nx * 1.6, door.cz + door.nz * 1.6, 1);
    if (!A || !B || !nav.path(A.x, A.z, B.x, B.z)) continue; tested++;
    const W = mkDoors(GUARD), s = new MonsterSim(nav, cw, LV, 5, W.env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const pl = { id: 'p', x: B.x, z: B.z, level: LV, gait: 'run', crouch: false, hidden: false, grace: 0 }; let caught = false, tt = 0;
    for (let i = 0; i < 30 * 40 && !caught; i++) { W.rts.forEach((r) => W.step(r, DT)); caught = s.update(DT, [pl]).some((e) => e.type === 'catch'); tt = i * DT; }
    if (caught) { good++; if (tt > 9) slow.push(door.name + ':' + tt.toFixed(1)); } else bad.push(door.name); W.restore();
  }
  ok(tested >= 12 && good === tested, `melewati ${good}/${tested} pintu nyata${bad.length ? ' (gagal: ' + bad.join(',') + ')' : ''}`);
  ok(slow.length === 0, `tidak ada pintu yang terlalu lama (>9 dtk): ${slow.join(' ')}`);
}

section('Pintu sudah terbuka (dibuka pemain): monster lewat mulus tanpa tersangkut');
{
  let tested = 0, good = 0, worst = 0; const bad = [];
  for (const door of md.doors.filter((q) => q.level === LV && !q.locked)) {
    const A = nav.snap(door.cx - door.nx * 1.6, door.cz - door.nz * 1.6, 1), B = nav.snap(door.cx + door.nx * 1.6, door.cz + door.nz * 1.6, 1);
    if (!A || !B || !nav.path(A.x, A.z, B.x, B.z)) continue; tested++;
    const W = mkDoors(GUARD), rt = W.rts.find((r) => r.d === door); rt.t = 1; rt.target = 1; W.step(rt, DT);
    const s = new MonsterSim(nav, cw, LV, 5, W.env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const pl = { id: 'p', x: B.x, z: B.z, level: LV, gait: 'run', crouch: false, hidden: false, grace: 0 }; let caught = false, tt = 0;
    for (let i = 0; i < 30 * 15 && !caught; i++) { rt.mon = s; W.rts.forEach((r) => W.step(r, DT)); caught = s.update(DT, [pl]).some((e) => e.type === 'catch'); tt = i * DT; }
    if (caught) { good++; worst = Math.max(worst, tt); } else bad.push(door.name); W.restore();
  }
  ok(tested >= 12 && good === tested, `pintu terbuka: ${good}/${tested} dilewati${bad.length ? ' (gagal: ' + bad.join(',') + ')' : ''}`);
  ok(worst < 6, `pintu terbuka: waktu lewat terburuk ${worst.toFixed(1)} dtk (< 6 dtk, tanpa menunggu daun)`);
}

section('Pintu ditutup saat monster di ambang: tidak mendorong monster');
{
  let tested = 0, pushed = 0, trapped = 0, closedOnIt = 0, maxJump = 0; const bad = [];
  for (const door of md.doors.filter((q) => q.level === LV && !q.locked)) {
    const A = nav.snap(door.cx - door.nx * 1.6, door.cz - door.nz * 1.6, 1), B = nav.snap(door.cx + door.nx * 1.6, door.cz + door.nz * 1.6, 1);
    if (!A || !B || !nav.path(A.x, A.z, B.x, B.z)) continue; tested++;
    const W = mkDoors(GUARD), rt = W.rts.find((r) => r.d === door), s = new MonsterSim(nav, cw, LV, 5, W.env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const pl = { id: 'p', x: B.x, z: B.z, level: LV, gait: 'run', crouch: false, hidden: false, grace: 0 };
    let inGap = false, closed = false, px = 0, pz = 0, jump = 0, n = 0;
    for (let i = 0; i < 30 * 40; i++) {
      rt.mon = s; W.rts.forEach((r) => W.step(r, DT));
      const ox = s.x, oz = s.z; s.update(DT, [pl]); const mv = Math.hypot(s.x - ox, s.z - oz);
      const along = (s.x - door.cx) * door.nx + (s.z - door.cz) * door.nz, lat = Math.abs((s.x - door.cx) * -door.nz + (s.z - door.cz) * door.nx);
      if (!closed && rt.t >= 0.4 && Math.abs(along) < 0.45 && lat < 0.6) { inGap = true; closed = true; rt.target = 0; }   // pemain menutup pintu persis saat monster di tengah ambang
      if (closed && s.state === 'catch') break; if (closed) { jump = Math.max(jump, mv); n++; if (mv > CFG.MONSTER_CHASE_SPEED * DT * 1.6) pushed++; if (rt.t === 0 && rt.obb.enabled && cw.constructor.distToObb(rt.obb, s.x, s.z) < R - 0.02) closedOnIt++; if (n > 30 * 12) break; }
    }
    maxJump = Math.max(maxJump, jump); if (!inGap) bad.push(door.name + '(tak sampai ambang)'); W.restore();
  }
  ok(tested >= 12, `diuji ${tested} pintu`);
  ok(bad.length === 0, `monster sempat berada di ambang pada semua pintu${bad.length ? ': ' + bad.join(',') : ''}`);
  ok(pushed === 0, `monster tidak pernah terlempar/terdorong (langkah > kecepatan wajar: ${pushed} frame; langkah maks ${maxJump.toFixed(3)} m/frame)`);
  ok(closedOnIt === 0, `daun yang menutup tidak pernah menimpa badan monster (${closedOnIt} frame)`);
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
