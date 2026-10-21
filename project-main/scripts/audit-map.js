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

// ================= AUDIT MAP (furniture bawaan: overlap dinding / antar furniture) =================
const { leafPose } = require(G + '/door.js');
const inObb = (o, x, z, m = 0) => { const dx = x - o.cx, dz = z - o.cz; const lx = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw), lz = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw); return Math.abs(lx) < o.hx - m && Math.abs(lz) < o.hz - m; };
const samples = (o, step = 0.12, m = 0.02) => { const pts = []; for (let a = -o.hx + m; a <= o.hx - m + 1e-9; a += step) for (let b = -o.hz + m; b <= o.hz - m + 1e-9; b += step) pts.push([o.cx + a * Math.cos(o.yaw) + b * Math.sin(o.yaw), o.cz - a * Math.sin(o.yaw) + b * Math.cos(o.yaw)]); return pts; };
// NB: konvensi yaw dicek lewat inObb (konsisten dengan CollisionWorld.distToObb)
const fixedC = md.colliders.filter((c) => !/^Stairs/.test(c.name));
let wallHit = [], pairHit = [];
for (const c of fixedC) {
  const o = c.obb; let n = 0, tot = 0;
  for (const [x, z] of samples(o)) { tot++; if (cw.gridBlocked(x, z, 0.0, o.level)) n++; }
  if (n / Math.max(1, tot) > 0.12) wallHit.push(`${c.name} ${(100 * n / tot).toFixed(0)}%`);
}
for (let i = 0; i < fixedC.length; i++) for (let k = i + 1; k < fixedC.length; k++) {
  const a = fixedC[i].obb, b = fixedC[k].obb; if (a.level !== b.level) continue;
  if (Math.hypot(a.cx - b.cx, a.cz - b.cz) > a.rad + b.rad + 0.1) continue;
  let n = 0, tot = 0; for (const [x, z] of samples(a, 0.08)) { tot++; if (inObb(b, x, z, 0.03)) n++; }
  if (n / Math.max(1, tot) > 0.08) pairHit.push(`${fixedC[i].name} x ${fixedC[k].name} ${(100 * n / tot).toFixed(0)}%`);
}
console.log('furniture bawaan:', fixedC.length, '| menembus dinding:', wallHit.length, '| overlap antar furniture:', pairHit.length);
console.log(' dinding:', wallHit.slice(0, 40).join('; '));
console.log(' pair:', pairHit.slice(0, 40).join('; '));

// ---- ventilasi: apakah penutup (flap) memblokir pemain? ----
for (const i of json.nodes.map((n, k) => k).filter((k) => json.nodes[k].extras && json.nodes[k].extras.type === 'Vent')) {
  const w = md.worldPos(i); const lvl = w[1] > 3 ? 1 : 0;
  console.log(json.nodes[i].name, 'pos', w.map((v) => +v.toFixed(2)).join(','), 'level', lvl, 'blocked@center', cw.blocked(w[0], w[2], 0.3, lvl), 'edge', JSON.stringify(json.nodes[i].extras.edge));
}
