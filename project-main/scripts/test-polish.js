// Uji polish: tangga (naik/turun, tanpa teleport), pintu (pivot, collision mengikuti sudut), container (ruang buka), placement (audit banyak seed).
// Dijalankan oleh scripts/run-test.sh sesudah test-game.js (butuh .tmp-game hasil kompilasi).
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData, measureFootprints } = require(G + '/mapdata.js');
const { NavGrid, generateFurniture, applyFootprints, auditPlacements } = require(G + '/layout.js');
const { makeRng } = require(G + '/rng.js');
const cfg = require(G + '/config.js');
const ST = require(G + '/stairs.js'), DR = require(G + '/door.js'), SW = require(G + '/swing.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'models', 'backrooms_full.glb'));
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
const bin = buf.slice(20 + jl + 8);
const accessor = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType]; const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type]; const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0); return new C(bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT)); };
const TEMPLATE = { table: 'DiningTable_01', shelf: 'Bookshelf_01', desk: 'Desk_01', cabinet: 'Cabinet_01', locker: 'Locker_01', crate: 'FilingCabinet_01', box: 'StorageCabinet_01' };
const md = extractMapData(json);
applyFootprints(measureFootprints(json, TEMPLATE));
const cw = new CollisionWorld(2);
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const w of md.wallNodes) { const m = json.meshes[json.nodes[w.idx].mesh]; const base = cfg.LEVEL_Y[w.level]; for (const p of m.primitives) cw.rasterMesh(w.level, accessor(p.attributes.POSITION), accessor(p.indices), I, base + 0.25, base + 2.0); }
cw.walk[0] = { ...md.floor0 }; cw.walk[1] = { ...md.mezz };
for (const c of md.colliders) cw.addObb(c.obb);
const doorObbs = md.doors.map((d) => ({ d, o: cw.addObb(d.closedObb) }));
const S = md.stair;
const stairDoorOff = () => { for (const { d, o } of doorObbs) o.enabled = false; }; // pintu ruang tangga dianggap terbuka saat tes tangga
const doorsOn = () => { for (const { o } of doorObbs) o.enabled = true; };
const LY = (l) => cfg.LEVEL_Y[l];
const sim = (p, dx, dz, frames, R = 0.3, rec) => { for (let f = 0; f < frames; f++) { ST.movePlayer(cw, S, p, dx, dz, R); const t = ST.floorTarget(S, p, LY); const ny = p.y + (t - p.y) * Math.min(1, 14 / 60); if (rec) rec(p, ny - p.y); p.y = ny; } };

