// TAHAP 5 - uji penghalusan animasi (logika murni, tanpa three): penghalus bebas-frame-rate, pengikut pemain remote, fase langkah dari jarak
// (metrik foot sliding lama vs baru), dan de-jitter interpolasi jaringan. Jalankan: npm run test:anim
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-anim');
const A = require(D + '/3d/animsmooth.js'), M = require(D + '/3d/motion.js'), I = require(D + '/net/interp.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  GAGAL:', msg); } };
const section = (t) => console.log('\n== ' + t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const info = (s) => console.log('  ' + s);
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; // acak deterministik

section('damp / wrapAngle / dampAngle');
{
  // sama di 30/60/120/240 FPS (rumus lama min(1, dt*k) tidak)
  const run = (fps) => { let v = 0; const dt = 1 / fps; for (let i = 0; i < fps; i++) v += (1 - v) * A.damp(6, dt); return v; };
  const r = [30, 60, 120, 240].map(run);
  ok(r.every((x) => near(x, r[0], 1e-9)), 'damp: hasil 1 detik identik di 30/60/120/240 FPS (' + r.map((x) => x.toFixed(6)).join(', ') + ')');
  const old = (fps) => { let v = 0; const dt = 1 / fps; for (let i = 0; i < fps; i++) v += (1 - v) * Math.min(1, dt * 6); return v; };
  info(`rumus lama min(1,dt*k): 30fps=${old(30).toFixed(4)} 60fps=${old(60).toFixed(4)} 240fps=${old(240).toFixed(4)} (bergantung FPS)`);
  ok(Math.abs(old(30) - old(240)) > 0.0005, 'rumus lama memang bergantung frame rate (pembanding; selisih ' + Math.abs(old(30) - old(240)).toExponential(1) + ')');
  ok(A.damp(5, 0) === 0 && A.damp(0, 1) === 0 && A.damp(-3, 1) === 0 && A.damp(5, -1) === 0, 'damp: dt=0 / k<=0 / dt negatif aman = 0');
  ok(near(A.wrapAngle(Math.PI * 3), -Math.PI, 1e-9) || near(A.wrapAngle(Math.PI * 3), Math.PI, 1e-9), 'wrapAngle(3PI) ~ PI');
  ok(near(A.wrapAngle(0.1 + 20 * Math.PI), 0.1, 1e-9) && near(A.wrapAngle(-0.1 - 8 * Math.PI), -0.1, 1e-9), 'wrapAngle banyak putaran');
  ok(A.dampAngle(3.0, -3.0, 10, 0.016) > 3.0, 'dampAngle lewat jalur terpendek melintasi +-PI (naik dari 3.0, bukan turun 6 rad)');
  ok(near(A.dampAngle(0, 1, 10, 0), 0), 'dampAngle dt=0 tidak NaN & tidak bergerak');
  let y = 0; for (let i = 0; i < 60; i++) { const n = A.dampAngle(y, 3, 100, 1 / 60, 2); ok(n - y <= 2 / 60 + 1e-12, 'dampAngle patuh batas laju'); y = n; }
}

section('PuppetFollower: kecepatan terukur dari gerak yang digambar');
{
  const mk = () => new A.PuppetFollower();
  // target dari jaringan: lurus 2.2 m/s sepanjang +Z, dikirim 10 Hz lalu diinterpolasi linear (seperti SnapshotBuffer) -> dirender 60 FPS
  const f = mk(); let z = 0;
  let out = f.step(1 / 60, 0, 0, 0, 0); ok(f.started && out.dist === 0 && out.speed === 0, 'langkah pertama = snap di tempat, kecepatan 0');
  const speeds = [];
  for (let i = 1; i <= 240; i++) { z = 2.2 * i / 60; out = f.step(1 / 60, 0, 0, z, 0); if (i > 60) speeds.push(out.speed); }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length, mx = Math.max(...speeds), mn = Math.min(...speeds);
  ok(Math.abs(mean - 2.2) < 0.08, `kecepatan terukur ~2.2 m/s (rata-rata ${mean.toFixed(3)})`);
  ok(mx - mn < 0.15, `kecepatan stabil, tanpa riak (min ${mn.toFixed(3)} maks ${mx.toFixed(3)})`);
  ok(out.z < z && z - out.z < 0.35, `pengikut tertinggal wajar di belakang target (${(z - out.z).toFixed(3)} m)`);
  ok(near(out.yaw, 0, 0.02), 'jalan lurus +Z -> badan menghadap +Z (yaw 0)');
  // berhenti
  let t0 = null; for (let i = 0; i < 90; i++) { out = f.step(1 / 60, 0, 0, z, 0); if (t0 === null && out.speed < 0.05) t0 = i / 60; }
  ok(t0 !== null && t0 < 0.6, `berhenti: kecepatan terukur < 0.05 dalam ${t0 === null ? '>1.5' : t0.toFixed(2)} dtk (<0.6)`);
  ok(out.dist < 1e-3 && Math.abs(out.z - z) < 0.01, 'berhenti: posisi mendarat di target tanpa overshoot/getar');
  // tidak pernah mundur saat target maju monoton
  const g = mk(); g.step(1 / 60, 0, 0, 0, 0); let back = 0, zz = 0, prevz = 0;
  for (let i = 1; i <= 300; i++) { zz += (0.02 + 0.04 * rnd()) ; const o = g.step(1 / 60, 0, 0, zz, 0); if (o.z < prevz - 1e-12) back++; prevz = o.z; }
  ok(back === 0, 'target maju monoton -> pengikut tidak pernah mundur');
  // teleport
  const h = mk(); h.step(1 / 60, 0, 0, 0, 0); for (let i = 0; i < 10; i++) h.step(1 / 60, 0, 0, 0.1 * i, 0);
  const tp = h.step(1 / 60, 20, 5, 20, 1); ok(tp.snapped && tp.x === 20 && tp.z === 20 && tp.dist === 0 && tp.speed === 0, 'lompatan > 3 m (respawn/teleport) = snap, tidak meluncur, kecepatan 0');
  // input rusak
  const k = mk(); k.step(1 / 60, 1, 0, 1, 0); const before = [k.x, k.z];
  k.step(1 / 60, NaN, 0, 3, 0); k.step(1 / 60, 1, Infinity, 1, 0); k.step(0, 2, 0, 2, 0); k.step(-1, 2, 0, 2, 0);
  ok(Number.isFinite(k.x + k.y + k.z + k.yaw) && near(k.x, before[0]) && near(k.z, before[1]), 'NaN/Infinity/dt<=0 tidak merusak state');
  const big = mk(); big.step(1 / 60, 0, 0, 0, 0); const ob = big.step(5, 0, 0, 2, 0); ok(Number.isFinite(ob.x) && ob.x === 0 && ob.z <= 2 && ob.z > 0, 'dt sangat besar (tab di background) dibatasi 0.25 dtk, tidak melompat jauh');
}

section('PuppetFollower: arah badan & kepala');
{
  const f = new A.PuppetFollower(); f.step(1 / 60, 0, 0, 0, 0);
  let x = 0, o; for (let i = 0; i < 120; i++) { x += 2 / 60; o = f.step(1 / 60, x, 0, 0, 0); } // jalan ke +X, kamera menghadap +Z (strafe)
  ok(near(o.yaw, Math.PI / 2, 0.08), `badan menghadap arah jalan (+X): yaw ${o.yaw.toFixed(3)} ~ PI/2`);
  ok(Math.abs(o.look + Math.PI / 2) < 0.12 || Math.abs(o.look) <= 1.1 + 1e-9, 'kepala menoleh ke arah bidik, dibatasi +-1.1 rad');
  for (let i = 0; i < 120; i++) o = f.step(1 / 60, x, 0, 0, 0);
  const yawStill = o.yaw;
  // diam: bidik berubah kecil -> badan tidak berputar; bidik berubah jauh -> putar di tempat lalu berhenti
  for (let i = 0; i < 60; i++) o = f.step(1 / 60, x, 0, 0, yawStill + 0.5);
  ok(near(o.yaw, yawStill, 1e-9), 'diam + menoleh kecil (0.5 rad) dalam deadzone: badan tidak ikut (tanpa gemetar)');
  ok(Math.abs(o.look - 0.5) < 0.02, `kepala menoleh sendiri ke 0.5 rad (${o.look.toFixed(3)})`);
  let maxTurn = 0, turnedAt = -1;
  for (let i = 0; i < 180; i++) { o = f.step(1 / 60, x, 0, 0, yawStill + 2.0); maxTurn = Math.max(maxTurn, Math.abs(o.turn)); if (turnedAt < 0 && Math.abs(A.wrapAngle(o.yaw - (yawStill + 2.0))) < 0.15) turnedAt = i / 60; }
  ok(turnedAt > 0 && turnedAt < 1.5, `menoleh jauh (2 rad): badan putar di tempat & sampai dalam ${turnedAt.toFixed(2)} dtk`);
  ok(maxTurn <= 6.2, `laju putar badan dibatasi (maks ${maxTurn.toFixed(2)} rad/dtk)`);
  for (let i = 0; i < 60; i++) o = f.step(1 / 60, x, 0, 0, yawStill + 2.0);
  ok(Math.abs(o.turn) < 0.05, 'setelah berhenti berputar: turn -> 0');
  // histeresis: kecepatan di antara faceOff dan faceOn tidak membuat arah berkedip
  const hs = new A.PuppetFollower(); hs.step(1 / 60, 0, 0, 0, 0); let flips = 0, last = null, zz = 0;
  for (let i = 0; i < 600; i++) { zz += (0.4 + 0.1 * Math.sin(i * 0.3)) / 60; const q = hs.step(1 / 60, 0, 0, zz, 0.3); const dir = Math.abs(q.yaw) > 0.05; if (last !== null && dir !== last) flips++; last = dir; }
  ok(flips <= 4, `kecepatan lambat ~0.4 m/s dengan riak: arah badan tidak berkedip (${flips} perpindahan)`);
}

section('PuppetFollower: sama di berbagai FPS');
{
  const sim = (fps) => {
    const f = new A.PuppetFollower(); const dt = 1 / fps; f.step(dt, 0, 0, 0, 0); let o, sp = [];
    for (let i = 1; i <= fps * 3; i++) { const z = 3.0 * i * dt; o = f.step(dt, 0, 0, z, 0); if (i > fps) sp.push(o.speed); }
    return { z: o.z, sp: sp.reduce((a, b) => a + b, 0) / sp.length };
  };
  const r = [30, 60, 90, 120].map(sim);
  ok(r.every((q) => Math.abs(q.z - r[0].z) < 0.05 && Math.abs(q.sp - r[0].sp) < 0.1), 'posisi akhir & kecepatan rata-rata ~sama di 30/60/90/120 FPS: ' + r.map((q) => `${q.z.toFixed(2)}/${q.sp.toFixed(2)}`).join('  '));
}

section('Fase langkah: foot sliding lama (sinusoid) vs baru (kaki terkunci)');
{
  // Meniru Character.update(): m, r dari kecepatan; fase maju oleh JARAK/cycleLength (baru) atau rumus kecepatan lama. Kaki "menapak" = tinggi telapak < 3 mm
  // (tinggi telapak = hips.y + drop; drop dari geometri tulang). Slide = laju horizontal telapak itu di dunia (kecepatan root + gerak relatif root).
  const body = { thigh: 0.4, shin: 0.4, armDown: [0.8, 0.8], foreFwd: [0.5, 0.5] };
  const geo = (p) => {
    const o = M.computePose(body, p);
    const mk = (L) => { const th1 = -o.rot['leg' + L][0], bend = o.rot['shin' + L][0], th2 = th1 - bend;
      return { th1, bend, fz: body.thigh * Math.sin(th1) + body.shin * Math.sin(th2), drop: body.thigh * (1 - Math.cos(th1)) + body.shin * (1 - Math.cos(th2)) }; };
    const L = mk('L'), R = mk('R'); L.h = o.hips[1] + L.drop; R.h = o.hips[1] + R.drop;
    return { o, L, R };
  };
  const sim = (v, cd, ik, secs = 8) => {
    M.gait.ik = ik;
    const dt = 1 / 60, vEff = Math.max(0, v - 0.05), m = Math.min(1, vEff / 1.1), r = M.smooth((vEff - 1.6) / 1.2);
    let phase = 0, prev = null, sum = 0, n = 0, sumAbs = 0, contactFrames = 0, frames = 0, minBend = 9, maxHipY = -9, minHipY = 9, maxStep = 0, pj = null;
    for (let i = 0; i < 60 * secs; i++) {
      if (!ik && false) {}
      if (ik) phase += Math.PI * 2 * (v * dt) / M.cycleLength(body, m, r, cd);
      else { const vv = Math.max(0, v); const cyc = vv > 0.03 ? Math.max(0.4, vv / (1.5 + M.smooth((vv - 1.6) / 1.2))) : 0; phase += dt * Math.PI * 2 * cyc; }
      const pm = ik ? { m, r } : { m: Math.min(1, v / 1.1), r: M.smooth((v - 1.6) / 1.2) };
      const g = geo({ t: i * dt, seed: 0, phase, gait: pm.m, run: pm.r, crouch: cd, air: 0, armsUp: 0, lookY: 0, lift: 0 });
      if (i > 60) { minBend = Math.min(minBend, g.L.bend, g.R.bend); maxHipY = Math.max(maxHipY, g.o.hips[1]); minHipY = Math.min(minHipY, g.o.hips[1]); }
      const cur = { L: g.L.h < 0.003 ? zr(g, 'L') : null, R: g.R.h < 0.003 ? zr(g, 'R') : null };
      frames++;
      if (prev && i > 60) for (const k of ['L', 'R']) if (cur[k] !== null && prev[k] !== null) { const fv = v + (cur[k] - prev[k]) / dt; sum += fv * fv; sumAbs += Math.abs(fv); n++; }
      if (cur.L !== null || cur.R !== null) contactFrames++;
      const jn = [g.L.th1, g.L.bend, g.R.th1, g.R.bend];
      if (pj && i > 60) maxStep = Math.max(maxStep, ...jn.map((q, j) => Math.abs(q - pj[j])));
      pj = jn; prev = cur;
    }
    return { rms: n ? Math.sqrt(sum / n) : 0, rel: n ? sumAbs / n / Math.max(v, 0.3) : 0, n, minBend, hipRange: maxHipY - minHipY, maxStep, contact: contactFrames / frames };
  };
  const zr = (g, k) => g.o.hips[2] + g[k].fz;
  const rows = [];
  for (const [v, cd] of [[0.6, 0], [1.1, 0], [1.1, 0.55], [1.6, 0], [2.2, 0], [3.0, 0], [4.0, 0]]) {
    const o = sim(v, cd, false), nw = sim(v, cd, true);
    rows.push({ v, cd, o, nw });
    info(`v=${v.toFixed(1)} crouch=${cd}: slide kaki menapak  lama ${(o.rel * 100).toFixed(0)}% (n=${o.n})  ->  baru ${(nw.rel * 100).toFixed(1)}% (rms ${nw.rms.toFixed(3)} m/dtk, n=${nw.n}) | lutut min ${nw.minBend.toFixed(2)} rad | gelombang pinggul ${(nw.hipRange * 100).toFixed(1)} cm | loncatan sendi maks/frame ${nw.maxStep.toFixed(3)} rad`);
  }
  M.gait.ik = true;
  const avgOld = rows.reduce((a, q) => a + q.o.rel, 0) / rows.length, avgNew = rows.reduce((a, q) => a + q.nw.rel, 0) / rows.length;
  info(`rata-rata slide relatif terhadap kecepatan: lama ${(avgOld * 100).toFixed(1)}%  baru ${(avgNew * 100).toFixed(1)}%`);
  ok(rows.every((q) => q.nw.n > 30), 'ada cukup frame menapak untuk diukur di tiap kecepatan');
  ok(rows.every((q) => q.nw.rel < 0.06), 'slide kaki menapak < 6% kecepatan di SEMUA kecepatan uji (jalan, lari, jongkok)');
  ok(rows.every((q) => q.nw.rel < q.o.rel), 'slide baru lebih kecil dari lama di setiap kecepatan uji');
  ok(rows.every((q) => q.nw.minBend > -1e-6), 'lutut tidak pernah menekuk ke belakang (bend >= 0)');
  ok(rows.every((q) => q.nw.maxStep < 0.30), 'tidak ada loncatan sudut sendi antar-frame (patah) pada 60 FPS: maks ' + Math.max(...rows.map((q) => q.nw.maxStep)).toFixed(3) + ' rad');
  ok(rows.every((q) => q.nw.hipRange < 0.09), 'gelombang tinggi pinggul wajar (< 9 cm)');
  // transisi diam -> jalan -> lari -> berhenti: jarak tempuh memajukan fase; tidak ada loncatan pose
  {
    const dt = 1 / 60; let phase = 0, v = 0, prevPose = null, worst = 0, sp = [];
    const prof = (t) => (t < 1 ? 0 : t < 3 ? 1.25 : t < 5 ? 4.0 : t < 7 ? 1.25 : 0);
    for (let i = 0; i < 60 * 9; i++) {
      const t = i * dt; v += (prof(t) - v) * A.damp(prof(t) > v ? 4.5 : 7.5, dt);
      const vEff = Math.max(0, v - 0.05), m = Math.min(1, vEff / 1.1), r = M.smooth((vEff - 1.6) / 1.2);
      phase += Math.PI * 2 * (v * dt) / M.cycleLength(body, m, r, 0);
      const o = M.computePose(body, { t, seed: 0, phase, gait: m, run: r, crouch: 0, air: 0, armsUp: 0, lookY: 0, lift: 0 });
      const flat = Object.values(o.rot).flat().concat(o.hips);
      if (prevPose) for (let j = 0; j < flat.length; j++) worst = Math.max(worst, Math.abs(flat[j] - prevPose[j]));
      prevPose = flat; sp.push(v);
    }
    ok(worst < 0.35, `idle->jalan->lari->jalan->berhenti: perubahan nilai pose terbesar antar-frame ${worst.toFixed(3)} (< 0.35; tidak ada pose yang melompat)`);
  }
  // pose diam identik dengan pose berdiri lama (tidak ada pergeseran saat idle)
  {
    const base = { t: 0, seed: 0, phase: 0, gait: 0, run: 0, crouch: 0, air: 0, armsUp: 0, lookY: 0, lift: 0 };
    M.gait.ik = true; const a = M.computePose(body, base); M.gait.ik = false; const b = M.computePose(body, base); M.gait.ik = true;
    const dl = Math.max(...['legL', 'shinL', 'legR', 'shinR'].map((k) => Math.abs(a.rot[k][0] - b.rot[k][0])));
    ok(dl < 1e-9 && Math.abs(a.hips[1] - b.hips[1]) < 1e-9 && Math.abs(a.hips[2] - b.hips[2]) < 1e-9, 'diam (m=0, tanpa jongkok): pose kaki & pinggul identik dengan versi lama');
    for (let ph = 0; ph < 6.3; ph += 0.7) { const q = M.computePose(body, { ...base, phase: ph }); ok(Math.abs(q.rot.legL[0]) < 1e-9 && Math.abs(q.rot.shinL[0]) < 1e-9, 'diam: pose tidak bergantung pada fase (' + ph.toFixed(1) + ')'); }
  }
  // jongkok & lompat: pose terbatas & tanpa NaN
  {
    let bad = 0, maxBend = 0;
    for (const cd of [0, 0.3, 0.55, 0.85, 1]) for (const air of [0, 0.5, 1]) for (const m of [0, 0.5, 1]) for (const r of [0, 1]) for (let ph = 0; ph < 6.3; ph += 0.4) {
      const o = M.computePose(body, { t: 1, seed: 0, phase: ph, gait: m, run: r, crouch: cd, air, armsUp: 0, lookY: 0, lift: 0 });
      const flat = Object.values(o.rot).flat().concat(o.hips); if (flat.some((q) => !Number.isFinite(q))) bad++;
      maxBend = Math.max(maxBend, Math.abs(o.rot.shinL[0]), Math.abs(o.rot.shinR[0]));
    }
    ok(bad === 0, 'semua kombinasi jongkok/lompat/gait/lari/fase menghasilkan pose berhingga (tanpa NaN)');
    M.gait.ik = false; let oldMax = 0; for (const cd of [0, 0.3, 0.55, 0.85, 1]) for (const air of [0, 0.5, 1]) for (const m of [0, 0.5, 1]) for (const r of [0, 1]) for (let ph = 0; ph < 6.3; ph += 0.4) { const o = M.computePose(body, { t: 1, seed: 0, phase: ph, gait: m, run: r, crouch: cd, air, armsUp: 0, lookY: 0, lift: 0 }); oldMax = Math.max(oldMax, Math.abs(o.rot.shinL[0]), Math.abs(o.rot.shinR[0])); } M.gait.ik = true;
    ok(maxBend <= oldMax + 1e-9, `tekukan lutut maksimum tidak melebihi versi lama (${maxBend.toFixed(2)} vs ${oldMax.toFixed(2)} rad, kombinasi ekstrem)`);
  }
  // kadens
  const cad = []; for (let v = 0.3; v <= 4.01; v += 0.1) { const vEff = Math.max(0, v - 0.05), m = Math.min(1, vEff / 1.1), r = M.smooth((vEff - 1.6) / 1.2); cad.push(2 * v / M.cycleLength(body, m, r, 0)); }
  ok(cad.every((c) => c > 0.3 && c < 5), `kadens (langkah/dtk) 0.1..4 m/dtk dalam rentang wajar: ${Math.min(...cad).toFixed(2)}..${Math.max(...cad).toFixed(2)}`);
  let maxJump = 0; for (let i = 1; i < cad.length; i++) maxJump = Math.max(maxJump, Math.abs(cad[i] - cad[i - 1]));
  ok(maxJump < 0.9, `kadens berubah halus antar kecepatan (loncatan maks ${maxJump.toFixed(2)} langkah/dtk per 0.1 m/dtk)`);
  info(`kadens pada 1.25 m/dtk (jalan lobi): ${(2 * 1.25 / M.cycleLength(body, 1, 0, 0)).toFixed(2)} langkah/dtk; 2.2 (jalan game): ${(2 * 2.2 / M.cycleLength(body, 1, M.smooth((2.15 - 1.6) / 1.2), 0)).toFixed(2)}; 4.0 (lari): ${(2 * 4 / M.cycleLength(body, 1, 1, 0)).toFixed(2)}`);
  ok(M.cycleLength(body, 0, 0, 0) >= 0.15 && Number.isFinite(M.cycleLength(body, 0, 0, 0)), 'cycleLength tidak nol/NaN saat diam (tanpa pembagian nol)');
}

section('computePose: belok (turn) opsional & kompatibel');
{
  const body = { thigh: 0.4, shin: 0.4, armDown: [0.8, 0.8], foreFwd: [0.5, 0.5] };
  const base = { t: 1, seed: 0, phase: 1, gait: 1, run: 0.4, crouch: 0, air: 0, armsUp: 0, lookY: 0, lift: 0 };
  const a = M.computePose(body, base), b = M.computePose(body, { ...base, turn: 0 }), c = M.computePose(body, { ...base, turn: 2 }), d = M.computePose(body, { ...base, turn: 99 }), e = M.computePose(body, { ...base, turn: -2 });
  ok(JSON.stringify(a) === JSON.stringify(b), 'tanpa turn = turn 0 (kompatibel dengan pemanggil lama)');
  ok(c.rot.chest[2] < a.rot.chest[2] && e.rot.chest[2] > a.rot.chest[2], 'belok kiri/kanan: dada condong berlawanan arah');
  ok(Math.abs(d.rot.chest[2] - a.rot.chest[2]) <= 0.035 * 3 + 1e-9 && Math.abs(d.rot.head[1] - a.rot.head[1]) <= 0.05 * 3 + 1e-9, 'turn ekstrem dipangkas (batas +-3 rad/dtk)');
  ok(M.computePose(body, { ...base, gait: 0, turn: 3 }).rot.chest[2] === M.computePose(body, { ...base, gait: 0 }).rot.chest[2], 'diam (gait 0): tidak condong walau turn besar');
}

section('SnapshotBuffer: de-jitter waktu terima');
{
  const st = (i, z) => ({ v: 1, ep: 1, seq: i, x: 0, y: 0, z, yaw: 0, pitch: 0, gait: 1, crouch: false, hide: false, level: 0, model: 'default' });
  const run = (dejitter, jit) => {
    seed = 777; const b = new I.SnapshotBuffer(24, dejitter), V = 2.2, vs = [];
    // pengirim: tiap 100 ms; penerima: waktu terima = kirim + base + jitter acak (paket tak pernah tiba mendahului paket sebelumnya)
    const pk = []; let lastArr = 0;
    for (let i = 0; i < 80; i++) { const send = i * 100; let arr = send + 50 + rnd() * jit; if (arr < lastArr) arr = lastArr; lastArr = arr; pk.push({ arr, z: V * send / 1000, i }); }
    let pi = 0, prevZ = null, back = 0, extrap = 0;
    for (let now = 0; now < 7000; now += 1000 / 60) {
      while (pi < pk.length && pk[pi].arr <= now) { b.push(st(pk[pi].i, pk[pi].z), pk[pi].arr); pi++; }
      const s = b.sample(now); if (!s) continue;
      if (prevZ !== null && now > 1500) { const v = (s.z - prevZ) / (1 / 60); vs.push(v); if (v < -1e-9) back++; }
      prevZ = s.z;
    }
    const mean = vs.reduce((a, x) => a + x, 0) / vs.length, sd = Math.sqrt(vs.reduce((a, x) => a + (x - mean) ** 2, 0) / vs.length);
    return { mean, sd, cv: sd / mean, back, min: Math.min(...vs), max: Math.max(...vs) };
  };
  for (const jit of [0, 30, 60, 90]) {
    const o = run(false, jit), n = run(true, jit);
    info(`jitter jaringan 0..${jit} ms: variasi kecepatan render (CV) lama ${(o.cv * 100).toFixed(1)}%  baru ${(n.cv * 100).toFixed(1)}%   | min/maks baru ${n.min.toFixed(2)}/${n.max.toFixed(2)} m/dtk | langkah mundur lama ${o.back} baru ${n.back}`);
    if (jit === 0) ok(near(n.cv, o.cv, 0.02) && n.back === 0, 'tanpa jitter: perilaku tidak berubah (de-jitter netral)');
    if (jit >= 30) ok(n.cv < o.cv, `jitter ${jit} ms: kecepatan render lebih rata dari sebelumnya`);
    ok(n.back === 0, `jitter ${jit} ms: tidak ada langkah mundur pada render`);
    ok(Math.abs(n.mean - 2.2) < 0.15, `jitter ${jit} ms: kecepatan rata-rata tetap ~2.2 m/dtk (${n.mean.toFixed(2)}) - tidak melambat/mempercepat`);
  }
  // berhenti lalu keepalive 1 dtk: waktu terima apa adanya, tidak ada drift
  const b = new I.SnapshotBuffer(); b.push(st(1, 0), 0); b.push(st(2, 1), 100); b.push(st(3, 1), 1100); b.push(st(4, 1), 2100);
  ok(near(b.sample(2100 + I.INTERP_DELAY_MS).z, 1, 1e-9), 'keepalive 1 dtk: posisi tetap, tidak meluncur');
  // push berurutan memberi waktu menaik ketat
  const c = new I.SnapshotBuffer(); for (let i = 0; i < 30; i++) c.push(st(i, i), 1000 + i * 10); ok(c.size === 24, 'kapasitas buffer tetap dihormati');
  ok(I.INTERP_DELAY_MS >= 100 && I.INTERP_DELAY_MS <= 200, `INTERP_DELAY_MS wajar (${I.INTERP_DELAY_MS} ms)`);
}

console.log(`\n${fails ? 'GAGAL' : 'LULUS'}: ${passes} cek lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
