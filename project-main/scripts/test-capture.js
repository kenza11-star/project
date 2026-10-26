// Uji TAHAP 3 (Capture POV): mesin keadaan efek gelap/bangun (logika murni), titik bangun aman, kebal setelah bangun, dan alur jaringan dengan
// sim monster asli + GLB peta asli (hanya korban yang mengalami efek). BUKAN uji di browser/Android: tampilan, FPS HP, dan audio tidak tercakup di sini.
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
const obs = (id, x, z, lv, o = {}) => ({ id, x, z, level: lv, gait: 'run', crouch: false, hidden: false, grace: 0, ...o });
const CF = require(G + '/capturefx.js');
const cfgOf = (o = {}) => ({ openSeconds: CFG.CAPTURE_OPEN_SECONDS, darkenSeconds: CFG.CAPTURE_DARKEN_SECONDS, darkenMax: CFG.CAPTURE_DARKEN_MAX, settleSeconds: CFG.CAPTURE_SETTLE_SECONDS, holdSeconds: CFG.CAPTURE_HOLD_SECONDS, maxDragSeconds: CFG.MONSTER_DRAG_MAX_SECONDS + CFG.MONSTER_DRAG_WAIT + 5, reduced: false, ...o });
const fs = require('fs');

section('CaptureFx: fase, kegelapan halus, hold, bangun tepat sekali');
{
  const f = new CF.CaptureFx(cfgOf()); let o = f.update(1 / 60);
  ok(o.phase === 'idle' && o.black === 0 && !f.active, 'sebelum start: netral (tidak gelap, tidak aktif)');
  f.start(); o = f.update(0);
  ok(o.phase === 'drag' && o.black === 1 && f.active, 'start: mulai dari hitam (sambung dari akhir jumpscare, tanpa kedip)');
  // pandangan terbuka lalu makin gelap, tidak pernah turun lagi setelah terbuka
  let minB = 1, minT = 0, prev = 1, mono = true, afterMin = false, maxStep = 0, t = 0; const dt = 1 / 30; let blackAt = {};
  for (let i = 0; i < 30 * 20; i++) { o = f.update(dt); t += dt; if (o.black < minB) { minB = o.black; minT = t; } if (t > CFG.CAPTURE_OPEN_SECONDS + 0.2) { if (o.black < prev - 1e-9) mono = false; } maxStep = Math.max(maxStep, Math.abs(o.black - prev)); prev = o.black; blackAt[Math.round(t)] = o.black; }
  ok(minB < 0.1 && minT <= CFG.CAPTURE_OPEN_SECONDS + 0.3, `layar terbuka setelah jumpscare (gelap minimum ${minB.toFixed(3)} pada ${minT.toFixed(2)} dtk)`);
  ok(mono, 'selama diseret kegelapan hanya naik (tidak berkedip/turun-naik)');
  ok(maxStep < 0.06, `perubahan antar frame halus (maks ${maxStep.toFixed(4)} per frame 30 FPS)`);
  ok(blackAt[4] > 0.05 && blackAt[4] < 0.5 && blackAt[10] > blackAt[4] && blackAt[14] > 0.9 && blackAt[19] <= CFG.CAPTURE_DARKEN_MAX + 1e-9, `perlahan menjadi gelap: 4s=${blackAt[4].toFixed(2)} 10s=${blackAt[10].toFixed(2)} 14s=${blackAt[14].toFixed(2)} 19s=${blackAt[19].toFixed(2)} (< 1 sampai tiba)`);
  ok(f.current === 'drag' && f.update(0).black < 1, 'masih diseret: belum hitam total');
  f.arrive(); const sB = f.update(0).black, ph1 = f.current;
  let wakes = 0, tSettle = 0, tHold = 0, tTotal = 0, black1At = -1; const seq = [];
  for (let i = 0; i < 30 * 12; i++) { o = f.update(dt); tTotal += dt; if (seq[seq.length - 1] !== o.phase) seq.push(o.phase); if (o.phase === 'settle') tSettle += dt; if (o.phase === 'hold') { tHold += dt; if (o.black !== 1) mono = false; } if (o.wake) wakes++; if (black1At < 0 && o.black >= 1) black1At = tTotal; }
  ok(ph1 === 'settle' && seq.join('>') === 'settle>hold>done', `urutan fase setelah tiba: ${seq.join('>')}`);
  ok(Math.abs(tSettle - CFG.CAPTURE_SETTLE_SECONDS) < 0.1 && Math.abs(tHold - CFG.CAPTURE_HOLD_SECONDS) < 0.1, `tunggu di gelap ${tHold.toFixed(2)} dtk (target ${CFG.CAPTURE_HOLD_SECONDS}), settle ${tSettle.toFixed(2)} dtk`);
  ok(wakes === 1, `sinyal bangun tepat 1x (didapat ${wakes}) dan tidak diulang`);
  ok(o.phase === 'done' && !o.wake && !f.active, 'setelah selesai: fase done, tidak aktif, tidak memicu lagi');
  ok(sB <= 1 && o.black === 1 && mono, 'hitam total saat hold');
  const f2 = new CF.CaptureFx(cfgOf()); f2.start(); f2.update(0); f2.arrive(); f2.arrive(); f2.arrive(); let w2 = 0; for (let i = 0; i < 30 * 8; i++) if (f2.update(dt).wake) w2++;
  ok(w2 === 1, 'arrive() berulang tidak mengacaukan urutan (tetap 1x bangun)');
  const f3 = new CF.CaptureFx(cfgOf()); f3.arrive(); f3.start(); f3.start(); ok(f3.current === 'drag', 'arrive sebelum start diabaikan; start ganda diabaikan');
  // tiba saat pandangan masih terbuka dari hitam: tetap menuju hitam tanpa lompatan mundur
  const f4 = new CF.CaptureFx(cfgOf()); f4.start(); let q = f4.update(0.3); const b0 = q.black; f4.arrive(); let ok4 = true, pb = b0; for (let i = 0; i < 30 * 2; i++) { q = f4.update(dt); if (q.black < pb - 1e-9 && i > 0) { /* settle bermula dari nilai saat itu: boleh tidak turun */ ok4 = false; } pb = q.black; }
  ok(ok4 && q.black === 1, 'tiba cepat (seretan sangat pendek): gelap naik mulus dari nilai saat itu ke hitam total');
}

