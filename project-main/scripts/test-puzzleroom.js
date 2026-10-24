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
  for (let u = 0; u <= md.stair.run + 1.2; u += 1.2) keep.push({ x: md.stair.bx + md.stair.sgn * u, z: md.stair.zc, r: 2.0 }); // sama dengan world.ts: ruang tangga bebas furniture
  const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }];
  const rooms0 = md.rooms.filter((r) => r.level === 0);
  const ladderRoom = rooms0.find((r) => r.type === 'ladder');
  const h0 = P.stairHatch(md.stair, cw, ladderRoom.id);
  ok(!!h0, 'pintu rahasia ditemukan di belakang Stairs_A');
  const S = md.stair, endX = S.bx + S.sgn * (S.run + 0.05);
  ok(h0 && Math.sign(h0.x - endX) === S.sgn && Math.abs(h0.z - S.zc) < 1e-9 && Math.abs(h0.ax - endX) > 0.3 && Math.abs(h0.ax - h0.x) > 0.3, 'panel di balik ujung tangga, titik berdiri muat di celah');
  ok(h0 && h0.x >= ladderRoom.rect.minx && h0.x <= ladderRoom.rect.maxx && h0.z >= ladderRoom.rect.minz && h0.z <= ladderRoom.rect.maxz, 'panel di ruang tangga lantai 1');
  ok(h0 && cw.gridBlocked(h0.x + S.sgn * 0.1, h0.z, 0.02, 0) && !cw.gridBlocked(h0.ax, h0.az, 0.3, 0), 'panel menempel dinding & titik berdiri bebas dinding');
  let none = 0, far = 0, diff = 0;
  for (let sd = 1; sd <= 200; sd++) {
    const rng = makeRng(sd * 7919), nav = new NavGrid(cw, 0, fixed);
    generateBeds(nav, makeRng((sd * 7919 ^ 0x7be5a1c3) >>> 0), { rooms: rooms0, spawn: md.spawn, keepouts: keep, mustReach: must });
    generateFurniture(nav, rng, { rooms: rooms0, forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: md.spawn, keepouts: keep, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    nav.flood(md.spawn.x, md.spawn.z);
    const h = P.stairHatch(md.stair, cw, ladderRoom.id);
    if (!h) { none++; continue; }
    if (JSON.stringify(h) !== JSON.stringify(h0)) diff++;
    if (!nav.reached(h.ax, h.az, 0.3)) far++;
  }
  ok(none === 0, 'pintu rahasia selalu ada (' + none + ' gagal)'); ok(diff === 0, 'posisi tetap (bukan acak), ' + diff + ' berbeda'); ok(far === 0, 'titik berdiri terjangkau dari spawn di semua seed (' + far + ' salah)');
  // collider panel padat untuk pemain & monster; bergeser = tidak lagi menutup posisi semula
  const ob = cw.addObb({ id: 'bunker-secret', cx: h0.x, cz: h0.z, hx: (Math.abs(Math.cos(h0.yaw)) > 0.5 ? P.SECRET.hw : P.SECRET.t / 2), hz: (Math.abs(Math.cos(h0.yaw)) > 0.5 ? P.SECRET.t / 2 : P.SECRET.hw), yaw: 0, level: 0, kind: 'fixed' });
  ok(cw.obbBlocked(h0.x - S.sgn * 0.1, h0.z, 0.15, 0), 'panel tertutup = collider padat');
  ob.cz = h0.z - Math.sin(h0.yaw) * P.SECRET.slide; ob.cx = h0.x + Math.cos(h0.yaw) * P.SECRET.slide;
  ok(!cw.obbBlocked(h0.x - S.sgn * 0.1, h0.z, 0.15, 0) && cw.obbBlocked(ob.cx - S.sgn * 0.1, ob.cz, 0.15, 0), 'panel terbuka = collider ikut bergeser');
  cw.removeObb(ob);
  // snapshot jaringan: bit rahasia tidak mengganggu puzzle & lolos validasi
  { const m = P.makePuzzleModel(12345), a = new P.RoomPuzzle(m), b = new P.RoomPuzzle(m);
    ok(!a.secretOpen && a.openSecret() && a.secretOpen && !a.openSecret(), 'openSecret sekali, idempoten');
    ok(P.isPzSnap(a.snapshot()) && b.apply(a.snapshot()) && b.secretOpen, 'flag rahasia ikut snapshot');
    a.completeAll(); ok(a.secretOpen && a.allDone, 'completeAll tidak menghapus flag rahasia'); }

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
section('PIN 3 digit (saklar belakang tangga)');
{
  const ev = (t) => { let m; if ((m = t.match(/^(\d+) dikurangi (\d+)$/))) return +m[1] - +m[2]; if ((m = t.match(/^(\d+) kali (\d+), lalu kurangi (\d+)$/))) return +m[1] * +m[2] - +m[3]; if ((m = t.match(/^(\d+) dibagi (\d+)$/))) return +m[1] / +m[2]; if ((m = t.match(/^(\d+) ditambah (\d+) ditambah (\d+)$/))) return +m[1] + +m[2] + +m[3]; return NaN; };
  let badPin = 0, badNote = 0, leak = 0;
  for (let sd = 1; sd <= 500; sd++) {
    const m = P.makePuzzleModel(sd * 7919), t = P.pinNoteText(m);
    if (m.pin.length !== 3 || m.pin.some((d) => !(d >= 0 && d <= 9)) || m.pin.every((d) => d === 0)) badPin++;
    const ls = t.split('\n').filter((l) => l.startsWith('Saklar'));
    if (ls.length !== 3 || ls.some((l, k) => ev(l.replace(/^Saklar \w+: /, '').replace(/\.$/, '')) !== m.pin[k])) badNote++;
    if (t.includes(m.pin.join(''))) leak++;
  }
  ok(badPin === 0, 'PIN sah & bukan 000'); ok(badNote === 0, 'teka-teki catatan: tiap baris = digit PIN'); ok(leak === 0, 'PIN tidak tertulis langsung');
  const m = P.makePuzzleModel(4242), z = new P.RoomPuzzle(m), turn = (i, n) => { for (let k = 0; k < n; k++) z.turnPin(i); };
  turn(0, (m.pin[0] + 1) % 10); turn(1, m.pin[1]); turn(2, m.pin[2]);
  ok(z.checkPin() === 'reset' && z.pin.every((d) => d === 0) && z.pinSt === 2 && !z.secretOpen, 'PIN salah = merah + digit reset 0');
  turn(0, m.pin[0]); turn(1, m.pin[1]); turn(2, m.pin[2]);
  const z2 = new P.RoomPuzzle(m); ok(z2.apply(z.snapshot()) && z2.pin.join() === m.pin.join(), 'digit PIN ikut snapshot (sinkron)');
  ok(z.checkPin() === 'done' && z.pinSt === 1 && z.openSecret() && z.secretOpen && z.turnPin(0) === 'ignored', 'PIN benar = hijau -> openSecret(), lalu terkunci');
}
console.log(fails ? `\n${fails} GAGAL` : '\nSEMUA LULUS'); process.exit(fails ? 1 : 0);
