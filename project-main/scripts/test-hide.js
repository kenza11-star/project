// Uji logika game dengan GLB asli (tanpa browser): collision, furniture acak, key, inventory per-player.
// Jalankan: npm run test:game
const fs = require('fs');
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData, measureFootprints, subtreeBounds, panelCentres } = require(G + '/mapdata.js');
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
const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'models', 'backrooms_full.glb'));
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

const md = extractMapData(json);
const TEMPLATE = { table: 'DiningTable_01', shelf: 'Bookshelf_01', desk: 'Desk_01', cabinet: 'Cabinet_01', locker: 'Locker_01', crate: 'FilingCabinet_01', box: 'StorageCabinet_01' };
applyFootprints(measureFootprints(json, TEMPLATE)); // sama seperti GameWorld.load

// ---- bangun collision persis seperti di game ----
const cw = new CollisionWorld(2);
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const w of md.wallNodes) {
  const m = json.meshes[json.nodes[w.idx].mesh];
  const base = cfg.LEVEL_Y[w.level];
  for (const p of m.primitives) cw.rasterMesh(w.level, accessor(p.attributes.POSITION), accessor(p.indices), IDENT, base + 0.25, base + 2.0);
}
cw.walk[0] = { ...md.floor0 };
if (md.mezz) cw.walk[1] = { ...md.mezz };
for (const c of md.colliders) cw.addObb(c.obb);
const doorObbs = md.doors.map((d) => ({ d, o: cw.addObb(d.closedObb) }));

section('Map & data');
console.log(`  rooms=${md.rooms.length} doors=${md.doors.length} containers=${md.containers.length} colliders=${md.colliders.length}`);
ok(md.rooms.length >= 12, 'room terbaca');

const { generateBeds, BED_SIZE } = require(G + '/layout.js');
const fixed = md.colliders.map((c) => c.obb).concat([md.exit.door.closedObb]);
const keepouts = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
if (md.ladder) keepouts.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
for (const d of md.doors) if (d.level === 0) keepouts.push({ x: d.cx, z: d.cz, r: 1.5 });
const must = [{ x: md.spawn.x, z: md.spawn.z }, { x: md.exit.insideX, z: md.exit.insideZ, rad: 0.7 }];
for (const d of md.doors.filter((d) => d.level === 0)) for (const sg of [1, -1]) { if (d.type === 'exit_door' && sg === -1) continue; must.push({ x: d.cx + d.nx * sg * 0.9, z: d.cz + d.nz * sg * 0.9, rad: 0.7 }); }
for (const c of md.containers.filter((c) => c.level === 0)) must.push({ x: c.ax, z: c.az, rad: 1.6 });
const rooms0 = md.rooms.filter((r) => r.level === 0);

section('Kasur: penempatan (200 seed)');
{
  let total = 0, none = 0, bad = 0, noSide = 0, wallBad = 0, overlapF = 0, blockedMust = 0, ms = 0, worst = 0;
  const inRect = (r, x, z) => x >= r.rect.minx && x <= r.rect.maxx && z >= r.rect.minz && z <= r.rect.maxz;
  for (let seed = 1; seed <= 200; seed++) {
    const nav = new NavGrid(cw, 0, fixed);
    const t0 = process.hrtime.bigint();
    const beds = generateBeds(nav, makeRng((seed * 7919) ^ 0x7be5), { rooms: rooms0, spawn: md.spawn, keepouts, mustReach: must });
    const rng = makeRng(seed * 7919);
    const pl = generateFurniture(nav, rng, { rooms: rooms0, forbiddenRoomTypes: ['exit', 'ladder', 'hidden2'], spawn: md.spawn, keepouts, mustReach: must, count: rng.int(cfg.MIN_FURNITURE, cfg.MAX_FURNITURE) });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6; ms += dt; worst = Math.max(worst, dt);
    total += beds.length; if (!beds.length) none++;
    for (const b of beds) {
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [b.x + sx * b.hx * Math.cos(b.yaw) + sz * b.hz * Math.sin(b.yaw), b.z - sx * b.hx * Math.sin(b.yaw) + sz * b.hz * Math.cos(b.yaw)]);
      if (!b.sides.length) noSide++;
      // satu ruang bertipe sama bisa >1; cukup salah satunya memuat kasur
      if (!rooms0.filter((r) => r.type === b.room).some((r) => corners.every(([x, z]) => inRect(r, x, z)))) { wallBad++; if (wallBad < 4) console.log('  di luar ruang:', seed, b.room, b.x.toFixed(2), b.z.toFixed(2), b.yaw.toFixed(2)); }
      for (const f of fixed) { if (f.kind === 'rail' || f.level !== 0) continue; const dx = b.x - f.cx, dz = b.z - f.cz; if (Math.hypot(dx, dz) < b.hz + f.hx + f.hz + 0.1) { /* SAT kasar via sampling */ let hit = false; for (let lx = -b.hx; lx <= b.hx && !hit; lx += 0.1) for (let lz = -b.hz; lz <= b.hz; lz += 0.1) { const wx = b.x + lx * Math.cos(b.yaw) + lz * Math.sin(b.yaw), wz = b.z - lx * Math.sin(b.yaw) + lz * Math.cos(b.yaw); const ex = wx - f.cx, ez = wz - f.cz, c = Math.cos(f.yaw), s = Math.sin(f.yaw); if (Math.abs(ex * c - ez * s) < f.hx && Math.abs(ex * s + ez * c) < f.hz) { hit = true; break; } } if (hit) overlapF++; } }
      for (const p of pl) { const dx = Math.abs(b.x - p.x), dz = Math.abs(b.z - p.z); if (dx < 0.6 && dz < 0.6) bad++; }
    }
    for (const m of must) if (!nav.reached(m.x, m.z, m.rad ?? 0.25) && nav.reached(md.spawn.x, md.spawn.z, 0.25) === false) blockedMust++;
  }
  ok(total >= 200 * 1.0 && none <= 200 * 0.15, `kasur tertempatkan (${total} dari 600 slot;  ${none} seed tanpa kasur)`);
  ok(noSide === 0, 'setiap kasur punya minimal satu sisi yang bisa dijangkau');
  ok(wallBad === 0, 'kasur seluruhnya di dalam ruangnya (tidak menembus dinding)');
  ok(overlapF === 0, `kasur tidak menimpa furniture bawaan (${overlapF})`);
  ok(bad === 0, `kasur tidak menimpa furniture acak (${bad})`);
  ok(blockedMust === 0, 'titik penting tetap terjangkau');
  ok(worst < 900, `waktu generate+kasur wajar (rata-rata ${(ms / 200).toFixed(1)} ms, terburuk ${worst.toFixed(0)} ms)`);
}
console.log(`\nHide: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
