// Tes pembagian dinding per ruangan (wallzones.ts) dengan GLB asli. Jalankan: tsc lib/game/wallzones.ts --outDir <tmp> --module commonjs --target es2020 && node scripts/test-wallzones.js <tmp>/wallzones.js
const fs = require('fs'), path = require('path');
const mod = require(path.resolve(process.argv[2] || '/tmp/wz/wallzones.js'));
const b = fs.readFileSync(path.join(__dirname, '../public/models/backrooms_full.glb'));
const jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString()), bin = b.slice(20 + jl + 8);
const acc = (i) => { const a = j.accessors[i], bv = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType]; return new C(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * C.BYTES_PER_ELEMENT)); };
const rooms = j.nodes.filter((n) => n.extras && n.extras.type === 'RoomVolume').map((n) => { const c = n.translation, s = n.extras.size, nm = n.extras.room; return { type: /^Stair$/i.test(nm) ? 'ladder' : nm.toLowerCase(), level: n.extras.floor === 2 ? 1 : 0, rect: { minx: c[0] - s[0] / 2, minz: c[2] - s[2] / 2, maxx: c[0] + s[0] / 2, maxz: c[2] + s[2] / 2 } }; });
const levelY = (l) => (l ? 3.4 : 0);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('GAGAL:', m); } };
const triArea = (p, i) => { const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2]; return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); };
for (const nm of ['F1_Walls', 'F2_Walls']) {
  const nd = j.nodes.find((n) => n.name === nm); ok(!nd.translation && !nd.rotation && !nd.scale && !nd.matrix, nm + ' punya transform');
  const pr = j.meshes[nd.mesh].primitives[0], P = acc(pr.attributes.POSITION), N = acc(pr.attributes.NORMAL), I = acc(pr.indices);
  let a0 = 0; const T = new Float32Array(I.length * 3); for (let k = 0; k < I.length; k++) { T[k * 3] = P[I[k] * 3]; T[k * 3 + 1] = P[I[k] * 3 + 1]; T[k * 3 + 2] = P[I[k] * 3 + 2]; }
  for (let i = 0; i < T.length; i += 9) a0 += triArea(T, i);
  const t0 = Date.now(), parts = mod.splitWalls(P, N, I, rooms, levelY), dt = Date.now() - t0;
  let a1 = 0, nt = 0; const per = {};
  for (const p of parts) { let a = 0; for (let i = 0; i < p.pos.length; i += 9) a += triArea(p.pos, i); a1 += a; nt += p.pos.length / 9; per[p.zone] = Math.round(a) + 'm2'; ok(p.uv.length / 2 === p.pos.length / 3 && p.nor.length === p.pos.length, 'panjang atribut ' + p.zone); ok(p.uv.every(Number.isFinite) && p.pos.every(Number.isFinite), 'NaN ' + p.zone); }
  console.log(nm, 'tri', I.length / 3, '->', nt, 'luas', a0.toFixed(1), '->', a1.toFixed(1), JSON.stringify(per), dt + 'ms');
  ok(Math.abs(a0 - a1) < 0.01 * a0, nm + ' luas berubah');
  ok(nt < 40000, nm + ' terlalu banyak segitiga');
  // wainscot: bagian planks/panels tidak boleh melewati batas tinggi; plaster tidak boleh di bawah batas
  const base = levelY(nm === 'F2_Walls' ? 1 : 0);
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 9) { const ys = [p.pos[i + 1], p.pos[i + 4], p.pos[i + 7]];
    if (p.zone === 'planks' || p.zone === 'panels') ok(Math.max(...ys) <= base + mod.WAINSCOT_H + 1e-3, p.zone + ' melewati wainscot');
    if (p.zone === 'plaster') ok(Math.min(...ys) >= base + mod.WAINSCOT_H - 1e-3, 'plaster di bawah wainscot'); }
}
console.log(fail ? 'GAGAL ' + fail : 'OK semua tes wallzones');
process.exit(fail ? 1 : 0);