section('CaptureFx: batal, batas waktu, frame-rate, reduced motion');
{
  const f = new CF.CaptureFx(cfgOf()); f.start(); for (let i = 0; i < 100; i++) f.update(1 / 30); f.cancel(); const o = f.update(1 / 30);
  ok(o.phase === 'idle' && o.black === 0 && o.muffle === 0 && o.dip === 0 && o.pitch === 0 && o.roll === 0 && !o.wake && !f.active, 'cancel (restart/respawn/unmount): semua kembali netral, tidak pernah memicu bangun');
  let w = 0; for (let i = 0; i < 30 * 30; i++) if (f.update(1 / 30).wake) w++; ok(w === 0, 'setelah cancel tidak ada bangun "hantu" walau update terus dipanggil');
  f.start(); ok(f.update(0).phase === 'drag', 'bisa dipakai lagi setelah cancel (tangkapan berikutnya)');
  const g = new CF.CaptureFx(cfgOf({ maxDragSeconds: 5 })); g.start(); let seen = []; let t = 0, wk = -1; for (let i = 0; i < 30 * 40; i++) { const r = g.update(1 / 30); t += 1 / 30; if (seen[seen.length - 1] !== r.phase) seen.push(r.phase); if (r.wake) wk = t; }
  ok(seen.join('>') === 'drag>settle>hold>done' && wk > 0 && wk < 5 + CFG.CAPTURE_SETTLE_SECONDS + CFG.CAPTURE_HOLD_SECONDS + 0.5, `sinyal tiba tak pernah datang: batas waktu memaksa tiba lalu bangun (${wk.toFixed(1)} dtk) -> tidak terkunci selamanya`);
  const run = (dtv) => { const h = new CF.CaptureFx(cfgOf()); h.start(); let tt = 0, b6 = 0, wakeT = -1; for (let i = 0; i < 20 / dtv && wakeT < 0; i++) { const r = h.update(dtv); tt += dtv; if (Math.abs(tt - 6) < dtv / 2) b6 = r.black; if (Math.abs(tt - 8) < dtv / 2) h.arrive(); if (r.wake) wakeT = tt; } return { b6, wakeT }; };
  const a = run(1 / 30), b = run(1 / 144), c = run(1 / 20);
  ok(Math.abs(a.b6 - b.b6) < 0.02 && Math.abs(a.wakeT - b.wakeT) < 0.1 && Math.abs(a.wakeT - c.wakeT) < 0.15, `hasil sama di 20/30/144 FPS (gelap@6s ${a.b6.toFixed(3)}/${b.b6.toFixed(3)}, bangun ${a.wakeT.toFixed(2)}/${b.wakeT.toFixed(2)}/${c.wakeT.toFixed(2)} dtk)`);
  const s = new CF.CaptureFx(cfgOf()); s.start(); s.update(0); const big = s.update(5);   // lonjakan dt (tab di-background) dibatasi 0,1 dtk
  ok(big.t <= 0.11, `lonjakan dt 5 dtk hanya memajukan ${big.t.toFixed(2)} dtk (tidak melompat ke hitam/bangun)`);
  const red = new CF.CaptureFx(cfgOf({ reduced: true })), nor = new CF.CaptureFx(cfgOf()); red.start(); nor.start(); let mr = 0, mn = 0, dr = 0, dn = 0; for (let i = 0; i < 30 * 8; i++) { const x = red.update(1 / 30), y = nor.update(1 / 30); mr = Math.max(mr, Math.abs(x.pitch), Math.abs(x.roll)); mn = Math.max(mn, Math.abs(y.pitch), Math.abs(y.roll)); dr = Math.min(dr, x.dip); dn = Math.min(dn, y.dip); }
  ok(mr === 0 && mn > 0.02 && mn < 0.08 && Math.abs(dr) < Math.abs(dn), `prefers-reduced-motion: tanpa goyang (normal maks ${(mn * 57.3).toFixed(1)} derajat, reduced 0)`);
  const o2 = new CF.CaptureFx(cfgOf()); o2.start(); let mm = 0; for (let i = 0; i < 30 * 16; i++) { const x = o2.update(1 / 30); mm = Math.max(mm, Math.abs(x.muffle - 0.85 * x.black)); } ok(mm < 1e-9, 'peredam audio mengikuti kegelapan');
}

