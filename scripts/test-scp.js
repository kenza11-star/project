// Uji Soda (permukaan nyata) + SCP-106 (locker/lemari acak, efek slow/blur) dengan GLB asli. Jalankan: npm run test:game
const fs = require('fs');
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const ROOT = path.join(__dirname, '..');
const { makeRng } = require(G + '/rng.js');
const { scareCount, pickScareUnits, ScareFx, scpTimeline, scpEligibleType, ARM_KEYS } = require(G + '/scp.js');
const { sampleSurfaces, dropOnto, verticalHits } = require(G + '/surface.js');
const cfg = require(G + '/config.js');
const { Inventory, ITEMS, itemLabel } = require(G + '/inventory.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  GAGAL:', msg); } };
const section = (t) => console.log('\n== ' + t);

const readGlb = (p) => {
  const b = fs.readFileSync(p), jl = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + jl).toString('utf8')), bin: b.slice(20 + jl + 8), size: b.length };
};
const acc = (g, i) => {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const off = g.bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new C(g.bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT));
};

section('Aset GLB di lokasi yang benar');
const sodaPath = path.join(ROOT, 'public', 'models', 'NORVIX_SODA_330ML_1file_vertexcolor.glb'), scpPath = path.join(ROOT, 'public', 'models', 'scp-106.glb');
ok(cfg.SODA_URL === '/models/NORVIX_SODA_330ML_1file_vertexcolor.glb' && fs.existsSync(sodaPath), 'GLB soda ada di public/models & cocok dengan SODA_URL');
ok(cfg.SCP_URL === '/models/scp-106.glb' && fs.existsSync(scpPath), 'GLB SCP ada di public/models & cocok dengan SCP_URL');
const soda = readGlb(sodaPath), scp = readGlb(scpPath);

section('Soda GLB: material, vertex color, ukuran');
{
  const mats = soda.json.materials.map((m) => m.name);
  ok(mats.includes('NORVIX_Label') && mats.includes('Aluminium'), 'material asli (NORVIX_Label, Aluminium) tersedia');
  const body = soda.json.meshes[0].primitives[0];
  ok(body.attributes.COLOR_0 !== undefined, 'Can_Body membawa vertex color (COLOR_0)');
  const pa = soda.json.accessors[soda.json.meshes[0].primitives[1].attributes.POSITION];
  ok(Math.abs(pa.max[1] - 0.1152) < 1e-3 && pa.min[1] === 0, 'dasar kaleng di y=0 (menempel permukaan), tinggi 11,5 cm (konstan SODA_H)');
  ok(Math.abs(pa.max[0] - 0.0316) < 1e-3, 'diameter ~6,3-6,6 cm: ukuran nyata kaleng 330 ml, tanpa skala');
  const tri = soda.json.accessors[body.indices].count / 3;
  console.log(`  segitiga Can_Body: ${tri} (LOD proxy dipakai di luar ${cfg.SODA_LOD_DIST} m), ukuran file ${(soda.size / 1048576).toFixed(1)} MB`);
}

section('SCP-106 GLB: rig, animasi, pose');
{
  const j = scp.json, names = new Set(j.nodes.map((n) => n.name));
  ok((j.animations || []).length === 0, 'tidak ada animasi bawaan (pose dibuat prosedural dengan transformasi tulang)');
  ok(j.skins.length === 1 && j.skins[0].joints.length === 55, 'satu skin, 55 joint');
  const SUF = '_106_2_skeleton';
  const need = ['Bone_001', 'Bone_002', 'Bone_021', 'Bone_022', 'Bone_004', 'Bone_005', 'Bone_006', 'Bone_024', 'Bone_025', 'Bone_026'];
  for (let i = 7; i <= 20; i++) need.push('Bone_' + String(i).padStart(3, '0'));
  for (const n of ['027', '028', '034', '048', '049', '035', '046', '047', '036', '044', '045', '037', '042', '043']) need.push('Bone_' + n);
  const miss = need.filter((n) => !names.has(n + SUF));
  ok(miss.length === 0, 'semua tulang yang dipakai scprig.ts ada: ' + miss.join(','));
  ok((j.extensionsUsed || []).includes('KHR_materials_unlit'), 'material unlit (tekstur asli dipertahankan)');
  // sumber scprig memakai nama tulang yang sama
  const src = fs.readFileSync(path.join(ROOT, 'lib/game/scprig.ts'), 'utf8');
  const used = Array.from(src.matchAll(/'(Bone_\d{3})'/g)).map((m) => m[1]);
  ok(used.length >= 40 && used.every((u) => names.has(u + SUF)), `scprig.ts: ${used.length} nama tulang, semuanya ada di GLB`);
}

