// Helper test: membangun dunia collision dari GLB asli (sama dengan test-polish.js) untuk uji AI monster, navigasi, dan jaringan.
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData, measureFootprints } = require(G + '/mapdata.js');
const { applyFootprints } = require(G + '/layout.js');
const cfg = require(G + '/config.js');
exports.buildWorld = function buildWorld() {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'models', 'backrooms_full.glb'));
  const jl = buf.readUInt32LE(12), json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8')), bin = buf.slice(20 + jl + 8);
  const accessor = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]; const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0); return new C(bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT)); };
  const TEMPLATE = { table: 'DiningTable_01', shelf: 'Bookshelf_01', desk: 'Desk_01', cabinet: 'Cabinet_01', locker: 'Locker_01', crate: 'FilingCabinet_01', box: 'StorageCabinet_01' };
  const md = extractMapData(json);
  applyFootprints(measureFootprints(json, TEMPLATE));
  const cw = new CollisionWorld(2), I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const w of md.wallNodes) { const m = json.meshes[json.nodes[w.idx].mesh], base = cfg.LEVEL_Y[w.level]; for (const p of m.primitives) cw.rasterMesh(w.level, accessor(p.attributes.POSITION), accessor(p.indices), I, base + 0.25, base + 2.0); }
  cw.walk[0] = { ...md.floor0 }; cw.walk[1] = { ...md.mezz };
  for (const c of md.colliders) cw.addObb(c.obb);
  const doorObbs = md.doors.map((d) => ({ d, o: cw.addObb(d.closedObb) }));
  return { cw, md, json, accessor, doorObbs, cfg };
};
