// Uji logika game dengan GLB asli (tanpa browser): collision, furniture acak, key, inventory per-player.
// Jalankan: npm run test:game
const fs = require('fs');
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData, applyPropNudges, measureFootprints, subtreeBounds } = require(G + '/mapdata.js');
const { NavGrid, generateFurniture, assignContents, pickFreeSpots, FURN_DEFS, SEARCHABLE, applyFootprints, visualOffset, swingBox, boxesOverlap } = require(G + '/layout.js');
const { makeRng } = require(G + '/rng.js');
const { Inventory, createPlayer } = require(G + '/inventory.js');
const { KEY_IDS, KEY_DEFS } = require(G + '/keys.js');
const { Flashlight } = require(G + '/flashlight.js');
const { Stamina } = require(G + '/stamina.js');
const { EventScheduler } = require(G + '/events.js');
const { SFX } = require(G + '/sfx.js');
const { ContainerState } = require(G + '/container.js');
const Module = require('module');
const _res = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'three' ? path.join(__dirname, 'three-stub.js') : _res.call(this, req, ...a); };
const { InteractionSystem } = require(G + '/interaction.js');
const cfg = require(G + '/config.js');
const { validateRun, slotProblem, findSafeSpawn, keyPosProblem } = require(G + '/validate.js');
const { planDecor, extractWallPlanes } = require(G + '/decor.js');
const { planRoomState, planShift } = require(G + '/roomstate.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; } else { fails++; console.log('  GAGAL:', msg); } };
const section = (t) => console.log('\n== ' + t);

// ---- parse GLB ----
const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'models', 'backrooms_level_0.glb'));
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
const bin = buf.slice(20 + jl + 8);
const accessor = (i) => {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
  const comp = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new comp(bin.buffer.slice(off, off + a.count * n * comp.BYTES_PER_ELEMENT));
};

applyPropNudges(json);
const md = extractMapData(json);
const TEMPLATE = { table: 'Table_Office_01', shelf: 'Shelf_Office_01', desk: 'Desk_Office_01', cabinet: 'Cabinet_Office_01', locker: 'Locker_Dark_01', crate: 'Crate_Dark_01', box: 'Crate_Dark_02' };
applyFootprints(measureFootprints(json, TEMPLATE)); // sama seperti GameWorld.load

// ---- bangun collision persis seperti di game ----
const cw = new CollisionWorld(2);
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const w of md.wallNodes) {
  const m = json.meshes[json.nodes[w.idx].mesh];
  const base = w.level === 1 ? 3 : 0;
  for (const p of m.primitives) cw.rasterMesh(w.level, accessor(p.attributes.POSITION), accessor(p.indices), IDENT, base + 0.25, base + 2.0);
}
if (md.mezz) cw.walk[1] = { minx: md.mezz.minx, maxx: md.mezz.maxx, minz: md.mezz.minz, maxz: md.mezz.maxz };
for (const c of md.colliders) cw.addObb(c.obb);
const doorObbs = md.doors.map((d) => ({ d, o: cw.addObb(d.closedObb) }));

section('Map & data');
console.log(`  rooms=${md.rooms.length} doors=${md.doors.length} containers=${md.containers.length} colliders=${md.colliders.length}`);
ok(md.rooms.length >= 12, 'room terbaca');
ok(md.doors.length >= 17, 'pintu terbaca');
ok(md.containers.length >= 25, 'container terbaca');
ok(md.exit.door.type === 'exit_door' && md.exit.door.locked, 'exit door terkunci');
console.log(`  spawn=(${md.spawn.x},${md.spawn.z}) yaw=${md.spawn.yaw.toFixed(2)} exit=(${md.exit.door.cx},${md.exit.door.cz}) inside=(${md.exit.insideX},${md.exit.insideZ})`);

section('Collision');
ok(!cw.blocked(md.spawn.x, md.spawn.z, 0.3, 0), 'spawn tidak menempel dinding');
let outsideEscape = 0;
for (let k = 0; k < 2000; k++) { // lempar titik acak di sekitar map: tidak boleh ada jalan menembus dinding luar
  // dilakukan di bawah lewat flood
}
// pintu: tanpa objek pintu lubang harus ada, dengan pintu tertutup harus terblokir
let doorsOpen = 0, doorsBlocked = 0;
for (const { d, o } of doorObbs) {
  o.enabled = false; const free = !cw.blocked(d.cx, d.cz, 0.3, d.level);
  o.enabled = true; const blk = cw.blocked(d.cx, d.cz, 0.3, d.level);
  if (free) doorsOpen++; else console.log('   lubang tertutup dinding:', d.name, d.cx, d.cz);
  if (blk) doorsBlocked++;
}
ok(doorsOpen === md.doors.length, `semua pintu punya lubang di dinding (${doorsOpen}/${md.doors.length})`);
ok(doorsBlocked === md.doors.length, `pintu tertutup memblokir (${doorsBlocked}/${md.doors.length})`);
// player tidak bisa menembus dinding: gerakkan ke segala arah dari spawn
{
  const bx = (x, z) => cw.blocked(x, z, 0.3, 0);
  let px = md.spawn.x, pz = md.spawn.z, esc = 0;
  const rng = makeRng(7);
  for (let n = 0; n < 200000; n++) {
    const a = rng.range(0, Math.PI * 2), sp = 0.2;
    const dx = Math.cos(a) * sp, dz = Math.sin(a) * sp;
    if (!bx(px + dx, pz)) px += dx;
    if (!bx(px, pz + dz)) pz += dz;
    if (px < -24.2 || px > 24.2 || pz < -20.2 || pz > 20.2) esc++;
  }
  ok(esc === 0, `random walk 200k langkah (dengan pintu tertutup) tidak keluar map (${esc})`);
}

section('Nav dasar');
// segel pintu exit di nav agar flood tidak bocor keluar map
const fixed = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]);
const nav0 = new NavGrid(cw, 0, fixed);
const base = nav0.flood(md.spawn.x, md.spawn.z);
console.log('  sel terjangkau dari spawn:', base);
const unreachDoors = [];
for (const d of md.doors.filter((d) => d.level === 0)) {
  for (const sg of [1, -1]) {
    const px = d.cx + d.nx * sg * 0.9, pz = d.cz + d.nz * sg * 0.9;
    if (d.type === 'exit_door' && sg === -1) continue; // luar map
    if (!nav0.reached(px, pz, 0.7)) unreachDoors.push(`${d.name}@${sg}`);
  }
}
ok(unreachDoors.length === 0, 'semua pintu bisa dijangkau dari spawn: ' + unreachDoors.join(','));
ok(nav0.reached(md.exit.insideX, md.exit.insideZ, 0.7), 'sisi dalam exit terjangkau dari spawn');
// uji lintasan pintu: lingkaran radius 0.3 harus bisa lewat dari satu sisi ke sisi lain (BFS lokal)
{
  const bad = [];
  for (const d of md.doors.filter((d) => d.level === 0)) {
    const inside = (x, z) => Math.abs(x - d.cx) < 2.2 && Math.abs(z - d.cz) < 2.2;
    const free = (x, z) => !cw.blocked(x, z, 0.3, 0) || d.type === 'x'; // pintu dianggap terbuka
    doorObbs.forEach((x) => { x.o.enabled = false; });
    // titik sebrang pintu: boleh bergeser menyamping (pemain tidak harus lewat tepat di tengah lubang) hingga 0,4 m
    const lat = (sg, o) => [d.cx + d.nx * sg + d.nz * o, d.cz + d.nz * sg + d.nx * o];
    const pick = (sg) => [0, 0.2, -0.2, 0.4, -0.4].map((o) => lat(sg, o)).find(([x, z]) => !cw.blocked(x, z, 0.3, 0));
    const A = pick(-1) ?? lat(-1, 0), B = pick(1) ?? lat(1, 0);
    const st = 0.1, seen = new Set(); const q = [[A[0], A[1]]]; let found = false;
    const key = (x, z) => Math.round(x / st) + ',' + Math.round(z / st);
    if (cw.blocked(A[0], A[1], 0.3, 0) || cw.blocked(B[0], B[1], 0.3, 0)) { doorObbs.forEach((x) => { x.o.enabled = true; }); bad.push(d.name + '(sisi terhalang prop)'); continue; }
    seen.add(key(A[0], A[1]));
    while (q.length && !found) { const [x, z] = q.pop(); if (Math.hypot(x - B[0], z - B[1]) < 0.15) { found = true; break; }
      for (const [dx, dz] of [[st, 0], [-st, 0], [0, st], [0, -st]]) { const nx = x + dx, nz = z + dz; const k = key(nx, nz); if (seen.has(k) || !inside(nx, nz) || cw.blocked(nx, nz, 0.3, 0)) continue; seen.add(k); q.push([nx, nz]); } }
    doorObbs.forEach((x) => { x.o.enabled = true; });
    if (!found) bad.push(d.name);
  }
  // Dua pintu bawaan map tertutup rak di sisi dalam (layout asli dipertahankan); ruangannya tetap terjangkau lewat pintu lain.
  const KNOWN = ['Door_Office_East', 'Door_StorageDark_West'];
  const unexpected = bad.filter((n) => !KNOWN.some((k) => n.startsWith(k)));
  if (bad.length) console.log('  catatan: pintu bawaan tertutup prop:', bad.join(', '));
  ok(unexpected.length === 0, 'semua pintu lain bisa dilewati pemain (radius 0.3): ' + unexpected.join(','));
}
const unreachC = md.containers.filter((c) => c.level === 0 && !nav0.reached(c.ax, c.az, 1.6)).map((c) => c.id);
ok(unreachC.length === 0, 'semua container lantai 0 terjangkau: ' + unreachC.join(','));
// level 1
{
  const nav1 = new NavGrid(cw, 1, fixed);
  const top = md.ladder.top; const n1 = nav1.flood(top[0], top[2]);
  console.log('  sel mezzanine terjangkau dari tangga:', n1);
  const up = md.containers.filter((c) => c.level === 1);
  ok(up.length > 0 && up.every((c) => nav1.reached(c.ax, c.az, 1.6)), 'container mezzanine terjangkau dari puncak tangga');
}

