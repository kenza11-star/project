// Uji STAGE 2 (tangkap -> seret ke penjara -> digantung) dengan GLB peta asli: tujuan seret = pintu penjara di lantai atas (lewat tangga bila tertangkap di lantai bawah),
// seretan selalu berakhir (arrive/abort) dan korban tidak ditangkap ulang, slot unik per korban, pesan tangkap membawa slot, solo bebas (release), protokol 'bd'.
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

section('Seret ke pintu penjara (lantai atas & bawah)');
for (const lv of [UP, 0]) {
  let arrived = 0, aborted = 0, never = 0, total = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const env = mkEnv(), sim = new MonsterSim(navUp, cw, UP, seed, env, top, { navLo, stair: S }, dragEnv);
    const nav = lv === UP ? navUp : navLo; const rng = sim.rng; const p0 = nav.randomPoint(rng);
    sim.x = p0.x; sim.z = p0.z; sim.level = lv; sim.state = 'chase'; sim.targetId = 'me';
    let caught = false, drag = null, t = 0, dragStart = false;
    const v = obs('me', p0.x + 0.5, p0.z, lv);
    // tangkap langsung: pemain di dekat monster
    for (let i = 0; i < 4000 && !caught; i++) { sim.lastSeen = { x: v.x, z: v.z }; const ev = sim.update(0.05, [v]); for (const e of ev) if (e.type === 'catch') { caught = true; ok(e.drag === true, `lantai ${lv}: tangkapan memicu seret ke penjara`); } }
    if (!caught) { never++; restore(env); continue; }
    total++; let end = null;
    for (let i = 0; i < 120 / 0.05 && !end; i++) { const ev = sim.update(0.05, [{ ...v, caught: true }]); for (const e of ev) if (e.type === 'drag' && e.phase !== 'start') end = e; }
    restore(env);
    if (!end) { never++; continue; }
    if (end.phase === 'arrive') { arrived++; ok(dist(end, PR.PRISON_GATE.arrive) < 1.2 && sim.level === UP, `lantai ${lv}: tiba di pintu penjara lantai atas (jarak ${dist(end, PR.PRISON_GATE.arrive).toFixed(2)})`); } else aborted++;
    ok(sim.state === 'watch' || sim.state === 'patrol', `lantai ${lv}: setelah seret monster kembali patroli (${sim.state})`);
  }
  console.log(`  lantai ${lv}: tiba=${arrived} abort=${aborted} tak selesai=${never}/${total}`);
  ok(never === 0, `lantai ${lv}: seretan selalu berakhir (arrive/abort) dalam batas waktu`);
  ok(arrived >= Math.ceil(total * 0.8), `lantai ${lv}: sebagian besar seretan sampai di pintu penjara (${arrived}/${total}); sisanya abort = fade lalu pindah`);
}

section('Korban terikat tidak ditangkap ulang');
{
  const env = mkEnv(), sim = new MonsterSim(navUp, cw, UP, 3, env, top, { navLo, stair: S }, dragEnv);
  const p0 = navUp.randomPoint(sim.rng); sim.x = p0.x; sim.z = p0.z; sim.state = 'chase'; sim.targetId = 'b';
  const bound = obs('b', p0.x + 0.4, p0.z, UP, { caught: true, bound: 2 }); let catches = 0;
  for (let i = 0; i < 600; i++) { sim.lastSeen = { x: bound.x, z: bound.z }; for (const e of sim.update(0.05, [bound])) if (e.type === 'catch') catches++; }
  ok(catches === 0, `pemain 'bound' (caught) tidak pernah ditangkap lagi (${catches})`); restore(env);
}