section('Tangga');
stairDoorOff();
ok(!!S && S.steps === 20 && Math.abs(S.rise - 3.4) < 1e-6, 'geometri tangga terbaca');
{ // naik: lewat ambang pintu ruang tangga (z=30,65) sampai lantai 2
  const p = { x: 29.2, z: 30.65, y: 0, level: 0, onStairs: false };
  let maxJump = 0, maxStep = 0, last = { x: p.x, z: p.z }, mono = true, lastY = 0, sawOn = false;
  sim(p, 2.2 * 0.8 / 60, 0, 600, 0.3, (q, dy) => { maxJump = Math.max(maxJump, Math.abs(dy)); maxStep = Math.max(maxStep, Math.hypot(q.x - last.x, q.z - last.z)); last = { x: q.x, z: q.z }; if (q.y < lastY - 1e-6) mono = false; lastY = q.y; if (q.onStairs) sawOn = true; });
  ok(sawOn, 'pemain masuk state tangga lewat mulut');
  ok(p.level === 1 && !p.onStairs && Math.abs(p.y - 3.4) < 0.02, `sampai lantai 2 (level=${p.level}, y=${p.y.toFixed(2)})`);
  ok(maxJump < 0.08, `tinggi kamera naik bertahap, tanpa lompatan (maks ${maxJump.toFixed(3)} m/frame)`);
  ok(maxStep < 0.06, `posisi kontinu, tanpa teleport (maks ${maxStep.toFixed(3)} m/frame)`);
  ok(mono, 'naik tidak pernah turun');
  // turun
  let sawMid = false; let dj = 0;
  sim(p, -2.2 * 0.8 / 60, 0, 600, 0.3, (q, dy) => { dj = Math.max(dj, Math.abs(dy)); if (q.onStairs && q.y > 1 && q.y < 2.5) sawMid = true; });
  ok(sawMid && p.level === 0 && !p.onStairs && p.y < 0.02, `turun bertahap sampai lantai 1 (level=${p.level}, y=${p.y.toFixed(2)})`);
  ok(dj < 0.08, 'turun halus');
}
for (const [lv, y] of [[0, 0], [1, 3.4]]) for (const [sx, sz, dz] of [[34, 29.45, 1], [34, 32.95, -1]]) { // dari sisi: tidak bisa naik lewat sisi tangga
  const p = { x: sx, z: sz, y, level: lv, onStairs: false };
  const z0 = p.z; sim(p, 0, dz * 2.2 / 60, 300);
  ok(!p.onStairs && Math.abs(p.z - S.zc) > S.hw - 0.01, `lantai ${lv + 1}: tidak masuk tangga lewat sisi (z=${p.z.toFixed(2)})`);
}
{ // di tangga tidak bisa keluar lewat sisi
  const p = { x: 30.5, z: 30.65, y: 0, level: 0, onStairs: false };
  sim(p, 2.2 / 60, 0, 90); ok(p.onStairs, 'masuk tangga');
  sim(p, 0, -2.2 / 60, 120); ok(p.onStairs && p.z >= S.zc - S.hw + 0.3 - 1e-6, `dinding samping kiri menahan (z=${p.z.toFixed(2)})`);
  sim(p, 0, 2.2 / 60, 240); ok(p.onStairs && p.z <= S.zc + S.hw - 0.3 + 1e-6, `dinding samping kanan menahan (z=${p.z.toFixed(2)})`);
  ok(ST.canStandAt(cw, S, p, 0.3), 'bisa berdiri di tangga');
}
{ // jongkok di tangga tetap sampai atas
  const p = { x: 29.2, z: 30.65, y: 0, level: 0, onStairs: false };
  sim(p, 1.1 / 60, 0, 1400, 0.24); ok(p.level === 1 && Math.abs(p.y - 3.4) < 0.02, 'naik sambil jongkok');
}
{ // kolong tangga / ujung salah tidak bisa dimasuki
  const p = { x: 38.0, z: 31.2, y: 0, level: 0, onStairs: false }; sim(p, -2.2 / 60, 0, 200);
  ok(!p.onStairs && p.x > 37.4, 'tidak bisa menembus badan tangga dari kolong ujung atas');
  const q = { x: 37.7, z: 31.2, y: 3.4, level: 1, onStairs: false }; sim(q, 0, 0, 1); ok(q.level === 1, 'lantai 2 tetap lantai 2');
}
{ // jalan acak 100k langkah: tidak pernah 'terbang' (y selalu cocok state) & tidak keluar zona
  const rng = makeRng(99); const p = { x: 30.5, z: 30.65, y: 0, level: 0, onStairs: false }; let bad = 0;
  for (let n = 0; n < 100000; n++) { const a = rng.range(0, Math.PI * 2); ST.movePlayer(cw, S, p, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.3); p.y = ST.floorTarget(S, p, LY);
    if (p.onStairs && (Math.abs(p.z - S.zc) > S.hw || ST.stairU(S, p.x) < -0.5 || ST.stairU(S, p.x) > S.run + 0.5)) bad++;
    if (!p.onStairs && ST.inStairFootprint(S, p.x, p.z, -0.01)) bad++; }
  ok(bad === 0, `jalan acak di sekitar tangga konsisten (${bad} pelanggaran)`);
}

