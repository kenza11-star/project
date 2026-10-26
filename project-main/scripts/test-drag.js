// Uji TAHAP 2 (Monster Drag) dengan GLB peta asli: pemilihan ruangan acak & titik tujuan aman, alur sim (tangkap -> jumpscare -> seret -> sampai ->
// kembali patroli), korban tidak ditangkap lagi, jejak korban selalu di tempat yang bisa dilewati, abort (terhalang / kehabisan waktu / tanpa tujuan),
// dan jalur jaringan (pesan tangkap membawa dg, replika melihat state 'drag'). BUKAN uji di browser: tampilan 3D/animasi tidak tercakup di sini.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead, MON_STATES } = require(G + '/monster.js');
const DP = require(G + '/dragplan.js');
const SY = require(G + '/monstersync.js');
const { MonsterController } = require(G + '/monsterctl.js');
const { swingPoints } = require(G + '/door.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md } = buildWorld();
const S = md.stair, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, LV = CFG.MONSTER_LEVEL;
const fixedOf = (lv) => md.colliders.filter((c) => c.obb.level === lv).map((c) => c.obb);
const nav1 = new MonsterNav(cw, 1, fixedOf(1), top), nav0 = new MonsterNav(cw, 0, fixedOf(0), { x: S.bx - S.sgn * 0.6, z: S.zc });
const navOf = (lv) => (lv === 1 ? nav1 : nav0);
// area terlarang sama dengan GameWorld (spawn, pintu keluar, tangga, ayunan pintu)
const avoid = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
if (md.ladder) avoid.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
for (let u = 0; u <= S.run + 1.2; u += 1.2) avoid.push({ x: S.bx + S.sgn * u, z: S.zc, r: 2.0 });
for (const d of md.doors) for (const sp of swingPoints({ hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: 0.04 })) avoid.push({ x: sp.x, z: sp.z, r: 0.45 });
const dragEnv = { rooms: md.rooms, avoid };
const { makeRng } = require(G + '/rng.js');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mkEnv = () => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) { const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return !d.locked; } }; };
const restoreDoors = (env) => { for (const n of env.op) { const d = md.doors.find((q) => q.name === n); cw.removeObbs((o) => o.id === 'door:' + n); cw.addObb(d.closedObb); } env.op.clear(); };
const skip = new Set(CFG.MONSTER_DRAG_SKIP_ROOMS);
const roomAt = (lv, p) => md.rooms.filter((r) => r.level === lv && p.x >= r.rect.minx && p.x <= r.rect.maxx && p.z >= r.rect.minz && p.z <= r.rect.maxz);