section('Pemilihan locker/lemari pemicu');
{
  ok(scareCount(32, 5, 0.2) === 7 && scareCount(70, 5, 0.2) === 14, 'jumlah = max(5, 20% total)');
  ok(scareCount(6, 5, 0.2) === 5 && scareCount(5, 5, 0.2) === 4 && scareCount(1, 5, 0.2) === 0 && scareCount(0, 5, 0.2) === 0, 'tidak pernah semua locker menjadi pemicu');
  const ids = Array.from({ length: 70 }, (_, i) => 'L' + i);
  const seen = new Set(); let minN = 99, same = 0;
  for (let s = 1; s <= 400; s++) {
    const a = pickScareUnits(ids, makeRng(s), cfg.SCP_MIN_LOCKERS, cfg.SCP_LOCKER_FRACTION), b = pickScareUnits(ids, makeRng(s), cfg.SCP_MIN_LOCKERS, cfg.SCP_LOCKER_FRACTION);
    minN = Math.min(minN, a.length); if (a.join() === b.join()) same++;
    ok(new Set(a).size === a.length && a.length < ids.length && a.every((x) => ids.includes(x)), 'pilihan unik, bagian dari locker yang ada');
    seen.add(a.slice().sort().join());
  }
  ok(minN >= 5, 'minimal 5 lokasi (min ' + minN + ')');
  ok(same === 400, 'seed sama -> pilihan sama (reproducible)');
  ok(seen.size > 390, 'seed berbeda -> lokasi pemicu berbeda (acak per sesi): ' + seen.size + '/400 unik');
  ok(pickScareUnits(['a', 'b', 'c', 'd', 'e', 'f'], makeRng(3), 5, 0.2).length === 5, 'locker sedikit tetap menyisakan satu yang aman');
  ok(scpEligibleType('Locker') && scpEligibleType('Cabinet') && !scpEligibleType('Desk') && !scpEligibleType('FilingCabinet') && !scpEligibleType('DiningTable') && !scpEligibleType('Fridge') && !scpEligibleType(undefined), 'hanya furniture Locker/Cabinet (lemari) yang memenuhi syarat; meja, laci, kulkas tidak');
}

section('ScareFx: slow tepat 1,5 dtk, blur, tanpa penumpukan');
{
  const f = new ScareFx(cfg.SCP_SLOW_MS, cfg.SCP_SLOW_MUL, cfg.SCP_BLUR_RAMP_MS, cfg.SCP_BLUR_FADE_MS, cfg.SCP_BLUR_MAX);
  ok(f.slow === 1 && f.blur === 0 && !f.active, 'awal: normal');
  ok(f.start(10000) === true && f.active, 'start berhasil');
  f.update(10000); ok(f.slow === cfg.SCP_SLOW_MUL, 'lambat sejak detik 0');
  f.update(10000 + 1499); ok(f.slow === cfg.SCP_SLOW_MUL && f.blur === 1, 'masih lambat & buram di 1499 ms');
  ok(f.start(10000 + 1499) === false, 'pemicu lain saat aktif DITOLAK (tidak menumpuk)');
  f.update(10000 + 1500); ok(f.slow === 1, 'tepat 1500 ms: kecepatan semula');
  f.update(10000 + 1500 + 350); ok(f.blur > 0.1 && f.blur < 0.9, 'blur pulih halus (bukan lompat): ' + f.blur.toFixed(2));
  let mono = true, prev = 2; for (let t = 1500; t <= 2200; t += 20) { f.update(10000 + t); if (f.blur > prev + 1e-9) mono = false; prev = f.blur; }
  ok(mono, 'blur turun monoton saat pemulihan');
  f.update(10000 + 1500 + cfg.SCP_BLUR_FADE_MS); ok(!f.active && f.blur === 0 && f.slow === 1, 'setelah efek: tidak aktif, penglihatan jernih');
  ok(f.start(20000) === true, 'bisa dipicu lagi setelah selesai');
  f.update(20050); f.reset(); ok(!f.active && f.slow === 1 && f.blur === 0, 'reset (ganti scene/unmount) memulihkan semuanya');
  // frame rate tidak memengaruhi durasi: sampling jarang tetap berakhir di 1500 ms
  const g = new ScareFx(1500, 0.4, 90, 700, 1); g.start(0); g.update(1000); const s1 = g.slow; g.update(1600); ok(s1 === 0.4 && g.slow === 1, 'durasi berbasis jam dinding, bukan jumlah frame');
}

