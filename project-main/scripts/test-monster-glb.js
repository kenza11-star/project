// Validasi GLB monster (public/models/gaunt-creature.glb): struktur glTF 2.0, rig (tulang/skin/bobot), klip animasi, dan pose (rest = bind,
// jalan/lari bergerak sewajarnya, cengkeram: ujung tangan menjangkau ke depan wajah). Tanpa three.js: skinning dihitung langsung (CPU).
const fs = require('fs'), path = require('path');
const maxOf = (a) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }, minOf = (a) => { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; };
let fails = 0, passes = 0; const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const file = path.join(__dirname, '..', 'public', 'models', 'gaunt-creature.glb'), buf = fs.readFileSync(file);
const jl = buf.readUInt32LE(12), j = JSON.parse(buf.slice(20, 20 + jl).toString('utf8')), binStart = 20 + jl + 8, binLen = buf.readUInt32LE(20 + jl);
const acc = (i) => { const a = j.accessors[i], bv = j.bufferViews[a.bufferView], nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType]; const off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0); return { n: a.count, nc, d: new C(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + a.count * nc * C.BYTES_PER_ELEMENT)) }; };
section('Struktur glTF');
ok(buf.readUInt32LE(0) === 0x46546c67 && buf.readUInt32LE(4) === 2 && buf.readUInt32LE(8) === buf.length, 'header GLB 2.0 & panjang benar');
ok(j.asset.version === '2.0' && j.buffers.length === 1 && j.buffers[0].byteLength === binLen, 'satu buffer, panjang cocok dengan chunk BIN');
ok(j.bufferViews.every((v) => v.byteOffset + v.byteLength <= binLen && (v.byteOffset % 4) === 0), 'semua bufferView di dalam buffer & rata 4 byte');
ok(j.accessors.every((a) => { const bv = j.bufferViews[a.bufferView]; const sz = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType] * { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]; return (a.byteOffset || 0) + a.count * sz <= bv.byteLength; }), 'semua accessor muat di bufferView-nya');
const pr = j.meshes[0].primitives[0], P = acc(pr.attributes.POSITION), NR = acc(pr.attributes.NORMAL), UV = acc(pr.attributes.TEXCOORD_0), JT = acc(pr.attributes.JOINTS_0), WT = acc(pr.attributes.WEIGHTS_0), IX = acc(pr.indices);
ok(P.n === NR.n && P.n === UV.n && P.n === JT.n && P.n === WT.n, `atribut sejajar (${P.n} vertex)`); ok(IX.n % 3 === 0 && maxOf(IX.d) < P.n, `${IX.n / 3} segitiga, indeks valid (16-bit)`);
ok(P.n * 3 === P.d.length && P.d.every(Number.isFinite), 'posisi finite'); const ys = P.d.filter((_, i) => i % 3 === 1), ymin = minOf(ys), ymax = maxOf(ys);
ok(Math.abs(ymin) < 1e-3 && ymax > 2.0 && ymax < 2.4, `kaki di y=0, tinggi ${ymax.toFixed(2)} m`);
ok(!pr.attributes.TANGENT && !pr.attributes.TEXCOORD_1 && j.meshes[0].primitives.length === 1, 'ramping untuk HP: tanpa TANGENT/UV tambahan, 1 primitive (1 draw call)');
ok(!(j.extensionsUsed || []).length && !(j.extensionsRequired || []).length, 'tanpa ekstensi (clearcoat dibuang)');
ok(buf.length < 5.5e6, `ukuran file ${(buf.length / 1048576).toFixed(1)} MB`);
ok(j.images.length === 3 && j.textures.length === 3 && j.materials[0].normalTexture.index === 2 && j.materials[0].pbrMetallicRoughness.baseColorTexture.index === 0, 'material: base color, metal-rough, normal');
section('Rig: tulang & bobot kulit');
const joints = j.skins[0].joints, names = joints.map((n) => j.nodes[n].name); const need = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'UpperArm_L', 'LowerArm_L', 'Hand_L', 'UpperArm_R', 'LowerArm_R', 'Hand_R', 'UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R'];
ok(need.every((n) => names.includes(n)) && new Set(names).size === names.length, `${names.length} tulang bernama unik (Hand_L/Hand_R/Head dipakai game)`);
ok(maxOf(JT.d) < joints.length, 'JOINTS_0 valid'); let bad = 0, maxSumErr = 0; for (let i = 0; i < WT.n; i++) { const s = WT.d[i * 4] + WT.d[i * 4 + 1] + WT.d[i * 4 + 2] + WT.d[i * 4 + 3]; maxSumErr = Math.max(maxSumErr, Math.abs(s - 1)); if (s < 0.99) bad++; }
ok(bad === 0 && maxSumErr < 1e-3, `bobot tiap vertex berjumlah 1 (galat maks ${maxSumErr.toExponential(1)})`);
const par = {}; j.nodes.forEach((n, i) => (n.children || []).forEach((c) => { par[c] = i; })); ok(joints.every((n) => n === j.skins[0].skeleton || par[n] !== undefined), 'hierarki tulang terhubung ke Hips');
const IBM = acc(j.skins[0].inverseBindMatrices); ok(IBM.n === joints.length, 'inverse bind matrix per tulang');
// ---- skinning CPU
const qmat = (q) => { const [x, y, z, w] = q; return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]; };
const mm = (a, b) => a.map((r, i) => b[0].map((_, k) => r.reduce((s, _v, l) => s + a[i][l] * b[l][k], 0)));
const anims = Object.fromEntries(j.animations.map((a) => [a.name, a]));
const sampleAnim = (an, t) => { const out = {}; for (const ch of an.channels) { const s = an.samplers[ch.sampler], ts = acc(s.input).d, vs = acc(s.output), nc = vs.nc; const t2 = Math.min(Math.max(t, ts[0]), ts[ts.length - 1]); let k = 0; while (k < ts.length - 2 && ts[k + 1] <= t2) k++; const u = (t2 - ts[k]) / (ts[k + 1] - ts[k] || 1); const a = Array.from(vs.d.slice(k * nc, k * nc + nc)), b = Array.from(vs.d.slice((k + 1) * nc, (k + 1) * nc + nc)); let r; if (nc === 4) { const d = a.reduce((s2, v, i) => s2 + v * b[i], 0), sg = d < 0 ? -1 : 1; r = a.map((v, i) => v * (1 - u) + sg * b[i] * u); const L = Math.hypot(...r); r = r.map((v) => v / L); } else r = a.map((v, i) => v * (1 - u) + b[i] * u); out[ch.target.node + ':' + ch.target.path] = r; } return out; };
const world = {}; const wm = (i, ov) => { if (world[i] !== undefined) return world[i]; const n = j.nodes[i], T = ov[i + ':translation'] || n.translation || [0, 0, 0], q = ov[i + ':rotation'] || n.rotation || [0, 0, 0, 1]; const R = qmat(q); let M = [[R[0][0], R[0][1], R[0][2], T[0]], [R[1][0], R[1][1], R[1][2], T[1]], [R[2][0], R[2][1], R[2][2], T[2]], [0, 0, 0, 1]]; return (world[i] = par[i] !== undefined ? mm(wm(par[i], ov), M) : M); };
const skinMats = (an, t) => { for (const k of Object.keys(world)) delete world[k]; const ov = an ? sampleAnim(an, t) : {}; return joints.map((jn, k) => { const ib = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => IBM.d[k * 16 + c * 4 + r])); return mm(wm(jn, ov), ib); }); };
const skinV = (SM, vi) => { const v = [P.d[vi * 3], P.d[vi * 3 + 1], P.d[vi * 3 + 2], 1], o = [0, 0, 0]; for (let k = 0; k < 4; k++) { const w = WT.d[vi * 4 + k]; if (!w) continue; const m = SM[JT.d[vi * 4 + k]]; for (let r = 0; r < 3; r++) o[r] += w * (m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + m[r][3]); } return o; };
section('Klip animasi');
ok(['idle', 'walk', 'run', 'grab'].every((n) => anims[n]), 'klip idle, walk, run, grab ada');
const dur = (a) => acc(a.samplers[0].input).d.slice(-1)[0]; ok(Math.abs(dur(anims.walk) - 1.2) < 0.05 && Math.abs(dur(anims.run) - 0.66) < 0.05 && Math.abs(dur(anims.grab) - 1.6) < 0.05, `durasi walk ${dur(anims.walk).toFixed(2)}s, run ${dur(anims.run).toFixed(2)}s, grab ${dur(anims.grab).toFixed(2)}s`);
let animOk = true, qOk = true, loopOk = true; for (const a of j.animations) { for (const ch of a.channels) { const s = a.samplers[ch.sampler], ti = acc(s.input), vo = acc(s.output); if (ti.n !== vo.n || !(j.nodes[ch.target.node])) animOk = false; if (ch.target.path === 'rotation') for (let i = 0; i < vo.n; i++) { const L = Math.hypot(vo.d[i * 4], vo.d[i * 4 + 1], vo.d[i * 4 + 2], vo.d[i * 4 + 3]); if (Math.abs(L - 1) > 1e-3) qOk = false; } if (a.name !== 'grab' && ch.target.path === 'rotation') { const vo2 = vo; for (let c = 0; c < 4; c++) if (Math.abs(vo2.d[c] - vo2.d[(vo2.n - 1) * 4 + c]) > 1e-3) loopOk = false; } } }
ok(animOk && qOk, 'sampler konsisten & kuaternion ternormalisasi'); ok(loopOk, 'klip idle/walk/run berulang mulus (frame awal = frame akhir)');
const rest = skinMats(null, 0); let err = 0; for (let i = 0; i < P.n; i += 7) { const o = skinV(rest, i); err = Math.max(err, Math.hypot(o[0] - P.d[i * 3], o[1] - P.d[i * 3 + 1], o[2] - P.d[i * 3 + 2])); } ok(err < 1e-4, `pose istirahat = bind pose (galat ${err.toExponential(1)})`);
const bidx = (n) => joints.indexOf(j.nodes.findIndex((x) => x.name === n) >= 0 ? j.nodes.findIndex((x) => x.name === n) : -1); const domOf = (vi) => { let b = 0; for (let k = 1; k < 4; k++) if (WT.d[vi * 4 + k] > WT.d[vi * 4 + b]) b = k; return JT.d[vi * 4 + b]; };
const tip = (SM, side) => { let best = null; for (let vi = 0; vi < P.n; vi++) { if (domOf(vi) !== bidx('Hand_' + side)) continue; const o = skinV(SM, vi); if (!best || o[2] > best[2]) best = o; } return best; };
const headY = (SM) => { let s = 0, n = 0; for (let vi = 0; vi < P.n; vi += 3) if (domOf(vi) === bidx('Head')) { s += skinV(SM, vi)[1]; n++; } return s / n; };
const maxMove = (an, name) => { let m = 0; const T = dur(an); for (const tt of [0.25, 0.5, 0.75]) { const SM = skinMats(an, T * tt); for (let i = 0; i < P.n; i += 53) { const o = skinV(SM, i); m = Math.max(m, Math.hypot(o[0] - P.d[i * 3], o[1] - P.d[i * 3 + 1], o[2] - P.d[i * 3 + 2])); } } return m; };
const mw = maxMove(anims.walk), mr = maxMove(anims.run); ok(mw > 0.1 && mw < 0.7 && mr > mw && mr < 1.2, `jalan menggerakkan badan ${mw.toFixed(2)} m, lari lebih besar ${mr.toFixed(2)} m (tidak meledak)`);
const g0 = skinMats(anims.grab, 0), g1 = skinMats(anims.grab, 1.5), tL = tip(g1, 'L'), tR = tip(g1, 'R'), t0 = tip(g0, 'L');
ok(tL[2] > t0[2] + 0.6 && tR[2] > 1.0 && tL[2] > 0.9, `cengkeram: ujung tangan menjangkau ke depan (z ${t0[2].toFixed(2)} -> L ${tL[2].toFixed(2)}, R ${tR[2].toFixed(2)})`);
ok(tL[1] > 1.2 && tL[1] < 2.0 && tR[1] > 1.2 && tR[1] < 2.0 && Math.abs(tL[0] - tR[0]) < 0.6, `tangan setinggi wajah/dada (y ${tL[1].toFixed(2)} & ${tR[1].toFixed(2)}) dan saling berdekatan (jarak x ${Math.abs(tL[0] - tR[0]).toFixed(2)} m)`);
let fin = true; for (let vi = 0; vi < P.n; vi += 11) { const o = skinV(g1, vi); if (!o.every(Number.isFinite) || Math.abs(o[0]) > 3 || o[1] < -0.5 || o[1] > 3.5 || Math.abs(o[2]) > 3) fin = false; } ok(fin, 'pose cengkeram tidak merusak mesh (semua vertex di batas wajar)');
console.log(`\nMonster GLB: ${passes} lulus, ${fails} gagal`); if (fails) process.exit(1);
