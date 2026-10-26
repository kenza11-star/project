// Uji v16: navigasi monster lewat TENGAH, tidak di balik daun pintu, lepas dari penghalang/pintu. GLB peta asli + pintu nyata (nav16-lib.js, doornav.js yang sama dengan game).
// Catatan jujur: kode World (three.js) tidak bisa dijalankan di sini; yang dites = MonsterNav + MonsterSim + doornav + meniru World.stepDoor/monsterEnv dengan pemanggilan fungsi murni yang sama.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const L = require('./nav16-lib.js');
const CFG = require(G + '/config.js');
const DN = require(G + '/doornav.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim } = require(G + '/monster.js');
const DP = require(G + '/dragplan.js');
const { makeRng } = require(G + '/rng.js');
const D = require(G + '/door.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md } = buildWorld(), S = md.stair, R = L.R, DT = L.DT;
const TOP = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, BOT = { x: S.bx - S.sgn * 0.6, z: S.zc };
const fixedOf = (lv) => md.colliders.filter((c) => c.obb.level === lv).map((c) => c.obb);
const doorsOf = (lv) => md.doors.filter((d) => d.level === lv && d.type === 'door').map(L.leafOf);
const NAV = { 1: new MonsterNav(cw, 1, fixedOf(1), TOP, doorsOf(1)), 0: new MonsterNav(cw, 0, fixedOf(0), BOT, doorsOf(0)) };
const SEEDPT = { 1: TOP, 0: BOT };
// "di balik daun" = benar-benar di belakang daun terbuka (sudut > sudut buka), bukan sekadar dekat ujung daun
const behind = (g, x, z) => { const c = DN.frameXY(g, x, z); return c.v > 0.05 && c.r < g.len && c.ang > Math.abs(g.openRad) + 0.05; };
const nearDoor = (gs, x, z, r) => gs.some((g) => { const c = DN.doorCenter(g); return Math.hypot(c.x - x, c.z - z) < r; });

section('Kualitas jalur: tengah koridor, tidak di balik daun, lewat tengah ambang (2 lantai, 250 jalur acak per lantai)');
for (const lv of [1, 0]) {
  const nav = NAV[lv], gs = doorsOf(lv), rng = makeRng(5 + lv); const cl = []; let pocket = 0, paths = 0, cross = 0, offMax = 0;
  for (let k = 0; k < 250; k++) {
    const a = nav.randomPoint(rng), b = nav.randomPoint(rng), p = nav.path(a.x, a.z, b.x, b.z); if (!p) continue; paths++;
    const startBehind = gs.some((g) => DN.frameXY(g, a.x, a.z).r < g.len + 0.7 && DN.frameXY(g, a.x, a.z).ang > Math.abs(g.openRad) - 0.3);   // titik awal sendiri dekat kantong: tidak dihitung
    for (const s of L.sample(a, p)) { if (!startBehind && gs.some((g) => behind(g, s.x, s.z))) pocket++; if (!nearDoor(gs, s.x, s.z, 1.3)) cl.push(L.clearance(cw, s.x, s.z, lv)); }
    let prev = a; for (const q of p) { for (const g of gs) { const f = DN.doorFrame(g), pa = (prev.x - g.hingeX) * f.nx + (prev.z - g.hingeZ) * f.nz, pb = (q.x - g.hingeX) * f.nx + (q.z - g.hingeZ) * f.nz; if (pa * pb < 0) { const t = pa / (pa - pb), al = (prev.x + (q.x - prev.x) * t - g.hingeX) * f.lx + (prev.z + (q.z - prev.z) * t - g.hingeZ) * f.lz; if (al > 0 && al < g.len) { cross++; offMax = Math.max(offMax, Math.abs(al - g.len / 2)); } } } prev = q; }
  }
  cl.sort((x, y) => x - y); const p5 = cl[Math.floor(cl.length * 0.05)], mean = cl.reduce((a, b) => a + b, 0) / cl.length;
  console.log(`  lantai ${lv + 1}: ${paths} jalur, clearance p5=${p5.toFixed(2)} rata2=${mean.toFixed(2)} m, titik di balik daun=${pocket}, lewat ambang ${cross}x (maks ${offMax.toFixed(2)} m dari tengah)`);
  ok(paths >= 200, `lantai ${lv + 1}: jalur cukup (${paths})`);
  ok(p5 >= 0.75, `lantai ${lv + 1}: 95% titik jalur (di luar ambang) >= 0,75 m dari dinding/furnitur (p5=${p5.toFixed(2)}; sebelum v16 ~0,54)`);
  ok(pocket <= 10, `lantai ${lv + 1}: jalur nyaris tidak pernah melewati area di balik daun pintu (${pocket} dari ~18000 titik; sebelum v16 ratusan; sisa = satu pintu di lorong sempit)`);
  ok(cross >= 100 && offMax <= 0.2, `lantai ${lv + 1}: ambang pintu dilewati di tengah celah (${cross} lintasan, maks ${offMax.toFixed(2)} m <= 0,20)`);
}

// ---------------- simulasi dengan pintu nyata ----------------
// Menjalankan sim; mencatat macet terlama (gerak < 0,3 m dalam 5 dtk saat sedang berjalan menuju tujuan), waktu di balik daun, loncatan posisi (teleport), clearance minimum di luar ambang.
function run(sim, W, lv, seconds, o = {}) {
  const gs = W.rts.map((r) => r.leaf), r = { stall: 0, behindT: 0, maxJump: 0, minClr: 9, drag: null, n: 0 };
  let win = [], acc = 0;
  for (let i = 0; i < seconds / DT; i++) {
    if (o.before) o.before(i, sim);
    W.rts.forEach((q) => { if (q.t !== q.target || q.pend) W.step(q, DT, sim, o.victim); });
    const ox = sim.x, oz = sim.z, ev = sim.update(DT, o.players || []);
    if (o.victim && o.trail) { o.trail.push(sim.x, sim.z); const b = o.trail.behind(); if (b) { o.victim.x = b.x; o.victim.z = b.z; } }
    { const j = Math.hypot(sim.x - ox, sim.z - oz); if (j > 0.2 && process.env.DBG) console.log('   loncat', j.toFixed(2), 'state', sim.state, 'frame', i, 'rec', !!sim.rec, sim.rec && sim.rec.phase); r.maxJump = Math.max(r.maxJump, j); }
    if (gs.some((g) => behind(g, sim.x, sim.z))) r.behindT += DT;
    const moving = ['patrol', 'investigate', 'chase', 'drag'].includes(sim.state);
    win.push({ x: sim.x, z: sim.z, m: moving }); if (win.length > 5 / DT) win.shift();
    if (win.length >= 5 / DT && win.every((w) => w.m)) { const d = Math.hypot(win[0].x - sim.x, win[0].z - sim.z); if (d < 0.3) acc += DT; else acc = 0; r.stall = Math.max(r.stall, acc); } else acc = 0;
    if (i % 3 === 0 && !nearDoor(gs, sim.x, sim.z, 1.3)) r.minClr = Math.min(r.minClr, L.clearance(cw, sim.x, sim.z, lv));
    for (const e of ev) if (e.type === 'drag') r.drag = e.phase;
    if (o.until && o.until(sim, ev)) { r.n = i; break; }
  }
  return r;
}

section('Patroli: 8 seed x 2 lantai x 6 menit, pintu nyata (tanpa macet > 5 dtk, tidak di balik daun, tanpa teleport)');
{
  const tot = { stall: 0, behind: 0, jump: 0, clr: 9, rec: 0, probe: 0, give: 0 }, bad = [];
  for (const lv of [1, 0]) for (let seed = 1; seed <= 8; seed++) {
    const W = L.mkDoors(cw, md, lv), sim = new MonsterSim(NAV[lv], cw, lv, seed * 7 + lv, W.env, SEEDPT[lv]);
    const r = run(sim, W, lv, 360); W.restore();
    tot.stall = Math.max(tot.stall, r.stall); tot.behind += r.behindT; tot.jump = Math.max(tot.jump, r.maxJump); tot.clr = Math.min(tot.clr, r.minClr); tot.rec += sim.stats.rec; tot.probe += sim.stats.probe; tot.give += sim.stats.giveUp;
    if (r.stall > 5 || r.behindT > 1) bad.push(`L${lv + 1}s${seed}:macet${r.stall.toFixed(1)}/balik${r.behindT.toFixed(1)}`);
  }
  console.log(`  macet terlama ${tot.stall.toFixed(1)} dtk; total di balik daun ${tot.behind.toFixed(1)} dtk; langkah maks ${tot.jump.toFixed(3)} m/frame; clearance min ${tot.clr.toFixed(2)} m; siklus lepas-pintu ${tot.rec}, replan penghalang ${tot.probe}, menyerah ${tot.give}`);
  ok(bad.length === 0, `tidak ada patroli macet > 5 dtk / berlama-lama di balik daun ${bad.join(' ')}`);
  ok(tot.jump <= CFG.MONSTER_CHASE_SPEED * DT * 1.6, `tanpa teleport (langkah maks ${tot.jump.toFixed(3)} m/frame)`);
  ok(tot.clr >= 0.28, `monster tidak pernah menembus/menempel dinding (clearance min ${tot.clr.toFixed(2)} m)`);
}

section('Seret: 12 tangkapan acak per lantai, korban mengikuti jejak, pintu nyata');
{
  const { DragTrail } = require(G + '/dragplan.js');
  const avoid = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
  const dragEnv = { rooms: md.rooms, avoid };
  let n = 0, arrive = 0, abort = 0, worstStall = 0, behindT = 0, trailBehind = 0, jump = 0, minClr = 9; const bad = [];
  for (const lv of [1, 0]) {
    const rng = makeRng(31 + lv);
    for (let k = 0; k < 12; k++) {
      let from = NAV[lv].randomPoint(rng); while (!NAV[lv].path(from.x, from.z, SEEDPT[lv].x, SEEDPT[lv].z)) from = NAV[lv].randomPoint(rng);
      const W = L.mkDoors(cw, md, lv), sim = new MonsterSim(NAV[lv], cw, lv, 90 + k, W.env, SEEDPT[lv], undefined, dragEnv);
      sim.x = from.x; sim.z = from.z; const plan = DP.planDrag(NAV[lv], cw, dragEnv, from, lv, rng); if (!plan) { W.restore(); continue; } n++;
      sim.state = 'drag'; sim.dragPlan = null; sim.beginDrag = undefined;
      sim.dragGoal = plan.goal; sim.dragLv = lv; sim.targetId = 'v'; sim.timer = 90; sim.path = plan.path; sim.pi = 0; sim.goal = { x: plan.goal.x, z: plan.goal.z };
      const trail = new DragTrail(); trail.seed(from.x, from.z); const victim = { x: from.x, z: from.z }, gs = W.rts.map((q) => q.leaf);
      const r = run(sim, W, lv, 100, { victim, trail, until: (s) => s.state !== 'drag' });
      if (r.drag === 'arrive' || (sim.state !== 'drag' && Math.hypot(sim.x - plan.goal.x, sim.z - plan.goal.z) < 1)) arrive++; else if (r.drag === 'abort') abort++; else bad.push(`L${lv + 1}#${k}:masih seret`);
      worstStall = Math.max(worstStall, r.stall); behindT += r.behindT; jump = Math.max(jump, r.maxJump); minClr = Math.min(minClr, r.minClr);
      if (gs.some((g) => behind(g, victim.x, victim.z))) trailBehind++;
      W.restore();
    }
  }
  console.log(`  ${n} seretan: sampai ${arrive}, dibatalkan bersih ${abort}; macet terlama ${worstStall.toFixed(1)} dtk; di balik daun ${behindT.toFixed(1)} dtk; langkah maks ${jump.toFixed(3)}; clearance min ${minClr.toFixed(2)}`);
  ok(n >= 20, `cukup seretan diuji (${n})`);
  ok(bad.length === 0 && arrive + abort === n, `setiap seretan berakhir (sampai / batal bersih), tidak menggantung ${bad.join(' ')}`);
  ok(arrive >= n * 0.9, `>= 90% seretan sampai tujuan (${arrive}/${n})`);
  ok(worstStall <= 5, `macet terlama saat menyeret <= 5 dtk (${worstStall.toFixed(1)})`);
  ok(behindT <= 1, `monster tidak berjalan di balik daun saat menyeret (${behindT.toFixed(1)} dtk)`);
  ok(jump <= CFG.MONSTER_DRAG_SPEED * DT * 2.5, `tanpa teleport saat menyeret (${jump.toFixed(3)} m/frame)`);
}

section('Lepas dari penghalang: furnitur dijatuhkan di depan monster -> tandai terhalang, ganti rute (tanpa macet)');
{
  let tested = 0, reached = 0, probes = 0, worst = 0; const bad = [];
  for (const lv of [1, 0]) {
    const rng = makeRng(77 + lv);
    for (let k = 0; k < 14; k++) {
      const a = NAV[lv].randomPoint(rng); let b = NAV[lv].randomPoint(rng), p = null;
      for (let t = 0; t < 40 && !(p && p.length >= 2); t++) { b = NAV[lv].randomPoint(rng); p = NAV[lv].path(a.x, a.z, b.x, b.z); if (p && Math.hypot(b.x - a.x, b.z - a.z) < 9) p = null; }
      if (!p) continue;
      const W = L.mkDoors(cw, md, lv), sim = new MonsterSim(NAV[lv], cw, lv, 200 + k, W.env, SEEDPT[lv]); sim.x = a.x; sim.z = a.z; sim.state = 'investigate'; sim.lastSeen = { x: b.x, z: b.z }; sim.lastSeenLv = lv; sim.yaw = Math.atan2(p[0].x - a.x, p[0].z - a.z);
      let obb = null; tested++;
      const r = run(sim, W, lv, 90, { before: (i, s) => {
        if (!obb && i > 30 && s.path.length) { const t = s.path[Math.min(s.pi, s.path.length - 1)], d = Math.hypot(t.x - s.x, t.z - s.z) || 1; const ox = s.x + ((t.x - s.x) / d) * 1.0, oz = s.z + ((t.z - s.z) / d) * 1.0;   // kotak 0,6 m tepat di jalur (furnitur bergeser / jatuh)
          if (!cw.blocked(ox, oz, 0.05, lv)) obb = cw.addObb({ id: 'tst' + k, cx: ox, cz: oz, hx: 0.3, hz: 0.3, yaw: 0.3, level: lv, kind: 'random' }); }
      }, until: (s) => Math.hypot(s.x - b.x, s.z - b.z) < 1.0 || s.state === 'search' });
      const arrived = Math.hypot(sim.x - b.x, sim.z - b.z) < 1.3 || sim.state === 'search' || sim.state === 'watch'; if (arrived) reached++; else bad.push(`L${lv + 1}#${k}`);
      probes += sim.stats.probe; worst = Math.max(worst, r.stall); if (obb) cw.removeObb(obb); W.restore();
      if (cw.blocked(sim.x, sim.z, R * 0.9, lv) && false) bad.push('terjepit');
    }
  }
  console.log(`  ${tested} uji: sampai/menyerah bersih ${reached}; replan sapuan-depan ${probes}; macet terlama ${worst.toFixed(1)} dtk`);
  ok(tested >= 20, `cukup uji (${tested})`);
  ok(reached === tested, `monster selalu melewati / mengganti rute di sekitar penghalang baru ${bad.join(' ')}`);
  ok(worst <= 5, `macet terlama <= 5 dtk (${worst.toFixed(1)})`);
  ok(probes > 0, `sapuan-depan benar-benar aktif (${probes} replan)`);
}

section('Terjebak di zona pintu: di balik daun terbuka / di sapuan daun -> mundur, tutup, titik tengah, rencana ulang, keluar lewat tengah ambang');
{
  let tested = 0, out = 0, closedMsg = 0, worstExit = 0, goalOk = 0, jump = 0; const bad = [];
  for (const lv of [1, 0]) {
    const gsAll = doorsOf(lv);
    md.doors.filter((d) => d.level === lv && d.type === 'door' && !d.locked).forEach((d) => {
      const g = L.leafOf(d), f = DN.doorFrame(g);
      // titik di balik daun (sudut buka 90 deg: sisi engsel, 0,35 m dari dinding & 0,2 m di balik daun), dan titik di sapuan (di depan daun, 0,5 m dari dinding)
      const toW = (u, v) => ({ x: g.hingeX + f.lx * u + f.nx * f.sw * v, z: g.hingeZ + f.lz * u + f.nz * f.sw * v });
      for (const [kind, pt] of [['balik', toW(-0.2, 0.55)], ['sapuan', toW(g.len * 0.6, 0.5)]]) {
        const st = NAV[lv].snap(pt.x, pt.z, 0.3) || null; if (!st || cw.blocked(st.x, st.z, R, lv)) continue; if (kind === 'balik' && !behind(g, st.x, st.z)) continue;
        const W = L.mkDoors(cw, md, lv), rt = W.rts.find((q) => q.d === d);
        let goal = null; { const gr = makeRng(11 + tested); for (let t = 0; t < 200 && !goal; t++) { const c = NAV[lv].randomPoint(gr), dd = Math.hypot(c.x - st.x, c.z - st.z); if (dd > 5 && dd < 12 && NAV[lv].path(st.x, st.z, c.x, c.z)) goal = c; } } if (!goal) { W.restore(); continue; }
        if (kind === 'balik') { rt.t = 1; rt.target = 1; D.applyPose(rt.obb, rt.leaf, 1); } else { rt.t = 0.5; rt.target = 1; D.applyPose(rt.obb, rt.leaf, D.ease(0.5)); }
        if (cw.blocked(st.x, st.z, R * 0.7, lv) && kind === 'sapuan') { /* leaf menimpa: sim mendorong keluar sendiri */ }
        const sim = new MonsterSim(NAV[lv], cw, lv, 5, W.env, SEEDPT[lv]); sim.x = st.x; sim.z = st.z; sim.state = 'investigate'; sim.lastSeen = { x: goal.x, z: goal.z }; sim.lastSeenLv = lv; tested++;
        let exitT = -1;
        const r = run(sim, W, lv, 60, { until: (s) => Math.hypot(s.x - goal.x, s.z - goal.z) < 1.0 || s.state === 'search', before: (i, s) => { if (exitT < 0 && !DN.trapGeo(rt.leaf, s.x, s.z, R)) exitT = i * DT; } });
        const arrived = Math.hypot(sim.x - goal.x, sim.z - goal.z) < 1.3 || sim.state === 'search';
        if (arrived) goalOk++; else bad.push(`L${lv + 1}${d.name}/${kind}`);
        if (exitT >= 0) { out++; worstExit = Math.max(worstExit, exitT); } else bad.push(`L${lv + 1}${d.name}/${kind}:tak keluar zona`);
        if (W.net.some((m) => m.o === 0)) closedMsg++;
        jump = Math.max(jump, r.maxJump); W.restore();
      }
    });
  }
  console.log(`  ${tested} skenario: keluar zona ${out}, sampai tujuan ${goalOk}, pesan tutup-pintu tersinkron ${closedMsg}x; keluar terlama ${worstExit.toFixed(1)} dtk; langkah maks ${jump.toFixed(3)} m/frame`);
  ok(tested >= 30, `cukup skenario (${tested})`);
  ok(out >= tested * 0.95, `monster keluar dari zona pintu (${out}/${tested}) ${bad.slice(0, 6).join(' ')}`);
  ok(goalOk >= tested * 0.95, `monster melanjutkan ke tujuan (${goalOk}/${tested})`);
  ok(worstExit <= 12, `keluar zona <= 12 dtk (${worstExit.toFixed(1)})`);
  ok(jump <= CFG.MONSTER_INVESTIGATE_SPEED * DT * 2.5, `tanpa teleport saat lepas dari pintu (${jump.toFixed(3)} m/frame)`);
}

section('Terjebak permanen (daun ditahan): siklus terbatas lalu menyerah / seret batal; tidak mengulang selamanya');
{
  const lv = 1, d = md.doors.find((q) => q.level === lv && q.type === 'door' && !q.locked), g = L.leafOf(d), f = DN.doorFrame(g);
  const toW = (u, v) => ({ x: g.hingeX + f.lx * u + f.nx * f.sw * v, z: g.hingeZ + f.lz * u + f.nz * f.sw * v });
  const W = L.mkDoors(cw, md, lv), rt = W.rts.find((q) => q.d === d), st = NAV[lv].snap(...(() => { const c = toW(-0.2, 0.55); return [c.x, c.z]; })(), 0.3);
  W.env.closeDoor = () => false;   // pintu tak pernah bisa ditutup (mis. ada pemain di ambang)
  rt.t = 1; rt.target = 1; D.applyPose(rt.obb, rt.leaf, 1);
  const goal = NAV[lv].snap(toW(g.len / 2, -2.2).x, toW(g.len / 2, -2.2).z, 2), sim = new MonsterSim(NAV[lv], cw, lv, 5, W.env, SEEDPT[lv]);
  sim.x = st.x; sim.z = st.z; sim.state = 'drag'; sim.dragGoal = goal; sim.dragLv = lv; sim.targetId = 'v'; sim.timer = 90; sim.goal = { x: goal.x, z: goal.z };
  let evs = [], t = 0; const trapAlways = { ...W.env, doorTrap: (x, z) => ({ idx: 0, pocket: true, bx: 0, bz: 1, dist: 1, via: null, exit: { x: st.x + 0.01, z: st.z } }) };
  const sim2 = new MonsterSim(NAV[lv], cw, lv, 5, trapAlways, SEEDPT[lv]); sim2.x = st.x; sim2.z = st.z; sim2.state = 'drag'; sim2.dragGoal = goal; sim2.dragLv = lv; sim2.targetId = 'v'; sim2.timer = 90; sim2.goal = { x: goal.x, z: goal.z };
  for (; t < 60 / DT && sim2.state === 'drag'; t++) evs.push(...sim2.update(DT, []));
  const ab = evs.find((e) => e.type === 'drag' && e.phase === 'abort');
  ok(!!ab && sim2.state !== 'drag', `jebakan tak terpecahkan: seretan dibatalkan (bukan loop abadi) setelah ${(t * DT).toFixed(1)} dtk`);
  ok(sim2.stats.rec === CFG.MONSTER_UNSTICK_CYCLES, `tepat ${CFG.MONSTER_UNSTICK_CYCLES} siklus lepas-pintu sebelum menyerah (${sim2.stats.rec})`);
  W.restore();
  // patroli: jebakan tak terpecahkan -> titik patroli lain (tidak membeku)
  const W2 = L.mkDoors(cw, md, lv), s3 = new MonsterSim(NAV[lv], cw, lv, 5, { ...W2.env, doorTrap: trapAlways.doorTrap, closeDoor: () => false }, SEEDPT[lv]); s3.x = st.x; s3.z = st.z; const wp0 = s3.wp;
  for (let i = 0; i < 40 / DT; i++) s3.update(DT, []);
  ok(s3.stats.giveUp >= 1 && s3.wp !== wp0, `patroli: menyerah lalu memilih waypoint lain (menyerah ${s3.stats.giveUp}x, wp ${wp0}->${s3.wp})`);
  // restore() (host berpindah) membersihkan urutan lepas-pintu
  s3.restore({ x: st.x, z: st.z, yaw: 0 }); ok(s3.state === 'patrol', 'restore (otoritas baru): kembali patroli bersih');
}

section('Multiplayer: pintu yang ditutup/dibuka monster dikirim sebagai pesan \'door\' (otoritas), replika hanya menerapkan');
{
  const lv = 1, d = md.doors.find((q) => q.level === lv && q.type === 'door' && !q.locked), W = L.mkDoors(cw, md, lv), rt = W.rts.find((q) => q.d === d), i = W.rts.indexOf(rt);
  rt.t = 1; rt.target = 1; const idle = W.env.closeDoor(i, lv);
  ok(!idle && rt.target === 0 && W.net.length === 1 && W.net[0].k === 'door' && W.net[0].i === i && W.net[0].o === 0, 'closeDoor: kirim tepat satu pesan door o:0 (idempoten bila dipanggil tiap frame)');
  W.env.closeDoor(i, lv); W.env.closeDoor(i, lv); ok(W.net.length === 1, 'pemanggilan ulang tidak membanjiri jaringan');
  // replika: terapkan pesan -> pintu menutup sendiri lewat animasi lokal yang sama (target diset, bukan teleport)
  const replica = L.mkDoors(cw, md, lv), rr = replica.rts[i]; rr.t = 1; rr.target = 1; rr.target = W.net[0].o; for (let k = 0; k < 120; k++) replica.step(rr, DT, null); ok(rr.t === 0, 'replika: pintu menutup penuh lewat animasi lokal setelah menerima pesan');
  W.restore(); replica.restore();
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
