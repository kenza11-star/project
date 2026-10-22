// Uji ruangan puzzle: model dari seed, petunjuk unik, mesin state, palka, isolasi bunker (GLB asli).
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const P = require(G + '/puzzleroom.js');
const { buildWorld } = require('./testworld.js');
const { NavGrid, generateFurniture, generateBeds } = require(G + '/layout.js');
const { makeRng } = require(G + '/rng.js');
const cfg = require(G + '/config.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

section('Model dari seed');
{
  const sigs = new Set(); let bad = 0, badClue = 0, badCirc = 0, badGl = 0, badSim = 0, minC = 99, maxC = 0;
  for (let sd = 1; sd <= 600; sd++) {
    const m = P.makePuzzleModel(sd * 7919), m2 = P.makePuzzleModel(sd * 7919);
    if (JSON.stringify(m) !== JSON.stringify(m2)) bad++;
    if (m.code.length !== 4 || m.code.some((d) => !(d >= 0 && d <= 9)) || m.code.every((d) => d === m.code[0])) bad++;
    sigs.add(m.code.join(''));
    if (P.countOrders(m.clues) !== 1) badClue++;
    const pos = []; m.order.forEach((c, k) => (pos[c] = k)); if (!m.clues.every((c) => P.clueHolds(c, pos))) badClue++;
    minC = Math.min(minC, m.clues.length); maxC = Math.max(maxC, m.clues.length);
    // sirkuit: tepat satu himpunan tuas menyalakan semua lampu, dan tidak 0/1 tuas
    const sols = []; for (let s = 0; s < 32; s++) if (P.lampsFor(m, s) === 31) sols.push(s);
    if (sols.length !== 1 || sols[0] !== m.solution2 || P.popcount(m.solution2) < 2 || P.lampsFor(m, 0) === 31) badCirc++;
    if (new Set(m.glyph).size !== 3 || m.glyph.some((g, i) => m.drum0[i] === g) || new Set(m.slotTrue.concat(m.decoy.map((d) => d.slot))).size !== 5) badGl++;
    if (m.simon.length !== 5 || new Set(m.simon).size < 3 || new Set(m.layout4).size !== 4 || new Set(m.layout1).size !== 5) badSim++;
  }
  ok(bad === 0, 'deterministik & kode sah'); ok(sigs.size > 400, 'kode beragam ' + sigs.size);
  ok(badClue === 0, 'petunjuk logika: jawaban tunggal & benar'); ok(minC >= 4 && maxC <= 8, `jumlah petunjuk ${minC}..${maxC}`);
  ok(badCirc === 0, 'sirkuit: solusi tunggal, tidak trivial'); ok(badGl === 0, 'glif sah'); ok(badSim === 0, 'urutan memori sah');
  console.log(`  petunjuk ${minC}..${maxC} baris; ${sigs.size} kode berbeda / 600 seed`);
}

section('Mesin state');
{
  const m = P.makePuzzleModel(4242), z = new P.RoomPuzzle(m);
  const phys = (c) => m.layout1.indexOf(c), wrong = [0, 1, 2, 3, 4].find((i) => m.layout1[i] !== m.order[0]);
  ok(z.press1(wrong) === 'reset' && z.a === 0 && z.v === 1, 'I: salah = reset');
  const rs = m.order.map((c) => z.press1(phys(c)));
  ok(rs.slice(0, 4).every((r) => r === 'ok') && rs[4] === 'done' && z.doneAt(1) && z.digit(0) === m.code[0] && z.digit(1) === null, 'I: urutan benar selesai, digit terbuka');
  ok(z.press1(0) === 'ignored', 'I: setelah selesai diabaikan');
  const lv = [0, 1, 2, 3, 4].filter((i) => (m.solution2 >> i) & 1); lv.forEach((i) => z.flip2(i));
  ok(z.doneAt(2) && z.digit(1) === m.code[1], 'II: kombinasi benar menyalakan semua');
  for (let k = 0; k < 3; k++) while (z.drums[k] !== m.glyph[k]) z.turn3(k);
  ok(z.doneAt(3), 'III: simbol benar');
  const iw = [0, 1, 2, 3].find((i) => m.layout4[i] !== m.simon[0]); ok(z.pick4(iw) === 'reset', 'IV: salah = reset');
  m.simon.forEach((c) => z.pick4(m.layout4.indexOf(c)));
  ok(z.doneAt(4) && z.allDone && z.digits().join('') === m.code.join(''), 'IV: selesai, semua digit');
  const c = new P.RoomPuzzle(m); ok(c.apply(z.snapshot()) && c.allDone && c.drums.join() === z.drums.join(), 'klien menerapkan snapshot host');
  ok(!c.apply(z.snapshot()) && !c.apply({ v: 99, a: 9, b: 0, c: 0, d: 0, f: 0 }) && !c.apply({ v: 99, a: 0, b: 0, c: 216, d: 0, f: 0 }), 'snapshot basi / tidak sah ditolak');
  ok(P.checkCode(m, P.codeString(m)) && !P.checkCode(m, '0000x') && !P.checkCode(m, '12'), 'panel kode');
  const q = new P.RoomPuzzle(m); q.completeAll(); ok(q.allDone, 'completeAll');
}

section('Palka + isolasi bunker (GLB asli, 200 seed)');
{
  const { cw, md } = buildWorld();
  const before = (() => { const nav = new NavGrid(cw, 0, md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb])); return nav.flood(md.spawn.x, md.spawn.z); })();
  cw.walk[0] = { ...md.floor0, maxx: P.WALK_MAXX };
  for (const w of P.bunkerWalls()) for (let j = Math.floor((w.minz - cw.z0) / 0.1); j < Math.ceil((w.maxz - cw.z0) / 0.1); j++) for (let i = Math.floor((w.minx - cw.x0) / 0.1); i < Math.ceil((w.maxx - cw.x0) / 0.1); i++) cw.solid[0][j * cw.W + i] = 1;
  const fixed = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]);
  const nav0 = new NavGrid(cw, 0, fixed); const after = nav0.flood(md.spawn.x, md.spawn.z);
  ok(after === before, `bangunan tidak berubah oleh perluasan (flood ${before} -> ${after})`);
  ok(!nav0.reached(P.BK.cx, P.BK.cz, 1), 'bunker TIDAK terhubung ke bangunan');
  const keep = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
  for (const d of md.doors) if (d.level === 0) keep.push({ x: d.cx, z: d.cz, r: 1.5 });
  const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }];
  const rooms0 = md.rooms.filter((r) => r.level === 0);
  let none = 0, far = 0; const usedRooms = {};
  for (let sd = 1; sd <= 200; sd++) {
    const rng = makeRng(sd * 7919), nav = new NavGrid(cw, 0, fixed);
    generateBeds(nav, makeRng((sd * 7919 ^ 0x7be5a1c3) >>> 0), { rooms: rooms0, spawn: md.spawn, keepouts: keep, mustReach: must });
    generateFurniture(nav, rng, { rooms: rooms0, forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: md.spawn, keepouts: keep, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    nav.flood(md.spawn.x, md.spawn.z);
    const h = P.planHatch(nav, makeRng((sd * 7919 ^ 0x4a7c11e5) >>> 0), { rooms: md.rooms, spawn: md.spawn, keepouts: keep });
    if (!h) { none++; continue; }
    usedRooms[h.room] = (usedRooms[h.room] || 0) + 1;
    if (!nav.reached(h.x, h.z, 0.3) || !nav.reached(h.ax, h.az, 0.3) || Math.hypot(h.x - md.spawn.x, h.z - md.spawn.z) < 8) far++;
  }
  ok(none === 0, 'palka selalu ada (' + none + ' gagal)'); ok(far === 0, 'palka terjangkau & jauh dari spawn (' + far + ' salah)');
  console.log('  ruangan palka:', JSON.stringify(usedRooms));

  section('Bunker: semua titik penting terjangkau dari titik muncul');
  const door = { id: 'door', cx: P.LAYOUT.door.x, cz: P.LAYOUT.door.z, hx: P.BK.doorW / 2, hz: P.BK.t / 2, yaw: 0, level: 0, kind: 'fixed' };
  const bn = new NavGrid(cw, 0, [door].concat(P.PROPS.map((p) => ({ id: p.id, cx: p.cx, cz: p.cz, hx: p.hx, hz: p.hz, yaw: 0, level: 0, kind: 'fixed' }))));
  bn.flood(P.LAYOUT.arrive.x, P.LAYOUT.arrive.z);
  const stand = (m, d = 0.85) => ({ x: m.x + m.nx * d, z: m.z + m.nz * d });
  const pts = { ladder: stand(P.LAYOUT.ladder, 0.8), plaque1: stand(P.LAYOUT.s1Plaque), s3: stand(P.LAYOUT.s3), play: stand(P.LAYOUT.s4Play), keypad: { x: P.BK.cx + 0.55, z: P.BK.cz - P.BK.hd + 0.9 } };
  P.LAYOUT.s1.forEach((m, i) => (pts['s1_' + i] = stand(m))); P.LAYOUT.s2.forEach((m, i) => (pts['s2_' + i] = stand(m))); P.LAYOUT.s4.forEach((m, i) => (pts['s4_' + i] = stand(m))); P.LAYOUT.glyphSlots.forEach((m, i) => (pts['g' + i] = stand(m)));
  for (const k in pts) ok(bn.reached(pts[k].x, pts[k].z, 0.1), 'terjangkau: ' + k);
  ok(!bn.reached(P.LAYOUT.door.x, P.LAYOUT.door.z - 1.2, 0.3), 'bilik tertutup selama pintu besi menutup');
}
console.log(fails ? `\n${fails} GAGAL` : '\nSEMUA LULUS'); process.exit(fails ? 1 : 0);
