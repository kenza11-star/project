// Uji frame impact jumpscare: urutan frame, selesai sendiri (tidak ada loop permanen), deterministik, mode reduced aman.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const I = require(G + '/impactfx.js'), M = require(G + '/monsterfx.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const seq = (reduced) => { const a = []; for (let t = 0; t <= M.JS_TOTAL + 5; t += 0.005) { const o = I.impactAt(t, reduced); a.push([t, o.idx, o.a, o.blur, o.fov, Math.abs(o.sx) + Math.abs(o.sy)]); } return a; };

console.log('== Urutan frame (normal)');
{
  const a = seq(false), idxs = []; for (const r of a) if (idxs[idxs.length - 1] !== r[1]) idxs.push(r[1]);
  console.log('  urutan idx:', idxs.join(' > '));
  ok(idxs.join() === '0,1,2,3,4,5,0', 'tepat 1>2>3>4>5 lalu mati, tidak pernah mengulang');
  ok(a.filter((r) => r[0] < M.JS_IMPACT_AT - 1e-6).every((r) => r[1] === 0), 'tidak ada efek sebelum benturan');
  const first = a.find((r) => r[1] === 1)[0]; ok(Math.abs(first - M.JS_IMPACT_AT) < 0.011, 'frame 1 tepat di JS_IMPACT_AT');
  ok(I.IMPACT_END < 2.5 && I.IMPACT_END > M.JS_IMPACT_AT + 1, 'selesai sebelum fase fade jumpscare (2,5 dtk): ' + I.IMPACT_END.toFixed(2));
  ok(a.filter((r) => r[0] >= I.IMPACT_END + 0.01).every((r) => r[1] === 0 && r[2] === 0 && r[3] === 0 && r[4] === 0 && r[5] === 0), 'lewat IMPACT_END semua nol (tidak nyangkut)');
  const hard = a.filter((r) => r[1] >= 1 && r[1] <= 4); ok(hard[hard.length - 1][0] - hard[0][0] < 0.42, 'frame keras total < 0,42 dtk');
  ok(a.every((r) => r[2] >= 0 && r[2] <= 1 && r[3] >= 0 && r[3] <= 8 && r[4] >= 0 && r[4] <= 9.01 && r[5] <= 0.13), 'nilai a/blur/fov/getar dalam batas aman');
}
console.log('== Deterministik & aman');
{
  ok(JSON.stringify(seq(false)) === JSON.stringify(seq(false)), 'hasil sama untuk waktu yang sama (fungsi murni)');
  ok(I.impactAt(NaN).idx === 0 && I.impactAt(-5).idx === 0 && I.impactAt(1e9).idx === 0 && I.impactAt(Infinity).idx === 0, 'NaN/negatif/tak hingga -> mati');
  ok(/^M[\d.\sLZM-]+$/.test(I.IMPACT_RAYS_A) && I.IMPACT_RAYS_A.length > 500 && I.IMPACT_RAYS_A !== I.IMPACT_RAYS_B && !/NaN/.test(I.IMPACT_RAYS_A + I.IMPACT_RAYS_B), 'path garis kecepatan valid, dua varian berbeda');
}
console.log('== Reduced motion');
{
  const a = seq(true), idxs = new Set(a.map((r) => r[1]));
  ok([...idxs].every((i) => i === 0 || i === 5), 'tanpa frame B&W/negatif/glitch/merah-kilat (tanpa strobo)');
  ok(a.every((r) => r[2] <= 0.46 && r[5] === 0), 'merah lembut & tanpa getar');
  ok(a.filter((r) => r[0] >= M.JS_IMPACT_AT + 0.71).every((r) => r[1] === 0), 'selesai sendiri < 0,71 dtk setelah benturan');
}
console.log(fails ? '\n' + fails + ' GAGAL, ' + passes + ' lulus' : '\nSemua lulus (' + passes + ')'); process.exit(fails ? 1 : 0);