doorsOn();
section('Pintu');
{
  let hingeBad = 0, blkBad = 0, passBad = 0, poseBad = 0, sweepBad = 0;
  for (const { d, o } of doorObbs) {
    const g = { hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: d.openAngle * Math.PI / 180, half: d.closedObb.hx };
    const p0 = DR.leafPose(g, 0);
    if (Math.hypot(p0.cx - d.closedObb.cx, p0.cz - d.closedObb.cz) > 0.02) hingeBad++; // pose tertutup = kotak tertutup dari map (engsel benar)
    // engsel tetap diam saat daun berputar (bukan dari tengah): titik pangkal daun = engsel
    for (const a of [0.25, 0.5, 1]) { const p = DR.leafPose(g, a); const bx = p.cx - Math.sin(p.yaw) * p.hz, bz = p.cz - Math.cos(p.yaw) * p.hz; if (Math.hypot(bx - d.hingeX, bz - d.hingeZ) > 1e-6) poseBad++; }
    // tertutup memblokir pusat bukaan; terbuka (>=70%) tidak
    const mx = d.cx, mz = d.cz;
    DR.applyPose(o, g, 0); o.enabled = true; if (!cw.blocked(mx, mz, 0.3, d.level)) blkBad++;
    DR.applyPose(o, g, 0.5); if (!DR.doorBlocksAt(0.5)) blkBad++;
    if (DR.doorBlocksAt(1)) passBad++;
    o.enabled = false; const cx = d.cx, cz = d.cz; // titik tengah bukaan harus bebas dari daun terbuka
    if (DR.leafDist(g, 1, cx, cz) < 0.3 && d.type === 'door') passBad++;
    if (DR.leafDist(g, DR.OPEN_FREE_FRAC, cx, cz) < 0.3 && d.type === 'door' && Math.abs(d.openAngle) < 100) passBad++;
    // pintu tidak boleh menembus pemain yang berdiri di jalur ayunan
    const sp = DR.swingPoints(g)[5]; if (!DR.sweepHitsPlayer({ ...g, half: 0.04 }, 0, 1, sp.x, sp.z, 0.3)) sweepBad++;
    DR.applyPose(o, g, 0); o.enabled = true;
  }
  const n = doorObbs.length;
  ok(hingeBad === 0, `pose tertutup cocok dengan map untuk semua ${n} pintu (${hingeBad} salah)`);
  ok(poseBad === 0, 'daun berputar di sekitar engsel (bukan dari tengah)');
  ok(blkBad === 0, 'pintu tertutup memblokir; collision mengikuti sudut');
  ok(passBad === 0, `bukaan lewat ambang cukup lebar saat terbuka (${passBad})`);
  ok(sweepBad === 0, 'sapuan daun mendeteksi pemain di jalur ayunan');
}