section('Garis waktu jumpscare');
{
  ok(scpTimeline(0, 1).visible && scpTimeline(0.99, 1).visible && !scpTimeline(1.0, 1).visible && !scpTimeline(2, 1).visible, 'SCP terlihat hanya selama dur, lalu hilang');
  const a = scpTimeline(0, 1), m = scpTimeline(0.4, 1), e = scpTimeline(0.95, 1);
  ok(a.raise < 0.05 && m.raise > 0.9 && e.close > 0.9 && a.close === 0, 'lengan: sisi badan -> terangkat -> menutup (memeluk)');
  ok(m.lunge > 0.95 && a.lunge === 0, 'terjang cepat dalam ~0,3 dtk');
  ok(ARM_KEYS.upperOpen[2] > 0.5 && ARM_KEYS.foreClose[0] < 0, 'pose akhir: lengan ke depan & lengan bawah menutup ke dalam (bukan pose-T)');
}

// ---- furniture asli untuk uji permukaan ----
const map = readGlb(path.join(ROOT, 'public', 'models', 'backrooms_full.glb'));
const J = map.json;
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const comp = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => { const [x, y, z, w] = q; const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]; for (let i = 0; i < 3; i++) { m[i] *= s[0]; m[4 + i] *= s[1]; m[8 + i] *= s[2]; } m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; };
const ap = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const parent = new Array(J.nodes.length).fill(-1); J.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
const worldM = (i) => { const n = J.nodes[i]; const m = comp(n.translation, n.rotation, n.scale); return parent[i] >= 0 ? mul(worldM(parent[i]), m) : m; };
function trisOf(i, shift) { // segitiga ruang dunia dari subtree node i (shift: Map idx->[dx,dy,dz] untuk bagian yang bergeser, mis. laci terbuka)
  const out = [];
  const walk = (k, pm) => {
    const n = J.nodes[k]; let tr = n.translation || [0, 0, 0];
    if (shift && shift.has(k)) { const d = shift.get(k); tr = [tr[0] + d[0], tr[1] + d[1], tr[2] + d[2]]; } // geser di ruang lokal induk (sama dengan p.obj.position = p0 + slide)
    const m = mul(pm, comp(tr, n.rotation, n.scale));
    if (n.mesh !== undefined) for (const p of J.meshes[n.mesh].primitives) {
      const P = acc(map, p.attributes.POSITION), ix = p.indices !== undefined ? acc(map, p.indices) : null, cnt = ix ? ix.length : P.length / 3;
      for (let t = 0; t + 2 < cnt; t += 3) for (let v = 0; v < 3; v++) { const id = ix ? ix[t + v] : t + v; out.push(...ap(m, P[id * 3], P[id * 3 + 1], P[id * 3 + 2])); }
    }
    for (const c of n.children || []) walk(c, m);
  };
  walk(i, parent[i] >= 0 ? worldM(parent[i]) : comp());
  return out;
}

