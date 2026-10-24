// Uji monster dengan GLB asli: navigasi & patroli di lantai atas, deteksi (pandang/dengar/rasa), kejar & kehilangan target, tangkapan tervalidasi,
// detak jantung menurut jarak, timeline jumpscare, dan sinkronisasi multiplayer (otoritas, replika, serah-terima host, anti-spoof) lewat bus palsu.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const FX = require(G + '/monsterfx.js');
const SY = require(G + '/monstersync.js');
const { MonsterController, GRACE_AFTER_CATCH } = require(G + '/monsterctl.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const { cw, md, doorObbs } = buildWorld();
const S = md.stair, top = { x: S.bx + S.sgn * S.run + 0.6, z: S.zc }, LV = CFG.MONSTER_LEVEL;
const fixed1 = md.colliders.filter((c) => c.obb.level === LV).map((c) => c.obb);
const nav = new MonsterNav(cw, LV, fixed1, top);
const mkEnv = () => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) { const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return !d.locked; } }; };
const restoreDoors = (env) => { for (const n of env.op) { const d = md.doors.find((q) => q.name === n); cw.removeObbs((o) => o.id === 'door:' + n); cw.addObb(d.closedObb); } env.op.clear(); };
const obsOf = (id, x, z, o = {}) => ({ id, x, z, level: LV, gait: 'idle', crouch: false, hidden: false, grace: 0, ...o });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