section('Key di dalam container (data map)');
for (const c of md.containers) {
  const a = c.anchorLocal;
  const inside = a[0] >= c.bodyMin[0] && a[0] <= c.bodyMax[0] && a[1] >= c.bodyMin[1] && a[1] <= c.bodyMax[1] && a[2] >= c.bodyMin[2] && a[2] <= c.bodyMax[2];
  ok(inside, `anchor ${c.id} berada di dalam badan container`);
}

section('Furniture acak (200 seed)');
const keepouts = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
if (md.ladder) keepouts.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
for (const d of md.doors) if (d.level === 0) keepouts.push({ x: d.cx, z: d.cz, r: 1.5 });
const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }];
for (const d of md.doors.filter((d) => d.level === 0)) for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; must.push({ x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, rad: 0.7 }); }
for (const c of md.containers.filter((c) => c.level === 0)) must.push({ x: c.ax, z: c.az, rad: 1.6 });

const obbOverlap = (A, B, m) => { // sampling titik dalam A terhadap B
  const ca = Math.cos(A.yaw), sa = Math.sin(A.yaw), cb = Math.cos(B.yaw), sb = Math.sin(B.yaw);
  for (let lx = -A.hx; lx <= A.hx + 1e-9; lx += 0.05) for (let lz = -A.hz; lz <= A.hz + 1e-9; lz += 0.05) {
    const wx = A.cx + lx * ca + lz * sa, wz = A.cz - lx * sa + lz * ca;
    const dx = wx - B.cx, dz = wz - B.cz;
    const bx = dx * cb - dz * sb, bz = dx * sb + dz * cb;
    if (Math.abs(bx) < B.hx + m && Math.abs(bz) < B.hz + m) return true;
  }
  return false;
};

const kinds = new Set(); let totalMs = 0, minC = 99, maxC = 0, countFail = 0;
const keySigs = new Set(), layoutSigs = new Set();
let maxMs = 0;
for (let seed = 1; seed <= 200; seed++) {
  const rng = makeRng(seed * 7919);
  const nav = new NavGrid(cw, 0, fixed);
  const count = rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE);
  const t0 = process.hrtime.bigint();
  const pl = generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; totalMs += ms; maxMs = Math.max(maxMs, ms);
  minC = Math.min(minC, pl.length); maxC = Math.max(maxC, pl.length);
  if (pl.length < cfg.MIN_FURNITURE) countFail++;
  pl.forEach((p) => kinds.add(p.kind));
  layoutSigs.add(pl.map((p) => p.kind + p.x.toFixed(1) + p.z.toFixed(1)).join('|'));
  const obs = pl.map((p) => ({ cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw }));
  // overlap
  let bad = 0;
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) if (obbOverlap(obs[i], obs[j], 0)) { bad++; if (process.env.DBG) console.log('   overlap furn', pl[i].kind, pl[j].kind); }
    for (const c of md.colliders) if (c.obb.level === 0 && obbOverlap(obs[i], c.obb, 0)) { bad++; if (process.env.DBG) console.log('   overlap fixed', pl[i].kind, pl[i].x.toFixed(2), pl[i].z.toFixed(2), c.name); }
    // dinding
    for (let lx = -obs[i].hx + 0.07; lx <= obs[i].hx - 0.07; lx += 0.05) for (let lz = -obs[i].hz + 0.07; lz <= obs[i].hz - 0.07; lz += 0.05) {
      const wx = obs[i].cx + lx * Math.cos(obs[i].yaw) + lz * Math.sin(obs[i].yaw), wz = obs[i].cz - lx * Math.sin(obs[i].yaw) + lz * Math.cos(obs[i].yaw);
      if (cw.gridBlocked(wx, wz, 0.0, 0)) { bad++; if (process.env.DBG) console.log('   overlap wall', pl[i].kind, pl[i].x.toFixed(2), pl[i].z.toFixed(2), wx.toFixed(2), wz.toFixed(2)); }
    }
    // keepout
    for (const k of keepouts) if (CollisionWorld.distToObb({ ...obs[i], cos: Math.cos(obs[i].yaw), sin: Math.sin(obs[i].yaw) }, k.x, k.z) < k.r - 1e-6) { bad++; if (process.env.DBG) console.log('   keepout', pl[i].kind, pl[i].x.toFixed(2), pl[i].z.toFixed(2), k.x, k.z, k.r); }
  }
  if (bad) { fails++; console.log(`  GAGAL: seed ${seed} overlap/keepout=${bad} ` + pl.map((p) => p.kind + '@' + p.x.toFixed(2) + ',' + p.z.toFixed(2)).join(' ')); }
  // konektivitas ulang dari nol (verifikasi independen): semua titik penting terjangkau
  const nv = new NavGrid(cw, 0, fixed);
  for (const o of obs) nv.addObb({ id: 'x', ...o, level: 0, kind: 'f' }, 0.02);
  nv.flood(md.spawn.x, md.spawn.z);
  const miss = must.filter((m) => !nv.reached(m.x, m.z, m.rad ?? 0.25) && nav0.reached(m.x, m.z, m.rad ?? 0.25));
  if (miss.length) { fails++; console.log(`  GAGAL: seed ${seed} titik tak terjangkau ${miss.length}`); }
  else passes++;
  // player benar-benar bisa berjalan: cek collision-based BFS kasar ke exit (pakai furniture sbg obb)
  // key assign
  const slots = [];
  for (const c of md.containers) slots.push({ id: c.id, x: c.ax, z: c.az, level: c.level });
  for (const p of pl) if (SEARCHABLE.includes(p.kind)) {
    if (p.kind === 'desk') { slots.push({ id: p.id + '_d1', x: p.ax, z: p.az, level: 0 }, { id: p.id + '_d2', x: p.ax, z: p.az, level: 0 }); }
    else slots.push({ id: p.id, x: p.ax, z: p.az, level: 0 });
  }
  const cont = assignContents(slots, makeRng(seed + 99), KEY_IDS.slice(0, cfg.REQUIRED_KEYS), md.spawn, cfg.MIN_BATTERY_PICKUPS);
  const keyIds = [...cont.entries()].filter(([, v]) => v.type === 'key').map(([k]) => k);
  if (keyIds.length !== cfg.REQUIRED_KEYS) { fails++; console.log(`  GAGAL: seed ${seed} jumlah key ${keyIds.length}`); }
  keySigs.add(keyIds.sort().join(','));
  const ks = keyIds.map((id) => slots.find((s) => s.id === id));
  if (ks.some((s) => !nv.reached(s.x, s.z, 1.6) && s.level === 0)) { fails++; console.log(`  GAGAL: seed ${seed} key di container tak terjangkau`); }
  if (new Set(keyIds).size !== keyIds.length) { fails++; console.log('  GAGAL: key duplikat'); }
  const colors = [...cont.values()].filter((v) => v.type === 'key').map((v) => v.key).sort().join(',');
  if (colors !== KEY_IDS.slice().sort().join(',')) { fails++; console.log(`  GAGAL: seed ${seed} warna key ${colors}`); }
  if (ks.some((s) => s.level !== 0)) { fails++; console.log(`  GAGAL: seed ${seed} key di mezzanine`); }
  const bats = [...cont.values()].filter((v) => v.type === 'loot' && v.item === 'battery').length;
  if (bats < cfg.MIN_BATTERY_PICKUPS) { fails++; console.log(`  GAGAL: seed ${seed} battery tersembunyi ${bats}`); }
}
console.log(`  furniture per run: ${minC}..${maxC} | jenis: ${[...kinds].sort().join(',')} | rata-rata ${(totalMs / 200).toFixed(1)} ms, maks ${maxMs.toFixed(0)} ms`);
console.log(`  layout unik: ${layoutSigs.size}/200 | kombinasi key unik: ${keySigs.size}/200`);
ok(countFail === 0, `jumlah furniture >= MIN di semua seed (gagal: ${countFail})`);
ok(maxC <= cfg.MAX_FURNITURE, 'jumlah furniture <= MAX');
ok(['table', 'cabinet', 'desk', 'crate', 'shelf'].every((k) => kinds.has(k)), 'meja, lemari, laci, crate, rak muncul');
ok(layoutSigs.size > 190, 'layout berubah tiap run');
ok(keySigs.size > 150, 'posisi key berubah tiap run');