section('safeWakePoint: tidak bangun di dalam benda');
{
  ok(CF.safeWakePoint(() => false, 3, 4).x === 3, 'posisi bebas dipakai apa adanya');
  const blk = (x, z) => Math.hypot(x - 5, z - 5) < 1.0;   // benda bulat r=1 tepat di posisi
  const p = CF.safeWakePoint(blk, 5, 5, 3); ok(p && !blk(p.x, p.z) && Math.hypot(p.x - 5, p.z - 5) <= 1.5, `terhalang: titik bebas terdekat (${p ? Math.hypot(p.x - 5, p.z - 5).toFixed(2) : '-'} m dari posisi)`);
  ok(CF.safeWakePoint(() => true, 0, 0, 3) === null, 'tidak ada titik bebas: null (pemanggil memakai posisi semula, tidak crash)');
  // pada peta asli: posisi di dalam dinding -> titik bebas terdekat valid
  let tested = 0, good = 0; const rng = makeRng(7); for (let i = 0; i < 300; i++) { const pt = nav1.randomPoint(rng); const x = pt.x + 0.0, z = pt.z; const fn = (a, b) => cw.blocked(a, b, CFG.PLAYER_RADIUS, 1); const r = CF.safeWakePoint(fn, x, z, 3); tested++; if (r && !fn(r.x, r.z)) good++; }
  ok(good === tested, `peta asli: ${good}/${tested} titik acak menghasilkan titik bangun bebas collision`);
}