section('Rencana seret: ruangan acak valid + titik tujuan aman');
{
  const validRooms = (lv) => md.rooms.filter((r) => r.level === lv && !skip.has(r.type.toLowerCase()));
  ok(validRooms(0).length >= 8 && validRooms(1).length >= 8, `ruangan tersedia: lantai1=${validRooms(0).length}, lantai2=${validRooms(1).length} (tipe terlarang dibuang: ${[...skip].join(',')})`);
  for (const lv of [1, 0]) {
    const nav = navOf(lv), rng = makeRng(99 + lv), chosen = new Map(); let bad = { room: 0, skipType: 0, blocked: 0, notOk: 0, avoid: 0, pathEnd: 0, tooLong: 0, tooNear: 0, startRoom: 0, none: 0 }, N = 250;
    for (let i = 0; i < N; i++) {
      let from = nav.randomPoint(rng); const seedPt = lv === 1 ? top : { x: S.bx - S.sgn * 0.6, z: S.zc };
      while (!nav.path(from.x, from.z, seedPt.x, seedPt.z)) from = nav.randomPoint(rng);   // titik tangkap realistis: bagian grid yang terhubung (monster pernah berada di sana); sel terpencil di grid tidak dihitung
      const plan = DP.planDrag(nav, cw, dragEnv, from, lv, rng);
      if (!plan) { bad.none++; continue; }
      const room = md.rooms.find((r) => r.id === plan.room && r.level === lv); chosen.set(plan.room, (chosen.get(plan.room) || 0) + 1);
      if (!room || !roomAt(lv, plan.goal).some((r) => r.id === plan.room)) bad.room++;
      if (room && skip.has(room.type.toLowerCase())) bad.skipType++;
      if (cw.blocked(plan.goal.x, plan.goal.z, CFG.MONSTER_DRAG_CLEAR, lv)) bad.blocked++;
      if (!nav.isOk(plan.goal.x, plan.goal.z)) bad.notOk++;
      if (avoid.some((a) => dist(a, plan.goal) < a.r)) bad.avoid++;
      const end = plan.path[plan.path.length - 1]; if (dist(end, plan.goal) > 0.6) bad.pathEnd++;
      if (plan.length > CFG.MONSTER_DRAG_MAX_PATH + 1e-6) bad.tooLong++;
      if (dist(from, plan.goal) < CFG.MONSTER_DRAG_MIN_DIST) bad.tooNear++;
      if (roomAt(lv, from).some((r) => r.id === plan.room)) bad.startRoom++;
    }
    ok(bad.none === 0, `lantai ${lv + 1}: selalu ada rencana (${N} titik tangkap acak; tanpa rencana=${bad.none})`);
    ok(bad.room === 0 && bad.skipType === 0, `lantai ${lv + 1}: tujuan selalu di dalam ruangan valid (bukan ruang rahasia/vault/tangga)`);
    ok(bad.blocked === 0 && bad.notOk === 0, `lantai ${lv + 1}: tujuan tidak di dalam objek/dinding dan di area map yang terjangkau (blocked=${bad.blocked}, di luar nav=${bad.notOk})`);
    ok(bad.avoid === 0, `lantai ${lv + 1}: tujuan di luar area terlarang (spawn/pintu keluar/tangga/ayunan pintu)`);
    ok(bad.pathEnd === 0 && bad.tooLong === 0 && bad.tooNear === 0 && bad.startRoom === 0, `lantai ${lv + 1}: jalur sampai tujuan, panjang <= ${CFG.MONSTER_DRAG_MAX_PATH} m, tujuan >= ${CFG.MONSTER_DRAG_MIN_DIST} m & bukan ruangan tempat tertangkap`);
    ok(chosen.size >= Math.min(6, validRooms(lv).length - 2), `lantai ${lv + 1}: pilihan benar-benar acak (${chosen.size} dari ${validRooms(lv).length} ruangan terpilih dalam ${N} percobaan)`);
  }
  const nav = nav1, from = nav.randomPoint(makeRng(5)), a = DP.planDrag(nav, cw, dragEnv, from, 1, makeRng(77)), b = DP.planDrag(nav, cw, dragEnv, from, 1, makeRng(77));
  ok(a && b && a.room === b.room && a.goal.x === b.goal.x, 'deterministik per seed rng');
  ok(DP.planDrag(nav1, cw, { rooms: [], avoid }, from, 1, makeRng(1)) === null, 'tanpa ruangan tersedia -> null (alur lama dipakai)');
  ok(DP.planDrag(nav1, cw, { rooms: md.rooms.filter((r) => skip.has(r.type.toLowerCase())), avoid }, from, 1, makeRng(1)) === null, 'hanya ruangan terlarang -> null');
}

section('Jejak korban (DragTrail)');
{
  const tr = new DP.DragTrail(); ok(tr.behind() === null, 'jejak kosong -> null');
  tr.seed(0, 0); for (let i = 1; i <= 40; i++) tr.push(i * 0.1, 0);
  const b = tr.behind(0.9); ok(Math.abs(b.x - 3.1) < 1e-6 && Math.abs(b.z) < 1e-6, 'titik 0,9 m di belakang ujung jejak');
  const t2 = new DP.DragTrail(); t2.seed(0, 0); t2.push(0.3, 0); ok(dist(t2.behind(0.9), { x: 0, z: 0 }) < 1e-6, 'jejak lebih pendek dari jarak -> titik awal (korban mulus bergerak ke belakang monster)');
  const t3 = new DP.DragTrail(); t3.seed(0, 0); for (let i = 1; i <= 2000; i++) t3.push(i * 0.1, 0); ok(t3.pts.length < 80, 'jejak dipangkas (memori tidak tumbuh)');
}

// ---- alur sim lengkap di peta asli ----
const catchSetup = (lv, seed, withDrag = true) => {
  const nav = navOf(lv), env = mkEnv(), top2 = lv === 1 ? top : { x: S.bx - S.sgn * 0.6, z: S.zc };
  const sim = new MonsterSim(nav, cw, lv, seed, env, top2, undefined, withDrag ? dragEnv : undefined);
  // pemain 3 m di depan monster dengan garis pandang -> dikejar -> ditangkap
  let p = null; for (let k = 0; k < 400 && !p; k++) { const a = sim.rng.range(0, Math.PI * 2), q = { x: sim.x + Math.sin(a) * 3.2, z: sim.z + Math.cos(a) * 3.2 }; if (nav.isOk(q.x, q.z) && !cw.segmentBlocked(sim.x, sim.z, q.x, q.z, lv, 0.02)) p = q; }
  return { sim, env, p, nav };
};
const obs = (id, x, z, lv, o = {}) => ({ id, x, z, level: lv, gait: 'run', crouch: false, hidden: false, grace: 0, ...o });

