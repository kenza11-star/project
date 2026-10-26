// Uji STAGE B: penjara tersambung FISIK (pintu jeruji di dinding timur -> koridor -> antechamber -> sel) tanpa teleport.
// GLB peta asli + data geometri penjara asli (prisonroom.ts) dipasang ke collision persis seperti PrisonRoom (tanpa three.js).
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const PR = require(G + '/prisonroom.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const { cw, md } = buildWorld();
const S = md.stair, UP = CFG.MONSTER_LEVEL, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, bot = { x: S.bx - S.sgn * 0.6, z: S.zc };

// ---- pasang geometri penjara seperti PrisonRoom (prison.ts konstruktor + buildDoor + buildGate)
const beforeSolid = Uint8Array.from(cw.solid[1]);
cw.clearRect(PR.PRISON_LEVEL, PR.PRISON_GATE_CUT.minx, PR.PRISON_GATE_CUT.minz, PR.PRISON_GATE_CUT.maxx, PR.PRISON_GATE_CUT.maxz);
const afterClear = Uint8Array.from(cw.solid[1]);
cw.walkEx[PR.PRISON_LEVEL] = PR.PRISON_WALK.map((b) => ({ ...b }));
for (const w of PR.PRISON_WALLS) cw.fillRect(PR.PRISON_LEVEL, w.minx, w.minz, w.maxx, w.maxz);
for (const p of PR.PRISON_PROPS) cw.addObb({ id: p.id, cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, yaw: p.yaw, level: PR.PRISON_LEVEL, kind: 'fixed' });
const cellObb = cw.addObb({ ...PR.PRISON_DOOR.obb, level: PR.PRISON_LEVEL, kind: 'door' }), gateObb = cw.addObb({ ...PR.PRISON_GATE.obb, level: PR.PRISON_LEVEL, kind: 'door' });
const fixedUp = cw.obbs.filter((o) => o.level === UP && !o.id.startsWith('door:') && o.id !== 'prison-door' && o.id !== 'prison-gate');   // sama dengan World.buildMonsterNav
const fixedLo = md.colliders.filter((c) => c.obb.level === 0).map((c) => c.obb);
const navUp = new MonsterNav(cw, UP, fixedUp, top), navLo = new MonsterNav(cw, 0, fixedLo, bot);
const setDoors = (gate, cell) => { gateObb.enabled = gate; cellObb.enabled = cell; };

section('Lubang di dinding & batas jalan');
{
  let outside = 0, changed = 0; const G0 = PR.PRISON_GATE_CUT;
  for (let j = 0; j < cw.H; j++) for (let i = 0; i < cw.W; i++) if (afterClear[j * cw.W + i] !== beforeSolid[j * cw.W + i]) { changed++; const x = cw.x0 + (i + 0.5) * cw.cell, z = cw.z0 + (j + 0.5) * cw.cell; if (x < G0.minx - cw.cell || x > G0.maxx + cw.cell || z < G0.minz - cw.cell || z > G0.maxz + cw.cell) outside++; }
  ok(changed > 0 && outside === 0, `pengosongan collision hanya di lubang dinding (${changed} sel berubah, ${outside} di luar lubang)`);
  setDoors(true, true);
  ok(cw.blocked(PR.PRISON_GATE.x, PR.PRISON_GATE.z, 0.3, 1), 'pintu jeruji TERTUTUP: padat untuk gerak (pemain tidak bisa lewat)');
  setDoors(false, true);
  ok(!cw.blocked(PR.PRISON_GATE.x, PR.PRISON_GATE.z, 0.3, 1), 'pintu jeruji TERBUKA: jalan lewat lubang dinding bebas untuk pemain (r 0,3)');
  let cnt = 0; for (let x = PR.PRISON_GATE.arrive.x; x <= 46; x += 0.1) if (cw.blocked(x, 31.15, 0.3, 1)) cnt++;
  ok(cnt === 0, 'garis lurus dari titik berdiri di ujung tangga sampai antechamber bebas bagi pemain (pintu terbuka)');
  ok(cw.blocked(40, 29.5, 0.3, 1) && cw.blocked(40, 33, 0.3, 1), 'di luar koridor tetap padat (tidak bocor ke luar bangunan)');
  const gap = PR.PRISON_HALL; ok(gap.maxz - gap.minz >= 1.5, 'lebar koridor >= 1,5 m (muat badan monster)');
}

section('Nav monster lantai atas mencakup koridor + penjara (tanpa bocor)');
{
  let leak = 0, inZone = 0;
  for (let j = 0; j < navUp.H; j++) for (let i = 0; i < navUp.W; i++) if (navUp.ok[j * navUp.W + i]) { const c = navUp.center(j * navUp.W + i); if (c.x > 38.6) { if (PR.inPrison(c.x, c.z, 0.5)) inZone++; else leak++; } }
  ok(inZone > 200 && leak === 0, `sel nav di timur dinding hanya di koridor/penjara (${inZone} sel, bocor ${leak})`);
  const stands = PR.PRISON_SLOTS.map((_, i) => PR.slotStand(i));
  ok(stands.every((s) => navUp.isOk(s.x, s.z) || navUp.snap(s.x, s.z, 0.6)), 'titik berdiri 6 slot bisa dijangkau nav');
  ok(stands.every((s) => !cw.blocked(s.x, s.z, 0.3, 1)), 'titik berdiri 6 slot bebas collision');
  ok(new Set(stands.map((s) => s.x.toFixed(2) + ',' + s.z.toFixed(2))).size === 6, '6 titik berdiri berbeda');
  const lens = stands.map((s) => { const p = navUp.path(top.x, top.z, s.x, s.z); if (!p) return -1; let L = dist(top, p[0]); for (let k = 1; k < p.length; k++) L += dist(p[k - 1], p[k]); return L; });
  ok(lens.every((l) => l > 10 && l < 60), `rute nyata dari ujung tangga ke tiap slot ada: ${lens.map((l) => l.toFixed(0)).join('/')} m`);
}

const mkEnv = (canOpen = true) => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) {
  if (!canOpen) return false;
  if (level === UP && gateObb.enabled && Math.hypot(x - PR.PRISON_GATE.x, z - PR.PRISON_GATE.z) < 2.0) { gateObb.enabled = false; return true; }
  if (level === UP && cellObb.enabled && Math.hypot(x - PR.PRISON_DOOR.cx, z - PR.PRISON_DOOR.cz) < PR.PRISON_DOOR.reach) { cellObb.enabled = false; return true; }
  const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return true; } }; };
