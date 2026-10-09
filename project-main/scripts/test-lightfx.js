// Uji LightFx (logika murni): acak, tidak strobo, jarang, tidak semua lampu mati bersamaan.
const path = require('path');
const { LightFx } = require(path.join(__dirname, '..', '.tmp-game', 'lightfx.js'));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  GAGAL:', m); } };
const seeded = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = 60, near = [0, 1, 2, 3, 4, 5, 6, 7];
const gaps = [], offDur = []; let maxOff = 0, maxRate = 0, minLv = 1, events = 0, bothOff = 0;
for (let seed = 1; seed <= 20; seed++) {
  const fx = new LightFx(seeded(seed)); fx.setCount(N);
  const T = 600, dt = 1 / 60; let lastEv = -1, prevAct = 0; const trans = []; const offStart = {};
  let prev = new Array(N).fill(1); const tr = near.map(() => []);
  for (let f = 0; f < T / dt; f++) {
    const t = f * dt; fx.update(dt, near, false);
    if (fx.active > prevAct) { events++; if (lastEv >= 0) gaps.push(t - lastEv); lastEv = t; } prevAct = fx.active;
    maxOff = Math.max(maxOff, fx.offCount); if (fx.offCount > 1) bothOff++;
    for (const i of near) { const l = fx.level(i); minLv = Math.min(minLv, l); if ((prev[i] > 0.5) !== (l > 0.5)) { tr[i].push(t); } prev[i] = l;
      if (l < 0.03 && offStart[i] === undefined) offStart[i] = t; else if (l >= 0.03 && offStart[i] !== undefined) { offDur.push(t - offStart[i]); delete offStart[i]; } }
    // laju transisi terang<->gelap dalam jendela 1 dtk
    for (const q of tr) { while (q.length && q[0] < t - 1) q.shift(); maxRate = Math.max(maxRate, q.length); }
  }
}
const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length, sd = Math.sqrt(gaps.reduce((a, b) => a + (b - avgGap) ** 2, 0) / gaps.length);
console.log(`events=${events} avgGap=${avgGap.toFixed(1)}s sd=${sd.toFixed(1)} maxSimultaneousOff=${maxOff} multiOffFrames=${bothOff} maxCrossings/s=${maxRate} longOffs=${offDur.filter((d) => d > 1).length}`);
ok(sd > avgGap * 0.3, 'jeda event harus bervariasi (tidak berpola tetap)');
ok(avgGap > 6, 'event harus jarang');
ok(maxOff <= 2, 'maksimal 2 lampu mati bersamaan');
ok(bothOff / (20 * 600 * 60) < 0.02, 'dua lampu mati bersamaan sangat jarang');
ok(maxRate <= 6, 'tidak ada strobo cepat: per lampu <=6 crossing/dtk (<=3 flash/dtk)');
const longOff = offDur.filter((d) => d > 1.0); ok(longOff.length > 20 && Math.min(...longOff) >= 3 && Math.max(...longOff) <= 17, 'lampu mati sementara 3-15 dtk lalu menyala lagi');
ok(minLv >= 0 && minLv <= 1, 'level dalam 0..1');
// blackout global menahan event baru
const fx2 = new LightFx(seeded(5)); fx2.setCount(N); for (let f = 0; f < 60 * 400; f++) fx2.update(1 / 60, near, true); ok(fx2.active === 0, 'tidak ada event lokal saat blackout global');
// reset
const fx3 = new LightFx(seeded(9)); for (let f = 0; f < 60 * 300; f++) fx3.update(1 / 60, near, false); fx3.reset(); ok(fx3.active === 0 && fx3.level(0) === 1, 'reset membersihkan state');
console.log(fails ? `LIGHTFX: ${fails} gagal` : 'LIGHTFX: semua lulus'); if (fails) process.exit(1);