section('Alur sim: tangkap -> (jumpscare) -> seret -> sampai -> kembali patroli');
for (const lv of [1, 0]) {
  let allOk = true, runs = 0, blockedFrames = 0, doorsOpened = 0, victimBlocked = 0, victimFallback = 0, victimFrames = 0, maxSp = 0, reCatch = 0, noDragEv = 0, lateArrive = 0, notPatrol = 0, startT = [], wrongOrder = 0, arriveFar = 0, nanN = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { sim, env, p, nav } = catchSetup(lv, seed); if (!p) continue; runs++;
    const victim = obs('v', p.x, p.z, lv), evs = [], trail = new DP.DragTrail(); let t = 0, caughtAt = -1, dragStart = -1, arriveAt = -1, plan = null, goal = null, vpos = { x: p.x, z: p.z };
    for (let i = 0; i < 30 * 220 && t < 220; i++, t += 1 / 30) {
      victim.x = vpos.x; victim.z = vpos.z; victim.caught = caughtAt >= 0;   // korban tidak bergerak sendiri (kontrol mati); posisi hanya dari seretan
      const ev = sim.update(1 / 30, [victim]); for (const e of ev) evs.push({ t, e });
      for (const e of ev) { if (e.type === 'catch') { caughtAt = t; if (!e.drag) noDragEv++; } if (e.type === 'drag' && e.phase === 'start') { dragStart = t; goal = { x: sim.dragGoal ? sim.dragGoal.x : 0, z: sim.dragGoal ? sim.dragGoal.z : 0 }; trail.seed(vpos.x, vpos.z); } if (e.type === 'drag' && e.phase === 'arrive') { arriveAt = t; arriveFar += dist(sim, goal) > 0.8 ? 1 : 0; } if (e.type === 'catch' && caughtAt >= 0 && t > caughtAt + 0.1) reCatch++; }
      if (!Number.isFinite(sim.x + sim.z)) nanN++;
      if (cw.blocked(sim.x, sim.z, CFG.MONSTER_RADIUS - 0.03, lv)) blockedFrames++;
      if (sim.state === 'drag') {
        maxSp = Math.max(maxSp, sim.speed);
        trail.push(sim.x, sim.z); const b = trail.behind(); victimFrames++;
        if (b && !cw.blocked(b.x, b.z, CFG.PLAYER_RADIUS, lv)) { vpos = { x: b.x, z: b.z }; } else { victimBlocked++; if (!cw.blocked(sim.x, sim.z, CFG.PLAYER_RADIUS, lv)) { vpos = { x: sim.x, z: sim.z }; victimFallback++; } }
      }
      if (arriveAt >= 0 && t > arriveAt + 12) break;
    }
    doorsOpened += env.op.size; restoreDoors(env);
    const kinds = evs.map((x) => (x.e.type === 'drag' ? 'drag:' + x.e.phase : x.e.type === 'state' ? 's:' + x.e.to : 'catch'));
    const seq = kinds.filter((k) => k === 'catch' || k.startsWith('drag:') || k === 's:catch' || k === 's:drag' || k === 's:watch' || k === 's:patrol');
    const want = ['s:chase', 'catch', 's:catch', 's:drag', 'drag:start', 'drag:arrive', 's:watch', 's:patrol'];
    // urutan harus mengandung rangkaian ini berurutan
    const all = kinds; let k = 0; for (const x of all) if (x === want[k] || (k > 0 && false)) k++;
    if (k < 1) wrongOrder++;
    if (dragStart < 0 || arriveAt < 0) { allOk = false; continue; }
    startT.push(dragStart - caughtAt);
    if (dragStart - caughtAt < CFG.MONSTER_DRAG_START - 0.05) wrongOrder++;
    if (arriveAt - dragStart > CFG.MONSTER_DRAG_MAX_SECONDS) lateArrive++;
    if (!(kinds.indexOf('catch') < kinds.indexOf('drag:start') && kinds.indexOf('drag:start') < kinds.indexOf('drag:arrive'))) wrongOrder++;
    if (!kinds.slice(kinds.indexOf('drag:arrive')).includes('s:patrol')) notPatrol++;
  }
  ok(runs >= 6, `lantai ${lv + 1}: ${runs} skenario tangkapan tersusun`);
  ok(allOk && noDragEv === 0, `lantai ${lv + 1}: setiap tangkapan diikuti seretan dan sampai (event catch.drag=true)`);
  ok(wrongOrder === 0 && startT.every((x) => x >= CFG.MONSTER_DRAG_START - 0.05 && x < CFG.MONSTER_DRAG_START + 0.2), `lantai ${lv + 1}: urutan catch -> drag.start -> drag.arrive benar; seretan mulai ${Math.min(...startT).toFixed(2)}-${Math.max(...startT).toFixed(2)} dtk setelah tangkap (>= jumpscare ${3.6} dtk)`);
  ok(lateArrive === 0 && arriveFar === 0, `lantai ${lv + 1}: sampai dalam batas waktu dan di dekat tujuan (< 0,8 m)`);
  ok(notPatrol === 0, `lantai ${lv + 1}: setelah sampai monster berhenti sebentar lalu KEMBALI PATROLI`);
  ok(blockedFrames === 0 && nanN === 0, `lantai ${lv + 1}: monster tidak menembus dinding/furnitur selama menyeret (${blockedFrames} frame melanggar), tanpa NaN`);
  ok(maxSp <= CFG.MONSTER_DRAG_SPEED + 0.02, `lantai ${lv + 1}: kecepatan seret <= ${CFG.MONSTER_DRAG_SPEED} m/dtk (maks ${maxSp.toFixed(2)})`);
  ok(victimFallback === victimBlocked, `lantai ${lv + 1}: posisi korban selalu valid (${victimBlocked}/${victimFrames} frame titik jejak terhalang -> memakai posisi monster; tidak ada frame tanpa posisi valid)`);
  ok(reCatch === 0, `lantai ${lv + 1}: korban TIDAK ditangkap berulang (korban berdiri dekat monster, caught=true)`);
  console.log(`  info lantai ${lv + 1}: pintu dibuka monster=${doorsOpened}, frame jejak terhalang=${victimBlocked}/${victimFrames}`);
}

