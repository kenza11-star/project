// Uji monster DUA LANTAI dengan GLB asli: patroli turun/naik tangga, kontinuitas gerak & tinggi, mengikuti pemain yang pindah lantai,
// mendengar lewat lantai, tangkap, serah-terima host (restore) dan protokol (lantai/tangga di snapshot, kompatibel pesan lama).
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead, monsterFloorY } = require(G + '/monster.js');
const SY = require(G + '/monstersync.js');
const { dangerOf } = require(G + '/monsterfx.js');
const { MonsterController } = require(G + '/monsterctl.js');
const ST = require(G + '/stairs.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md, doorObbs } = buildWorld();
const S = md.stair, UP = CFG.MONSTER_LEVEL, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, bot = { x: S.bx - S.sgn * 0.6, z: S.zc };
const fixedOf = (lv) => md.colliders.filter((c) => c.obb.level === lv).map((c) => c.obb);
const navUp = new MonsterNav(cw, UP, fixedOf(UP), top), navLo = new MonsterNav(cw, 0, fixedOf(0), bot);
const mkEnv = () => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) { const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return !d.locked; } }; };
const restoreDoors = (env) => { for (const n of env.op) { const d = md.doors.find((q) => q.name === n); cw.removeObbs((o) => o.id === 'door:' + n); cw.addObb(d.closedObb); } env.op.clear(); };
const mk = (seed, env) => new MonsterSim(navUp, cw, UP, seed, env, top, { navLo, stair: S });
const obs = (id, x, z, level, o = {}) => ({ id, x, z, level, gait: 'idle', crouch: false, hidden: false, grace: 0, stairs: false, ...o });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// titik (x,z) yang bebas di KEDUA lantai (pemain di bawah monster) dan agak jauh dari tangga
const pair = (() => { for (let x = 4; x < 45; x += 1) for (let z = 4; z < 45; z += 1) { const a = navUp.snap(x, z, 0.1), b = navLo.snap(x, z, 0.1), c = navUp.snap(x + 3, z, 0.1); if (a && b && c && Math.hypot(x - top.x, z - top.z) > 8 && navUp.path(a.x, a.z, c.x, c.z)) return { up: a, lo: b, upNear: c }; } return null; })();

section('Navigasi lantai bawah & tangga');
{
  ok(navLo.count > 2000, `grid lantai bawah terbentuk (${navLo.count} sel)`);
  ok(navLo.isOk(bot.x, bot.z) || navLo.snap(bot.x, bot.z, 2) !== null, 'mulut kaki tangga ada di grid lantai bawah');
  ok(navUp.isOk(top.x, top.z) || navUp.snap(top.x, top.z, 2) !== null, 'mulut atas tangga ada di grid lantai atas');
  const env = mkEnv(), sim = mk(1, env);
  ok(sim.enabled, 'monster aktif'); const nU = sim.wpLv.filter((l) => l === UP).length, nL = sim.wpLv.filter((l) => l === 0).length;
  ok(nU >= 8 && nL >= 8, `waypoint di kedua lantai (atas ${nU}, bawah ${nL})`);
  ok(sim.level === UP && dist(sim, top) >= 12, 'mulai di lantai atas, jauh dari tangga');
  ok(sim.waypoints.every((p, i) => (sim.wpLv[i] === UP ? navUp : navLo).isOk(p.x, p.z)), 'semua waypoint di sel bebas lantainya');
  ok(Math.abs(monsterFloorY(S, 0, false, 0) - CFG.LEVEL_Y[0]) < 1e-9 && Math.abs(monsterFloorY(S, UP, false, 0) - CFG.LEVEL_Y[UP]) < 1e-9, 'tinggi lantai per level');
  ok(Math.abs(ST.stairHeight(S, S.run) - CFG.LEVEL_Y[UP]) < 0.05 && Math.abs(ST.stairHeight(S, 0) - CFG.LEVEL_Y[0]) < 0.4, 'tinggi tangga menyambung lantai bawah & atas');
  const noMulti = new MonsterSim(navUp, cw, UP, 1, env, top); ok(noMulti.wpLv.every((l) => l === UP), 'tanpa multi: perilaku lama (hanya lantai atas)');
}

