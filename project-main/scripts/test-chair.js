// Uji kursi custom (public/models/chair.glb): footprint model harus berada di dalam kotak collision kursi bawaan (anti-tembus),
// orientasi sandaran benar, kaki menyentuh lantai, dan pemain (gerak game asli: stairs.movePlayer) tidak bisa masuk ke badan kursi
// dari arah mana pun. Dijalankan oleh scripts/run-test.sh sesudah test-game.js (butuh .tmp-game hasil kompilasi).
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData } = require(G + '/mapdata.js');
const { fitChair, applyFit } = require(G + '/chairfit.js');
const ST = require(G + '/stairs.js');
const cfg = require(G + '/config.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

const readGlb = (file) => {
  const buf = fs.readFileSync(file), jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8')), bin = buf.slice(20 + jl + 8);
  const accessor = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new C(bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT));
  };
  return { json, accessor };
};
// ---- matriks (kolom-mayor, seperti glTF)
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const compose = (n) => {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
};
const tp = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

// ---- model kursi: posisi vertex setelah transform node-nya
const C = readGlb(path.join(__dirname, '..', 'public', 'models', 'chair.glb'));
const cjson = C.json;
let chairMesh = -1; cjson.nodes.forEach((n, i) => { if (n.mesh !== undefined && chairMesh < 0) chairMesh = i; });
ok(chairMesh >= 0 && cjson.meshes.length >= 1, 'chair.glb punya mesh');
const parentC = {}; cjson.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parentC[c] = i; }));
let MC = compose(cjson.nodes[chairMesh]); for (let k = parentC[chairMesh]; k !== undefined; k = parentC[k]) MC = mul(compose(cjson.nodes[k]), MC);
const pos = C.accessor(cjson.meshes[cjson.nodes[chairMesh].mesh].primitives[0].attributes.POSITION);
const V = []; for (let i = 0; i < pos.length; i += 3) V.push(tp(MC, pos[i], pos[i + 1], pos[i + 2]));
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const v of V) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }

section('Model chair.glb');
console.log(`  vertex=${V.length} bounds model (Y-atas) x[${mn[0].toFixed(2)},${mx[0].toFixed(2)}] y[${mn[1].toFixed(2)},${mx[1].toFixed(2)}] z[${mn[2].toFixed(2)},${mx[2].toFixed(2)}]`);
ok(V.length > 100 && V.every((v) => v.every(Number.isFinite)), 'vertex valid (tanpa NaN)');
ok(fs.statSync(path.join(__dirname, '..', 'public', 'models', 'chair.glb')).size < 1.2e6, 'file chair.glb ringan untuk HP (< 1,2 MB)');
{ // sandaran model asli di sisi +Z (jauh di atas dudukan)
  const hh = mx[1] - mn[1], top = V.filter((v) => v[1] > mn[1] + 0.8 * hh), seat = V.filter((v) => v[1] > mn[1] + 0.4 * hh && v[1] < mn[1] + 0.5 * hh);
  const mean = (a, k) => a.reduce((s, v) => s + v[k], 0) / a.length;
  ok(mean(top, 2) > mean(seat, 2) + 0.5, 'asumsi orientasi: sandaran di sisi +Z model asli (karena itu yaw = PI)');
}

// ---- fungsi fit (kasus murni)
section('fitChair (murni)');
for (const slot of [{ w: 0.5, d: 0.5, h: 1.03 }, { w: 0.4, d: 0.6, h: 1.2 }, { w: 0.6, d: 0.35, h: 0.8 }]) {
  const f = fitChair(mn, mx, slot);
  ok(f.hx * 2 <= slot.w + 1e-9 && f.hz * 2 <= slot.d + 1e-9 && f.h <= slot.h + 1e-9, `muat di slot ${slot.w}x${slot.d}x${slot.h} (hasil ${(f.hx * 2).toFixed(3)}x${(f.hz * 2).toFixed(3)}x${f.h.toFixed(3)})`);
  const q = V.map((v) => applyFit(f, v[0], v[1], v[2]));
  const lo = [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.min(...q.map((p) => p[2]))], hi = [Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1])), Math.max(...q.map((p) => p[2]))];
  ok(Math.abs(lo[1]) < 1e-9, 'kaki tepat di y=0');
  ok(Math.abs(lo[0] + hi[0]) < 1e-9 && Math.abs(lo[2] + hi[2]) < 1e-9, 'footprint terpusat di pivot');
  ok(lo[0] >= -slot.w / 2 - 1e-9 && hi[0] <= slot.w / 2 + 1e-9 && lo[2] >= -slot.d / 2 - 1e-9 && hi[2] <= slot.d / 2 + 1e-9, 'semua vertex di dalam slot');
}