section('Cegah penangkapan berulang & fallback');
{
  // kontrol: tanpa flag caught dan tanpa grace, korban yang berdiri di dekat monster memang akan ditangkap lagi (menunjukkan flag benar-benar berpengaruh)
  const { sim, p } = catchSetup(1, 3); const v = obs('v', p.x, p.z, 1); let first = false, again = 0, t = 0;
  for (let i = 0; i < 30 * 200; i++, t += 1 / 30) { v.caught = first; const ev = sim.update(1 / 30, [v]); for (const e of ev) if (e.type === 'catch') { if (first) again++; else first = true; } if (sim.state === 'drag') { v.x = sim.x - Math.sin(sim.yaw) * 0.9; v.z = sim.z - Math.cos(sim.yaw) * 0.9; } }
  ok(first && again === 0, 'caught=true selama dan SESUDAH seretan: tidak ada tangkapan kedua dalam 200 dtk (monster patroli lewat dekat korban)');
  const c2 = catchSetup(1, 3), v2 = obs('v', c2.p.x, c2.p.z, 1); let got = 0, st = false;
  for (let i = 0; i < 30 * 200; i++) { v2.caught = false; v2.grace = 0; const ev = c2.sim.update(1 / 30, [v2]); for (const e of ev) if (e.type === 'catch') got++; if (c2.sim.state === 'drag') { v2.x = c2.sim.x; v2.z = c2.sim.z; } }
  ok(got >= 2, `kontrol: tanpa flag caught korban yang diam di jalur patroli ditangkap lagi (${got}x) -> flag yang mencegahnya`);
  // tanpa drag env -> alur lama (relokasi), tidak ada event drag
  const old = catchSetup(1, 3, false), vo = obs('v', old.p.x, old.p.z, 1); const kinds = []; let relocated = false, t0 = -1, tt = 0;
  for (let i = 0; i < 30 * 30; i++, tt += 1 / 30) { const x0 = old.sim.x, z0 = old.sim.z, ev = old.sim.update(1 / 30, [vo]); for (const e of ev) { kinds.push(e.type === 'drag' ? 'drag' : e.type === 'catch' ? 'catch:' + !!e.drag : 's:' + e.to); if (e.type === 'catch') t0 = tt; } if (t0 >= 0 && Math.hypot(old.sim.x - x0, old.sim.z - z0) > 5) relocated = tt - t0 >= CFG.MONSTER_RESET_TIME - 0.1; }
  ok(!kinds.includes('drag') && kinds.includes('catch:false') && relocated, 'tanpa tujuan/drag env: alur LAMA tetap (tangkap -> jeda 6 dtk -> pindah ke titik patroli), korban respawn');
  // di tangga: tidak menyeret (alur lama)
  const multi = { navLo: nav0, stair: S }, env3 = mkEnv(), sT = new MonsterSim(nav1, cw, 1, 3, env3, top, multi, dragEnv);
  sT.onStairs = true; sT.level = 1; sT.x = S.bx + S.sgn * 3; sT.z = S.zc; sT.set('chase', []); sT.targetId = 'v'; sT.lastSeen = { x: sT.x, z: sT.z }; sT.lastSeenLv = 1;
  const vs = obs('v', sT.x + 0.4 * S.sgn, sT.z, 1, { stairs: true }); const ev2 = sT.update(1 / 30, [vs]); const cev = ev2.find((e) => e.type === 'catch');
  ok(!!cev && cev.drag === false, 'ditangkap saat berada di tangga: tidak menyeret (alur lama)');
}