section('Slot: unik per korban, dibawa pesan tangkap');
{
  const sent = [], io = { selfId: 'A', selfSlot: 0, peers: () => [{ id: 'B', slot: 1, online: true }, { id: 'C', slot: 2, online: true }], send: (m) => sent.push(m), onMessage: () => () => {} };
  let clock = 0, got = [];
  const env = mkEnv(); const mk = () => { const s = new MonsterSim(navUp, cw, UP, 5, env, top, { navLo, stair: S }, dragEnv); return s; };
  const ctl = new MonsterController(mk, io, () => clock); ctl.onCatchSelf = (d, sl) => got.push({ d, sl });
  const self = obs('A', 0, 0, UP), others = [obs('B', 0, 0, UP), obs('C', 0, 0, UP)];
  ctl.update(0.05, self, others); const sim = ctl.sim;
  // tangkapan nyata: pesan 'mc' membawa slot & korban menerimanya
  sim.x = 20; sim.z = 20; sim.state = 'chase'; sim.targetId = 'A'; sim.level = UP; self.x = 20.4; self.z = 20; sim.lastSeen = { x: 20.4, z: 20 };
  for (let i = 0; i < 40 && !got.length; i++) { clock += 50; ctl.update(0.05, self, others); }
  const mc = sent.filter((m) => m.t === 'mc')[0];
  ok(mc && Number.isInteger(mc.sl) && mc.sl >= 0 && mc.sl < PR.PRISON_SLOTS.length, 'pesan tangkap membawa slot valid');
  ok(got.length >= 1 && got[0].sl === mc.sl, 'korban (otoritas) menerima slot yang sama di onCatchSelf');
  // pemilihan slot: unik sampai penuh, slot pemain bound tidak dipakai lagi
  const ctl2 = new MonsterController(mk, io, () => clock), picked = [];
  for (let k = 0; k < PR.PRISON_SLOTS.length; k++) picked.push(ctl2.pickSlot('V' + k, [], clock));
  ok(new Set(picked).size === PR.PRISON_SLOTS.length, `6 korban berturut-turut: 6 slot berbeda (${picked.join(',')})`);
  const ctl3 = new MonsterController(mk, io, () => clock);
  const bnd = [0, 1, 2, 3, 4].map((b) => obs('P' + b, 0, 0, UP, { caught: true, bound: b }));
  ok(ctl3.pickSlot('NEW', bnd, clock) === 5, 'slot milik pemain bound tidak dipilih (satu-satunya sisa = 5)');
  const bnd2 = [0, 1, 2, 3, 4, 5].map((b) => obs('Q' + b, 0, 0, UP, { caught: true, bound: b }));
  const sl7 = ctl3.pickSlot('SEVEN', bnd2, clock + 1); ok(Number.isInteger(sl7) && sl7 >= 0 && sl7 < 6, 'semua slot penuh: tetap mengembalikan slot valid (tanpa batas tangkapan)');
  const clean = SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'x', dg: 1, sl: 4 }); ok(clean && clean.sl === 4, 'sanitize menerima sl');
  ok(SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'x', sl: -1 }) === null && SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'x', sl: 'a' }) === null, 'sanitize menolak sl tidak valid');
  ok(SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'x', dg: 1 }).sl === undefined, 'pesan lama tanpa sl tetap valid');
}

section('Solo bebas: monster menjauh & pemain kebal');
{
  const env = mkEnv(); const ctl = new MonsterController(() => new MonsterSim(navUp, cw, UP, 9, env, top, { navLo, stair: S }, dragEnv), null, (() => { let c = 0; return () => (c += 16); })());
  const me = obs('me', top.x, top.z, UP, { gait: 'idle' }); ctl.update(0.05, me, []);
  const sim = ctl.sim; sim.x = top.x - 3; sim.z = top.z; sim.state = 'patrol';
  ctl.release(me, CFG.SOLO_FREE_MONSTER_AWAY, CFG.SOLO_FREE_GRACE);
  ok(dist(sim, top) > 12, `monster dipindah jauh dari korban (${dist(sim, top).toFixed(1)} m)`);
  ok(sim.quiet === CFG.SOLO_FREE_MONSTER_AWAY, 'monster tidak peduli selama SOLO_FREE_MONSTER_AWAY');
  ok(ctl.graceOf('me') > CFG.SOLO_FREE_GRACE - 1, 'pemain kebal SOLO_FREE_GRACE');
  let seen = 0; for (let i = 0; i < CFG.SOLO_FREE_MONSTER_AWAY * 20 - 20; i++) { sim.x = top.x - 1; sim.z = top.z; sim.update(0.05, [{ ...me, gait: 'run' }]); if (sim.state === 'chase') seen++; }
  ok(seen === 0, 'selama quiet monster tidak mengejar meski berada dekat');
  restore(env);
}

section('Konfigurasi & data');
{
  ok(CFG.STRUGGLE_SECONDS === 12, 'batas waktu minigame berontak = 12 dtk (konstanta config)');
  ok(CFG.PRISON_SLOT_COUNT === PR.PRISON_SLOTS.length, 'PRISON_SLOT_COUNT sama dengan jumlah PRISON_SLOTS');
  ok(CFG.STRUGGLE_START + CFG.STRUGGLE_TAP * 10 > 1 && CFG.STRUGGLE_DRAIN * CFG.STRUGGLE_SECONDS < 2, 'minigame bisa dimenangkan (ketukan wajar) dan tidak otomatis');
  ok(dragEnv.prison.x < 38.5 && dragEnv.prison.x > S.bx + S.run, 'pintu penjara di lantai atas dekat ujung tangga');
}
console.log(`\n${passes} lulus, ${fails} gagal`); process.exit(fails ? 1 : 0);
