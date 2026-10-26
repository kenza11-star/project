// Uji penempatan Soda NORVIX terhadap GEOMETRI NYATA map (backrooms_full.glb) dan model soda asli.
// Tiap titik soda bawaan harus: (1) berdiri tepat di atas permukaan menghadap atas (selisih <= 2 mm: tidak melayang/tenggelam),
// (2) ruang di atasnya bebas untuk kaleng (r 3,3 cm x tinggi 11,5 cm), dan di dalam batas permukaan. Dijalankan oleh run-test.sh.
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { extractMapData } = require(G + '/mapdata.js');
const { authoredSodaSpots, randomSurfaceSpot, chooseSodaSpots, SODA_ITEM } = require(G + '/soda.js');
const { makeRng } = require(G + '/rng.js');
const { ITEMS, itemLabel } = require(G + '/inventory.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

const readGlb = (file) => {
  const buf = fs.readFileSync(file), jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8')), bin = buf.slice(20 + jl + 8);
  const accessor = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new C(bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT));
  };
  return { json, accessor };
};
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const compose = (n) => {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
};

// ---------- model soda asli
section('Model soda (GLB asli)');
const SD = readGlb(path.join(__dirname, '..', 'public', 'models', 'NORVIX_SODA_330ML_1file_vertexcolor.glb'));
{
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], hasColor = false;
  SD.json.meshes.forEach((m) => m.primitives.forEach((p) => { if (p.attributes.COLOR_0 !== undefined) hasColor = true; const a = SD.json.accessors[p.attributes.POSITION]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); } }));
  console.log('  bounds', mn.map((v) => v.toFixed(3)).join(','), '|', mx.map((v) => v.toFixed(3)).join(','));
  ok(Math.abs(mn[1]) < 0.006, 'dasar kaleng di y=0 (pivot di dasar: tidak tenggelam/melayang bila y = permukaan)');
  ok(mx[1] > 0.10 && mx[1] < 0.13, 'tinggi kaleng ~11,5 cm (skala nyata, tanpa scale tambahan)');
  ok(mx[0] < 0.04 && mn[0] > -0.04 && mx[2] < 0.04 && mn[2] > -0.04, 'radius ~3,3 cm, berpusat di sumbu');
  ok(hasColor, 'vertex color (COLOR_0) ada di GLB');
  ok(SD.json.materials.length === 2, 'material GLB asli (NORVIX_Label + Aluminium) dipertahankan');
}
const R = 0.035, H = 0.12;
// ---------- geometri dunia map
section('Geometri map & titik soda bawaan');
const M = readGlb(path.join(__dirname, '..', 'public', 'models', 'backrooms_full.glb'));
const json = M.json;
const md = extractMapData(json);
const tris = []; // {x0,x1,y0,y1,z0,z1, v:[9], ny}
{
  const walk = (i, pm) => {
    const n = json.nodes[i], m = mul(pm, compose(n));
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      const P = M.accessor(p.attributes.POSITION), I = p.indices !== undefined ? M.accessor(p.indices) : null;
      const cnt = I ? I.length : P.length / 3;
      const W = (k) => { const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2]; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; };
      for (let t = 0; t < cnt; t += 3) {
        const a = W(I ? I[t] : t), b = W(I ? I[t + 1] : t + 1), c = W(I ? I[t + 2] : t + 2);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], L = Math.hypot(nx, ny, nz) || 1;
        tris.push({ a, b, c, ny: ny / L, x0: Math.min(a[0], b[0], c[0]), x1: Math.max(a[0], b[0], c[0]), y0: Math.min(a[1], b[1], c[1]), y1: Math.max(a[1], b[1], c[1]), z0: Math.min(a[2], b[2], c[2]), z1: Math.max(a[2], b[2], c[2]) });
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene || 0].nodes) walk(r, I4);
}
console.log('  segitiga map:', tris.length);
const inTri = (t, x, z) => { // titik (x,z) di dalam segitiga diproyeksikan ke bidang XZ
  const [a, b, c] = [t.a, t.b, t.c];
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(d) < 1e-12) return false;
  const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  return l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6;
};
const supportOf = (x, y, z) => { // permukaan menghadap atas terdekat (di bawah/di sekitar y) yang menutupi titik
  let best = null;
  for (const t of tris) {
    if (t.ny < 0.95 || x < t.x0 - 1e-6 || x > t.x1 + 1e-6 || z < t.z0 - 1e-6 || z > t.z1 + 1e-6 || t.y1 > y + 0.05 || t.y0 < y - 0.1) continue;
    if (inTri(t, x, z)) { if (best === null || Math.abs(t.y0 - y) < Math.abs(best - y)) best = t.y0; }
  }
  return best;
};
const blockedAbove = (x, y, z) => { // ada segitiga yang menembus silinder kaleng? (bbox konservatif)
  for (const t of tris) {
    if (t.x1 < x - R || t.x0 > x + R || t.z1 < z - R || t.z0 > z + R) continue;
    if (t.y1 > y + 0.004 && t.y0 < y + H) return t;
  }
  return null;
};
const spots = authoredSodaSpots(json, md.worldPos);
const kinds = {}; spots.forEach((s) => { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
console.log('  titik bawaan:', JSON.stringify(kinds));
ok((kinds.table || 0) >= 14 && (kinds.shelf || 0) >= 40, 'titik meja & rak bawaan terbaca dari map');
let badSup = 0, badClr = 0, worst = 0, edge = 0;
for (const s of spots) {
  const sup = supportOf(s.x, s.y, s.z);
  if (sup === null || Math.abs(sup - s.y) > 0.002) { badSup++; if (badSup < 6) console.log('   tanpa permukaan:', s.id, s.kind, s.x.toFixed(2), s.y.toFixed(3), s.z.toFixed(2), 'permukaan=', sup); } else worst = Math.max(worst, Math.abs(sup - s.y));
  // seluruh tepi kaleng harus tertopang (tidak menggantung di tepi meja/papan)
  for (const [dx, dz] of [[R, 0], [-R, 0], [0, R], [0, -R]]) { const e = supportOf(s.x + dx, s.y, s.z + dz); if (e === null || Math.abs(e - s.y) > 0.002) { edge++; break; } }
  const b = blockedAbove(s.x, s.y, s.z); if (b) { badClr++; if (badClr < 6) console.log('   terhalang:', s.id, s.kind, s.x.toFixed(2), s.y.toFixed(3), s.z.toFixed(2)); }
}
console.log(`  selisih permukaan terburuk: ${(worst * 1000).toFixed(2)} mm; tanpa penopang: ${badSup}; tepi menggantung: ${edge}; terhalang: ${badClr}`);
ok(badSup === 0, 'semua titik soda berdiri di permukaan nyata (tidak melayang / tenggelam)');
ok(edge === 0, 'seluruh alas kaleng tertopang permukaan (tidak menggantung di tepi)');
ok(badClr === 0, 'ruang di atas/sekitar kaleng bebas (tidak menembus rak/benda lain)');
const l0 = spots.filter((s) => s.level === 0).length; console.log('  titik lantai 1:', l0); ok(l0 >= 20, 'cukup titik di lantai 1');

section('Meja acak');
{
  const fp = { w: 1.51, d: 0.71, ox: 0, oz: 0 }, rng = makeRng(7);
  let inside = true;
  for (let i = 0; i < 300; i++) {
    const yaw = rng.range(0, 6.28), p = { id: 'r', x: 10, z: 5, yaw, vx: 0.02, vz: -0.01 };
    const s = randomSurfaceSpot(p, fp, 0.75, rng);
    const c = Math.cos(yaw), sn = Math.sin(yaw), dx = s.x - 10.02, dz = s.z - 4.99;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // balik ke lokal
    if (Math.abs(lx) > fp.w / 2 - 0.13 || Math.abs(lz) > fp.d / 2 - 0.13 || s.y !== 0.75) inside = false;
  }
  ok(inside, 'soda di meja acak selalu di dalam tabletop (margin dari tepi) pada tinggi permukaan');
}
section('Pemilihan titik');
{
  const run = (seed) => chooseSodaSpots(spots, makeRng(seed), { tables: 5, shelves: 3, spawn: md.spawn, minSpawnDist: 2.5, minGap: 3, reachable: (s) => s.level === 0 });
  const a = run(11), b = run(11), c = run(12);
  ok(a.length === 8, 'jumlah soda = 5 meja + 3 rak (' + a.length + ')');
  ok(JSON.stringify(a) === JSON.stringify(b), 'deterministik untuk seed sama');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'berbeda untuk seed berbeda');
  ok(a.every((s, i) => a.every((t, j) => i === j || Math.hypot(s.x - t.x, s.z - t.z) >= 3)), 'jarak antar soda >= 3 m');
  ok(a.every((s) => Math.hypot(s.x - md.spawn.x, s.z - md.spawn.z) >= 2.5), 'jauh dari spawn');
  ok(a.filter((s) => s.kind === 'shelf').length === 3, '3 soda di rak');
  ok(chooseSodaSpots(spots, makeRng(1), { tables: 5, shelves: 3, spawn: md.spawn, minSpawnDist: 2.5, minGap: 3, reachable: () => false }).length === 0, 'tidak ada titik terjangkau -> tidak ada soda');
}
section('Rename Almond Water -> Soda');
{
  ok(SODA_ITEM === 'soda' && ITEMS.soda && itemLabel('soda') === 'Soda' && ITEMS.soda.usable, 'item "soda" berlabel Soda & bisa dipakai');
  ok(!ITEMS.almond_water, 'almond_water sudah tidak ada di inventory');
}
console.log(`\nSODA: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