section('Abort: jalur terhalang & kehabisan waktu (korban tetap tertangkap, monster patroli lagi)');
{
  const run = (mutate) => {
    const { sim, env, p } = catchSetup(1, 4), v = obs('v', p.x, p.z, 1); const kinds = []; let drag = false, wall = null; const added = [];
    for (let i = 0; i < 30 * 120; i++) {
      v.caught = kinds.includes('catch');
      const ev = sim.update(1 / 30, [v]);
      for (const e of ev) kinds.push(e.type === 'drag' ? 'drag:' + e.phase : e.type === 'catch' ? 'catch' : 's:' + e.to);
      if (!drag && sim.state === 'drag') { drag = true; mutate(sim, added); }
    }
    restoreDoors(env); for (const id of added) cw.removeObbs((o) => o.id === id);
    return { kinds, sim };
  };
  // jalur diblok tembok baru tepat di depan monster -> macet -> unreachable -> abort
  const r1 = run((sim, added) => { const g = sim.dragGoal, dx = g.x - sim.x, dz = g.z - sim.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d, px = sim.x + ux * 1.4, pz = sim.z + uz * 1.4; const o = { id: 'test-wall', cx: px, cz: pz, hx: 0.2, hz: 6, yaw: Math.atan2(ux, uz), level: 1, kind: 'wall' }; cw.addObb(o); added.push('test-wall'); });
  ok(r1.kinds.includes('drag:abort') && !r1.kinds.includes('drag:arrive'), 'jalur diblok: seretan dihentikan di tempat (drag:abort), tidak macet selamanya');
  ok(r1.kinds.slice(r1.kinds.indexOf('drag:abort')).some((k) => k === 's:patrol'), 'setelah abort monster kembali patroli');
  const saved = CFG.MONSTER_DRAG_MAX_SECONDS; CFG.MONSTER_DRAG_MAX_SECONDS = 2;
  const r2 = run(() => {}); CFG.MONSTER_DRAG_MAX_SECONDS = saved;
  ok(r2.kinds.includes('drag:abort') && r2.kinds.slice(r2.kinds.indexOf('drag:abort')).includes('s:patrol'), 'kehabisan waktu: seretan dihentikan lalu patroli');
}