section('Collision furniture (rak) vs visual GLB');
{
  // 1) footprint tiap template menutupi seluruh visual (mesh induk + anak yang menonjol)
  let under = 0;
  for (const [kind, name] of Object.entries(TEMPLATE)) {
    const i = json.nodes.findIndex((n) => n.name === name); const { mn, mx } = subtreeBounds(json, i);
    const d = FURN_DEFS[kind];
    if (d.ox - d.w / 2 > mn[0] + 1e-6 || d.ox + d.w / 2 < mx[0] - 1e-6 || d.oz - d.d / 2 > mn[2] + 1e-6 || d.oz + d.d / 2 < mx[2] - 1e-6) { under++; console.log('   footprint kurang:', kind); }
  }
  ok(under === 0, 'footprint furniture acak menutupi bounds visual GLB');
  // 2) prop tetap (rak bawaan map): OBB menutupi subtree visual
  let fixedBad = 0;
  for (const c of md.colliders) if (/^Shelf_/.test(c.name)) {
    const { mn, mx } = subtreeBounds(json, c.idx);
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2; // ruang lokal; cukup cek ukuran
    if (c.obb.hz + 1e-6 < (mx[2] - mn[2]) / 2 || c.obb.hx + 1e-6 < (mx[0] - mn[0]) / 2) fixedBad++;
  }
  ok(fixedBad === 0, 'rak bawaan map: collision menutupi visual');
  // 3) tabrak rak dari 16 arah pada 30 seed acak (juga setelah digeser seperti event furniture) : tidak boleh menembus
  let tested = 0, pen = 0, stuckOut = 0;
  const R = cfg.PLAYER_RADIUS;
  for (let seed = 1; seed <= 30; seed++) {
    const rng = makeRng(seed * 104729);
    const nav = new NavGrid(cw, 0, fixed);
    const pl = generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: cfg.MAX_FURNITURE });
    const added = pl.map((p) => cw.addObb({ id: p.id, cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, level: 0, kind: 'rand-' + p.kind }));
    for (const p of pl.filter((q) => q.kind === 'shelf')) {
      const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        let px = p.x + Math.cos(ang) * 2.2, pz = p.z + Math.sin(ang) * 2.2;
        if (cw.blocked(px, pz, R, 0)) continue; // titik awal tidak valid (dinding): lewati
        tested++;
        for (const speed of [0.05, 0.4]) { // jalan normal & langkah besar (lag) dengan substep seperti PlayScene
          let qx = px, qz = pz;
          for (let n = 0; n < 120; n++) {
            const vx = (p.x - qx), vz = (p.z - qz), L = Math.hypot(vx, vz) || 1;
            const dx = (vx / L) * speed, dz = (vz / L) * speed, k = Math.min(6, Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08)));
            for (let q = 0; q < k; q++) { if (!cw.blocked(qx + dx / k, qz, R, 0)) qx += dx / k; if (!cw.blocked(qx, qz + dz / k, R, 0)) qz += dz / k; }
            // posisi pemain (titik) tidak boleh masuk kotak visual rak
            const lx = (qx - p.x) * cs - (qz - p.z) * sn, lz = (qx - p.x) * sn + (qz - p.z) * cs;
            if (Math.abs(lx) < p.hx - 0.01 && Math.abs(lz) < p.hz - 0.01) { pen++; break; }
          }
          if (CollisionWorld.distToObb({ cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, cos: cs, sin: sn }, qx, qz) < R - 0.02) stuckOut++;
        }
      }
    }
    for (const o of added) cw.removeObbs((b) => b === o);
  }
  console.log(`  tabrakan rak: ${tested} arah x 2 kecepatan, menembus=${pen}`);
  ok(tested > 100, 'cukup banyak uji tabrakan rak (' + tested + ')');
  ok(pen === 0 && stuckOut === 0, `pemain tidak menembus rak (menembus=${pen}, terlalu dekat=${stuckOut})`);
  ok(cw.obbs.every((o) => !o.kind.startsWith('rand-')), 'obb acak dibersihkan antar seed');
}

