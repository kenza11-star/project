// Uji detail pintu: texture procedural (tile mulus, serat terarah, goresan), shader (struktur & konsistensi), dan fakta GLB (semua pintu = door_wood).
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game'), ROOT = path.join(__dirname, '..');
const T = require(G + '/doortex.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

section('Texture procedural pintu (dibagi semua pintu)');
{
  const S = T.DOOR_TEX_SIZE, a = T.makeDoorDetail(), b = T.makeDoorDetail();
  ok(a.length === S * S * 4 && S <= 256, `ukuran kecil: ${S}x${S} RGBA = ${(a.length / 1024) | 0} KB (satu texture untuk semua pintu)`);
  ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, 'deterministik');
  let alphaOk = true; for (let i = 3; i < a.length; i += 4) if (a[i] !== 255) { alphaOk = false; break; } ok(alphaOk, 'alpha 255');
  const ch = (c) => { const o = new Float32Array(S * S); for (let i = 0; i < S * S; i++) o[i] = a[i * 4 + c] / 255; return o; };
  const R = ch(0), Gc = ch(1), B = ch(2);
  const stat = (f) => { let m = 0; for (const v of f) m += v; m /= f.length; let s = 0; for (const v of f) s += (v - m) * (v - m); return { m, sd: Math.sqrt(s / f.length) }; };
  const sr = stat(R), sb = stat(B);
  ok(sr.m > 0.35 && sr.m < 0.65 && sr.sd > 0.08, `serat: rata-rata ${sr.m.toFixed(2)}, sebaran ${sr.sd.toFixed(2)} (tidak flat, tidak ekstrem)`);
  ok(sb.m > 0.35 && sb.m < 0.65 && sb.sd > 0.08, `bercak: rata-rata ${sb.m.toFixed(2)}, sebaran ${sb.sd.toFixed(2)}`);
  let cov = 0; for (const v of Gc) if (v > 0.35) cov++; cov /= S * S; ok(cov > 0.015 && cov < 0.12, `goresan tipis: ${(cov * 100).toFixed(1)}% piksel (bukan noise penuh)`);
  // arah serat: perubahan melintang (x = lebar) jauh lebih besar daripada memanjang (y = tinggi) => garis serat vertikal
  let dx = 0, dy = 0; for (let y = 0; y < S - 1; y++) for (let x = 0; x < S - 1; x++) { dx += Math.abs(R[y * S + x + 1] - R[y * S + x]); dy += Math.abs(R[(y + 1) * S + x] - R[y * S + x]); }
  ok(dx > dy * 2, `serat memanjang searah tinggi pintu (variasi melintang ${(dx / (S * S)).toFixed(3)} > 2x memanjang ${(dy / (S * S)).toFixed(3)})`);
  // tile mulus: selisih antar-tepi (wrap) tidak lebih besar dari selisih antar-piksel biasa
  const seam = (f, vertical) => { let s = 0, n = 0, r = 0; for (let i = 0; i < S; i++) { s += Math.abs(vertical ? f[i * S + S - 1] - f[i * S] : f[(S - 1) * S + i] - f[i]); n++; } for (let i = 0; i < S; i++) for (let j = 0; j < S - 1; j++) r += Math.abs(vertical ? f[i * S + j + 1] - f[i * S + j] : f[(j + 1) * S + i] - f[j * S + i]); return { seam: s / n, avg: r / (S * (S - 1)) }; };
  for (const [name, f] of [['serat', R], ['bercak', B]]) for (const v of [true, false]) { const q = seam(f, v); ok(q.seam <= q.avg * 1.8 + 0.01, `tile mulus (${name}, ${v ? 'kiri-kanan' : 'atas-bawah'}): sambungan ${q.seam.toFixed(3)} vs rata-rata ${q.avg.toFixed(3)}`); }
}