const restore = (env) => { for (const n of env.op) { const d = md.doors.find((q) => q.name === n); cw.removeObbs((o) => o.id === 'door:' + n); cw.addObb(d.closedObb); } env.op.clear(); setDoors(true, true); };
const dragEnv = { rooms: md.rooms, avoid: [], prison: { x: PR.slotStand(0).x, z: PR.slotStand(0).z, lv: UP, slotGoal: (i) => PR.slotStand(i) } };
const obs = (id, x, z, level, o = {}) => ({ id, x, z, level, gait: 'run', crouch: false, hidden: false, grace: 0, stairs: false, ...o });

section('Patroli tidak masuk penjara');
{ let bad = 0; for (let s = 1; s <= 12; s++) { const sim = new MonsterSim(navUp, cw, UP, s, mkEnv(), top, { navLo, stair: S }, dragEnv); bad += sim.waypoints.filter((p) => PR.inPrison(p.x, p.z, 0.5)).length; } ok(bad === 0, `titik patroli acak tidak ada di koridor/penjara (${bad})`); }

section('Seret ke slot lewat rute nyata (tanpa teleport)');
for (const lv of [UP, 0]) {
  let arrived = 0, total = 0, maxJump = 0, blockedHall = 0, left = 0, closeToSlot = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const slot = (seed - 1) % PR.PRISON_SLOTS.length, env = mkEnv(); setDoors(true, true);
    const sim = new MonsterSim(navUp, cw, UP, seed, env, top, { navLo, stair: S }, dragEnv), nav = lv === UP ? navUp : navLo;
    let p0; do { p0 = nav.randomPoint(sim.rng); } while (PR.inPrison(p0.x, p0.z, 1));
    sim.x = p0.x; sim.z = p0.z; sim.level = lv; sim.state = 'chase'; sim.targetId = 'me';
    const v = obs('me', p0.x + 0.5, p0.z, lv); let caught = false;
    for (let i = 0; i < 4000 && !caught; i++) { sim.lastSeen = { x: v.x, z: v.z }; for (const e of sim.update(0.05, [v])) if (e.type === 'catch') { caught = true; sim.setDragSlot(slot); } }
    if (!caught) continue; total++;
    let end = null, prev = { x: sim.x, z: sim.z }, steps = 0;
    for (let i = 0; i < 240 / 0.05 && !end; i++) {
      for (const e of sim.update(0.05, [{ ...v, caught: true }])) if (e.type === 'drag' && e.phase !== 'start') end = e;
      const cur = { x: sim.x, z: sim.z }; if (sim.state === 'drag' && !sim.onStairs) maxJump = Math.max(maxJump, dist(prev, cur)); prev = cur; steps++;
      if (sim.state === 'drag' && sim.level === UP && sim.x > 38.6 && sim.x < 45.2 && !gateObb.enabled && cw.blocked(sim.x, sim.z, 0.3, 1)) blockedHall++;   // korban menyusul di jejak monster: titik jejak harus bisa dilewati
    }
    if (process.env.DBG) console.log('   seed', seed, 'slot', slot, 'end', end && end.phase, 'pos', sim.x.toFixed(1), sim.z.toFixed(1), 'state', sim.state, 'steps', steps);
    if (end && end.phase === 'arrive') { arrived++; if (dist(end, PR.slotStand(slot)) < 1.0 && sim.level === UP) closeToSlot++; }
    // sesudah menyeret: monster pergi lewat pintu & koridor kembali ke mezz (tanpa teleport)
    for (let i = 0; i < 160 / 0.05; i++) { sim.update(0.05, [{ ...v, caught: true }]); const cur = { x: sim.x, z: sim.z }; if (!sim.onStairs) maxJump = Math.max(maxJump, dist(prev, cur)); prev = cur; }
    if (!PR.inPrison(sim.x, sim.z, 0.5)) left++;
    restore(env);
  }
  console.log(`  lantai ${lv}: tiba=${arrived}/${total} dekat slot=${closeToSlot} keluar penjara=${left} loncatan maks=${maxJump.toFixed(2)} m/frame`);
  ok(total >= 5 && arrived === total, `lantai ${lv}: semua seretan sampai di penjara lewat rute nyata (${arrived}/${total})`);
  ok(closeToSlot === arrived, `lantai ${lv}: monster berhenti di depan slot yang dipilih (<1 m)`);
  ok(maxJump < 0.25, `lantai ${lv}: tidak ada teleport/loncatan posisi (maks ${maxJump.toFixed(2)} m per frame 0,05 dtk)`);
  ok(blockedHall === 0, `lantai ${lv}: jejak monster di koridor selalu bisa dilewati korban (${blockedHall} titik terblok)`);
  ok(left === total, `lantai ${lv}: sesudah menyeret monster keluar dari penjara dan kembali patroli (${left}/${total})`);
}