section('AUDIT furniture: placement & collision (150 seed, collision lingkaran nyata)');
{
  const SEEDS = 150, R = cfg.PLAYER_RADIUS;
  const solid0 = cw.solid[0], Wd = cw.W;
  const wallCells = (b, shrink) => { // sel dinding di dalam kotak (dikecilkan `shrink`)
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), rad = Math.hypot(b.hx, b.hz);
    const i0 = Math.floor((b.cx - rad - cw.x0) / 0.1), i1 = Math.floor((b.cx + rad - cw.x0) / 0.1), j0 = Math.floor((b.cz - rad - cw.z0) / 0.1), j1 = Math.floor((b.cz + rad - cw.z0) / 0.1);
    let n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!solid0[j * Wd + i]) continue;
      const dx = cw.x0 + (i + 0.5) * 0.1 - b.cx, dz = cw.z0 + (j + 0.5) * 0.1 - b.cz;
      if (Math.abs(dx * c - dz * sn) <= b.hx - shrink && Math.abs(dx * sn + dz * c) <= b.hz - shrink) n++;
    }
    return n;
  };
  // BFS fisik: lingkaran radius pemain pada collision nyata (dinding + furniture, pintu dianggap terbuka kecuali exit)
  const physReach = (sx, sz) => {
    const st = 0.1, key = (i, j) => j * 1000 + i, seen = new Map();
    const q = [[Math.round((sx - cw.x0) / st), Math.round((sz - cw.z0) / st)]]; seen.set(key(q[0][0], q[0][1]), 1);
    while (q.length) { const [i, j] = q.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, k = key(ii, jj); if (seen.has(k) || ii < 0 || jj < 0 || ii >= cw.W || jj >= cw.H) continue;
        if (cw.blocked(cw.x0 + ii * st, cw.z0 + jj * st, R, 0)) continue; seen.set(k, 1); q.push([ii, jj]); } }
    return { has: (x, z, rad = 0.3) => { const n = Math.ceil(rad / st), ci = Math.round((x - cw.x0) / st), cj = Math.round((z - cw.z0) / st); for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) if (seen.has(key(ci + a, cj + b))) return true; return false; }, size: seen.size };
  };
  doorObbs.forEach(({ d, o }) => { o.enabled = d.type === 'exit_door'; });
  const base0 = physReach(md.spawn.x, md.spawn.z);
  const fixedVis = md.colliders.filter((c) => c.vis.level === 0 && c.obb.kind !== 'rail');
  const viol = { desync: 0, wall: 0, swingWall: 0, fixed: 0, rand: 0, door: 0, keepout: 0, route: 0, mesh: 0, count: 0 };
  let nPlaced = 0, minCount = 99;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = makeRng(seed * 31337 + 5);
    const nav = new NavGrid(cw, 0, fixed);
    const pl = generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    nPlaced += pl.length; minCount = Math.min(minCount, pl.length); if (pl.length < cfg.MIN_FURNITURE) viol.count++;
    const added = pl.map((p) => cw.addObb({ id: p.id, cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, level: 0, kind: 'rand-' + p.kind }));
    pl.forEach((p, a) => {
      const body = { cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw }, sw = swingBox(p.kind, body);
      // visual mesh (bounds GLB + posisi mesh p.x+vx) harus tepat di dalam collision (selisih < 2 cm tiap sisi)
      const i = json.nodes.findIndex((n) => n.name === TEMPLATE[p.kind]); const { mn, mx } = subtreeBounds(json, i);
      const c = Math.cos(p.yaw), sn = Math.sin(p.yaw), ox = p.x + p.vx, oz = p.z + p.vz;
      let worst = 0;
      for (const lx of [mn[0], mx[0]]) for (const lz of [mn[2], mx[2]]) {
        const wx = ox + lx * c + lz * sn, wz = oz - lx * sn + lz * c, dx = wx - p.x, dz = wz - p.z;
        const bx = dx * c - dz * sn, bz = dx * sn + dz * c; // koordinat di kotak collision
        worst = Math.max(worst, Math.abs(bx) - p.hx, Math.abs(bz) - p.hz);
      }
      if (worst > 0.001) viol.mesh++; // mesh keluar dari collision
      const slackX = p.hx * 2 - (mx[0] - mn[0]), slackZ = p.hz * 2 - (mx[2] - mn[2]);
      if (slackX > 0.04 || slackZ > 0.04) viol.desync++; // collision jauh lebih besar dari visual
      if (wallCells(body, 0.02) > 0) viol.wall++;
      if (wallCells(sw, 0.02) > 0) viol.swingWall++;
      for (const f of fixedVis) if (boxesOverlap(body, f.vis, 0) || boxesOverlap(sw, f.vis, 0)) { viol.fixed++; if (process.env.DBG) console.log('   fixed', seed, p.id, f.name); }
      for (let b = a + 1; b < pl.length; b++) { const q = { cx: pl[b].x, cz: pl[b].z, hx: pl[b].hx, hz: pl[b].hz, yaw: pl[b].yaw }; if (boxesOverlap(body, q, 0) || boxesOverlap(sw, q, 0) || boxesOverlap(swingBox(pl[b].kind, q), body, 0)) viol.rand++; }
      for (const d of md.doors) if (d.level === 0 && CollisionWorld.distToObb({ ...sw, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) }, d.cx, d.cz) < 1.2) viol.door++;
      for (const k of keepouts) if (CollisionWorld.distToObb({ ...sw, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) }, k.x, k.z) < k.r - 1e-6) viol.keepout++;
    });
    // jalan fisik: spawn -> exit, kedua sisi tiap pintu, semua container (bawaan + acak), titik akses
    const pr = physReach(md.spawn.x, md.spawn.z);
    const targets = [{ n: 'exit', x: md.exit.insideX, z: md.exit.insideZ, r: 0.7 }];
    for (const d of md.doors.filter((d) => d.level === 0)) for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; const t = { n: d.name + '@' + sg, x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, r: 0.7 }; if (base0.has(t.x, t.z, t.r)) targets.push(t); }
    for (const c of md.containers.filter((c) => c.level === 0)) if (base0.has(c.ax, c.az, 1.6)) targets.push({ n: c.id, x: c.ax, z: c.az, r: 1.6 });
    for (const p of pl) if (SEARCHABLE.includes(p.kind)) targets.push({ n: p.id, x: p.ax, z: p.az, r: 0.25 });
    for (const t of targets) if (!pr.has(t.x, t.z, t.r)) { viol.route++; if (process.env.DBG) { const pp = pl.find((q) => q.id === t.n); console.log('   tak terjangkau', seed, t.n, t.x.toFixed(2), t.z.toFixed(2), 'blocked@pt', cw.blocked(t.x, t.z, R, 0), pp && (pp.x.toFixed(2) + ',' + pp.z.toFixed(2) + ' yaw ' + pp.yaw.toFixed(2))); } }
    if (pr.size < base0.size * 0.95) viol.route++; // furniture tidak boleh menyegel >5% area
    for (const o of added) cw.removeObbs((b) => b === o);
  }
  doorObbs.forEach(({ o }) => { o.enabled = true; });
  console.log(`  ${SEEDS} seed, ${nPlaced} furniture (min/run ${minCount}); pelanggaran:`, JSON.stringify(viol));
  for (const [k, v] of Object.entries(viol)) ok(v === 0, `audit furniture: ${k} = ${v}`);
}

section('Seed tetap -> hasil sama');
{
  const run = () => { const nav = new NavGrid(cw, 0, fixed); const r = makeRng(12345); return JSON.stringify(generateFurniture(nav, r, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: 10 })); };
  ok(run() === run(), 'MAP_SEED yang sama menghasilkan layout yang sama');
}

section('Inventory per player');
{
  const A = createPlayer('a', 'A'), B = createPlayer('b', 'B');
  A.inventory.add('key_yellow'); A.inventory.add('key_red'); A.inventory.add('battery'); A.inventory.add('note', 1, 'halo');
  ok(A.inventory.keyTotal() === 2 && A.inventory.hasKey('key_yellow') && !A.inventory.hasKey('key_green'), 'A punya Yellow+Red, tanpa Green');
  ok(B.inventory.keyTotal() === 0 && B.inventory.total() === 0, 'B punya 0 key & kosong');
  B.inventory.add('key_green');
  ok(A.inventory.keyTotal() === 2 && B.inventory.keyTotal() === 1, 'inventory tidak tercampur');
  ok(A.inventory.remove('battery') && !A.inventory.remove('battery'), 'remove item bekerja & tidak minus');
  ok(A.inventory.readNote(0) === 'halo', 'catatan tersimpan per player');
  ok(B.inventory.notes().length === 0, 'catatan B kosong');
}

section('Item lantai (Almond Water)');
{
  const nav = new NavGrid(cw, 0, fixed); const r = makeRng(5);
  const pl = generateFurniture(nav, r, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: 12 });
  const spots = pickFreeSpots(nav, r, cfg.ALMOND_COUNT, md.spawn, 2.5, keepouts);
  console.log('  spot item:', spots.length);
  ok(spots.length >= 6, 'item lantai mendapat posisi valid');
  ok(spots.every((s) => !cw.blocked(s.x, s.z, 0.15, 0)), 'item tidak di dalam dinding');
}