// ---- map: semua kursi bawaan
const M = readGlb(path.join(__dirname, '..', 'public', 'models', 'backrooms_full.glb'));
const json = M.json, md = extractMapData(json);
const parent = {}; json.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
const worldM = (i) => { let m = compose(json.nodes[i]); for (let k = parent[i]; k !== undefined; k = parent[k]) m = mul(compose(json.nodes[k]), m); return m; };
const chairs = []; json.nodes.forEach((n, i) => { if (n.extras && n.extras.type === 'Chair') chairs.push(i); });

section('Kursi di map');
ok(chairs.length >= 30, `kursi terbaca di map (${chairs.length})`);
const vis = []; // footprint visual per kursi (ruang lokal node) untuk uji tabrakan
let worstSlack = Infinity, minFill = 1, badBack = 0, badFloor = 0, outside = 0;
for (const i of chairs) {
  const col = md.colliders.find((c) => c.idx === i);
  ok(!!col, `${json.nodes[i].name} punya collider`);
  if (!col) continue;
  const o = col.obb, size = json.nodes[i].extras.size || [0.5, 1.03, 0.5];
  const f = fitChair(mn, mx, { w: o.hx * 2, d: o.hz * 2, h: size[1] });
  const Wm = worldM(i), cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity, ymin = Infinity, ymax = -Infinity, topZ = 0, topN = 0;
  for (const v of V) {
    const p = applyFit(f, v[0], v[1], v[2]);            // ruang lokal node
    const w = tp(Wm, p[0], p[1], p[2]);                  // dunia
    const dx = w[0] - o.cx, dz = w[2] - o.cz, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; // ruang kotak collision
    lx0 = Math.min(lx0, lx); lx1 = Math.max(lx1, lx); lz0 = Math.min(lz0, lz); lz1 = Math.max(lz1, lz);
    ymin = Math.min(ymin, w[1]); ymax = Math.max(ymax, w[1]);
    if (p[1] > 0.8 * f.h) { topZ += p[2]; topN++; }
  }
  const slack = Math.min(o.hx - Math.max(Math.abs(lx0), Math.abs(lx1)), o.hz - Math.max(Math.abs(lz0), Math.abs(lz1)));
  worstSlack = Math.min(worstSlack, slack);
  if (slack < -1e-3) outside++;
  minFill = Math.min(minFill, f.hx / o.hx, f.hz / o.hz);
  const floorY = Wm[13];
  if (Math.abs(ymin - floorY) > 1e-3 || ymax > floorY + size[1] + 1e-3) badFloor++;
  if (!(topN > 0 && topZ / topN < -0.15)) badBack++; // sandaran di sisi -Z lokal (belakang), seperti kursi bawaan; depan = +Z
  vis.push({ i, o, hxv: Math.max(-lx0, lx1), hzv: Math.max(-lz0, lz1), cxv: (lx0 + lx1) / 2, czv: (lz0 + lz1) / 2 });
}
console.log(`  kursi=${chairs.length} | sisa celah terkecil footprint -> kotak collision: ${(worstSlack * 100).toFixed(1)} cm | isi kotak terkecil: ${(minFill * 100).toFixed(0)}%`);
ok(outside === 0, `footprint model di dalam kotak collision untuk semua kursi (melanggar: ${outside})`);
ok(worstSlack >= -1e-3, 'tidak ada vertex di luar kotak collision');
ok(minFill > 0.85, `kursi tidak mengecil berlebihan (isi kotak >= 85%: ${(minFill * 100).toFixed(0)}%)`);
ok(badFloor === 0, `kaki di lantai & tinggi sesuai slot (melanggar: ${badFloor})`);
ok(badBack === 0, `sandaran di belakang (-Z lokal) pada semua kursi (melanggar: ${badBack})`);