section('Jaringan + sim asli: hanya korban yang gelap, kebal setelah bangun, tidak terkunci');
{
  const bus = { t: 0, clients: {}, q: [] };
  const add = (id, slot) => { const c = { id, slot, hs: [], caught: 0, catchTimes: [], dragFlag: null, cap: null, capStarts: 0 }; bus.clients[id] = c; c.io = { selfId: id, selfSlot: slot, peers: () => Object.values(bus.clients).filter((o) => o.id !== id).map((o) => ({ id: o.id, slot: o.slot, online: true })), send: (m) => { for (const o of Object.values(bus.clients)) if (o.id !== id) bus.q.push({ at: bus.t + 60, to: o.id, from: id, m: JSON.parse(JSON.stringify(m)) }); }, onMessage: (fn) => { c.hs.push(fn); return () => { c.hs = c.hs.filter((x) => x !== fn); }; } }; return c; };
  const step = (ms) => { bus.t += ms; for (let i = bus.q.length - 1; i >= 0; i--) if (bus.q[i].at <= bus.t) { const q = bus.q.splice(i, 1)[0]; const c = bus.clients[q.to]; if (c) for (const h of c.hs) h(q.from, q.m); } };
  const env = mkEnv(); const A = add('A', 0), B = add('B', 1), C3 = add('C', 2);
  for (const c of [A, B, C3]) { c.ctl = new MonsterController(() => new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv), c.io, () => bus.t); c.ctl.onCatchSelf = (d) => { c.caught++; c.catchTimes.push(bus.t); c.dragFlag = d; c.cap = new CF.CaptureFx(cfgOf()); c.cap.start(); c.capStarts++; c.state = 'dead'; c.deadAt = bus.t; }; }
  const m0 = new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv); let P = null; for (let k = 0; k < 500 && !P; k++) { const a = m0.rng.range(0, 6.28), q = { x: m0.x + Math.sin(a) * 3.2, z: m0.z + Math.cos(a) * 3.2 }; if (nav1.isOk(q.x, q.z) && !cw.segmentBlocked(m0.x, m0.z, q.x, q.z, 1, 0.02)) P = q; }
  const far = nav1.randomPoint(m0.rng);
  const ps = { A: obs('A', top.x, top.z, 0, { gait: 'idle' }), B: obs('B', P.x, P.z, 1), C: obs('C', top.x, top.z, 0, { gait: 'idle' }) };
  for (const k of Object.keys(ps)) ps[k].caught = false;
  let sawDrag = false, arrivedAt = -1, wakeAt = -1, maxBlackOthers = 0, caughtAfterWake = 0, dragStartAt = -1; const phasesB = [];
  const dtv = 1 / 30; let graceGap = -1, recatchAt = -1;
  for (let i = 0; i < 30 * 220; i++) {
    step(1000 / 30);
    // korban B meniru PlayScene: caught = status 'dead'; efek hanya berjalan di klien B
    ps.B.caught = B.state === 'dead';
    for (const c of [A, B, C3]) { const self = ps[c.id], rem = Object.keys(ps).filter((k) => k !== c.id).map((k) => ps[k]); c.ctl.update(dtv, self, rem); }
    const vb = B.ctl.view;
    if (B.state === 'dead' && B.cap) {
      const mine = vb.active && vb.state === 'drag' && vb.targetId === 'B';
      if (mine) { sawDrag = true; if (dragStartAt < 0) dragStartAt = bus.t; ps.B.x = vb.x - Math.sin(vb.yaw) * 0.9; ps.B.z = vb.z - Math.cos(vb.yaw) * 0.9; }
      if (sawDrag && !mine && B.cap.current === 'drag') { B.cap.arrive(); if (arrivedAt < 0) arrivedAt = bus.t; }
      else if (!sawDrag && B.cap.current === 'drag' && (bus.t - B.deadAt) / 1000 > 3.6 + CFG.MONSTER_DRAG_WAIT) { B.cap.arrive(); if (arrivedAt < 0) arrivedAt = bus.t; }
      const o = B.cap.update(dtv); if (phasesB[phasesB.length - 1] !== o.phase) phasesB.push(o.phase);
      if (o.wake) { if (wakeAt < 0) wakeAt = bus.t; B.state = 'play'; B.cap = null; graceGap = 0; const m = B.ctl.view; ps.B.x = m.x + 0.9; ps.B.z = m.z; }   // bangun tepat di samping monster: kasus terburuk
    }
    for (const c of [A, C3]) if (c.cap) maxBlackOthers = Math.max(maxBlackOthers, c.cap.update(dtv).black);
  }
  ok(B.capStarts >= 1 && B.catchTimes.length === B.capStarts && A.capStarts === 0 && C3.capStarts === 0 && A.caught === 0 && C3.caught === 0, `efek hanya dimulai di klien korban (B=${B.capStarts}x, A=${A.capStarts}, C=${C3.capStarts}; tangkapan ulang B boleh terjadi SETELAH masa kebal)`);
  ok(maxBlackOthers === 0, 'pemain lain: tidak pernah ada kegelapan (nilai efek 0)');
  ok(sawDrag && arrivedAt > dragStartAt, 'korban diseret lalu tiba (sinyal tiba dari state monster, bukan teleport)');
  ok(phasesB.slice(0, 4).join('>') === 'drag>settle>hold>done', `urutan efek di korban: ${phasesB.join('>')}`);
  ok(wakeAt > arrivedAt && Math.abs((wakeAt - arrivedAt) / 1000 - (CFG.CAPTURE_SETTLE_SECONDS + CFG.CAPTURE_HOLD_SECONDS)) < 0.2, `bangun ${((wakeAt - arrivedAt) / 1000).toFixed(2)} dtk setelah tiba (settle+hold=${CFG.CAPTURE_SETTLE_SECONDS + CFG.CAPTURE_HOLD_SECONDS})`);
  // setelah bangun tepat di samping monster: tidak boleh ditangkap lagi selama CAPTURE_GRACE (dihitung otoritas A dari flag 'tertangkap' B yang hilang)
  const second = B.catchTimes[1], dragFirst = B.dragFlag;
  ok(second === undefined || second >= wakeAt + CFG.CAPTURE_GRACE * 1000 - 150, `kebal setelah bangun: tangkapan kedua ${second === undefined ? 'tidak terjadi' : ((second - wakeAt) / 1000).toFixed(1) + ' dtk setelah bangun'} (kebal ${CFG.CAPTURE_GRACE} dtk)`);
  ok(B.state === 'play' && wakeAt > 0, 'korban benar-benar kembali ke state main (kontrol pulih), tidak terkunci');
}