section('Flashlight & battery');
{
  const f = new Flashlight();
  ok(f.pct === 100 && !f.on, 'senter mulai 100% & OFF');
  for (let i = 0; i < 600; i++) f.update(0.1);
  ok(f.pct === 100, 'battery TIDAK berkurang saat senter OFF');
  ok(f.toggle() === true, 'senter bisa ON');
  for (let i = 0; i < 600; i++) f.update(0.1); // 60 detik
  ok(f.pct === 50, `60 dtk ON -> 50% (dapat ${f.pct})`);
  let died = null; for (let i = 0; i < 700 && !died; i++) died = f.update(0.1);
  ok(died === 'died' && !f.on && f.pct === 0, 'battery habis -> senter mati otomatis');
  ok(f.toggle() === false && !f.on, 'tidak bisa ON saat battery habis');
  f.recharge(); ok(f.pct === 100 && f.toggle() === true, 'battery dipakai -> recharge 100% & bisa ON lagi');
  const g = new Flashlight(); g.toggle(); let t = 0; while (g.update(0.05) !== 'died') t += 0.05;
  ok(Math.abs(t - cfg.FLASH_MAX_SECONDS) < 0.2, `durasi penuh ${cfg.FLASH_MAX_SECONDS} dtk (dapat ${t.toFixed(1)})`);
}

section('Stamina');
{
  const sm = new Stamina();
  ok(sm.canSprint() && sm.pct === 100, 'stamina penuh di awal');
  let ev = null, t = 0; while (!ev && t < 30) { ev = sm.update(0.05, true); t += 0.05; }
  ok(ev === 'exhausted' && !sm.canSprint(), 'stamina habis saat sprint -> tidak bisa sprint');
  ok(Math.abs(t - cfg.STAMINA_MAX / cfg.STAMINA_DRAIN) < 0.2, `sprint ${t.toFixed(1)} dtk dari penuh`);
  for (let i = 0; i < 10; i++) sm.update(0.05, true);
  ok(sm.value === 0, 'sprint dipaksa saat habis tidak membuat nilai minus / drain');
  for (let i = 0; i < 20; i++) sm.update(0.05, false); // 1 dtk: masih delay + regen kecil
  ok(!sm.canSprint(), 'belum bisa sprint segera setelah habis');
  let n = 0; while (!sm.canSprint() && n++ < 2000) sm.update(0.05, false);
  ok(sm.canSprint() && sm.value >= cfg.STAMINA_RESUME_AT, 'regenerasi saat tidak sprint -> bisa sprint lagi');
  const s2 = new Stamina(); s2.update(1, true); const v = s2.value; s2.update(0.5, false); ok(s2.value === v, 'jeda regen setelah sprint');
}

section('Event horor (jadwal)');
{
  const run = (seed) => { const sc = new EventScheduler(makeRng(seed)); const out = []; for (let t = 0; t < 1800; t += 0.5) { const e = sc.update(0.5, () => true); if (e) out.push(Math.round(t) + ':' + e); } return out; };
  const a = run(77), b = run(77), c = run(78);
  ok(JSON.stringify(a) === JSON.stringify(b), 'seed sama -> jadwal event sama');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'seed beda -> jadwal beda');
  const times = a.map((x) => +x.split(':')[0]);
  ok(times[0] >= cfg.EVENT_FIRST_MIN - 1 && times[0] <= cfg.EVENT_FIRST_MAX + 1, `event pertama di ${times[0]} dtk`);
  ok(times.every((t, i) => i === 0 || t - times[i - 1] >= cfg.EVENT_GAP_MIN - 1), 'jarak antar event >= minimum (tidak terlalu sering)');
  ok(a.length >= 8 && a.length <= 35, `jumlah event 30 menit wajar (${a.length})`);
  ok(a.every((x, i) => i === 0 || x.split(':')[1] !== a[i - 1].split(':')[1]), 'jenis event tidak berulang berurutan');
  const kinds = new Set(); for (let sd = 1; sd < 30; sd++) run(sd).forEach((x) => kinds.add(x.split(':')[1]));
  ok(['lights', 'door', 'furniture', 'entity'].every((k) => kinds.has(k)), 'keempat jenis event muncul');
  let tries = 0; const sc = new EventScheduler(makeRng(5)); let fired = 0; for (let t = 0; t < 600; t += 0.5) { if (sc.update(0.5, () => { tries++; return false; })) fired++; }
  ok(fired === 0 && tries > 3 && tries < 60, `event yang tidak aman ditunda & dicoba lagi (${tries}x), tidak pernah dipaksa`);
}

section('Gembok exit per warna');
{
  // meniru logika world: tiap gembok butuh key ber-ID yang sama; menghitung jumlah saja tidak cukup
  const inv = new Inventory(); const opened = new Set();
  const tryOpen = (id) => { if (inv.hasKey(id) && !opened.has(id)) { inv.remove(id); opened.add(id); return true; } return false; };
  inv.add('key_red'); inv.add('key_red'); inv.add('key_red'); // 3 key tapi semuanya merah
  ok(inv.keyTotal() === 3 && !tryOpen('key_yellow') && !tryOpen('key_green'), '3 key merah tidak membuka gembok kuning/hijau');
  ok(tryOpen('key_red') && opened.size === 1, 'key merah membuka gembok merah');
  const full = new Inventory(); KEY_IDS.forEach((k) => full.add(k));
  ok(KEY_IDS.every((k) => full.hasKey(k)) && KEY_DEFS.length === 3, 'ketiga warna ada: yellow, red, green');
}