section('Patroli dua lantai: 5 seed x 12 menit (turun & naik tangga, tanpa menembus dinding, gerak & tinggi kontinu)');
{
  let blocked = 0, nan = 0, jumps = 0, yjump = 0, frames = 0, downs = 0, ups = 0, bothLv = 0, stairFrames = 0, stuckSeeds = 0, wps = new Set();
  for (const seed of [1, 2, 3, 99, 777]) {
    const env = mkEnv(), sim = mk(seed, env), seen = new Set(), far = obs('p', -500, -500, UP, { hidden: true });
    let prevLv = sim.level, prevOn = false, px = sim.x, pz = sim.z, py = sim.y, moved = 0;
    for (let i = 0; i < 30 * 720; i++) {
      sim.update(1 / 30, [far]); frames++;
      if (!Number.isFinite(sim.x) || !Number.isFinite(sim.z) || !Number.isFinite(sim.y)) { nan++; break; }
      if (!sim.onStairs && cw.blocked(sim.x, sim.z, CFG.MONSTER_RADIUS * 0.7, sim.level)) blocked++;
      const step = Math.hypot(sim.x - px, sim.z - pz); if (step > 3.4 / 30 * 1.3 && step > 1.7) jumps++; moved += step;
      if (Math.abs(sim.y - py) > 0.25) yjump++;
      if (sim.onStairs) stairFrames++;
      if (sim.level !== prevLv) { if (sim.level < prevLv) downs++; else ups++; prevLv = sim.level; }
      seen.add(sim.level); px = sim.x; pz = sim.z; py = sim.y; wps.add(seed + ':' + sim.wp);
    }
    restoreDoors(env); if (moved < 200) stuckSeeds++; if (seen.has(0) && seen.has(UP)) bothLv++;
  }
  ok(nan === 0, 'tidak ada NaN');
  ok(blocked === 0, `tidak menembus dinding/furnitur (${blocked} frame di dalam penghalang)`);
  ok(jumps === 0, `tidak ada lompatan posisi (${jumps})`);
  ok(yjump === 0, `tinggi mulus saat naik/turun (${yjump} lompatan)`);
  ok(bothLv === 5, `semua seed mengunjungi kedua lantai (${bothLv}/5)`);
  ok(downs >= 5 && ups >= 5, `turun ${downs}x dan naik ${ups}x lewat tangga`);
  ok(stairFrames > 100, 'benar-benar berjalan di tangga');
  ok(stuckSeeds === 0, 'tidak ada seed yang macet');
}

section('Mendengar lewat lantai: pemain di lantai bawah ketahuan dari atas -> monster turun lewat tangga');
{
  ok(!!pair, 'ada titik uji yang bebas di kedua lantai');
  const env = mkEnv(), sim = mk(5, env); sim.x = pair.up.x; sim.z = pair.up.z; sim.level = UP; sim.onStairs = false;
  const pl = obs('p', pair.lo.x, pair.lo.z, 0, { gait: 'run' }); let reached = false, st = '';
  ok(dist(sim, pl) < CFG.MONSTER_HEAR_RUN * 0.6, 'pemain lari tepat di bawah monster: dalam jangkauan dengar lewat lantai');
  for (let i = 0; i < 30 * 60 && !reached; i++) { sim.update(1 / 30, [pl]); st = sim.state; if (sim.level === 0 && !sim.onStairs) reached = true; }
  ok(reached, `monster turun ke lantai bawah (status ${st})`);
  let caught = false; pl.gait = 'idle';
  for (let i = 0; i < 30 * 90 && !caught; i++) for (const e of sim.update(1 / 30, [pl])) if (e.type === 'catch') caught = e.id === 'p';
  ok(caught, 'lalu menemukan & menangkap pemain di lantai bawah'); restoreDoors(env);
}

section('Pemain diam/jongkok di lantai lain tidak terdeteksi (tidak curang lewat lantai)');
{
  const env = mkEnv(), sim = mk(5, env); sim.x = pair.up.x; sim.z = pair.up.z; sim.level = UP;
  let reacted = false; const idle = obs('p', pair.lo.x, pair.lo.z, 0, { gait: 'idle' }), crouch = obs('p', pair.lo.x, pair.lo.z, 0, { gait: 'idle', crouch: true });
  for (let i = 0; i < 30 * 6; i++) { sim.update(1 / 30, [i < 90 ? idle : crouch]); if (sim.state === 'investigate' || sim.state === 'chase') reacted = true; }
  ok(!reacted, 'diam/jongkok di bawah: monster tidak bereaksi');
  const far = obs('p', pair.lo.x + 40, pair.lo.z + 40, 0, { gait: 'run' }); const s2 = mk(5, mkEnv()); s2.x = pair.up.x; s2.z = pair.up.z; let r2 = false;
  for (let i = 0; i < 30 * 5; i++) { s2.update(1 / 30, [far]); if (s2.state === 'investigate' || s2.state === 'chase') r2 = true; }
  ok(!r2, 'lari jauh di lantai lain tidak terdengar'); restoreDoors(env);
}

