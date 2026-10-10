// Uji LightFx (logika murni): event murni berbasis waktu/acak atas semua lampu, tidak tergantung pemain, tidak strobo, jarang, tidak semua mati.
const path = require('path');
const { LightFx } = require(path.join(__dirname, '..', '.tmp-game', 'lightfx.js'));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  GAGAL:', m); } };
const seeded = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = 150, watch = [3, 40, 77, 101, 140]; // 5 lampu yang 'diamati' (pemain diam di dekatnya)
let maxOffGlobal = 0, maxRate = 0, events = 0, watchedFlicks = 0, watchedOuts = 0; const offDur = [];
for (let seed = 1; seed <= 12; seed++) {
  const fx = new LightFx(seeded(seed)); fx.setCount(N);
  const T = 900, dt = 1 / 30; const prev = {}, tr = {}, offStart = {}; let prevAct = 0;
  for (let f = 0; f < T / dt; f++) {
    const t = f * dt; fx.update(dt, [], false); // near SELALU kosong: pemain diam / tidak relevan
    if (fx.active > prevAct) events += fx.active - prevAct; prevAct = fx.active;
    maxOffGlobal = Math.max(maxOffGlobal, fx.offCount);
    for (let i = 0; i < N; i++) { const l = fx.level(i); if (l >= 0.999 && !(i in prev)) continue; const was = prev[i] ?? 1; if ((was > 0.5) !== (l > 0.5)) { (tr[i] ||= []).push(t); } prev[i] = l;
      if (l < 0.03 && offStart[i] === undefined) offStart[i] = t; else if (l >= 0.03 && offStart[i] !== undefined) { offDur.push(t - offStart[i]); delete offStart[i]; } }
    for (const q of Object.values(tr)) { while (q.length && q[0] < t - 1) q.shift(); maxRate = Math.max(maxRate, q.length); }
  }
  // lampu yang diamati: berapa kali pernah punya event dalam 15 menit
  const fx2 = new LightFx(seeded(seed)); fx2.setCount(N);
  const seen = new Set(), seenOff = new Set();
  for (let f = 0; f < T / dt; f++) { fx2.update(dt, [], false); for (const i of watch) { if (fx2.level(i) < 0.97) seen.add(i); if (fx2.level(i) < 0.03) seenOff.add(i); } }
  watchedFlicks += seen.size; watchedOuts += seenOff.size;
}
console.log(`events=${events} maxOffGlobal=${maxOffGlobal}/${N} maxCrossings/s=${maxRate} longOffs=${offDur.filter((d) => d > 1).length} watched(avg per 15min, of ${watch.length} lamps): dips=${(watchedFlicks / 12).toFixed(1)} offs=${(watchedOuts / 12).toFixed(1)}`);
ok(events > 100, 'event harus tetap terjadi walau near kosong (independen dari pemain)');
ok(maxOffGlobal <= Math.floor(N * 0.1), 'maksimal 10% lampu mati bersamaan');
ok(maxRate <= 6, 'tidak ada strobo: per lampu <=6 crossing/dtk');
const longOff = offDur.filter((d) => d > 1.0); ok(longOff.length > 20 && Math.min(...longOff) >= 3 && Math.max(...longOff) <= 17, 'lampu mati sementara 3-15 dtk lalu menyala lagi');
ok(watchedFlicks / 12 > 1.5, 'lampu yang diamati harus sesekali berubah walau pemain diam');
ok(watchedOuts / 12 < 3, 'tidak semua lampu yang diamati mati (event jarang)');
console.log(fails ? `LIGHTFX: ${fails} GAGAL` : 'LIGHTFX: semua lulus'); process.exit(fails ? 1 : 0);