section('Soda di permukaan furniture nyata (meja / meja kerja / rak)');
{
  const TYPES = /^(DiningTable|MeetingTable|LabTable|Desk|ReceptionDesk|Bookshelf|StorageShelf)$/;
  let nodes = 0, withSpots = 0, total = 0, bad = 0, heights = [];
  const byType = {};
  J.nodes.forEach((n, i) => {
    const ty = n.extras && n.extras.type; if (!n.extras || !n.extras.furniture || !TYPES.test(ty)) return;
    const wy = worldM(i)[13]; if (wy > cfg.LEVEL_Y[1] - 0.5) return; // lantai 1 saja (yang dipakai Soda di meja)
    nodes++;
    const T = trisOf(i), pts = sampleSurfaces(T, { minY: 0.45, maxY: 1.75 });
    if (pts.length) withSpots++; total += pts.length; byType[ty] = (byType[ty] || 0) + pts.length;
    for (const p of pts) {
      heights.push(p.y);
      // setiap titik: permukaan datar nyata tepat di bawah kaleng (sinar vertikal menemukan muka atas pada y itu), dan ruang bebas di atasnya
      const h = verticalHits(T, p.x, p.z), s = h.findIndex((q) => q.up && Math.abs(q.y - p.y) < 1e-6);
      const above = s > 0 ? h[s - 1].y - h[s].y : Infinity;
      if (s < 0 || above < 0.22) bad++;
      // kaleng (r=3,3 cm) tidak menjorok: 4 titik di sekelilingnya (r=5 cm) berada pada permukaan yang sama
      for (const [dx, dz] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) { const hh = verticalHits(T, p.x + dx, p.z + dz); if (!hh.some((q) => q.up && Math.abs(q.y - p.y) < 0.02)) { bad++; break; } }
    }
  });
  console.log(`  furniture lantai 1: ${nodes}, memiliki titik: ${withSpots}, total titik: ${total}, per jenis:`, JSON.stringify(byType));
  ok(nodes > 20 && withSpots > 10 && total > 200, 'banyak permukaan valid tersedia di map');
  ok(bad === 0, 'semua titik: di atas muka atas nyata, ada ruang bebas, tidak di tepi (pelanggaran: ' + bad + ')');
  ok(heights.every((y) => y >= 0.45 && y <= 1.75), 'tinggi 0,45-1,75 m: terjangkau crosshair (bukan lantai / atas lemari)');
  // furniture acak (template yang dipakai generateFurniture): tiap jenis punya permukaan
  for (const [kind, name] of [['table', 'DiningTable_01'], ['desk', 'Desk_01'], ['shelf', 'Bookshelf_01']]) {
    const i = J.nodes.findIndex((n) => n.name === name); const pts = sampleSurfaces(trisOf(i), { minY: 0.45, maxY: 1.75 });
    ok(pts.length > 0, `template ${kind} (${name}) punya permukaan: ${pts.length} titik, tinggi ${pts.length ? Math.min(...pts.map((p) => p.y)).toFixed(2) + '-' + Math.max(...pts.map((p) => p.y)).toFixed(2) : '-'}`);
  }
}

section('Soda di dalam container: duduk di dasar/rak asli');
{
  const seen = {}; let n = 0, bad = 0;
  J.nodes.forEach((nd, i) => {
    const it = nd.extras && nd.extras.type === 'drawer' ? nd : null; void it;
  });
  // container: node 'door'/'drawer' furniture di bawah furniture bertipe tertentu; anchor sama dengan mapdata (ItemSpawn / Interior)
  const { extractMapData } = require(G + '/mapdata.js');
  const Module = require('module'); const _r = Module._resolveFilename; Module._resolveFilename = function (req, ...a) { return req === 'three' ? path.join(__dirname, 'three-stub.js') : _r.call(this, req, ...a); };
  const md = extractMapData(J);
  for (const c of md.containers) {
    const rn = J.nodes[c.rootIdx], ty = rn.extras.type, key = ty + '/' + c.kind; if ((seen[key] = (seen[key] || 0) + 1) > 3) continue;
    const it = J.nodes[c.parts[0]].extras.interact, shift = new Map(); if (it.open_type !== 'hinge') shift.set(c.parts[0], it.slide);
    const T = trisOf(c.rootIdx, shift), M = worldM(c.rootIdx);
    const a = c.anchorLocal, sl = c.slideKey ? it.slide : [0, 0, 0], lift = c.slideKey ? 0.12 : 0.08;
    const w = ap(M, a[0] + sl[0], a[1] + sl[1] + lift, a[2] + sl[2]); w[1] = Math.max(w[1], (c.level ? cfg.LEVEL_Y[1] : 0) + 0.3); // sama dengan world.keyWorldPos
    const y = dropOnto(T, w[0], w[2], w[1] + 0.15); n++;
    if (y === null || w[1] - y > 0.45 || y < (c.level ? cfg.LEVEL_Y[1] : 0)) { bad++; console.log('   gagal:', c.id, ty, 'lvl', c.level, 'anchorY', w[1].toFixed(3), 'surface', y); }
  }
  console.log('  jenis container diuji:', JSON.stringify(seen));
  ok(n >= 9 && bad === 0, `Soda menemukan permukaan di bawah titik simpan untuk ${n} container (laci, locker, lemari, kulkas); gagal: ${bad}`);
}