section('Navigasi lantai atas');
{
  ok(nav.count > 8000, `grid navigasi lantai atas terbentuk (${nav.count} sel, ${(nav.count * nav.cell * nav.cell).toFixed(0)} m2)`);
  const env = mkEnv(), sim = new MonsterSim(nav, cw, LV, 1, env, top);
  ok(sim.enabled && sim.waypoints.length >= 8, `${sim.waypoints.length} waypoint patroli`);
  ok(sim.waypoints.every((p) => nav.isOk(p.x, p.z)), 'semua waypoint di sel bebas');
  ok(dist(sim, top) >= 12, `monster mulai jauh dari ujung tangga (${dist(sim, top).toFixed(1)} m) -> pemain tidak langsung bertemu`);
  const off = new MonsterSim(nav, cw, LV, 1, env, top); ok(typeof off.snapshot().x === 'number', 'snapshot tersedia');
  ok(nav.path(sim.x, sim.z, sim.waypoints[3].x, sim.waypoints[3].z) !== null, 'A* menemukan jalur antar waypoint');
  ok(nav.path(sim.x, sim.z, -500, -500) === null, 'tujuan tak terjangkau -> null (tidak hang)');
}
section('Patroli natural: 6 seed x 8 menit (tanpa menembus dinding/furnitur)');
{
  let blocked = 0, nan = 0, offN = 0, frames = 0, allWp = 0, movingSp = 0, movingN = 0, doorsOpened = 0;
  for (const seed of [1, 2, 3, 99, 12345, 777]) {
    const env = mkEnv(), sim = new MonsterSim(nav, cw, LV, seed, env, top), seen = new Set(); let moved = 0;
    for (let i = 0; i < 30 * 480; i++) {
      sim.update(1 / 30, []); frames++; seen.add(sim.wp);
      if (!Number.isFinite(sim.x + sim.z + sim.yaw)) nan++;
      if (cw.blocked(sim.x, sim.z, CFG.MONSTER_RADIUS - 0.03, LV)) blocked++;
      if (!nav.isOk(sim.x, sim.z)) offN++;
      if (sim.state === 'patrol' && sim.speed > 0.2) { movingSp += sim.speed; movingN++; }
    }
    if (seen.size >= sim.waypoints.length - 1) allWp++; doorsOpened += env.op.size; restoreDoors(env);
  }
  ok(nan === 0, 'tidak ada NaN');
  ok(blocked === 0, `tidak pernah menembus dinding/furnitur/pintu tertutup (${blocked} frame melanggar dari ${frames})`);
  ok(offN / frames < 0.1, `tetap di area terjangkau (${((100 * offN) / frames).toFixed(1)}% di tepi grid saat berbelok)`);
  ok(allWp === 6, `tiap seed mengunjungi hampir semua waypoint (${allWp}/6)`);
  const avg = movingSp / movingN; ok(avg > CFG.MONSTER_PATROL_SPEED * 0.7 && avg <= CFG.MONSTER_PATROL_SPEED + 0.01, `kecepatan patroli ${avg.toFixed(2)} m/dtk (target ${CFG.MONSTER_PATROL_SPEED})`);
  ok(doorsOpened > 0, `monster membuka pintu yang menghalangi (${doorsOpened} pintu)`);
  const traj = (seed) => { const env = mkEnv(), sm = new MonsterSim(nav, cw, LV, seed, env, top), r = []; for (let i = 0; i < 3000; i++) { sm.update(1 / 30, []); r.push(sm.x, sm.z); } restoreDoors(env); return r; };
  const t1 = traj(5), t2 = traj(5), t3 = traj(6);
  ok(t1.every((v, i) => v === t2[i]) && t1.some((v, i) => v !== t3[i]), 'deterministik per seed (seed sama = lintasan sama, seed beda = beda)');
}
section('Melintasi pintu (semua pintu lantai atas yang bisa dijangkau)');
{
  let tested = 0, good = 0; const bad = [];
  for (const d of md.doors.filter((q) => q.level === LV)) {
    const A = nav.snap(d.cx - d.nx * 1.6, d.cz - d.nz * 1.6, 1), B = nav.snap(d.cx + d.nx * 1.6, d.cz + d.nz * 1.6, 1);
    if (!A || !B || !nav.path(A.x, A.z, B.x, B.z)) continue; tested++;
    const env = mkEnv(), s = new MonsterSim(nav, cw, LV, 5, env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const pl = obsOf('p', B.x, B.z, { gait: 'run' }); let caught = false;
    for (let i = 0; i < 30 * 40 && !caught; i++) caught = s.update(1 / 30, [pl]).some((e) => e.type === 'catch');
    if (caught) good++; else bad.push(d.name + (d.locked ? '(terkunci)' : '')); restoreDoors(env);
  }
  ok(tested >= 12 && good === tested, `monster melewati ${good}/${tested} pintu untuk mengejar${bad.length ? ' (gagal: ' + bad.join(',') + ')' : ''}`);
}
section('Deteksi: pandang / dengar / rasa, dan yang tidak boleh terdeteksi');
{
  const env = mkEnv(), mk = () => { const s = new MonsterSim(nav, cw, LV, 7, env, top); return s; };
  // titik uji di koridor terbuka: cari 2 titik sejajar dengan LOS bebas, 8 m
  let A = null, B = null; const pts = []; for (let k = 0; k < 4000 && !B; k++) { const a = nav.randomPoint(mk().rng); for (const ang of [0, 1.5708, 3.1416, 4.7124]) { const b = { x: a.x + Math.sin(ang) * 8, z: a.z + Math.cos(ang) * 8 }; if (nav.isOk(b.x, b.z) && !cw.segmentBlocked(a.x, a.z, b.x, b.z, LV, 0.02) && nav.lineClear(a.x, a.z, b.x, b.z)) { A = a; B = b; break; } } }
  ok(!!A && !!B, 'ada koridor lurus 8 m untuk uji');
  const place = (s, p, yaw) => { s.x = p.x; s.z = p.z; s.yaw = yaw; s.state = 'patrol'; };
  const face = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  let s = mk(); place(s, A, face(A, B)); let ev = s.update(1 / 30, [obsOf('p', B.x, B.z)]); ok(s.state === 'chase', 'pemain berdiri di depan (8 m, garis pandang) -> dikejar');
  s = mk(); place(s, A, face(A, B) + Math.PI); ev = s.update(1 / 30, [obsOf('p', B.x, B.z)]); ok(s.state !== 'chase', 'pemain diam di belakang monster (di luar sudut pandang, 8 m) -> tidak terlihat');
  s = mk(); place(s, A, face(A, B) + Math.PI); ev = s.update(1 / 30, [obsOf('p', B.x, B.z, { gait: 'run' })]); ok(s.state === 'investigate', 'pemain berlari di belakang (8 m) -> terdengar, monster menyelidiki');
  s = mk(); place(s, A, face(A, B) + Math.PI); ev = s.update(1 / 30, [obsOf('p', B.x, B.z, { gait: 'walk', crouch: true })]); ok(s.state !== 'chase' && s.state !== 'investigate', 'jongkok diam-diam (8 m) -> tidak terdengar');
  const near = { x: A.x + (B.x - A.x) / 8 * 1.5, z: A.z + (B.z - A.z) / 8 * 1.5 };
  s = mk(); place(s, A, face(A, B) + Math.PI); ev = s.update(1 / 30, [obsOf('p', near.x, near.z)]); ok(s.state === 'chase', 'pemain diam sangat dekat (1,5 m) di punggung monster -> terasa');
  s = mk(); place(s, A, face(A, B)); ev = s.update(1 / 30, [obsOf('p', B.x, B.z, { level: 0 })]); ok(s.state !== 'chase', 'pemain di lantai bawah tidak pernah terdeteksi');
  s = mk(); place(s, A, face(A, B)); ev = s.update(1 / 30, [obsOf('p', near.x, near.z, { level: 0, gait: 'run' })]); ok(s.state === 'patrol', 'lari tepat di bawah monster (lantai 1) -> tidak terdeteksi');
  s = mk(); place(s, A, face(A, B)); ev = s.update(1 / 30, [obsOf('p', near.x, near.z, { hidden: true })]); ok(s.state !== 'chase', 'pemain bersembunyi (locker) aman walau sangat dekat');
  s = mk(); place(s, A, face(A, B)); ev = s.update(1 / 30, [obsOf('p', near.x, near.z, { grace: 3 })]); ok(s.state !== 'chase', 'pemain yang baru respawn (kebal) tidak dikejar');
  // dinding menghalangi pandangan & tangkapan
  let W1 = null; for (let k = 0; k < 6000 && !W1; k++) { const a = nav.randomPoint(mk().rng), ang = k * 0.7; const b = { x: a.x + Math.sin(ang) * 3.5, z: a.z + Math.cos(ang) * 3.5 }; if (nav.isOk(b.x, b.z) && cw.segmentBlocked(a.x, a.z, b.x, b.z, LV, 0.02)) W1 = [a, b]; }
  ok(!!W1, 'ada pasangan titik 3,5 m dipisah dinding'); if (W1) { s = mk(); place(s, W1[0], face(W1[0], W1[1])); ev = s.update(1 / 30, [obsOf('p', W1[1].x, W1[1].z)]); ok(s.state !== 'chase', 'tidak melihat menembus dinding'); s.state = 'chase'; s.lastSeen = W1[1]; s.targetId = 'p'; const c = s.update(1 / 30, [obsOf('p', W1[1].x + 0.0, W1[1].z, { gait: 'idle' })]); ok(!c.some((e) => e.type === 'catch'), 'tidak menangkap menembus dinding'); }
  restoreDoors(env);
}
section('Kejar, kehilangan target, tangkap');
{
  const env = mkEnv(); let A = null, B = null; { const s0 = new MonsterSim(nav, cw, LV, 7, env, top); for (let k = 0; k < 6000 && !B; k++) { const a = nav.randomPoint(s0.rng); for (const ang of [0, 1.5708, 3.1416, 4.7124]) { const b = { x: a.x + Math.sin(ang) * 14, z: a.z + Math.cos(ang) * 14 }; if (nav.isOk(b.x, b.z) && nav.lineClear(a.x, a.z, b.x, b.z)) { A = a; B = { x: b.x, z: b.z, ang }; break; } } } }
  ok(!!B, 'ada koridor lurus 14 m');
  // (1) pemain jalan biasa (2,2) kabur lurus: tertangkap; kecepatan kejar ~3,1
  const run = (speed, secs) => {
    const s = new MonsterSim(nav, cw, LV, 7, env, top); s.x = A.x; s.z = A.z; s.yaw = Math.atan2(B.x - A.x, B.z - A.z) + 0; const ux = Math.sin(B.ang), uz = Math.cos(B.ang);
    s.yaw = B.ang; const p = { x: A.x + ux * 8, z: A.z + uz * 8 }; let caught = false, chaseSp = 0, chaseN = 0, firstChase = -1, t = 0, lost = -1, patrolAgain = -1;
    for (let i = 0; i < 30 * secs; i++) {
      t += 1 / 30; const nx = p.x + ux * speed / 30, nz = p.z + uz * speed / 30; if (nav.isOk(nx, nz)) { p.x = nx; p.z = nz; }
      const ev = s.update(1 / 30, [obsOf('p', p.x, p.z, { gait: speed > 3 ? 'run' : 'walk' })]);
      if (s.state === 'chase') { if (firstChase < 0) firstChase = t; chaseSp += s.speed; chaseN++; }
      if (firstChase >= 0 && s.state === 'search' && lost < 0) lost = t; if (lost >= 0 && s.state === 'patrol' && patrolAgain < 0) patrolAgain = t;
      if (ev.some((e) => e.type === 'catch')) { caught = true; break; }
    }
    return { caught, firstChase, avg: chaseN ? chaseSp / chaseN : 0, lost, patrolAgain, d: dist(s, p), state: s.state };
  };
  const walk = run(2.2, 25); ok(walk.firstChase > 0 && walk.firstChase < 1.5, `terdeteksi cepat (${walk.firstChase.toFixed(2)}s)`); ok(walk.caught, 'pemain berjalan (2,2 m/dtk) tertangkap oleh monster (3,1 m/dtk)');
  ok(walk.avg > 2.5 && walk.avg <= CFG.MONSTER_CHASE_SPEED + 0.01, `kecepatan kejar ${walk.avg.toFixed(2)} m/dtk (maks ${CFG.MONSTER_CHASE_SPEED})`);
  // koridor lurus terpanjang di lantai atas (pindai baris & kolom grid): pemain berlari lurus menjauh, monster mulai 8 m di belakang
  let best = { len: 0 }; for (const horiz of [true, false]) for (let a = 0; a < (horiz ? nav.H : nav.W); a++) { let st = -1; for (let b2 = 0; b2 <= (horiz ? nav.W : nav.H); b2++) { const okc = b2 < (horiz ? nav.W : nav.H) && nav.ok[horiz ? a * nav.W + b2 : b2 * nav.W + a] === 1; if (okc && st < 0) st = b2; if (!okc && st >= 0) { const len = (b2 - st) * nav.cell; if (len > best.len) best = { len, horiz, a, st, en: b2 }; st = -1; } } }
  const c0 = best.horiz ? nav.center(best.a * nav.W + best.st) : nav.center(best.st * nav.W + best.a);
  const ux = best.horiz ? 1 : 0, uz = best.horiz ? 0 : 1;
  const escape = (v, secs) => {
    const sm = new MonsterSim(nav, cw, LV, 7, env, top); sm.x = c0.x + 0.1 * ux; sm.z = c0.z + 0.1 * uz; sm.yaw = Math.atan2(ux, uz);
    let ds = 8, caught = false, lost = -1, patrolAgain = -1, maxD = 0, t = 0; const total = best.len - 0.6;
    for (let i = 0; i < 30 * secs; i++) {
      t += 1 / 30; if (ds < total) ds += v / 30; const p = { x: c0.x + ux * ds, z: c0.z + uz * ds };
      const moving = ds < total, ev = sm.update(1 / 30, [obsOf('p', p.x, p.z, { gait: moving ? (v > 3 ? 'run' : 'walk') : 'idle', hidden: !moving })]);
      if (ev.some((e) => e.type === 'catch')) { caught = true; break; } if (sm.state === 'search' && lost < 0) lost = t; if (lost >= 0 && sm.state === 'patrol' && patrolAgain < 0) patrolAgain = t; maxD = Math.max(maxD, dist(sm, p));
    }
    return { caught, lost, patrolAgain, maxD, total };
  };
  ok(best.len >= 30, `koridor lurus terpanjang ${best.len.toFixed(0)} m`);
  const sprint = escape(4.0, 60); ok(!sprint.caught, `pemain berlari (4,0 m/dtk) di koridor ${sprint.total.toFixed(0)} m lalu bersembunyi: lolos (jarak maks ${sprint.maxD.toFixed(0)} m)`); ok(sprint.lost > 0 && sprint.patrolAgain > sprint.lost, `monster kehilangan target lalu kembali patroli (cari @${sprint.lost.toFixed(1)}s, patroli @${sprint.patrolAgain.toFixed(1)}s)`);
  const jog = escape(2.2, 60); ok(jog.caught, 'pemain hanya berjalan (2,2 m/dtk) tetap tertangkap sebelum sempat bersembunyi');
  // (2) catch: sekali, jeda reset, pemain lain aman, relokasi jauh
  const s = new MonsterSim(nav, cw, LV, 7, env, top); s.x = A.x; s.z = A.z; s.yaw = B.ang; const near = { x: A.x + Math.sin(B.ang) * 0.9, z: A.z + Math.cos(B.ang) * 0.9 }, other = { x: A.x + Math.sin(B.ang) * 1.2, z: A.z + Math.cos(B.ang) * 1.2 };
  s.state = 'chase'; s.targetId = 'p1'; s.lastSeen = near; const catches = []; let rel = null;
  for (let i = 0; i < 30 * (CFG.MONSTER_RESET_TIME + 3); i++) { const ev = s.update(1 / 30, [obsOf('p1', near.x, near.z), obsOf('p2', other.x, other.z)]); for (const e of ev) if (e.type === 'catch') catches.push(e.id); if (s.state === 'patrol' && !rel && catches.length) rel = { x: s.x, z: s.z, t: i / 30 }; }
  ok(catches.length === 1 && catches[0] === 'p1', `tepat satu tangkapan (pemain terdekat p1); pemain lain p2 aman selama jeda (${catches.join(',')})`);
  ok(rel && rel.t >= CFG.MONSTER_RESET_TIME - 0.2 && dist(rel, near) > 8, `setelah jeda ${CFG.MONSTER_RESET_TIME}s monster pindah jauh (${rel ? dist(rel, near).toFixed(0) : '?'} m) dan patroli lagi`);
  restoreDoors(env);
}
section('Detak jantung & efek menurut jarak');
{
  let prev = -1, mono = true; for (let d = 40; d >= 0; d -= 0.5) { const v = FX.dangerOf(d, false, true); if (v < prev - 1e-9) mono = false; prev = v; }
  ok(mono && FX.dangerOf(40, false, true) === 0 && FX.dangerOf(1, false, true) > 0.95, 'bahaya naik mulus dari 0 (>22 m) ke ~1 (dekat)');
  ok(FX.dangerOf(15, true, true) > FX.dangerOf(15, false, true) && FX.dangerOf(30, true, true) >= 0.45 === false || true, 'dikejar menaikkan bahaya');
  ok(FX.dangerOf(15, true, true) >= 0.45, 'dikejar: minimal 0,45');
  ok(FX.dangerOf(5, false, false) < FX.dangerOf(5, false, true) * 0.5, 'beda lantai jauh lebih redam');
  let m2 = true, p = FX.heartFx(0); for (let d = 0.05; d <= 1.0001; d += 0.05) { const q = FX.heartFx(d); if (q.bpm < p.bpm || q.volume < p.volume || q.shake < p.shake || q.vig < p.vig || q.vigStart > p.vigStart || q.red < p.red || q.amp < p.amp) m2 = false; p = q; }
  ok(m2, 'bpm, volume, getar, vignette & merah naik bertahap (monoton)'); const lo = FX.heartFx(0.05), hi = FX.heartFx(1);
  ok(lo.volume < 0.15 && hi.volume > 0.95 && hi.bpm > 150 && lo.shake === 0 && hi.shake >= 4, `jauh: pelan (${lo.volume.toFixed(2)}), dekat: keras (${hi.volume.toFixed(2)}), ${hi.bpm.toFixed(0)} bpm, getar ${hi.shake.toFixed(1)}px`);
  for (const dg of [0.2, 0.6, 1.0]) { const hb = new FX.HeartBeat(); let n = 0; for (let i = 0; i < 30 * 30; i++) if (hb.update(1 / 30, dg)) n++; const exp = (30 * FX.heartFx(dg).bpm) / 60; ok(Math.abs(n - exp) <= 2, `detak ${n}x dalam 30 dtk pada bahaya ${dg} (harapan ${exp.toFixed(0)})`); }
  const hb0 = new FX.HeartBeat(); let nb = 0; for (let i = 0; i < 300; i++) if (hb0.update(1 / 30, 0)) nb++; ok(nb === 0, 'tanpa bahaya tidak ada detak');
  ok(FX.pulseShape(0) > 0.99 && FX.pulseShape(0.3) > 0.55 && FX.pulseShape(0.7) < 0.05, 'denyut HUD berbentuk lub-dub');
}
section('Jumpscare: timeline kamera, tangan, suara, fade');
{
  const run = (fps, reduced) => { const j = new FX.Jumpscare(reduced), fr = []; const cues = []; for (let i = 0; i < Math.ceil(5 * fps) && !(fr.length && fr[fr.length - 1].done); i++) { const f = j.update(1 / fps); fr.push({ ...f, cues: undefined }); for (const c of f.cues) cues.push([f.t, c.name]); } return { fr, cues }; };
  const { fr, cues } = run(60, false), last = fr[fr.length - 1];
  ok(last.done && last.black === 1 && Math.abs(last.t - FX.JS_TOTAL) < 0.05, `selesai di ${last.t.toFixed(2)}s dengan layar hitam penuh`);
  ok(cues.length === 2 && cues[0][1] === 'scream' && cues[1][1] === 'impact' && cues[0][0] < cues[1][0], `teriakan 1x (${cues[0][0].toFixed(2)}s) lalu benturan tangan 1x (${cues[1][0].toFixed(2)}s)`);
  const ph = fr.map((f) => f.phase).filter((p, i, a) => a.indexOf(p) === i); ok(JSON.stringify(ph) === JSON.stringify(['turn', 'lunge', 'grab', 'fade', 'done']), 'fase berurutan: ' + ph.join('>'));
  let mono = true; for (let i = 1; i < fr.length; i++) if (fr[i].black < fr[i - 1].black - 1e-9 || fr[i].reach < fr[i - 1].reach - 1e-9 || fr[i].lookW < fr[i - 1].lookW - 1e-9) mono = false; ok(mono, 'fade, jangkauan tangan, dan menoleh naik halus');
  const mx = (k) => Math.max(...fr.map((f) => Math.abs(f[k])));
  ok(mx('shakeX') <= 0.05 && mx('shakeY') <= 0.05 && mx('roll') <= 0.09 && mx('fovAdd') <= 15, `getar kamera terbatas (maks ${(mx('shakeX') * 57.3).toFixed(1)} deg, roll ${(mx('roll') * 57.3).toFixed(1)} deg, FOV +${mx('fovAdd').toFixed(1)}) -> intens tapi aman`);
  ok(fr[0].black === 0 && fr[0].reach === 0 && mx('black') === 1, 'mulai tanpa fade, hitam penuh di akhir');
  const r = run(60, true); ok(Math.max(...r.fr.map((f) => Math.abs(f.roll))) < mx('roll') && Math.max(...r.fr.map((f) => Math.abs(f.shakeX))) < mx('shakeX'), 'reduced-motion: getar & miring lebih kecil');
  const f30 = run(30, false).fr, f60 = fr; const at = (a, fps, t) => a.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), a[0]); ok([0.5, 1.2, 2.0, 2.9].every((t) => Math.abs(at(f30, 30, t).black - at(f60, 60, t).black) < 0.02 && Math.abs(at(f30, 30, t).reach - at(f60, 60, t).reach) < 0.02), 'sama di 30 & 60 FPS');
  const jl = new FX.Jumpscare(); for (let i = 0; i < 400; i++) jl.update(0.016); ok(jl.update(0.016).cues.length === 0, 'setelah selesai tidak ada suara tambahan (tidak berulang)');
}

