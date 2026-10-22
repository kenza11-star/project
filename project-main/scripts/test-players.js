// Uji mode pemain (1-6): normalisasi, slot, offset spawn, pembagian layar, dan penempatan spawn di collision map asli.
const fs = require('fs');
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { CollisionWorld } = require(G + '/collision.js');
const { extractMapData } = require(G + '/mapdata.js');
const cfg = require(G + '/config.js');
const P = require(G + '/players.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  GAGAL:', msg); } };
const section = (t) => console.log('\n== ' + t);

section('normalizeMode');
ok(P.normalizeMode(1) === 1 && P.normalizeMode(2) === 2 && P.normalizeMode(3) === 3 && P.normalizeMode(4) === 4, 'nilai 1-4 dipertahankan');
ok(P.normalizeMode('3') === 3, 'string "3" -> 3');
for (const bad of [0, 5, -1, 2.5 * 0 + 9, NaN, null, undefined, {}, 'abc', 'duo']) ok(P.normalizeMode(bad) === cfg.PLAYER_MODE_DEFAULT, `nilai tidak valid ${String(bad)} -> default`);
ok(P.PLAYER_MODES.map((m) => m.label).join('|') === 'Single Player|2 Players|3 Players|4 Players|5 Players|6 Players', 'label mode sesuai permintaan');

section('buildSlots');
for (const m of [1, 2, 3, 4, 5, 6]) {
  const s = P.buildSlots(m, ['AKU']);
  ok(s.length === m, `mode ${m}: ${m} slot`);
  ok(s[0].status === 'local' && s[0].name === 'AKU' && s[0].id === 'p1', `mode ${m}: slot 0 = pemain lokal`);
  ok(s.slice(1).every((x) => x.status === 'open'), `mode ${m}: slot lain kosong tanpa party`);
  ok(P.openCount(s) === m - 1 && P.liveSlots(s).length === 1, `mode ${m}: hitung slot kosong/aktif`);
  ok(new Set(s.map((x) => x.id)).size === m, `mode ${m}: id unik`);
}
{
  const s = P.buildSlots(1, ['AKU', 'TEMAN']);
  ok(s.length === 1 && P.liveSlots(s).length === 1, 'mode 1 mengabaikan anggota party berlebih');
  const t = P.buildSlots(4, ['AKU', 'TEMAN']);
  ok(t[1].status === 'remote' && t[1].name === 'TEMAN' && t[2].status === 'open' && t[3].status === 'open', 'mode 4 + 1 teman: 1 remote, 2 kosong');
  ok(P.buildSlots(2, [])[0].name === 'PLAYER', 'nama default bila kosong');
}

section('spawnOffsets');
for (const m of [1, 2, 3, 4, 5, 6]) {
  const o = P.spawnOffsets(m);
  ok(o.length === m && o[0].dx === 0 && o[0].dz === 0, `mode ${m}: slot 0 tepat di spawn`);
  let minD = Infinity;
  for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) minD = Math.min(minD, Math.hypot(o[i].dx - o[j].dx, o[i].dz - o[j].dz));
  ok(m === 1 || minD >= cfg.SPAWN_MIN_GAP, `mode ${m}: jarak antar spawn >= ${cfg.SPAWN_MIN_GAP} (min ${minD.toFixed(2)})`);
}

section('viewLayout');
for (const m of [1, 2, 3, 4, 5, 6]) {
  const v = P.viewLayout(m);
  const area = v.reduce((a, r) => a + r.w * r.h, 0);
  ok(v.length === m && Math.abs(area - 1) < 1e-9, `mode ${m}: layar terbagi penuh (luas ${area})`);
  let overlap = false;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const a = v[i], b = v[j];
    if (a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) overlap = true;
  }
  ok(!overlap, `mode ${m}: tidak ada layar tumpang tindih`);
}

section('placeSpawns (unit)');
{
  const base = { x: 10, z: 10 };
  const free = () => true;
  const a = P.placeSpawns(base, P.spawnOffsets(4), free);
  ok(a[0].x === 10 && a[0].z === 10, 'slot 0 persis di titik spawn');
  ok(a.every((p, i) => a.every((q, j) => i === j || Math.hypot(p.x - q.x, p.z - q.z) >= cfg.SPAWN_MIN_GAP - 1e-9)), 'semua titik terpisah >= gap');
  const none = P.placeSpawns(base, P.spawnOffsets(3), (x, z) => x === 10 && z === 10);
  ok(none.length === 3 && none.every((p) => p.x === 10 && p.z === 10), 'tidak ada ruang -> fallback ke spawn utama (tidak crash)');
}

section('placeSpawns (collision map asli, tanpa furniture acak)');
{
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
  const cw = new CollisionWorld(2);
  const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const w of md.wallNodes) {
    const m = json.meshes[json.nodes[w.idx].mesh]; const base = cfg.LEVEL_Y[w.level];
    for (const p of m.primitives) cw.rasterMesh(w.level, accessor(p.attributes.POSITION), accessor(p.indices), IDENT, base + 0.25, base + 2.0);
  }
  cw.walk[0] = { ...md.floor0 }; if (md.mezz) cw.walk[1] = { ...md.mezz };
  for (const c of md.colliders) cw.addObb(c.obb);
  for (const d of md.doors) cw.addObb(d.closedObb);
  const isFree = (x, z) => !cw.blocked(x, z, cfg.PLAYER_RADIUS + 0.04, 0);
  for (const m of [1, 2, 3, 4, 5, 6]) {
    const pts = P.placeSpawns(md.spawn, P.spawnOffsets(m), isFree);
    ok(pts.length === m, `mode ${m}: ${m} titik spawn`);
    ok(pts[0].x === md.spawn.x && pts[0].z === md.spawn.z, `mode ${m}: slot 0 = spawn asli map`);
    ok(pts.every((p) => !cw.blocked(p.x, p.z, cfg.PLAYER_RADIUS, 0)), `mode ${m}: tak ada titik di dalam dinding/furniture`);
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
    ok(m === 1 || minD >= cfg.SPAWN_MIN_GAP * 0.45, `mode ${m}: titik tidak menumpuk (min ${minD.toFixed(2)} m)`);
    console.log(`  mode ${m}: ` + pts.map((p) => `(${p.x.toFixed(2)},${p.z.toFixed(2)})`).join(' '));
  }
}

console.log(`\nplayers: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