section('Inventory: Soda menggantikan Almond Water');
{
  ok(ITEMS.soda && ITEMS.soda.label === 'Soda' && itemLabel('soda') === 'Soda' && ITEMS.soda.usable, "item 'soda' berlabel 'Soda', bisa dipakai");
  ok(!('almond_water' in ITEMS), 'almond_water sudah dihapus dari daftar item');
  const inv = new Inventory(); inv.add('soda'); ok(inv.count('soda') === 1 && inv.remove('soda') && inv.count('soda') === 0, 'tambah/pakai soda');
  const rest = ['lib', 'components', 'scripts', 'README.md'].flatMap((d) => { const w = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => w(path.join(p, f))) : [p]; return w(path.join(ROOT, d)).filter((f) => /\.(ts|tsx|js|md)$/.test(f) && !f.includes('test-scp.js')); });
  const left = rest.filter((f) => /almond/i.test(fs.readFileSync(f, 'utf8')));
  ok(left.length === 0, 'tidak ada sisa "Almond" di kode/dokumen: ' + left.join(','));
}

section('Pemasangan di game (statis): SCP hanya dari event buka locker/lemari');
{
  const w = fs.readFileSync(path.join(ROOT, 'lib/game/world.ts'), 'utf8');
  const count = (re) => (w.match(re) || []).length;
  ok(count(/this\.armScp\(/g) === 1 && /if \(act === 'close'\)[^\n]*\n[\s\S]{0,400}this\.armScp\(rt\);/.test(w), 'armScp dipanggil tepat sekali: di toggleContainer (event buka container asli) setelah aksi "open"');
  ok(count(/this\.fireScp\(/g) === 1 && /updateScpTrigger\(\)[\s\S]{0,500}this\.fireScp\(p\.rt, p\.unit\)/.test(w), 'fireScp hanya dipanggil dari updateScpTrigger (yang hanya diisi armScp)');
  ok(/scpEligibleType\(\(c\.root\.userData as any\)\?\.type\)/.test(w) && /this\.scpUnits\.has\(unit\)/.test(w) && /this\.scpDone\.has\(unit\)/.test(w), 'hanya furniture terpilih bertipe Locker/Cabinet & belum terpakai');
  ok(/this\.scpDone\.add\(unit\)/.test(w) && /endScp\(\)[\s\S]{0,200}scpModel\?\.hide\(\)/.test(w), 'jatah dihabiskan saat muncul; model dikeluarkan dari scene setelah selesai');
  ok(/dispose\(\) \{[\s\S]*this\.resetScp\(\); this\.scpModel\?\.dispose\(\)/.test(w) && /this\.timers = \[\]; this\.resetScp\(\)/.test(w), 'reset efek/model saat run baru & dispose (unmount)');
  const ps = fs.readFileSync(path.join(ROOT, 'components/lobby/PlayScene.tsx'), 'utf8');
  ok(/world\.scareFx\.slow/.test(ps) && /world\.scareFx\.blur/.test(ps) && /post\.setBlur/.test(ps), 'PlayScene memakai scareFx.slow (kecepatan) & scareFx.blur (post-processing)');
  ok(!/sensitivity|0\.006 \* world/.test(ps), 'sensitivitas kamera tidak diubah');
  ok(/CFG\.SODA_COUNT/.test(w) || /SODA_COUNT/.test(w), 'jumlah Soda dari config');
}

console.log(`\nSCP/Soda: ${passes} lulus, ${fails} gagal`);
if (fails) process.exitCode = 1;
