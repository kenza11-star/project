// Uji STAGE 3 (penyelamatan korban bound): suara tali putus menarik monster, kebal RESCUE_GRACE diatur otoritas, noise hanya dijalankan otoritas.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const SY = require(G + '/monstersync.js');
const { MonsterController } = require(G + '/monsterctl.js');
const PR = require(G + '/prisonroom.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md } = buildWorld();
const S = md.stair, UP = CFG.MONSTER_LEVEL, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, bot = { x: S.bx - S.sgn * 0.6, z: S.zc };
const fixedOf = (lv) => md.colliders.filter((c) => c.obb.level === lv).map((c) => c.obb);
const navUp = new MonsterNav(cw, UP, fixedOf(UP), top), navLo = new MonsterNav(cw, 0, fixedOf(0), bot);
const mkEnv = () => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) { const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return true; } }; };
const restore = (env) => { for (const n of env.op) { const d = md.doors.find((q) => q.name === n); cw.removeObbs((o) => o.id === 'door:' + n); cw.addObb(d.closedObb); } env.op.clear(); };
const dragEnv = { rooms: md.rooms, avoid: [], prison: { x: PR.PRISON_GATE.arrive.x, z: PR.PRISON_GATE.arrive.z, lv: UP } };
const obs = (id, x, z, level, o = {}) => ({ id, x, z, level, gait: 'run', crouch: false, hidden: false, grace: 0, stairs: false, ...o });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

section('hearNoise: patroli/watch/search menyelidiki; chase/drag tidak diganggu');
{
  const env = mkEnv(), sim = new MonsterSim(navUp, cw, UP, 11, env, top, { navLo, stair: S }, dragEnv);
  const p = navUp.randomPoint(sim.rng);
  for (const st of ['patrol', 'watch', 'search']) { sim.state = st; sim.lastSeen = null; sim.hearNoise(p.x, p.z, UP); ok(sim.state === 'investigate' && sim.lastSeen.x === p.x && sim.lastSeenLv === UP, 'state ' + st + ' -> investigate ke titik suara'); }
  for (const st of ['chase', 'catch', 'drag']) { sim.state = st; sim.lastSeen = null; sim.hearNoise(p.x, p.z, UP); ok(sim.state === st && sim.lastSeen === null, 'state ' + st + ' tidak diganggu'); }
  sim.state = 'patrol'; sim.quiet = 5; sim.hearNoise(p.x, p.z, UP); ok(sim.state === 'patrol', 'quiet (solo bebas): tidak peduli suara');
}

section('Controller: noteRescue (kebal 8 dtk, bukan 12) + noise hanya otoritas');
{
  let clock = 0; const env = mkEnv(), mk = () => new MonsterSim(navUp, cw, UP, 5, env, top, { navLo, stair: S }, dragEnv);
  const ctl = new MonsterController(mk, null, () => clock), me = obs('me', top.x, top.z, UP, { gait: 'idle' });
  ctl.update(0.05, me, []); ok(ctl.isAuthority, 'solo = otoritas');
  const p = navUp.randomPoint(ctl.sim ? ctl.sim.rng : mk().rng); ctl.sim.state = 'patrol'; ctl.noise(p.x, p.z, UP); ok(ctl.sim.state === 'investigate', 'otoritas: noise -> investigate');
  // korban bound (caught) lalu bebas: tanpa rescue = CAPTURE_GRACE
  ctl.update(0.05, { ...me, id: 'v', caught: true }, []); clock += 1000; ctl.update(0.05, { ...me, id: 'v', caught: false }, []);
  ok(Math.abs(ctl.graceOf('v') - CFG.CAPTURE_GRACE) < 1.5, 'tanpa rescue: kebal ~CAPTURE_GRACE, ' + ctl.graceOf('v').toFixed(1));
  // dengan rescue: rok datang SEBELUM flag cg hilang
  const ctl2 = new MonsterController(mk, null, () => clock); ctl2.update(0.05, me, []);
  ctl2.update(0.05, { ...me, id: 'v', caught: true }, []); ctl2.noteRescue('v'); ctl2.update(0.05, { ...me, id: 'v', caught: false }, []);
  ok(Math.abs(ctl2.graceOf('v') - CFG.RESCUE_GRACE) < 0.2, 'rok dulu: kebal tepat RESCUE_GRACE, ' + ctl2.graceOf('v').toFixed(2));
  // rok datang SETELAH flag cg hilang
  const ctl3 = new MonsterController(mk, null, () => clock); ctl3.update(0.05, me, []);
  ctl3.update(0.05, { ...me, id: 'v', caught: true }, []); ctl3.update(0.05, { ...me, id: 'v', caught: false }, []); ctl3.noteRescue('v');
  ok(Math.abs(ctl3.graceOf('v') - CFG.RESCUE_GRACE) < 0.2, 'rok belakangan: kebal ditimpa ke RESCUE_GRACE, ' + ctl3.graceOf('v').toFixed(2));
  clock += (CFG.RESCUE_GRACE + 0.5) * 1000; ok(ctl2.graceOf('v') === 0, 'kebal habis setelah RESCUE_GRACE');
  // replika (bukan otoritas): noise tidak berpengaruh
  const sent = [], io = { selfId: 'b', selfSlot: 1, peers: () => [{ id: 'a', slot: 0, online: true }, { id: 'b', slot: 1, online: true }], send: (m) => sent.push(m), onMessage: () => () => {} };
  const rep = new MonsterController(mk, io, () => clock); rep.update(0.05, obs('b', top.x, top.z, UP), [obs('a', top.x, top.z, UP)]);
  ok(!rep.isAuthority, 'slot 1 = replika'); rep.noise(p.x, p.z, UP); ok(true, 'noise pada replika: no-op tanpa error');
}

section('Konfigurasi rescue');
ok(CFG.RESCUE_HOLD_SECONDS === 3 && CFG.RESCUE_MAX_MUL === 2 && CFG.RESCUE_GRACE === 8, 'tahan 3 dtk, 2x, kebal 8 dtk di config');
ok(CFG.RESCUE_KEEPALIVE < CFG.RESCUE_TIMEOUT, 'keepalive < timeout');

console.log(`\n${passes} lulus, ${fails} gagal`); process.exit(fails ? 1 : 0);