section('Anti-softlock (600 seed)');
{
  const TPL = { desk: 'Desk_Office_01', cabinet: 'Cabinet_Office_01', locker: 'Locker_Dark_01', crate: 'Crate_Dark_01', box: 'Crate_Dark_02' };
  const exitIn = { x: md.exit.insideX, z: md.exit.insideZ };
  const tplConts = {}; for (const k in TPL) tplConts[k] = md.containers.filter((c) => json.nodes[c.rootIdx].name === TPL[k]);
  const REQ = KEY_IDS.slice(0, cfg.REQUIRED_KEYS);
  const fixedSlot = (c) => ({ id: c.id, level: c.level, ax: c.ax, az: c.az, keyPos: { x: c.keyPos[0], y: c.keyPos[1], z: c.keyPos[2] }, usable: true });
  const randSlots = (pl) => { const out = []; for (const p of pl) if (SEARCHABLE.includes(p.kind)) for (const c of tplConts[p.kind] || []) {
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw), l = c.keyLocal;
    out.push({ id: c.id + '@' + p.id, level: 0, ax: p.ax, az: p.az, usable: true, keyPos: { x: p.x + l[0] * cs + l[2] * sn, y: Math.max(l[1], 0.3), z: p.z - l[0] * sn + l[2] * cs } });
  } return out; };

  // 1) spawn bawaan aman & area luas
  const sp = findSafeSpawn(cw, new NavGrid(cw, 0, fixed), md.spawn);
  ok(sp && !sp.moved, 'spawn bawaan map valid (tidak perlu digeser)');

  // 2) container bawaan map saja (layout cadangan tanpa furniture acak) cukup untuk 3 key
  const navStatic = new NavGrid(cw, 0, fixed); navStatic.flood(md.spawn.x, md.spawn.z);
  const fixedOk = md.containers.map(fixedSlot).filter((sl) => !slotProblem(cw, navStatic, sl) && sl.level === 0);
  console.log(`  container bawaan layak untuk key: ${fixedOk.length}/${md.containers.length}`);
  ok(fixedOk.length >= 6, 'layout cadangan (tanpa furniture acak) punya >= 6 container valid untuk key');

  // 3) simulasi persis alur world.startRun: generate -> validasi -> (retry terbatas) -> cadangan
  const gen = (sd, randomize) => {
    const rng = makeRng(sd), nav = new NavGrid(cw, 0, fixed);
    const pl = randomize ? generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) }) : [];
    nav.flood(md.spawn.x, md.spawn.z);
    const all = md.containers.map(fixedSlot).concat(randSlots(pl));
    const slots = all.filter((x) => !(x.level === 0 && !nav.reached(x.ax, x.az, 1.6)));
    const good = slots.filter((x) => !slotProblem(cw, nav, x) && x.level === 0);
    const cont = assignContents(good.map((x) => ({ id: x.id, x: x.ax, z: x.az, level: x.level })), rng, REQ, md.spawn, cfg.MIN_BATTERY_PICKUPS);
    const keys = []; cont.forEach((c, id) => { if (c.type === 'key') keys.push({ key: c.key, slot: all.find((x) => x.id === id) }); });
    const problems = validateRun({ cw, nav, spawn: md.spawn, exitInside: exitIn, required: REQ.slice(), keys, ladderReachable: true });
    return { problems, pl, nav, keys };
  };
  let hist = [0, 0, 0, 0, 0, 0, 0, 0], fallbackUsed = 0, worstSeed = null;
  for (let i = 1; i <= 600; i++) {
    const base = (i * 2654435761) >>> 0; let done = false;
    for (let a = 0; a <= 6; a++) {
      const sd = a === 0 ? base : (Math.imul(base ^ Math.imul(a, 0x9e3779b1), 0x85ebca6b) ^ a) >>> 0;
      const r = gen(sd, a < 6);
      if (!r.problems.length) { hist[a]++; if (a === 6) fallbackUsed++; done = true;
        // verifikasi tambahan: key punya container valid unik, di atas lantai, dan bisa dijangkau pemain
        const ks = new Set(r.keys.map((k) => k.slot.id));
        ok(r.keys.length === cfg.REQUIRED_KEYS && ks.size === cfg.REQUIRED_KEYS, `seed ${i}: 3 key di 3 container berbeda`);
        for (const k of r.keys) ok(!keyPosProblem(cw, k.slot.level, k.slot.keyPos) && r.nav.reached(k.slot.ax, k.slot.az, 1.6), `seed ${i}: key ${k.key} valid & terjangkau`);
        break; }
    }
    if (!done) { fails++; worstSeed = i; console.log(`  GAGAL: seed ${i} tidak ada percobaan yang valid`); }
  }
  console.log(`  percobaan ke-1 sukses: ${hist[0]}/600 | butuh retry: ${600 - hist[0]} | cadangan tanpa furniture: ${fallbackUsed}`);
  ok(worstSeed === null, 'semua 600 seed menghasilkan run yang bisa diselesaikan (<= 7 percobaan)');
  ok(hist[0] >= 540, 'mayoritas seed lolos di percobaan pertama (tidak boros regenerate)');
  const fb = gen(12345, false); ok(fb.problems.length === 0, 'layout cadangan (tanpa furniture acak) selalu valid');

  // 4) kasus rusak sengaja: validator harus menolak, bukan crash
  const nav = navStatic, good = fixedOk[0];
  const bad = (o) => slotProblem(cw, nav, { ...good, ...o });
  ok(!slotProblem(cw, nav, good), 'slot baik lolos validasi');
  ok(bad({ keyPos: { ...good.keyPos, y: -0.5 } }), 'key di bawah lantai ditolak');
  ok(bad({ keyPos: { ...good.keyPos, x: NaN } }), 'key NaN ditolak');
  ok(bad({ keyPos: { x: 500, y: 0.5, z: 500 } }), 'key di luar map ditolak');
  let wall = null; for (let x = -20; x < 20 && !wall; x += 0.1) for (let z = -20; z < 20; z += 0.1) if (cw.gridBlocked(x, z, 0.02, 0)) { wall = { x, z }; break; }
  ok(wall && bad({ keyPos: { x: wall.x, y: 0.8, z: wall.z } }), 'key di dalam dinding ditolak');
  ok(bad({ usable: false }), 'container rusak/tidak bisa dibuka ditolak');
  ok(bad({ ax: 400, az: 400 }), 'container tak terjangkau ditolak');
  ok(bad({ keyPos: { x: good.ax + 5, y: 0.8, z: good.az } }), 'key terlalu jauh dari titik berdiri ditolak');
  const two = fixedOk.slice(0, 2).map((x, i) => ({ key: REQ[i], slot: x }));
  const chk = (o) => validateRun({ cw, nav, spawn: md.spawn, exitInside: exitIn, required: REQ.slice(), keys: fixedOk.slice(0, 3).map((x, i) => ({ key: REQ[i], slot: x })), ladderReachable: true, ...o });
  ok(chk({}).length === 0, 'run dengan 3 key valid lolos');
  ok(chk({ keys: two }).length > 0, 'hanya 2 key -> ditolak');
  ok(chk({ keys: [two[0], two[0], two[1]].map((k, i) => ({ key: REQ[i], slot: k.slot })) }).length > 0, 'dua key di container sama -> ditolak');
  ok(chk({ spawn: wall }).length > 0, 'spawn di dalam dinding -> ditolak');
  ok(chk({ exitInside: { x: 400, z: 400 } }).length > 0, 'exit tak terjangkau -> ditolak');
  const moved = wall && findSafeSpawn(cw, new NavGrid(cw, 0, fixed), wall);
  ok(moved && moved.moved && !cw.blocked(moved.x, moved.z, cfg.PLAYER_RADIUS, 0), 'spawn rusak dipindah ke titik aman terdekat');
  // assignContents tidak crash bila slot kurang dari jumlah key
  const few = assignContents([{ id: 'a', x: 0, z: 0, level: 0 }], makeRng(1), REQ, md.spawn, 0);
  ok([...few.values()].filter((v) => v.type === 'key').length < cfg.REQUIRED_KEYS, 'slot < 3: tidak crash (validator yang menolak, lalu regenerate)');
}

section('Container buka / tutup');
{
  const run = (c, sec, open = 0.5, search = 1) => { for (let t = 0; t < sec; t += 1 / 60) { const r = c.update(1 / 60, open, search); if (r) return r; } return null; };
  const c = new ContainerState();
  ok(c.prompt() === 'SEARCH' && !c.isOpen, 'awal: tertutup, prompt SEARCH');
  ok(c.toggle() === 'open' && c.searching, 'tekan -> mulai buka + menggeledah');
  ok(c.toggle() === 'ignored', 'saat menggeledah, tekan lagi diabaikan');
  ok(run(c, 3) === 'found' && c.searched && c.k === 1, 'selesai menggeledah (isi ditemukan sekali) & terbuka penuh');
  ok(c.prompt() === 'CLOSE', 'sesudah terbuka prompt = CLOSE');
  ok(c.toggle() === 'close', 'bisa ditutup kembali');
  run(c, 2); ok(c.k === 0 && !c.animating && !c.isOpen, 'animasi menutup selesai, tertutup penuh');
  ok(c.prompt() === 'OPEN', 'tertutup setelah digeledah: prompt OPEN');
  ok(c.toggle() === 'open' && !c.searching, 'dibuka lagi tanpa menggeledah ulang');
  ok(run(c, 2) === null && c.k === 1, 'terbuka penuh tanpa event isi ganda');
  // jalan menjauh saat menggeledah -> batal
  const d = new ContainerState(); d.toggle(); d.update(0.2, 0.5, 1, false); d.update(0.1, 0.5, 1, true);
  ok(!d.searching && d.want === 0 && !d.searched, 'menjauh saat menggeledah: batal & menutup (isi belum diambil)');
  // buka-tutup cepat berulang tetap konsisten
  const e = new ContainerState(); e.toggle(); run(e, 3); for (let i = 0; i < 20; i++) { e.toggle(); e.update(0.1, 0.5, 1); }
  run(e, 2); ok(e.k === e.want && !e.searching, 'toggle berulang cepat tetap konsisten');
  for (const t of ['drawer', 'cabinet', 'locker', 'lid']) ok(SFX[t + '_open'] && SFX[t + '_close'] && SFX[t + '_open'].files[0] !== SFX[t + '_close'].files[0], 'SFX buka/tutup khusus: ' + t);
  const files = ['drawer', 'cabinet', 'locker', 'lid'].map((t) => SFX[t + '_open'].files[0]);
  ok(new Set(files).size === 4, 'tiap jenis furniture punya SFX berbeda');
}