section('Kebal setelah bangun & pembersihan state (stub sim, tanpa jaringan dan dengan jaringan)');
{
  const mkStub = (log) => ({ enabled: true, x: 0, z: 0, yaw: 0, state: 'patrol', anim: 'idle', speed: 0, targetId: '', level: 1, onStairs: false, wp: 0, restore() {}, update(dt, obs) { log.push(obs.map((o) => ({ id: o.id, grace: o.grace, caught: o.caught }))); return []; } });
  let nowMs = 0; const log = []; const ctl = new MonsterController(() => mkStub(log), null, () => nowMs);
  const self = { id: 'me', x: 0, z: 0, level: 1, gait: 'idle', crouch: false, hidden: false, grace: 0, caught: false };
  ctl.update(0.1, self, []); ok(ctl.graceOf('me') === 0, 'belum pernah tertangkap: tidak ada kebal');
  self.caught = true; for (let i = 0; i < 30; i++) { nowMs += 100; ctl.update(0.1, self, []); } ok(ctl.graceOf('me') === 0, 'selama tertangkap tidak ada kebal tambahan (flag caught sudah mencegah tangkapan)');
  self.caught = false; nowMs += 100; ctl.update(0.1, self, []);
  ok(Math.abs(ctl.graceOf('me') - CFG.CAPTURE_GRACE) < 0.2, `bangun (caught true->false): kebal ${ctl.graceOf('me').toFixed(1)} dtk (target ${CFG.CAPTURE_GRACE})`);
  ok(log[log.length - 1][0].grace > 10, 'sim menerima grace > 0 untuk pemain yang baru bangun (tidak diburu)');
  nowMs += (CFG.CAPTURE_GRACE + 0.5) * 1000; ctl.update(0.1, self, []); ok(ctl.graceOf('me') === 0 && log[log.length - 1][0].grace === 0, 'kebal habis setelah CAPTURE_GRACE: kembali bisa ditangkap (tidak kebal selamanya)');
  // grace yang lebih panjang (mis. dari respawn normal) tidak dipendekkan
  const ctl2 = new MonsterController(() => mkStub([]), null, () => nowMs); const s2 = { ...self, caught: true }; ctl2.update(0.1, s2, []); s2.caught = false; ctl2.update(0.1, s2, []); const g1 = ctl2.graceOf('me'); ctl2.update(0.1, s2, []); ok(Math.abs(ctl2.graceOf('me') - g1) < 0.2, 'update berikutnya tidak memperpanjang kebal (hanya saat transisi)');
  // pemain jarak jauh: caught dari flag cg; putus saat tertangkap -> state dibuang tanpa sisa
  const ctl3 = new MonsterController(() => mkStub([]), null, () => nowMs); const r = { id: 'R', x: 3, z: 3, level: 1, gait: 'idle', crouch: false, hidden: false, grace: 0, caught: true };
  ctl3.update(0.1, self, [r]); r.caught = false; ctl3.update(0.1, self, [r]); ok(ctl3.graceOf('R') > 11, 'pemain lain yang bangun (cg hilang) juga kebal di sisi otoritas');
  const ctl4 = new MonsterController(() => mkStub([]), null, () => nowMs); const r4 = { ...r, caught: true }; ctl4.update(0.1, self, [r4]); ctl4.update(0.1, self, []); ctl4.update(0.1, self, [{ ...r4, caught: false }]);
  ok(ctl4.graceOf('R') === 0, 'pemain putus saat tertangkap lalu muncul lagi: tidak mendapat kebal palsu dari state lama');
  ctl.dispose(); ctl.update(0.1, self, []); ok(true, 'dispose + update sesudahnya tidak melempar error');
}

