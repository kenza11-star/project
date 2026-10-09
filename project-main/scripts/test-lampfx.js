// Uji logika lampu horor (lampfx.ts): acak, aman mata, jarang, tidak serempak. Butuh .tmp-lampfx hasil kompilasi tsc.
const path = require('path');
const { LampFx, LAMPFX } = require(path.join(__dirname, '..', '.tmp-lampfx', 'lampfx.js'));
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const N = 300, POOL = 6, DT = 1 / 60, SECS = 1800; // 30 menit game, 60 fps
let seedv = 12345; const rnd = () => ((seedv = (seedv * 1664525 + 1013904223) >>> 0) / 4294967296);
const fx = new LampFx(N, rnd);
const flaky = (i) => i % 10 === 0, canOut = (i) => i % 13 !== 0;
const near = [10, 20, 30, 31, 32, 33]; // satu pool tetap di dekat pemain
const trace = new Map(near.map((i) => [i, []]));
let maxOut = 0, outStarts = 0, prevOut = 0, allDark = 0, minG = 1, fully = 0;
for (let f = 0; f < SECS * 60; f++) {
  const clock = f * DT;
  fx.update(DT, clock, near, flaky, canOut);
  maxOut = Math.max(maxOut, fx.outages);
  if (fx.outages > prevOut) outStarts++; prevOut = fx.outages;
  let dark = 0; for (const i of near) { const g = fx.g[i]; if (g < 0.2) dark++; trace.get(i).push(g); minG = Math.min(minG, g); }
  if (dark === near.length) allDark++;
}
ok(maxOut <= LAMPFX.MAX_OUT, 'maks lampu mati bersamaan <= ' + LAMPFX.MAX_OUT + ' (dapat ' + maxOut + ')');
ok(allDark === 0, 'tidak pernah semua lampu dekat mati bersamaan');
ok(outStarts >= 15 && outStarts <= 130, 'lampu mati sementara jarang tapi terjadi (' + outStarts + ' dalam 30 mnt)');
// acak: selang antar kejadian kedip tidak tetap
const gaps = []; { const t = trace.get(10); let last = -1; for (let f = 1; f < t.length; f++) if (t[f - 1] > 0.97 && t[f] <= 0.97) { if (last >= 0) gaps.push((f - last) / 60); last = f; } }
const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length, sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
ok(gaps.length > 50 && sd / mean > 0.3, 'jeda kedip lampu rusak bervariasi (CV=' + (sd / mean).toFixed(2) + ', n=' + gaps.length + ')');
// aman mata: ayunan besar (>0.3) per jendela 1 dtk
let worst = 0;
for (const [i, t] of trace) {
  const dirs = []; let ref = t[0], dir = 0;
  for (let f = 1; f < t.length; f++) { const d = t[f] - ref; if (dir >= 0 && d < -0.3) { dirs.push(f); dir = -1; ref = t[f]; } else if (dir <= 0 && d > 0.3) { dirs.push(f); dir = 1; ref = t[f]; } else if ((dir > 0 && t[f] > ref) || (dir < 0 && t[f] < ref)) ref = t[f]; }
  for (let a = 0, b = 0; a < dirs.length; a++) { while (dirs[b] < dirs[a] - 60) b++; worst = Math.max(worst, a - b + 1); }
}
ok(worst <= 6, 'ayunan besar per detik per lampu <= 6 pembalikan (=3 siklus/dtk), dapat ' + worst);
// reset
fx.reset(); ok(fx.outages === 0 && fx.g.every((g) => g === 1), 'reset memulihkan semua lampu');
// lampu yang tidak boleh mati tidak pernah mati
seedv = 99; const fx2 = new LampFx(N, rnd); let bad = 0;
for (let f = 0; f < 600 * 60; f++) { fx2.update(DT, f * DT, [13, 26, 39], flaky, canOut); if (fx2.g[13] < 0.2 || fx2.g[26] < 0.2 || fx2.g[39] < 0.2) bad++; }
ok(bad === 0, 'lampu terlarang (dekat spawn/exit) tidak pernah dimatikan');
console.log('lampfx: ' + passes + ' lulus, ' + fails + ' gagal; minG=' + minG.toFixed(2) + ' outStarts=' + outStarts);
process.exit(fails ? 1 : 0);