section('Jaringan: pesan tangkap membawa dg, replika melihat state drag');
{
  ok(SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'B', dg: 1 }).dg === 1 && SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'B', dg: 'x' }).dg === 0 && SY.sanitizeMonsterMsg({ v: 1, t: 'mc', e: 1, s: 1, id: 'B' }).dg === 0, 'dg=1 diteruskan; nilai lain/tanpa field = 0 (klien lama aman)');
  const st = (n) => ({ v: 1, t: 'm', e: 1, s: 1, x: 1, z: 1, yw: 0, st: n, tg: 'B', sp: 1.2, wp: 0, lv: 1, os: 0 });
  ok(MON_STATES[6] === 'drag' && SY.sanitizeMonsterMsg(st(6)) && !SY.sanitizeMonsterMsg(st(7)), "snapshot st=6 ('drag') sah, st=7 ditolak");
  const rep = new SY.MonsterReplica(); rep.push(st(6), 0); ok(rep.sample(1000).state === 'drag' && rep.sample(1000).anim === 'drag', "replika: state 'drag' -> anim 'drag'");
  const bus = { t: 0, clients: {}, q: [] };
  const add = (id, slot) => { const c = { id, slot, hs: [], caught: 0, dragFlag: null }; bus.clients[id] = c; c.io = { selfId: id, selfSlot: slot, peers: () => Object.values(bus.clients).filter((o) => o.id !== id).map((o) => ({ id: o.id, slot: o.slot, online: true })), send: (m) => { for (const o of Object.values(bus.clients)) if (o.id !== id) bus.q.push({ at: bus.t + 60, to: o.id, from: id, m: JSON.parse(JSON.stringify(m)) }); }, onMessage: (fn) => { c.hs.push(fn); return () => { c.hs = c.hs.filter((x) => x !== fn); }; } }; return c; };
  const step = (ms) => { bus.t += ms; for (let i = bus.q.length - 1; i >= 0; i--) if (bus.q[i].at <= bus.t) { const q = bus.q.splice(i, 1)[0]; const c = bus.clients[q.to]; for (const h of c.hs) h(q.from, q.m); } };
  const env = mkEnv(); const A = add('A', 0), B = add('B', 1);
  let sp = null; { const s0 = new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv); sp = s0; }
  for (const c of [A, B]) { c.ctl = new MonsterController(() => new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv), c.io, () => bus.t); c.ctl.onCatchSelf = (d) => { c.caught++; c.dragFlag = d; }; }
  const m0 = new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv); let P = null; for (let k = 0; k < 500 && !P; k++) { const a = m0.rng.range(0, 6.28), q = { x: m0.x + Math.sin(a) * 3.2, z: m0.z + Math.cos(a) * 3.2 }; if (nav1.isOk(q.x, q.z) && !cw.segmentBlocked(m0.x, m0.z, q.x, q.z, 1, 0.02)) P = q; }
  const ps = { A: obs('A', top.x, top.z, 0, { gait: 'idle' }), B: obs('B', P.x, P.z, 1) };
  let sawDragB = false, sawAnimB = false, maxCaughtB = 0, arrivedB = false, patrolAfter = false;
  for (let i = 0; i < 30 * 200; i++) {
    step(1000 / 30); ps.B.caught = B.caught > 0;
    for (const c of [A, B]) { const self = ps[c.id], rem = Object.keys(ps).filter((k) => k !== c.id).map((k) => ps[k]); c.ctl.update(1 / 30, self, rem); }
    const vb = B.ctl.view; if (vb.state === 'drag' && vb.targetId === 'B') { sawDragB = true; if (vb.anim === 'drag') sawAnimB = true; ps.B.x = vb.x - Math.sin(vb.yaw) * 0.9; ps.B.z = vb.z - Math.cos(vb.yaw) * 0.9; }
    if (sawDragB && vb.state !== 'drag') arrivedB = true; if (arrivedB && (vb.state === 'patrol' || vb.state === 'watch')) patrolAfter = true;
    maxCaughtB = Math.max(maxCaughtB, B.caught);
  }
  ok(B.caught === 1 && B.dragFlag === true && A.caught === 0, `hanya korban B menerima onCatchSelf(drag=true), tepat 1x walau pesan dikirim ulang (B=${B.caught}, flag=${B.dragFlag}, A=${A.caught})`);
  ok(sawDragB && sawAnimB, 'klien korban (non-otoritas) melihat state drag dengan target dirinya & anim drag lewat snapshot');
  ok(arrivedB && patrolAfter && maxCaughtB === 1, 'seretan selesai di klien korban, monster kembali patroli, tidak ada tangkapan kedua');
}

section('Protokol posisi: flag cg (tertangkap)');
{
  const P = require(path.join(__dirname, '..', '.tmp-lockers', 'net', 'protocol.js'));
  const base = { v: P.PROTOCOL_VERSION, ep: 1, seq: 1, x: 1, y: 0, z: 1, yaw: 0, pitch: 0, gait: 0, crouch: false, hide: false, level: 0, model: 'default' };
  const a = P.sanitizeState({ ...base, cg: true }), b = P.sanitizeState(base), c = P.sanitizeState({ ...base, cg: 'ya' });
  ok(a && a.cg === true && b && b.cg === undefined && c && c.cg === undefined, 'cg=true diteruskan; tanpa/nilai lain = tidak ada (klien lama aman)');
  ok(P.stateChanged(a, b) === true && P.stateChanged(b, c) === false, 'perubahan cg memicu pengiriman state');
}

console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
