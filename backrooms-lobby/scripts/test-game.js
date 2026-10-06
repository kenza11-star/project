// Uji logika game dengan GLB asli (tanpa browser): collision, furniture acak, key, inventory per-player.
// Jalankan: npm run test:game
const fs = require('fs');
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData, applyPropNudges } = require(G + '/mapdata.js');
const { NavGrid, generateFurniture, assignContents, pickFreeSpots, FURN_DEFS, SEARCHABLE } = require(G + '/layout.js');
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
    const A = [d.cx - d.nx * 1.0, d.cz - d.nz * 1.0], B = [d.cx + d.nx * 1.0, d.cz + d.nz * 1.0];
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
