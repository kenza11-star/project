// Uji puzzle saklar: urutan dari seed, mesin state (salah = reset), penempatan 5 saklar di 5 ruangan berbeda pada GLB asli.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { buildWorld } = require('./testworld.js');
const { NavGrid, generateFurniture, generateBeds } = require(G + '/layout.js');
const { makeRng } = require(G + '/rng.js');
const S = require(G + '/switchpuzzle.js');
const cfg = require(G + '/config.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

section('Urutan benar dari seed room');
{
  const sig = new Set(); let bad = 0, ident = 0;
  for (let sd = 1; sd <= 300; sd++) { const o = S.switchOrder(sd * 7919), same = JSON.stringify(o) === JSON.stringify(S.switchOrder(sd * 7919)); if (!same) bad++; if (o.every((v, i) => v === i)) ident++; if ([...o].sort().join() !== '0,1,2,3,4') bad++; sig.add(o.join('')); }
  ok(bad === 0, 'permutasi 0..4 yang sah & deterministik per seed (sama di semua klien)');
  ok(ident === 0, 'tidak pernah urut 0,1,2,3,4');
  ok(sig.size >= 60, `urutan beragam antar room (${sig.size} urutan berbeda dari 300 seed)`);
}

section('Mesin state: salah urutan = reset, benar semua = selesai');
{
  const order = S.switchOrder(12345), wrong = [0, 1, 2, 3, 4].find((i) => i !== order[0]);
  const p = new S.SwitchPuzzle(order);
  ok(p.press(wrong) === 'reset' && p.p === 0 && p.v === 1, 'salah di awal: reset, versi naik');
  let r = [];
  for (let k = 0; k < 4; k++) r.push(p.press(order[k]));
  ok(r.every((x) => x === 'ok') && p.p === 4 && order.slice(0, 4).every((i) => p.isOn(i)) && !p.isOn(order[4]), 'urutan benar: tiap saklar menyala');
  ok(p.press(order[0]) === 'ignored' && p.p === 4, 'menekan saklar yang sudah menyala diabaikan (tanpa hukuman)');
  const q = new S.SwitchPuzzle(order); q.press(order[0]); q.press(order[1]);
  const w2 = order.slice(3).find((i) => i !== order[2]); ok(q.press(w2) === 'reset' && q.p === 0 && order.every((i) => !q.isOn(i)), 'salah di tengah: SEMUA reset');
  const d = new S.SwitchPuzzle(order); let last; for (const i of order) last = d.press(i);
  ok(last === 'done' && d.done && d.p === 5, 'urutan benar semua: selesai');
  ok(d.press(order[0]) === 'ignored' && d.press(99) === 'ignored' && d.press(-1) === 'ignored' && d.press(1.5) === 'ignored', 'setelah selesai / indeks tidak sah diabaikan');
  const a = new S.SwitchPuzzle(order); ok(a.apply(3, 2) && a.p === 2 && a.v === 3, 'klien menerapkan state host yang lebih baru');
  ok(!a.apply(3, 4) && !a.apply(2, 4) && !a.apply(9, 6) && !a.apply(9, -1) && a.p === 2, 'state basi / tidak sah ditolak');
}

section('Penempatan 5 saklar di ruangan terpisah (GLB asli, 300 seed)');
{
  const { cw, md } = buildWorld();
  const fixed = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]);
  const keepouts = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
  if (md.ladder) keepouts.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
  for (const d of md.doors) if (d.level === 0) keepouts.push({ x: d.cx, z: d.cz, r: 1.5 });
  const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }];
  for (const d of md.doors.filter((q) => q.level === 0)) for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; must.push({ x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, rad: 0.7 }); }
  const rooms0 = md.rooms.filter((r) => r.level === 0);
  let short = 0, dupRoom = 0, badType = 0, unreach = 0, inKeep = 0, notWall = 0, facing = 0, close = 0, ms = 0; const roomsUsed = new Set();
  for (let sd = 1; sd <= 300; sd++) {
    const rng = makeRng(sd * 7919), nav = new NavGrid(cw, 0, fixed);
    generateBeds(nav, makeRng((sd * 7919 ^ 0x7be5a1c3) >>> 0), { rooms: rooms0, spawn: md.spawn, keepouts, mustReach: must });
    generateFurniture(nav, rng, { rooms: rooms0, forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    nav.flood(md.spawn.x, md.spawn.z);
    const t0 = process.hrtime.bigint(); const sp = S.planSwitches(nav, makeRng((sd * 7919 ^ 0x5b17c4d9) >>> 0), { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must }); ms = Math.max(ms, Number(process.hrtime.bigint() - t0) / 1e6);
    if (sp.length !== S.SWITCH_COUNT) short++;
    if (new Set(sp.map((s) => s.room)).size !== sp.length) dupRoom++;
    for (const s of sp) {
      roomsUsed.add(s.room);
      const rm = rooms0.find((r) => r.id === s.room); if (!rm || !S.SWITCH_ROOM_TYPES.includes(rm.type)) badType++;
      const [ci, cj] = nav.cellOf(s.ax, s.az); if (!nav.isReachedCell(ci, cj) || nav.occ[cj * nav.W + ci]) unreach++;
      if (keepouts.some((k) => Math.hypot(k.x - s.x, k.z - s.z) < k.r)) inKeep++;
      const nx = Math.sin(s.yaw), nz = Math.cos(s.yaw);        // normal pelat (menghadap ke dalam ruangan)
      if (![0.04, 0.08, 0.12, 0.16].some((d) => { const [wi, wj] = nav.cellOf(s.x - nx * d, s.z - nz * d); return nav.wallOnly[wj * nav.W + wi]; })) notWall++; // dinding tipis (1 sel): sel dinding harus tepat di belakang kotak
      if (Math.abs((s.ax - s.x) * nx + (s.az - s.z) * nz - 0.82) > 0.08) facing++;
      for (const o of sp) if (o !== s && Math.hypot(o.x - s.x, o.z - s.z) < 3) close++;
    }
  }
  ok(short === 0, `selalu 5 saklar tertempatkan (kurang: ${short}/300 seed)`);
  ok(dupRoom === 0, 'semua saklar di ruangan berbeda');
  ok(badType === 0, 'hanya di ruangan lantai 1 yang diizinkan');
  ok(unreach === 0, 'titik berdiri di depan saklar terjangkau & bebas furniture');
  ok(inKeep === 0, 'tidak di keepout (spawn/pintu/exit/tangga)');
  ok(notWall === 0, 'pelat menempel di dinding');
  ok(facing === 0, 'pelat menghadap ke dalam ruangan (titik berdiri di depannya)');
  ok(close === 0, 'antar saklar berjarak >= 3 m');
  ok(roomsUsed.size >= 6, `variasi ruangan antar seed (${roomsUsed.size} ruangan dipakai)`);
  ok(ms < 200, `perencanaan cepat (maks ${ms.toFixed(1)} ms)`);
}

section('End-to-end 3 pemain: non-host minta, host memutuskan, semua klien sinkron');
{
  const W = require(path.join(__dirname, '..', '.tmp-net', 'worldsync.js'));
  const seed = 987654, order = S.switchOrder(seed);
  const mk = (id, host) => ({ id, host, ws: new W.WorldSync(), pz: new S.SwitchPuzzle(S.switchOrder(seed)), alarms: 0, mission: false });
  const H = mk('H', true), A = mk('A', false), B = mk('B', false), all = [H, A, B];
  const deliver = (from, m) => { if (!m) return; for (const c of all) { if (c === from) continue; for (const e of c.ws.receive(m, from.host)) apply(c, e); } };
  const apply = (c, e) => {
    if (e.k === 'sw') { const prev = c.pz.v; if (c.pz.apply(e.v, e.p) && e.r === 1 && e.v === prev + 1) c.alarms++; }
    else if (e.k === 'swreq') { if (c.host) hostPress(c, e.i); }
    else if (e.k === 'mission') c.mission = true;
  };
  const hostPress = (h, i) => { const r = h.pz.press(i); if (r === 'ignored') return; if (r === 'reset') h.alarms++; deliver(h, h.ws.local({ k: 'sw', v: h.pz.v, p: h.pz.p, r: r === 'reset' ? 1 : 0 })); if (r === 'done') { h.mission = true; deliver(h, h.ws.local({ k: 'mission', id: 'switch' })); } };
  const press = (c, i) => { if (c.host) hostPress(c, i); else deliver(c, c.ws.local({ k: 'swreq', i })); };
  const same = () => all.every((c) => c.pz.p === H.pz.p && c.pz.v === H.pz.v);
  const wrong = [0, 1, 2, 3, 4].find((i) => i !== order[0]);
  press(A, wrong); ok(same() && all.every((c) => c.pz.p === 0 && c.alarms === 1), 'non-host salah urutan: semua reset, alarm tepat sekali di tiap klien');
  press(A, order[0]); press(B, order[1]); ok(same() && H.pz.p === 2 && all.every((c) => c.pz.isOn(order[0]) && c.pz.isOn(order[1])), 'tekanan benar dari pemain berbeda digabung di urutan');
  press(B, order[0]); ok(H.pz.p === 2 && all.every((c) => c.alarms === 1), 'menekan saklar yang sudah menyala tidak menghukum');
  const w2 = order.slice(3).find((i) => i !== order[2]); press(H, w2); ok(same() && H.pz.p === 0 && all.every((c) => c.alarms === 2), 'host salah: semua reset, alarm sekali lagi');
  const L = mk('L', false); for (const e of L.ws.receive(H.ws.digest(), true)) apply(L, e); ok(L.pz.p === 0 && L.alarms === 0, 'pemain terlambat sinkron lewat digest tanpa alarm lama');
  for (const i of order) press(i % 2 ? A : B, i); ok(same() && H.pz.done && all.every((c) => c.pz.done && c.mission), 'urutan benar semua: puzzle selesai & misi saklar selesai di semua klien');
  const before = H.pz.v; press(A, order[0]); ok(H.pz.v === before, 'setelah selesai, tekanan lanjutan diabaikan');
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