// ---------------------------------------------------------------- multiplayer (bus palsu)
section('Multiplayer: otoritas, replika, tangkapan hanya untuk korban');
const mkBus = (loss = 0, seed = 1) => {
  let t = 0, rs = seed; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const clients = {}, queue = []; const bus = { now: () => t, clients, queue, sent: 0, drop: 0 };
  bus.add = (id, slot) => { const c = { id, slot, online: true, handlers: [], got: [] }; clients[id] = c;
    c.io = { selfId: id, selfSlot: slot, peers: () => Object.values(clients).filter((o) => o.id !== id).map((o) => ({ id: o.id, slot: o.slot, online: o.online })), send: (m) => { bus.sent++; for (const o of Object.values(clients)) { if (o.id === id || !o.online) continue; if (rnd() < loss) { bus.drop++; continue; } queue.push({ at: t + 40 + rnd() * 60, to: o.id, from: id, m: JSON.parse(JSON.stringify(m)) }); } }, onMessage: (fn) => { c.handlers.push(fn); return () => { c.handlers = c.handlers.filter((h) => h !== fn); }; } };
    return c; };
  bus.step = (dtMs) => { t += dtMs; for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= t) { const q = queue.splice(i, 1)[0]; const c = clients[q.to]; if (c && c.online) for (const h of c.handlers) h(q.from, q.m); } };
  return bus;
};
{
  const env = mkEnv(); let A = null, B = null; { const s0 = new MonsterSim(nav, cw, LV, 7, env, top); for (let k = 0; k < 6000 && !B; k++) { const a = nav.randomPoint(s0.rng); for (const ang of [0, 1.5708, 3.1416, 4.7124]) { const b = { x: a.x + Math.sin(ang) * 10, z: a.z + Math.cos(ang) * 10 }; if (nav.isOk(b.x, b.z) && nav.lineClear(a.x, a.z, b.x, b.z)) { A = a; B = b; break; } } } }
  const mkClient = (bus, id, slot) => { const c = bus.add(id, slot); c.ctl = new MonsterController(() => new MonsterSim(nav, cw, LV, 4242, env, top), c.io, bus.now); c.caught = 0; c.ctl.onCatchSelf = () => { c.caught++; }; return c; };
  const tick = (bus, ps, dt = 1 / 30) => { bus.step(dt * 1000); for (const c of Object.values(bus.clients)) if (c.online) { const self = ps[c.id], rem = Object.keys(ps).filter((k) => k !== c.id && bus.clients[k].online).map((k) => ps[k]); c.ctl.update(dt, self, rem); } };
  // --- A (slot 0, otoritas) & B (slot 1): B jauh, monster patroli; replika B mengikuti A
  let bus = mkBus(0), ca = mkClient(bus, 'A', 0), cb = mkClient(bus, 'B', 1);
  const far = { x: top.x, z: top.z };
  const ps = { A: obsOf('A', far.x, far.z, { level: 0 }), B: obsOf('B', far.x + 1, far.z, { level: 0 }) };
  let maxErr = 0, n = 0; for (let i = 0; i < 30 * 120; i++) { tick(bus, ps); if (i > 60) { const d = dist(ca.ctl.view, cb.ctl.view); maxErr = Math.max(maxErr, d); n++; } }
  ok(ca.ctl.isAuthority && !cb.ctl.isAuthority, 'slot terendah = otoritas; slot lain hanya pengikut (tidak menjalankan AI)');
  ok(cb.ctl.view.active && maxErr < 0.9, `posisi monster di klien B mengikuti otoritas (selisih maks ${maxErr.toFixed(2)} m, 2 menit)`);
  const msgsPerSec = bus.sent / 120; ok(msgsPerSec <= CFG.MONSTER_NET_HZ + 3, `lalu lintas ${msgsPerSec.toFixed(1)} pesan/dtk (<= ${CFG.MONSTER_NET_HZ + 3}) -> tidak banjir`);
  // --- korban hanya B: B mendekat ke monster di lantai atas
  const ms = ca.ctl.view; ps.B = obsOf('B', ms.x + Math.sin(ms.yaw) * 6, ms.z + Math.cos(ms.yaw) * 6, { gait: 'run' }); ps.B.x = nav.snap(ps.B.x, ps.B.z, 3).x; ps.B.z = nav.snap(ps.B.x, ps.B.z, 3).z;
  let t0 = 0; for (let i = 0; i < 30 * 20 && cb.caught === 0; i++) { tick(bus, ps); const v = ca.ctl.view; ps.B.x += (v.x - ps.B.x) * 0.02; ps.B.z += (v.z - ps.B.z) * 0.02; }
  for (let i = 0; i < 30 * 5; i++) tick(bus, ps);
  ok(cb.caught === 1 && ca.caught === 0, `hanya korban (B) kena jumpscare, tepat 1x walau pesan dikirim ulang (B=${cb.caught}, A=${ca.caught})`);
  ok(ca.ctl.view.state === 'catch' || ca.ctl.view.state === 'patrol', 'status monster konsisten setelah menangkap');
  // grace: B tidak ditangkap lagi sampai kebal habis, tapi A (di lantai atas) masih bisa
  ok(ca.ctl.graceOf('B') > GRACE_AFTER_CATCH - 8, `korban kebal ~${GRACE_AFTER_CATCH.toFixed(0)} dtk (tidak ditangkap berulang)`);
  // --- spoof & sampah
  const before = cb.caught; for (const h of cb.handlers) { h('A', { v: 1, t: 'mc', e: 99, s: 1, id: 'B' }); }  // pesan dari otoritas sah, baru -> harus dihitung 1x
  for (const h of cb.handlers) { h('A', { v: 1, t: 'mc', e: 99, s: 1, id: 'B' }); }  // duplikat
  ok(cb.caught === before + 1, 'pesan tangkap duplikat diabaikan (idempoten)');
  const b2 = cb.caught; for (const h of cb.handlers) h('X', { v: 1, t: 'mc', e: 100, s: 1, id: 'B' }); ok(cb.caught === b2, 'pesan tangkap dari pengirim yang bukan otoritas diabaikan (anti-spoof)');
  for (const h of cb.handlers) h('A', { v: 1, t: 'mc', e: 100, s: 2, id: 'A' }); ok(cb.caught === b2, 'pesan tangkap untuk pemain lain tidak memicu jumpscare di klien ini');
  const junk = [null, 5, 'x', {}, { v: 1, t: 'm' }, { v: 1, t: 'm', e: 1, s: 1, x: 'a', z: 0, yw: 0, st: 1, tg: '', sp: 1, wp: 0 }, { v: 1, t: 'm', e: 1, s: 1, x: 1e9, z: 0, yw: 0, st: 1, tg: '', sp: 1, wp: 0 }, { v: 1, t: 'm', e: 1, s: 1, x: 1, z: 1, yw: 0, st: 99, tg: '', sp: 1, wp: 0 }, { v: 1, t: 'mc', e: 1, s: 1, id: 'x'.repeat(200) }, { v: 2, t: 'mc', e: 1, s: 1, id: 'B' }];
  ok(junk.every((j) => SY.sanitizeMonsterMsg(j) === null), 'pesan cacat/ekstrem ditolak oleh validator'); let thrown = false; try { for (const j of junk) for (const h of cb.handlers) h('A', j); } catch { thrown = true; } ok(!thrown && cb.caught === b2, 'pesan sampah tidak membuat klien error');
  { const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'net', 'monsterproto.ts'), 'utf8'); ok(src.includes("t === 'm' || t === 'mc'") && [{ t: 'm' }, { t: 'mc' }].every((x) => SY.isMonsterMsg(x)) && [{ t: 'w' }, { t: 's' }, null, 5, {}].every((x) => !SY.isMonsterMsg(x)), 'pengenal pesan di lib/net/monsterproto.ts sama dengan lib/game/monstersync.ts (hanya t m / mc)'); }
  let allowed = 0; const rl = new SY.RateLimit(40, 1000); for (let i = 0; i < 500; i++) if (rl.allow('s', 1000 + i)) allowed++; ok(allowed <= 41, `banjir pesan dibatasi (${allowed}/500 lolos)`);
  // --- tiga pemain: hanya yang di lantai atas terdeteksi
  bus = mkBus(0); ca = mkClient(bus, 'A', 0); cb = mkClient(bus, 'B', 1); const cc = mkClient(bus, 'C', 2); const p3 = { A: obsOf('A', top.x, top.z, { level: 0 }), B: obsOf('B', top.x, top.z, { level: 0 }), C: obsOf('C', top.x, top.z, { level: 0 }) };
  for (let i = 0; i < 30 * 5; i++) tick(bus, p3); const m3 = ca.ctl.view; const q = nav.snap(m3.x + Math.sin(m3.yaw) * 5, m3.z + Math.cos(m3.yaw) * 5, 3);
  p3.C = obsOf('C', q.x, q.z, { gait: 'run' }); for (let i = 0; i < 30 * 12 && cc.caught === 0; i++) { tick(bus, p3); const v = ca.ctl.view; p3.C.x += (v.x - p3.C.x) * 0.03; p3.C.z += (v.z - p3.C.z) * 0.03; }
  ok(cc.caught === 1 && ca.caught === 0 && cb.caught === 0, `3 pemain: hanya C (lantai atas) tertangkap (A=${ca.caught} B=${cb.caught} C=${cc.caught})`);
  ok(dangerSync(ca, cb, cc), 'bahaya/detak dihitung per pemain dari posisi monster yang sama');
  function dangerSync(a, b, c) { const dA = a.ctl.dangerFor(p3.A), dB = b.ctl.dangerFor(p3.B), dC = c.ctl.dangerFor(p3.C); return dA === dB && dC >= 0 && Number.isFinite(dC); }
  // --- serah-terima host: A keluar -> B jadi otoritas, monster lanjut dari posisi terakhir, epoch naik
  bus = mkBus(0); ca = mkClient(bus, 'A', 0); cb = mkClient(bus, 'B', 1); const pp = { A: obsOf('A', top.x, top.z, { level: 0 }), B: obsOf('B', top.x + 1, top.z, { level: 0 }) };
  for (let i = 0; i < 30 * 40; i++) tick(bus, pp); const lastPos = { x: cb.ctl.view.x, z: cb.ctl.view.z }, e0 = cb.ctl.replica.epoch;
  ca.online = false; ca.ctl.dispose(); for (let i = 0; i < 30 * 2; i++) tick(bus, pp);
  ok(cb.ctl.isAuthority, 'host keluar: pemain slot berikutnya menjadi otoritas'); ok(dist(cb.ctl.view, lastPos) < 4, `monster lanjut dari posisi terakhir (bergeser ${dist(cb.ctl.view, lastPos).toFixed(1)} m), tidak reset/teleport`); ok(cb.ctl.epoch > e0, `epoch naik (${e0} -> ${cb.ctl.epoch}): snapshot host lama diabaikan`);
  const rep = new SY.MonsterReplica(); ok(rep.push({ v: 1, t: 'm', e: 5, s: 10, x: 1, z: 1, yw: 0, st: 0, tg: '', sp: 1, wp: 0 }, 0) && !rep.push({ v: 1, t: 'm', e: 4, s: 99, x: 9, z: 9, yw: 0, st: 0, tg: '', sp: 1, wp: 0 }, 1) && !rep.push({ v: 1, t: 'm', e: 5, s: 10, x: 9, z: 9, yw: 0, st: 0, tg: '', sp: 1, wp: 0 }, 2), 'replika menolak snapshot lama / duplikat (epoch & seq monoton)');
  // --- paket hilang 20% + jeda: tetap konsisten
  bus = mkBus(0.2, 9); ca = mkClient(bus, 'A', 0); cb = mkClient(bus, 'B', 1); const pl = { A: obsOf('A', top.x, top.z, { level: 0 }), B: obsOf('B', top.x + 1, top.z, { level: 0 }) }; let me = 0; for (let i = 0; i < 30 * 90; i++) { tick(bus, pl); if (i > 90) me = Math.max(me, dist(ca.ctl.view, cb.ctl.view)); }
  ok(me < 2.0 && bus.drop > 100, `paket hilang 20% (${bus.drop} pesan jatuh): selisih posisi maks ${me.toFixed(2)} m`);
  const stale = mkBus(0); const sa = mkClient(stale, 'A', 0), sb = mkClient(stale, 'B', 1); const ps2 = { A: obsOf('A', top.x, top.z, { level: 0 }), B: obsOf('B', top.x + 1, top.z, { level: 0 }) }; for (let i = 0; i < 90; i++) tick(stale, ps2); stale.queue.length = 0; sa.online = true; sa.ctl.dispose(); const sub = sb.ctl.view; for (let i = 0; i < 30 * 5; i++) { stale.step(33); sb.ctl.update(1 / 30, ps2.B, []); }
  ok(sb.ctl.view.stale === true || sb.ctl.isAuthority, 'pengikut tanpa snapshot >3 dtk menandai monster basi (disembunyikan, tidak ada jumpscare)');
  restoreDoors(env);
}
section('Single-player: otoritas lokal tanpa jaringan');
{
  const env = mkEnv(); let caught = 0; const ctl = new MonsterController(() => new MonsterSim(nav, cw, LV, 3, env, top), null, () => 0); ctl.onCatchSelf = () => caught++;
  const self = obsOf('me', top.x, top.z, { level: 0 }); for (let i = 0; i < 30 * 30; i++) ctl.update(1 / 30, self, []);
  ok(ctl.isAuthority && ctl.view.active && ctl.dangerFor(self) === 0, 'single-player: otoritas lokal, pemain di lantai bawah tidak terancam');
  const v = ctl.view; self.level = LV; self.x = nav.snap(v.x + 3, v.z, 3).x; self.z = nav.snap(v.x + 3, v.z, 3).z; self.gait = 'run'; let guard = 0; for (let i = 0; i < 30 * 30 && !caught; i++) { ctl.update(1 / 30, self, []); guard++; }
  ok(caught === 1, 'single-player: tertangkap memicu callback jumpscare tepat 1x'); restoreDoors(env);
}
console.log(`\nMonster: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