section('Pemain kabur naik/turun tangga saat dikejar: monster mengikuti');
{
  const env = mkEnv(), sim = mk(7, env); const a = navLo.snap(bot.x - S.sgn * 4, bot.z, 4), tp = navLo.snap(a.x - S.sgn * 3, a.z, 4);
  sim.x = tp.x; sim.z = tp.z; sim.level = 0; sim.onStairs = false;
  const pl = obs('p', a.x, a.z, 0, { gait: 'run' }); let chased = false;
  for (let i = 0; i < 30 * 4 && !chased; i++) { sim.update(1 / 30, [pl]); if (sim.state === 'chase') chased = true; }
  ok(chased, 'monster mengejar di lantai bawah');
  pl.level = UP; pl.x = top.x; pl.z = top.z; let up = false, caughtEarly = false;   // pemain berlari naik tangga: sudah di atas
  for (let i = 0; i < 30 * 40 && !up; i++) { for (const e of sim.update(1 / 30, [pl])) if (e.type === 'catch') caughtEarly = true; if (sim.level === UP && !sim.onStairs) up = true; }
  ok(up && !caughtEarly, 'monster ikut naik lewat tangga'); restoreDoors(env);
  const env2 = mkEnv(), s2 = mk(8, env2); s2.x = pair.up.x; s2.z = pair.up.z; s2.level = UP;
  const p2 = obs('q', pair.upNear.x, pair.upNear.z, UP, { gait: 'run' }); for (let i = 0; i < 30 * 4 && s2.state !== 'chase'; i++) s2.update(1 / 30, [p2]);
  ok(s2.state === 'chase', 'monster mengejar di lantai atas'); p2.level = 0; p2.x = bot.x - S.sgn * 3; p2.z = bot.z; let down = false;
  for (let i = 0; i < 30 * 60 && !down; i++) { s2.update(1 / 30, [p2]); if (s2.level === 0 && !s2.onStairs) down = true; }
  ok(down, 'monster ikut turun lewat tangga'); restoreDoors(env2);
}

section('Di tangga: sama-sama di tangga bisa tertangkap; pemain di lantai tidak ditangkap dari tangga');
{
  const env = mkEnv(), sim = mk(9, env); sim.level = 0; sim.onStairs = true; sim.climbDir = 1; sim.x = S.bx + S.sgn * 2; sim.z = S.zc; sim.state = 'chase'; sim.targetId = 'p'; sim.lastSeen = { x: S.bx + S.sgn * 3, z: S.zc }; sim.lastSeenLv = 0;
  const onSt = obs('p', S.bx + S.sgn * 2.6, S.zc, 0, { stairs: true, gait: 'run' }); let c = false;
  for (let i = 0; i < 30 * 3 && !c; i++) { for (const e of sim.update(1 / 30, [onSt])) if (e.type === 'catch') c = true; }
  ok(c, 'tertangkap saat sama-sama di tangga');
  const sim2 = mk(9, mkEnv()); sim2.level = 0; sim2.onStairs = true; sim2.climbDir = 1; sim2.x = S.bx + S.sgn * 2; sim2.z = S.zc; sim2.state = 'chase'; sim2.targetId = 'p';
  const flo = obs('p', S.bx + S.sgn * 2.4, S.zc, UP, { stairs: false }); let c2 = false; for (let i = 0; i < 30; i++) for (const e of sim2.update(1 / 30, [flo])) if (e.type === 'catch') c2 = true;
  ok(!c2, 'pemain di lantai atas tidak ditangkap dari tangga'); restoreDoors(env);
}

section('Setelah menangkap: monster pindah ke titik jauh (beda lantai dihitung jauh) & lanjut patroli');
{
  const env = mkEnv(), sim = mk(11, env); const tp = navLo.snap(bot.x - S.sgn * 5, bot.z, 4); sim.x = tp.x; sim.z = tp.z; sim.level = 0;
  const pl = obs('p', tp.x + 0.6, tp.z, 0, { gait: 'run' }); sim.state = 'chase'; sim.targetId = 'p'; sim.lastSeen = { x: pl.x, z: pl.z }; sim.lastSeenLv = 0; let caught = false;
  for (let i = 0; i < 60 && !caught; i++) for (const e of sim.update(1 / 30, [pl])) if (e.type === 'catch') caught = true;
  ok(caught, 'menangkap'); const g = { ...pl, grace: 20 };
  for (let i = 0; i < 30 * (CFG.MONSTER_RESET_TIME + 1); i++) sim.update(1 / 30, [g]);
  ok(sim.state === 'patrol' && dist(sim, pl) > 10 || sim.level !== 0, `pindah jauh dari korban (level ${sim.level}, ${dist(sim, pl).toFixed(1)} m)`); restoreDoors(env);
}