section('Container: ruang buka');
{
  const parentOf = new Array(json.nodes.length).fill(-1); json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parentOf[c] = i)));
  const worldM = (i) => { const ch = []; for (let k = i; k >= 0; k = parentOf[k]) ch.push(k); let m = I.slice(); for (let k = ch.length - 1; k >= 0; k--) { const n = json.nodes[ch[k]]; m = SW.mul(m, SW.compose(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1])); } return m; };
  const { subtreeBounds } = require(G + '/mapdata.js');
  const byId = new Map(); json.nodes.forEach((n, i) => { const it = n.extras && n.extras.interact; if (it && it.type === 'container') { const a = byId.get(it.container_id) || []; a.push(i); byId.set(it.container_id, a); } });
  let total = 0, full = 0, partial = 0, blocked = 0, nan = 0; const sample = [];
  byId.forEach((idxs, id) => {
    const root = parentOf[idxs[0]]; const rn = json.nodes[root];
    const parts = idxs.map((i) => { const n = json.nodes[i], it = n.extras.interact, b = subtreeBounds(json, i); return { p0: n.translation || [0, 0, 0], q0: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1], hinge: it.open_type === 'hinge', axis: it.axis || [0, 1, 0], angle: (it.angle_deg || 0) * Math.PI / 180, slide: it.slide || [0, 0, 0], mn: b.mn, mx: b.mx }; });
    const lvl = (worldM(root)[13] > 2.9) ? 1 : 0;
    const lim = SW.openLimit(cw, lvl, worldM(root), parts, rn.name);
    total++; if (!Number.isFinite(lim)) nan++; if (lim >= 1) full++; else if (lim >= 0.5) partial++; else { blocked++; if (sample.length < 5) sample.push(id + '@' + lim); }
  });
  console.log(`  container bawaan map: ${total} | buka penuh ${full} | sebagian ${partial} | terhalang ${blocked} ${sample.join(',')}`);
  ok(nan === 0, 'ruang buka selalu angka valid');
  ok(total >= 200, 'container terbaca');
  ok(full / total > 0.9, `>90% container bawaan terbuka penuh tanpa menembus (${(100 * full / total).toFixed(1)}%)`);
}

section('Placement furniture (banyak seed)');
{
  const fixed = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]);
  const keepouts = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }, { x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 }];
  for (let u = 0; u <= S.run + 1.2; u += 1.2) keepouts.push({ x: S.bx + S.sgn * u, z: S.zc, r: 2.0 });
  for (const d of md.doors) if (d.level === 0) { for (const sp of DR.swingPoints({ hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: d.openAngle * Math.PI / 180, half: 0.04 })) keepouts.push({ x: sp.x, z: sp.z, r: 0.45 }); keepouts.push({ x: d.cx, z: d.cz, r: 1.5 }); }
  const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }, { x: md.ladder.bottom[0], z: md.ladder.bottom[2], rad: 0.7 }];
  for (const d of md.doors) if (d.level === 0) for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; must.push({ x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, rad: 0.7 }); }
  const rooms = md.rooms.filter((r) => r.level === 0);
  let violations = 0, empty = 0, tot = 0, doorway = 0, stairIn = 0, spawnNear = 0; const ex = [];
  for (let seed = 1; seed <= 150; seed++) {
    const nav = new NavGrid(cw, 0, fixed), rng = makeRng(seed * 7919);
    const pl = generateFurniture(nav, rng, { rooms, forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    tot += pl.length; if (!pl.length) empty++;
    const a = auditPlacements(cw, fixed, pl, keepouts); violations += a.length; if (a.length && ex.length < 4) ex.push(`seed ${seed}: ${a[0]}`);
    for (const p of pl) {
      if (Math.hypot(p.x - md.spawn.x, p.z - md.spawn.z) < 2.0) spawnNear++;
      if (ST.inStairFootprint(S, p.x, p.z, 0.8)) { stairIn++; if (process.env.DBG) console.log('   stair-near', p.kind, p.x.toFixed(2), p.z.toFixed(2)); }
      for (const d of md.doors) if (d.level === 0 && Math.hypot(p.x - d.cx, p.z - d.cz) < 0.9 + Math.max(p.hx, p.hz) * 0.6) { doorway++; break; }
    }
  }
  console.log(`  150 seed: ${tot} furniture, audit pelanggaran=${violations} ${ex.join(' | ')}`);
  ok(violations === 0, 'audit: tidak menembus dinding / furniture lain / area bebas / ayunan pintu');
  ok(empty === 0 && tot / 150 >= cfg.MIN_FURNITURE - 1, 'jumlah furniture tetap terpenuhi');
  ok(doorway === 0, `tidak menutup ambang pintu (${doorway})`);
  ok(stairIn === 0, `tidak di area tangga (${stairIn})`);
  ok(spawnNear === 0, `tidak di spawn (${spawnNear})`);
}

console.log(`\nPolish: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