section('Pemasangan di PlayScene (pembersihan & pemulihan; diperiksa dari source)');
{
  const P = fs.readFileSync(path.join(__dirname, '..', 'components', 'lobby', 'PlayScene.tsx'), 'utf8');
  const fn = (name) => { const i = P.indexOf('const ' + name + ' = '); if (i < 0) return ''; let d = 0, k = P.indexOf('{', P.indexOf('=>', i)), s = k; for (; k < P.length; k++) { if (P[k] === '{') d++; else if (P[k] === '}' && --d === 0) break; } return P.slice(s, k + 1); };
  const wk = fn('wakeFromCapture'), rs = fn('resetCapture'), bg = fn('beginRun'), rl = fn('respawnLocal');
  ok(/setStatus\('play'\)/.test(wk) && /S\.status = 'play'/.test(wk), "bangun: status kembali 'play' (kontrol pulih)");
  ok(/S\.run = false; S\.crouch = false/.test(wk) && /resetInput/.test(wk) && /stamina\.current\.reset\(\)/.test(wk), 'bangun: run/crouch/input/stamina dipulihkan bersih');
  ok(/dragMode = 'none'/.test(wk) && /dragTrail\.clear\(\)/.test(wk) && /capture = null/.test(wk), 'bangun: state seret & capture dibersihkan');
  ok(/safeWakePoint/.test(wk) && /setDeadScreen\(0, false\)/.test(wk) && /applyWakeFx/.test(wk) && /new WakeUp/.test(wk), 'bangun: posisi aman, overlay dilepas setelah kanvas gelap (tanpa kedip), fade-in memakai WakeUp yang ada');
  ok(/capture\?\.cancel\(\)/.test(rs) && /capWake/.test(rs) && /clearWakeFx/.test(rs) && /setMuffle\(0\)/.test(rs), 'resetCapture: batalkan efek, bersihkan WakeUp milik capture, audio jernih');
  ok(/resetCapture\(\)/.test(bg), 'restart/Main lagi (beginRun) membersihkan capture');
  ok(/resetCapture\(\)/.test(rl), 'respawn membersihkan capture');
  ok(/scareFx\.reset\(\); canvas\.style\.filter = ''; resetCapture\(\)/.test(P), 'unmount membersihkan capture');
  ok(/capWake = false; clearWakeFx/.test(P), 'WakeUp capture selesai: penanda dibersihkan');
  const capSrc = P.slice(P.indexOf('let capture: CaptureFx'), P.indexOf('const setupMonster')) + P.slice(P.indexOf("if (capture && S.status === 'dead' && !js)"), P.indexOf("if (capture && S.status === 'dead' && !js)") + 600);
  ok(capSrc.length > 1500 && !/setTimeout|setInterval|requestAnimationFrame/.test(capSrc), 'efek capture tidak memakai setTimeout/setInterval/rAF sendiri (waktu dihitung per frame di loop; tidak ada timer yatim)');
  ok(/if \(capture && S\.status === 'dead' && !js\)/.test(P), 'efek hanya berjalan untuk pemain lokal yang berstatus dead (korban)');
  ok(!/sendMonster|net\.client\.send[^;]*capture|setLocal\([^)]*black/.test(P.slice(P.indexOf('const beginCapture'), P.indexOf('const setupMonster'))), 'efek gelap tidak dikirim ke jaringan');
  ok(/CFG\.CAPTURE_POV_ENABLED/.test(P) && /if \(capture\) capture\.arrive\(\); else if \(!net\) setDeadReady\(true\)/.test(P), 'CAPTURE_POV_ENABLED=false mengembalikan perilaku TAHAP 2 (Main lagi)');
}

console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