section('Pintu tak bisa dibuka: seretan berhenti di depan pintu, tidak menembus & tidak teleport');
{
  const env = mkEnv(false); setDoors(true, true);
  const sim = new MonsterSim(navUp, cw, UP, 3, env, top, { navLo, stair: S }, dragEnv); sim.x = top.x; sim.z = top.z; sim.level = UP; sim.state = 'chase'; sim.targetId = 'me';
  const v = obs('me', sim.x + 0.4, sim.z, UP); let caught = false, end = null, maxX = 0, jump = 0, prev = { x: sim.x, z: sim.z };
  for (let i = 0; i < 4000 && !caught; i++) { sim.lastSeen = { x: v.x, z: v.z }; for (const e of sim.update(0.05, [v])) if (e.type === 'catch') { caught = true; sim.setDragSlot(2); } }
  for (let i = 0; i < 200 / 0.05 && !end; i++) { for (const e of sim.update(0.05, [{ ...v, caught: true }])) if (e.type === 'drag' && e.phase !== 'start') end = e; maxX = Math.max(maxX, sim.x); jump = Math.max(jump, dist(prev, { x: sim.x, z: sim.z })); prev = { x: sim.x, z: sim.z }; }
  ok(caught && !!end && end.phase === 'abort', `tanpa pintu terbuka seretan berakhir abort (${end ? end.phase : 'tak selesai'})`);
  ok(maxX < 38.2 && jump < 0.25, `monster tidak menembus dinding/pintu (x maks ${maxX.toFixed(2)}) dan tidak melompat (${jump.toFixed(2)})`);
  restore(env);
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