// ---- tabrakan pemain: gerak game asli (stairs.movePlayer) dari 24 arah, 3 kecepatan, berdiri & jongkok
section('Tabrakan pemain vs kursi');
const cw = new CollisionWorld(2), IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const w of md.wallNodes) { const m = json.meshes[json.nodes[w.idx].mesh]; const base = cfg.LEVEL_Y[w.level]; for (const p of m.primitives) cw.rasterMesh(w.level, M.accessor(p.attributes.POSITION), M.accessor(p.indices), IDENT, base + 0.25, base + 2.0); }
cw.walk[0] = { ...md.floor0 }; cw.walk[1] = { ...md.mezz };
for (const c of md.colliders) cw.addObb(c.obb);
for (const d of md.doors) cw.addObb(d.closedObb);
const S = md.stair;
// jarak titik (x,z) ke persegi footprint visual kursi (ruang lokal kotak collision) = batas bawah jarak ke mesh sebenarnya
const distVis = (v, x, z) => {
  const o = v.o, cs = Math.cos(o.yaw), sn = Math.sin(o.yaw), dx = x - o.cx, dz = z - o.cz, lx = dx * cs - dz * sn - v.cxv, lz = dx * sn + dz * cs - v.czv;
  return Math.hypot(Math.max(Math.abs(lx) - v.hxv, 0), Math.max(Math.abs(lz) - v.hzv, 0));
};
let runs = 0, minDist = Infinity, worst = '', penetr = 0, reached = 0;
for (const v of vis) {
  const o = v.o, lv = o.level;
  for (const R of [cfg.PLAYER_RADIUS, cfg.PLAYER_RADIUS_CROUCH]) for (const step of [0.044, 0.11, 0.2]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.07;
    const p = { x: o.cx + Math.cos(a) * 1.6, z: o.cz + Math.sin(a) * 1.6, y: cfg.LEVEL_Y[lv], level: lv, onStairs: false };
    if (cw.blocked(p.x, p.z, R, lv)) continue; // titik awal sudah menempel dinding/furniture lain
    runs++;
    // arah: ke pusat kursi; sebagian percobaan miring 35 derajat (menggesek sisi kursi)
    for (const tilt of [0, 0.6, -0.6]) {
      const q = { ...p }; const ang = Math.atan2(o.cz - q.z, o.cx - q.x) + tilt;
      for (let f = 0; f < 90; f++) {
        ST.movePlayer(cw, S, q, Math.cos(ang) * step, Math.sin(ang) * step, R);
        const d = distVis(v, q.x, q.z);
        if (d < minDist) { minDist = d; worst = `${json.nodes[v.i].name} R=${R} step=${step} sudut=${k} tilt=${tilt}`; }
        if (d < R - 5e-3) penetr++;
      }
      if (distVis(v, q.x, q.z) < R + 0.05) reached++;
    }
  }
}
console.log(`  skenario=${runs} (x3 arah) | pemain mencapai kursi (menempel): ${reached} | jarak pusat pemain ke badan kursi terdekat: ${(minDist * 100).toFixed(1)} cm (R=24-30 cm)`);
console.log(`  kasus terdekat: ${worst}`);
ok(runs > 1000, `cukup banyak skenario (${runs})`);
ok(reached > 200, `pemain benar-benar sampai menempel kursi di banyak skenario (${reached})`);
ok(penetr === 0, `pemain tidak pernah masuk ke badan kursi: langkah melanggar = ${penetr}`);
ok(minDist >= cfg.PLAYER_RADIUS_CROUCH - 5e-3, 'jarak minimum >= radius pemain (jongkok 0,24 / berdiri 0,30)');

console.log(`\nChair: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