section('Bidikan crosshair (key di dalam furniture)');
{
  const mk = (name, parent = null) => ({ name, parent, visible: true, userData: {}, isMesh: true, traverse(f) { f(this); } });
  const cam = { getWorldPosition: (v) => v, getWorldQuaternion: (q) => q };
  const desk = mk('desk'); const body = mk('desk_body', desk); const drawer = mk('drawer', desk); const key = mk('key', null);
  const mkIx = () => {
    const ix = new InteractionSystem(2.4);
    let open = true, keyTaken = false;
    const cont = { id: 'c', kind: 'container', prompt: () => (open ? 'CLOSE' : 'OPEN'), interact: () => {} };
    const kit = { id: 'k', kind: 'key', reach: 2.8, shelter: desk, prompt: () => (keyTaken ? null : 'PICK UP'), interact: () => {} };
    ix.register(cont, [drawer]); ix.register(kit, [key]); ix.addOccluders([body]);
    return { ix, setOpen: (v) => { open = v; }, take: () => { keyTaken = true; } };
  };
  const hit = (o, d) => ({ object: o, distance: d });
  let t = mkIx();
  globalThis.__hits = [hit(drawer, 1.0), hit(key, 1.2)];
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'key', 'key di balik laci terbuka bisa dibidik (PICK UP)');
  globalThis.__hits = [hit(body, 0.9), hit(drawer, 1.0), hit(key, 1.2)];
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'key', 'badan furniture pemilik key tidak menghalangi key');
  const wall = mk('wall');
  t = mkIx(); t.ix.addOccluders([wall]);
  globalThis.__hits = [hit(wall, 0.6), hit(drawer, 1.0), hit(key, 1.2)];
  ok(t.ix.update(cam, {}, 1) === null, 'dinding di depan tetap menghalangi (tidak bisa interaksi menembus dinding)');
  t = mkIx(); const other = mk('other'); t.ix.addOccluders([other]);
  globalThis.__hits = [hit(other, 0.7), hit(key, 1.2)];
  ok(t.ix.update(cam, {}, 1) === null, 'objek lain (bukan furniture pemilik key) di depan key tetap menghalangi');
  t = mkIx(); globalThis.__hits = [hit(drawer, 1.0)];
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'container' && t.ix.prompt({}) === 'CLOSE', 'bidik laci tanpa key: prompt CLOSE');
  t = mkIx(); globalThis.__hits = [hit(drawer, 1.0), hit(key, 3.0)];
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'container', 'key di luar jangkauan tidak bisa diambil');
  t = mkIx(); globalThis.__hits = [hit(drawer, 1.0), hit(key, 1.2)]; t.ix.update(cam, {}, 1); t.take();
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'container', 'key sudah diambil: target kembali ke laci');
  key.visible = false; t = mkIx(); globalThis.__hits = [hit(drawer, 1.0), hit(key, 1.2)];
  ok(t.ix.update(cam, {}, 1)?.it.kind === 'container', 'key tersembunyi (container tertutup) tidak bisa dibidik');
  key.visible = true;
  // raycast tidak dijalankan ulang tiap frame
  t = mkIx(); let casts = 0; const orig = t.ix.ray.intersectObjects.bind(t.ix.ray); t.ix.ray.intersectObjects = (o) => { casts++; return orig(o); };
  globalThis.__hits = [hit(drawer, 1.0)]; for (let i = 0; i < 60; i++) t.ix.update(cam, {});
  ok(casts <= 8, `raycast dibatasi (${casts}x dalam 60 frame, kamera diam)`);
  globalThis.__hits = [];
}