section('Serah-terima host (restore) & protokol');
{
  const env = mkEnv(), sim = mk(3, env);
  const lo = navLo.snap(bot.x - S.sgn * 6, bot.z + 2, 4); sim.restore({ x: lo.x, z: lo.z, yaw: 1, lv: 0, os: 0 });
  ok(sim.level === 0 && !sim.onStairs && navLo.isOk(sim.x, sim.z), 'restore ke lantai bawah');
  sim.restore({ x: S.bx + S.sgn * 1, z: S.zc, yaw: 0, lv: 0, os: 1 });
  ok(sim.level === 0 && !sim.onStairs && dist(sim, bot) < 1.5, 'restore dari tengah tangga (dekat kaki) -> mulut kaki tangga');
  sim.restore({ x: S.bx + S.sgn * (S.run - 1), z: S.zc, yaw: 0, lv: 0, os: 1 });
  ok(sim.level === UP && dist(sim, top) < 1.5, 'restore dari tengah tangga (dekat atas) -> mulut atas');
  const sn = sim.snapshot(); ok(sn.lv === sim.level && sn.os === 0, 'snapshot memuat lantai & status tangga');
  const base = { v: 1, t: 'm', e: 1, s: 1, x: 1, z: 2, yw: 0, st: 0, tg: '', sp: 1, wp: 0 };
  ok(SY.sanitizeMonsterMsg(base).lv === 1 && SY.sanitizeMonsterMsg(base).os === 0, 'pesan lama tanpa lv/os diterima (lantai atas)');
  ok(SY.sanitizeMonsterMsg({ ...base, lv: 0, os: 1 }).lv === 0, 'pesan baru lv/os diterima');
  ok(SY.sanitizeMonsterMsg({ ...base, lv: 5 }) === null && SY.sanitizeMonsterMsg({ ...base, os: 2 }) === null && SY.sanitizeMonsterMsg({ ...base, lv: 'x' }) === null, 'lv/os di luar batas ditolak');
  const rep = new SY.MonsterReplica(); rep.push({ ...base, lv: 0, os: 1, sp: 2 }, 1000); const sm = rep.sample(1200);
  ok(sm.level === 0 && sm.onStairs === true, 'replika menyampaikan lantai & status tangga');
  ok(dangerOf(3, false, false) < dangerOf(3, false, true), 'bahaya beda lantai lebih redam');
}

section('Multiplayer lintas lantai: replika klien lain melihat monster turun/naik tangga (lantai & tinggi tersinkron)');
{
  let t = 0; const clients = {}, queue = [];
  const add = (id, slot) => { const c = { id, slot, handlers: [] }; clients[id] = c; c.io = { selfId: id, selfSlot: slot, peers: () => Object.values(clients).filter((o) => o.id !== id).map((o) => ({ id: o.id, slot: o.slot, online: true })), send: (m) => { for (const o of Object.values(clients)) if (o.id !== id) queue.push({ at: t + 50, to: o.id, from: id, m: JSON.parse(JSON.stringify(m)) }); }, onMessage: (fn) => { c.handlers.push(fn); return () => {}; } }; return c; };
  const step = (ms) => { t += ms; for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= t) { const q = queue.splice(i, 1)[0]; for (const h of clients[q.to].handlers) h(q.from, q.m); } };
  const env = mkEnv(); const A = add('A', 0), B = add('B', 1);
  for (const c of [A, B]) c.ctl = new MonsterController(() => mk(2, env), c.io, () => t);
  const far = (id) => obs(id, -500, -500, UP, { hidden: true }); let sawLo = false, sawUp = false, sawStairs = false, bad = 0, maxErr = 0;
  for (let i = 0; i < 30 * 400; i++) {
    step(1000 / 30); A.ctl.update(1 / 30, far('A'), [far('B')]); B.ctl.update(1 / 30, far('B'), [far('A')]);
    const a = A.ctl.view, b = B.ctl.view; if (a.level === 0) sawLo = true; if (a.level === UP) sawUp = true; if (a.onStairs) sawStairs = true;
    if (i > 90 && b.active) { maxErr = Math.max(maxErr, dist(a, b)); if (b.level !== a.level && !a.onStairs && !b.onStairs && Math.abs(a.x - b.x) < 0.3) bad++; }
  }
  ok(sawLo && sawUp && sawStairs, 'otoritas patroli di kedua lantai & tangga');
  ok(B.ctl.view.active && maxErr < 1.2, `replika mengikuti posisi (selisih maks ${maxErr.toFixed(2)} m)`);
  ok(bad === 0, 'replika menampilkan lantai yang benar (tidak salah lantai)'); restoreDoors(env);
  // serah-terima: A (otoritas) keluar -> B melanjutkan dari lantai terakhir
  const lvA = A.ctl.view.level; clients.A.handlers.length = 0; delete clients.A; for (let i = 0; i < 30 * 5; i++) { step(1000 / 30); B.ctl.update(1 / 30, far('B'), []); }
  ok(B.ctl.isAuthority && B.ctl.view.active, 'B menjadi otoritas setelah A keluar'); ok(B.ctl.view.level === lvA || B.ctl.view.onStairs !== undefined, 'monster lanjut dari lantai terakhir');
}
console.log(`\nMonster 2 lantai: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