section('Shader pintu: struktur & konsistensi');
{
  const bal = (s, o, c) => s.split(o).length === s.split(c).length;
  for (const [k, v] of Object.entries(T.DOOR_GLSL)) ok(bal(v, '{', '}') && bal(v, '(', ')') && bal(v, '[', ']'), `kurung seimbang: ${k}`);
  const G = T.DOOR_GLSL, frag = G.fragDecl + G.color + G.rough + G.normal;
  const vars = (s) => new Set([...s.matchAll(/varying\s+\w+\s+(\w+)/g)].map((m) => m[1]));
  const vv = vars(G.vertDecl), fv = vars(G.fragDecl);
  ok([...fv].every((n) => vv.has(n)) && [...vv].every((n) => fv.has(n)), `varying vertex = fragment (${[...vv].join(', ')})`);
  ok(/vLp\s*=/.test(G.vertMain) && /vLn\s*=/.test(G.vertMain) && /vOrg\s*=/.test(G.vertMain) && /vW\s*=/.test(G.vertMain), 'vertex mengisi semua varying');
  ok(!/\bvWp\b|modelMatrix\s*\*\s*vec4\(transformed/.test(G.vertMain + G.color), 'koordinat OBJEK, bukan dunia (pola tidak berenang saat pintu berayun)');
  const taps = (G.color.match(/texture2D\(tDoor/g) || []).length; ok(taps === 4, `hanya 4 pengambilan texture per fragmen pintu (${taps})`);
  ok(!/gl_FragColor|emissive|totalEmissiveRadiance/.test(frag), 'tidak ada emisi / pewarnaan akhir (pintu tidak bercahaya sendiri)');
  for (const n of ['gW', 'gS', 'gH', 'gGr', 'gR']) { const decl = G.color.indexOf(n + ' = 0'); ok(decl >= 0 && G.color.indexOf(n) === decl, `${n} dideklarasikan sebelum dipakai`); ok(G.rough.includes('gR') && G.normal.includes('gH'), 'roughness & normal memakai variabel yang sudah dihitung'); }
  const m = G.rough.match(/clamp\([\s\S]*,\s*([\d.]+)\s*,\s*([\d.]+)\)\s*;$/); ok(m && +m[1] >= 0.5 && +m[2] <= 0.95, `roughness dibatasi ${m && m[1]}..${m && m[2]} (tidak glossy, tidak mati)`);
  ok(/uniform float u_dbump/.test(G.fragDecl) && /sampler2D tDoor/.test(G.fragDecl), 'uniform terdeklarasi');
  // texture kayu bawaan GLB (pusaran melingkar) tidak boleh mendominasi: dilemahkan ke warna rata-rata + sisa detail kecil, memakai uniform `diffuse` (tint tetap)
  ok(/#ifdef USE_MAP/.test(G.color) && /textureLod\(map, vMapUv, 8\.0\)/.test(G.color) && /diffuseColor\.rgb = diffuse \* mapAvg \* mix\(vec3\(1\.0\), mapRel, 0\.1\d*\)/.test(G.color), 'map GLB dilemahkan (mip rata-rata + <=19% detail) dengan tint `diffuse` dipertahankan');
  ok(/#endif/.test(G.color) && (G.color.match(/#ifdef/g) || []).length === (G.color.match(/#endif/g) || []).length, '#ifdef/#endif seimbang');
  ok(/if \(dot\(mapAvg, vec3\(1\.0\)\) < 0\.03\)/.test(G.color), 'pengaman bila mip tidak ada (pintu tidak jadi hitam)');
}

section('Integrasi: hanya material door_wood, aman dispose, geometri tidak berubah bentuk');
{
  const mat = fs.readFileSync(path.join(ROOT, 'lib/game/materials.ts'), 'utf8'), world = fs.readFileSync(path.join(ROOT, 'lib/game/world.ts'), 'utf8');
  ok(/door_wood:\s*\{[^}]*door:\s*1[^}]*\}/.test(mat) && !/door_wood:\s*\{[^}]*(bump|grime|scratch)/.test(mat), "profil door_wood memakai shader pintu (tanpa bump/kotor generik berbasis dunia)");
  ok(/this\.tex\.push\(t\)/.test(mat) && /dispose\(\) \{ for \(const t of this\.tex\)/.test(mat), 'texture pintu ikut daftar dispose MaterialUpgrade');
  ok(/if \(!this\.doorTex\)/.test(mat), 'texture dibuat sekali (dibagi), bukan per pintu/per frame');
  ok(/prepDoorGeometry/.test(world) && /name === 'door_wood'/.test(world), 'atribut lebar daun hanya untuk mesh bermaterial door_wood');
  ok(/customProgramCacheKey = \(\) => 'door1'/.test(mat), 'cache program shader pintu terpisah');
  // fakta model
  const b = fs.readFileSync(path.join(ROOT, 'public/models/backrooms_full.glb')), len = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + len).toString());
  const users = new Set(); j.nodes.forEach((n) => { if (n.mesh === undefined) return; for (const p of j.meshes[n.mesh].primitives) if (j.materials[p.material]?.name === 'door_wood') users.add(n.name); });
  ok(users.size > 30 && [...users].every((x) => /^Door_\d+$/.test(x)), `door_wood hanya dipakai node Door_NN (${users.size} pintu, termasuk pintu exit)`);
  ok([...users].every((nm) => { const n = j.nodes.find((q) => q.name === nm); const p = j.meshes[n.mesh].primitives.find((q) => j.materials[q.material].name === 'door_wood'); const a = j.accessors[p.attributes.POSITION]; return p.attributes.TEXCOORD_0 !== undefined && a.max[1] > 2 && a.max[1] < 2.3 && a.max[2] >= 1.0 && a.max[2] <= 1.15; }), 'semua daun pintu: tinggi ~2,12 m, lebar 1,04-1,14 m, punya UV & normal (sesuai asumsi shader)');
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