section('Dekor storytelling (150 seed)');
{
  const pX = new Set(), pZ = new Set();
  for (const w of md.wallNodes) if (w.level === 0) { const m = json.meshes[json.nodes[w.idx].mesh]; for (const pr of m.primitives) extractWallPlanes(accessor(pr.attributes.POSITION), accessor(pr.indices), IDENT, pX, pZ); }
  const planesX = [...pX], planesZ = [...pZ];
  console.log(`  bidang dinding: x=${planesX.length} z=${planesZ.length}`);
  ok(planesX.length > 5 && planesZ.length > 5, 'bidang dinding terbaca dari mesh');
  const avoid = keepouts.concat([{ x: md.exit.door.cx, z: md.exit.door.cz, r: 3.2 }]);
  const doors = md.doors.map((d) => ({ cx: d.cx, cz: d.cz, nx: d.nx, nz: d.nz, level: d.level, type: d.type }));
  const run = (seed) => {
    const rng = makeRng(seed * 7919), nav = new NavGrid(cw, 0, fixed);
    const pl = generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    nav.flood(md.spawn.x, md.spawn.z);
    const t0 = process.hrtime.bigint();
    const items = planDecor({ nav, rng: makeRng((seed ^ 0x7f4a7c15) >>> 0), counts: cfg.DECOR_COUNTS, minGap: cfg.DECOR_MIN_GAP, avoid, anchors: pl.map((p) => ({ x: p.x, z: p.z })), doors, rooms: md.rooms, planesX, planesZ });
    return { items, nav, pl, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  let blockedBad = 0, reachBad = 0, avoidBad = 0, maxN = 0, minN = 999, maxMs = 0, furnBad = 0, wallBad = 0; const kindsSeen = {};
  for (let seed = 1; seed <= 150; seed++) {
    const { items, nav, pl, ms } = run(seed);
    maxMs = Math.max(maxMs, ms); maxN = Math.max(maxN, items.length); minN = Math.min(minN, items.length);
    for (const it of items) {
      kindsSeen[it.kind] = (kindsSeen[it.kind] || 0) + 1;
      if (it.kind === 'box' || it.kind === 'can') { // benda berdiri tidak boleh berada di sel yang bisa dijalani pemain
        const [i, j] = nav.cellOf(it.x, it.z);
        if (nav.isReachedCell(i, j)) reachBad++;
        for (const p of pl) if (Math.hypot(p.x - it.x, p.z - it.z) < 0.9) furnBad++;
      }
      if (['box', 'can', 'paper', 'stain', 'cable'].includes(it.kind) && cw.gridBlocked(it.x, it.z, 0, 0)) blockedBad++; // tidak di dalam dinding/collider
      if (['paper', 'stain', 'box', 'can', 'cable', 'extinguisher', 'vent', 'warning', 'pipe'].includes(it.kind) && avoid.some((a) => Math.hypot(a.x - it.x, a.z - it.z) < a.r - 0.5)) avoidBad++;
      if (!Number.isFinite(it.x + it.y + it.z + it.yaw)) wallBad++;
    }
    // jalur / spawn / exit tetap terjangkau persis seperti tanpa dekor (dekor tidak punya collision & tidak mengubah nav)
    ok(nav.reached(md.exit.insideX, md.exit.insideZ, 0.7), `exit terjangkau (seed ${seed})`);
  }
  console.log(`  item/run: ${minN}-${maxN}, waktu maks ${maxMs.toFixed(1)} ms, jenis: ${JSON.stringify(kindsSeen)}`);
  ok(blockedBad === 0, `dekor tidak di dalam dinding/collider (${blockedBad})`);
  ok(reachBad === 0, `kardus/benda kecil tidak di area jalan pemain (${reachBad})`);
  ok(avoidBad === 0, `dekor menjauhi spawn/exit/tangga/pintu (${avoidBad})`);
  ok(furnBad === 0, `kardus/benda kecil jauh dari furniture (${furnBad})`);
  ok(wallBad === 0, 'semua nilai transform finite');
  ok(maxN <= 90, `jumlah instance dekor ringan (maks ${maxN} <= 90)`);
  ok(minN >= 25, `dekor tidak kosong (min ${minN} >= 25)`);
  ok(Object.keys(kindsSeen).length >= 9, 'hampir semua jenis dekor muncul: ' + Object.keys(kindsSeen).join(','));
  ok(maxMs < 120, `perencanaan dekor cepat (${maxMs.toFixed(1)} ms)`);
  const a = JSON.stringify(run(77).items), b = JSON.stringify(run(77).items);
  ok(a === b, 'seed sama -> dekor sama');
  ok(JSON.stringify(run(78).items) !== a, 'seed beda -> dekor beda');
}

section('Variasi kondisi ruangan (200 seed)');
{
  const lightPos = []; json.nodes.forEach((n, i) => { if (n.extensions && n.extensions.KHR_lights_punctual) { const w = md.worldPos(i); lightPos.push({ x: w[0], z: w[2] }); } });
  console.log(`  lampu map: ${lightPos.length}, pintu: ${md.doors.length}`);
  ok(lightPos.length >= 10, 'lampu map terbaca');
  const exitP = { x: md.exit.insideX, z: md.exit.insideZ };
  const dsc = md.doors.map((d) => ({ cx: d.cx, cz: d.cz, level: d.level, type: d.type, locked: d.locked }));
  let shiftRuns = 0, shiftTot = 0, bad = { exit: 0, must: 0, access: 0, overlap: 0, wall: 0, keepout: 0, door: 0, light: 0, cont: 0, count: 0 };
  const diffSigs = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const sd = (seed * 2654435761) >>> 0;
    const rng = makeRng(sd), nav = new NavGrid(cw, 0, fixed);
    const pl = generateFurniture(nav, rng, { rooms: md.rooms, spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    let baseReach = nav.flood(md.spawn.x, md.spawn.z);
    const mustOk = must.filter((m) => nav.reached(m.x, m.z, m.rad ?? 0.25));
    const srng = makeRng((sd ^ 0x2c1b3c6d) >>> 0);
    const n = srng.int(cfg.ROOM_STATE.shifts[0], cfg.ROOM_STATE.shifts[1]);
    let cur = nav, done = 0;
    const accessOf = (c) => md.containers.filter((x) => x.level === 0 && cur.reached(x.ax, x.az, 1.6)).map((x) => ({ x: x.ax, z: x.az })).concat(pl.filter((p) => SEARCHABLE.includes(p.kind)).map((p) => ({ x: p.ax, z: p.az })).filter((a) => cur.reached(a.x, a.z, 1.6)));
    for (const q of srng.shuffle(pl.slice())) {
      if (done >= n) break;
      const amt = srng.range(0.2, 0.45) * (srng.chance(0.5) ? 1 : -1);
      const dx = Math.cos(q.yaw) * amt, dz = -Math.sin(q.yaw) * amt;
      const plan = planShift({ cw, fixed, placements: pl, q, dx, dz, keepouts, pickups: [], spawn: md.spawn, baseReach, mustOk, accessPts: accessOf() });
      if (!plan) continue;
      q.x += dx; q.z += dz; q.ax += dx; q.az += dz; cur = plan.nav; baseReach = plan.n; done++;
    }
    shiftTot += done; if (done) shiftRuns++;
    // sesudah semua pergeseran: semua tetap aman
    cur.flood(md.spawn.x, md.spawn.z);
    if (!cur.reached(exitP.x, exitP.z, 0.7)) bad.exit++;
    for (const m of mustOk) if (!cur.reached(m.x, m.z, m.rad ?? 0.25)) bad.must++;
    for (const c of md.containers) if (c.level === 0 && nav.reached(c.ax, c.az, 1.6) && !cur.reached(c.ax, c.az, 1.6)) bad.access++;
    for (const p of pl) if (SEARCHABLE.includes(p.kind) && !cur.reached(p.ax, p.az, 0.15)) bad.access++;
    const obs = pl.map((p) => ({ cx: p.x, cz: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw }));
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) if (obbOverlap(obs[i], obs[j], 0)) bad.overlap++;
      for (const c of md.colliders) if (c.obb.level === 0 && obbOverlap(obs[i], c.obb, 0)) bad.overlap++;
      for (const k of keepouts) if (CollisionWorld.distToObb({ ...obs[i], cos: Math.cos(obs[i].yaw), sin: Math.sin(obs[i].yaw) }, k.x, k.z) < k.r) bad.keepout++;
      for (let lx = -obs[i].hx + 0.07; lx <= obs[i].hx - 0.07; lx += 0.05) for (let lz = -obs[i].hz + 0.07; lz <= obs[i].hz - 0.07; lz += 0.05) {
        if (cw.gridBlocked(obs[i].cx + lx * Math.cos(obs[i].yaw) + lz * Math.sin(obs[i].yaw), obs[i].cz - lx * Math.sin(obs[i].yaw) + lz * Math.cos(obs[i].yaw), 0, 0)) bad.wall++;
      }
    }
    // pilihan pintu / lampu / container
    const conts = pl.filter((p) => SEARCHABLE.includes(p.kind)).map((p, i) => ({ id: 'c' + i, x: p.ax, z: p.az }));
    const st = planRoomState({ rng: srng, cfg: cfg.ROOM_STATE, spawn: md.spawn, exit: exitP, doors: dsc, lights: lightPos, containers: conts });
    for (const i of st.openDoors) { const d = dsc[i]; if (d.type !== 'door' || d.locked || d.level !== 0 || Math.hypot(d.cx - md.spawn.x, d.cz - md.spawn.z) < 3.5 || Math.hypot(d.cx - exitP.x, d.cz - exitP.z) < 4) bad.door++; }
    for (const i of st.dimLights.concat(st.flickerLights)) { const l = lightPos[i]; if (Math.hypot(l.x - md.spawn.x, l.z - md.spawn.z) < 7 || Math.hypot(l.x - exitP.x, l.z - exitP.z) < 7) bad.light++; }
    for (const id of st.openContainers) { const c = conts.find((x) => x.id === id); if (!c || Math.hypot(c.x - md.spawn.x, c.z - md.spawn.z) < 3.5) bad.cont++; }
    if (st.openDoors.length > 4 || st.dimLights.length + st.flickerLights.length > 5 || st.openContainers.length > 4 || new Set(st.openDoors).size !== st.openDoors.length) bad.count++;
    diffSigs.add(JSON.stringify([st.openDoors, st.dimLights, st.flickerLights]));
  }
  console.log(`  run dengan furniture bergeser: ${shiftRuns}/200, total pergeseran: ${shiftTot}, variasi pintu/lampu unik: ${diffSigs.size}`);
  for (const k in bad) ok(bad[k] === 0, `variasi aman: ${k} (${bad[k]})`);
  ok(shiftRuns >= 120, `furniture bergeser di sebagian besar run (${shiftRuns}/200)`);
  ok(diffSigs.size >= 150, 'variasi berbeda antar seed');
  // seed sama -> state sama
  const run = (sd) => { const r = makeRng(sd); return JSON.stringify(planRoomState({ rng: r, cfg: cfg.ROOM_STATE, spawn: md.spawn, exit: exitP, doors: dsc, lights: lightPos, containers: [] })); };
  ok(run(5) === run(5) && run(5) !== run(6), 'seed sama -> state sama, seed beda -> beda');
}

section('Crouch');
{
  ok(cfg.PLAYER_RADIUS_CROUCH < cfg.PLAYER_RADIUS, 'collider jongkok lebih kecil');
  ok(cfg.CROUCH_SPEED < cfg.WALK_SPEED, 'jongkok lebih lambat dari jalan');
}

section('SFX');
{
  const fs2 = require('fs');
  const missing = []; Object.entries(SFX).forEach(([n, d]) => d.files.forEach((f) => { if (!fs2.existsSync(path.join(__dirname, '..', 'public', 'sfx', f + '.wav'))) missing.push(f); }));
  ok(missing.length === 0, 'semua file SFX ada: ' + missing.join(','));
  const ev = ['lights_off', 'lights_on', 'door_open', 'door_close', 'furniture_scrape', 'entity_steps', 'entity_whisper'];
  const fl2 = ev.map((e) => SFX[e].files[0]);
  ok(new Set(fl2).size === ev.length, 'setiap event memakai file SFX berbeda');
}

console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
