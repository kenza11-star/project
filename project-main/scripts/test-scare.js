// Uji jumpscare SCP-106: pemilihan locker pemicu, pose tulang (skeleton GLB asli), timeline, efek slow+blur, dan keterhubungan ke event buka locker asli.
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const S = require(G + '/scp106.js'), F = require(G + '/scarefx.js'), { makeRng } = require(G + '/rng.js'), cfg = require(G + '/config.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

section('Pemilihan locker pemicu');
{
  const o = { min: cfg.SCARE_PICK_MIN, frac: cfg.SCARE_PICK_FRAC, max: cfg.SCARE_PICK_MAX };
  const ids = Array.from({ length: 70 }, (_, i) => 'L' + i);
  const a = S.pickScareLockers(ids, makeRng(1), o), b = S.pickScareLockers(ids, makeRng(1), o), c = S.pickScareLockers(ids, makeRng(2), o);
  console.log('  70 kandidat ->', a.length, 'pemicu');
  ok(a.length >= 5 && a.length < 70 && a.length <= cfg.SCARE_PICK_MAX, 'minimal 5, tidak semua, di bawah batas atas');
  ok(new Set(a).size === a.length && a.every((x) => ids.includes(x)), 'tanpa duplikat & hanya dari kandidat');
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'acak per seed, reproducible untuk seed sama');
  let diff = new Set(); for (let s = 0; s < 200; s++) S.pickScareLockers(ids, makeRng(s), o).forEach((x) => diff.add(x));
  ok(diff.size > 60, 'sebaran acak mencakup hampir semua locker lintas seed (' + diff.size + '/70)');
  ok(S.pickScareLockers(ids.slice(0, 6), makeRng(3), o).length === 5, '6 kandidat -> 5 pemicu, 1 normal');
  ok(S.pickScareLockers(ids.slice(0, 3), makeRng(3), o).length === 2, '3 kandidat -> sisakan 1 normal');
  ok(S.pickScareLockers(['x'], makeRng(3), o).length === 0 && S.pickScareLockers([], makeRng(3), o).length === 0, '0-1 kandidat -> tidak ada pemicu');
  ok(S.pickScareLockers(['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], makeRng(4), o).length === 5, 'duplikat id dihitung satu');
}

section('Skeleton & pose SCP-106 (GLB asli)');
const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'models', 'scp-106.glb')), jl = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
ok(!j.animations || j.animations.length === 0, 'GLB tidak punya animasi bawaan (gerak dari transformasi tulang)');
const joints = j.skins[0].joints, N = j.nodes, par = {}; N.forEach((n, i) => (n.children || []).forEach((c) => { par[c] = i; }));
const names = new Set(joints.map((i) => N[i].name));
ok(S.REQUIRED_BONES.every((n) => names.has(n)), 'semua tulang yang dipakai pose ada di skeleton');
// matriks: komposisi node (TRS), FK untuk posisi tangan
const mulM = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const comp = (t, q, s) => { const [x, y, z, w] = q; return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1]; };
const localOf = (i, q) => { const n = N[i]; if (n.matrix) return n.matrix.slice(); return comp(n.translation || [0, 0, 0], q || n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]); };
const rootJ = joints[0], jIdx = new Map(joints.map((i, k) => [i, k]));
const chain = []; for (let p = par[rootJ]; p !== undefined; p = par[p]) chain.unshift(p);
let rootM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; for (const p of chain) rootM = mulM(rootM, localOf(p));
// rootQ dari matriks induk akar (rotasi murni, skala seragam dibuang)
const rq = (m) => { const s = Math.hypot(m[0], m[1], m[2]), r = m.map((v, i) => (i < 12 ? v / s : v)); const t = r[0] + r[5] + r[10]; let x, y, z, w; if (t > 0) { const k = Math.sqrt(t + 1) * 2; w = k / 4; x = (r[6] - r[9]) / k; y = (r[8] - r[2]) / k; z = (r[1] - r[4]) / k; } else if (r[0] > r[5] && r[0] > r[10]) { const k = Math.sqrt(1 + r[0] - r[5] - r[10]) * 2; w = (r[6] - r[9]) / k; x = k / 4; y = (r[4] + r[1]) / k; z = (r[8] + r[2]) / k; } else if (r[5] > r[10]) { const k = Math.sqrt(1 + r[5] - r[0] - r[10]) * 2; w = (r[8] - r[2]) / k; x = (r[4] + r[1]) / k; y = k / 4; z = (r[9] + r[6]) / k; } else { const k = Math.sqrt(1 + r[10] - r[0] - r[5]) * 2; w = (r[1] - r[4]) / k; x = (r[8] + r[2]) / k; y = (r[9] + r[6]) / k; z = k / 4; } return [x, y, z, w]; };
const rest = joints.map((i) => { const p = par[i], pk = jIdx.has(p) ? jIdx.get(p) : -1; const b = { name: N[i].name, parent: pk, q: N[i].rotation || [0, 0, 0, 1] }; if (pk < 0) b.rootQ = rq(rootM); return b; });
ok(rest.every((b, i) => b.parent < i), 'urutan tulang induk-sebelum-anak');
const fk = (qs) => { const W = []; joints.forEach((i, k) => { const L = localOf(i, qs[k]); const pm = rest[k].parent < 0 ? rootM : W[rest[k].parent]; W[k] = mulM(pm, L); }); const pos = (n) => { const k = joints.findIndex((i) => N[i].name === n); return [W[k][12], W[k][13], W[k][14]]; }; return pos; };
const P = (o) => S.solvePose(rest, S.hugOps(Object.assign({ open: 0, hug: 0, lean: 0, head: 0, claw: 0, shake: 0, t: 0 }, o)));
const rp = fk(rest.map((b) => b.q)), p0 = fk(P({}));
const wristA = S.BONE.fingersA[0], wristB = S.BONE.fingersB[0];
ok(S.solvePose(rest, []).every((q, i) => q === rest[i].q), 'tanpa op = pose istirahat persis');
for (const k of [wristA, wristB, S.BONE.head]) ok(Math.hypot(...rp(k).map((v, i) => v - p0(k)[i])) < 1e-6, 'FK pose netral = pose istirahat: ' + k.slice(0, 9));
const h0 = rp(wristA), shoulder = rp(S.BONE.shoulderA);
console.log('  istirahat: bahu', shoulder.map((v) => v.toFixed(2)).join(','), 'tangan', h0.map((v) => v.toFixed(2)).join(','));
ok(h0[1] < shoulder[1] - 1.2, 'pose istirahat bawaan = lengan menggantung (bukan T-pose)');
const full = fk(P({ open: 1, lean: 1, head: 1, claw: 1 })), hugd = fk(P({ open: 1, hug: 1, lean: 1, head: 1, claw: 1 }));
for (const [w, sh, sg] of [[wristA, S.BONE.shoulderA, 1], [wristB, S.BONE.shoulderB, -1]]) {
  const h = full(w), s = full(sh), hh = hugd(w);
  console.log('  terbuka: tangan', h.map((v) => v.toFixed(2)).join(','), '| memeluk:', hh.map((v) => v.toFixed(2)).join(','));
  ok(h[2] - s[2] > 1.3, 'lengan terentang ke DEPAN (+z) bukan ke samping (bukan T-pose) sisi ' + sg);
  ok(Math.abs(h[1] - s[1]) < 1.6 && h[1] > 3.2, 'tangan setinggi dada/bahu');
  ok(sg * h[0] > sg * s[0] && sg * h[0] < 2.0, 'terbuka keluar tetapi tidak selebar T-pose (' + h[0].toFixed(2) + ')');
  ok(Math.abs(hh[0]) < Math.abs(h[0]) - 0.15, 'fase memeluk: tangan menutup ke tengah');
}
ok(full(S.BONE.head)[2] > p0(S.BONE.head)[2] + 0.3, 'badan & kepala condong ke arah pemain');

section('Timeline jumpscare');
{
  const dur = cfg.SCARE_DURATION, L = 1.0;
  const f = (t) => S.scpFrame(t, dur, L);
  ok(!f(-0.01).visible && !f(dur).visible && !f(dur + 1).visible, 'tidak terlihat sebelum mulai & sesudah selesai (langsung hilang)');
  ok(f(0).visible && f(dur - 0.001).visible, 'terlihat seketika saat mulai sampai tepat sebelum selesai');
  let prev = -1, mono = true, bounded = true, finite = true;
  for (let t = 0; t < dur; t += 1 / 120) { const q = f(t); if (q.fwd < prev - 1e-9) mono = false; prev = q.fwd; if (q.fwd > L + 0.25) bounded = false; if (![q.fwd, q.lift, q.side, q.scale, q.pose.open, q.pose.hug].every(Number.isFinite)) finite = false; }
  ok(mono && bounded && finite, 'gerak maju monoton, terbatas (<= lunge+0.25 m), tanpa NaN');
  ok(f(0).fwd === 0 && f(0.05).pose.open < 0.2 && f(0.5).pose.open > 0.99 && f(1.2).pose.hug > 0.95, 'muncul di dalam locker -> menerjang membuka lengan -> memeluk');
  ok(S.scpLunge(0.3) === 0 && S.scpLunge(5) === 1.1 && Math.abs(S.scpLunge(1.5) - 0.8) < 1e-9, 'jarak terjang menjaga >= 0,7 m dari kamera');
  const y = S.scpYaw(0, 0, 0, 0, 5, 0.5), y2 = S.scpYaw(0, 0, 0, 5, 0, 0.5), y3 = S.scpYaw(0, 0, 0, 1, 5, 0.5);
  ok(Math.abs(y) < 1e-9 && Math.abs(y2 - 0.5) < 1e-9 && y3 > 0 && y3 < 0.5, 'yaw menghadap pemain, dibatasi agar keluar lewat bukaan locker');
}

section('Efek slow + blur');
{
  const mk = () => new F.ScareFx({ slowSeconds: cfg.SCARE_SLOW_SECONDS, slowMul: cfg.SCARE_SLOW_MUL, blurPx: cfg.SCARE_BLUR_PX, blurIn: cfg.SCARE_BLUR_IN, blurOut: cfg.SCARE_BLUR_OUT });
  const fx = mk(); const dt = 1 / 60;
  ok(fx.update(dt).speed === 1 && fx.update(dt).blur === 0 && !fx.active, 'tanpa trigger: kecepatan 1, tanpa blur');
  ok(fx.trigger() === true, 'trigger diterima');
  let slow = 0, t = 0, maxBlur = 0, speeds = new Set(), lastBlur = 0, smooth = true, endedAt = -1, afterSlowBlurs = [];
  for (let i = 0; i < 400; i++) {
    const o = fx.update(dt); t += dt;
    if (o.speed < 1) { slow += dt; speeds.add(o.speed); }
    maxBlur = Math.max(maxBlur, o.blur);
    if (t > cfg.SCARE_SLOW_SECONDS) { afterSlowBlurs.push(o.blur); if (Math.abs(o.blur - lastBlur) > cfg.SCARE_BLUR_PX * 0.12) smooth = false; }
    lastBlur = o.blur;
    if (!o.active && endedAt < 0) { endedAt = t; break; }
  }
  console.log(`  slow selama ${slow.toFixed(3)} dtk, blur puncak ${maxBlur.toFixed(2)}px, selesai di ${endedAt.toFixed(2)} dtk`);
  ok(Math.abs(slow - cfg.SCARE_SLOW_SECONDS) <= dt * 1.5, 'slow berlangsung TEPAT 1,5 dtk');
  ok(speeds.size === 1 && [...speeds][0] === cfg.SCARE_SLOW_MUL, 'kecepatan konstan selama slow');
  ok(maxBlur > 0 && maxBlur <= cfg.SCARE_BLUR_PX + 1e-9, 'blur terjadi & terbatas');
  ok(smooth && afterSlowBlurs.length > 20, 'blur pulih halus (tanpa lompatan) setelah efek');
  ok(fx.update(dt).speed === 1 && fx.update(dt).blur === 0 && !fx.active, 'sesudah selesai: kecepatan & penglihatan kembali normal persis');
  // tidak bertumpuk
  const f2 = mk(); f2.trigger(); for (let i = 0; i < 30; i++) f2.update(dt);
  ok(f2.trigger() === false && f2.rejected === 1, 'trigger saat efek aktif ditolak (tidak bertumpuk)');
  let m = 1, b = 0; for (let i = 0; i < 400; i++) { const o = f2.update(dt); m = Math.min(m, o.speed); b = Math.max(b, o.blur); }
  ok(m === cfg.SCARE_SLOW_MUL && b <= cfg.SCARE_BLUR_PX + 1e-9, 'kecepatan tidak pernah lebih lambat dari satu efek, blur tidak lebih kuat');
  ok(f2.trigger() === true, 'setelah selesai efek bisa dipicu lagi');
  f2.update(dt); f2.reset(); const o = f2.update(dt);
  ok(!f2.active && o.speed === 1 && o.blur === 0, 'reset (restart/unmount) membersihkan semuanya');
  ok(F.combineSpeed(0.45, 0.35) === 0.35 && F.combineSpeed(1, 1) === 1 && F.combineBlur(11, 5) === 11, 'dengan efek opening: ambil yang terkuat, tidak ditumpuk');
  const pz = mk(); pz.trigger(); for (let i = 0; i < 100; i++) pz.update(0); ok(pz.active && pz.update(0).speed === cfg.SCARE_SLOW_MUL, 'dt=0 (game dijeda) tidak memajukan timer');
}

section('Keterhubungan ke game asli (source)');
{
  const W = fs.readFileSync(path.join(__dirname, '..', 'lib', 'game', 'world.ts'), 'utf8'), P = fs.readFileSync(path.join(__dirname, '..', 'components', 'lobby', 'PlayScene.tsx'), 'utf8');
  const tg = W.slice(W.indexOf('private toggleContainer'), W.indexOf('private toggleContainer') + 1400);
  ok(/this\.maybeLockerScare\(rt\)/.test(tg), 'dipicu dari toggleContainer (event buka container yang dipakai game)');
  ok((W.match(/maybeLockerScare\(/g) || []).length === 2 && (W.match(/fireLockerScare\(/g) || []).length === 2, 'satu-satunya jalur pemicu: maybeLockerScare -> fireLockerScare');
  ok(/maybeLockerScare\(rt: ContainerRT\) \{\s*if \(!this\.scp \|\| this\.scarePending \|\| this\.scpRt \|\| this\.hr \|\| !this\.isWardrobe\(rt\)\) return;/.test(W), 'hanya locker/lemari (isWardrobe), tidak saat bersembunyi / saat scare lain aktif');
  ok(/scareSet\.has\(key\)/.test(W) && /scareUsed\.add\(key\)/.test(W), 'hanya lokasi terpilih & sekali per lokasi');
  ok(/pickScareLockers\(elig/.test(W) && /this\.scareUsed\.clear\(\)/.test(W), 'lokasi diacak saat generate run (awal sesi) & state bersih tiap run');
  ok(/scene\.remove\(s\.root\)/.test(W) && /this\.endScp\(\)/.test(W), 'SCP dilepas dari scene saat selesai / reset / dispose');
  ok(/onScare = \(\) => \{ scareFx\.trigger\(\)/.test(P) && /combineSpeed\(wk \? wk\.speed : 1, sf\.speed\)/.test(P), 'PlayScene: efek dipicu event SCP & kecepatan dikombinasi tanpa menumpuk');
  ok(/scareFx\.reset\(\); canvas\.style\.filter = ''/.test(P), 'cleanup unmount membersihkan efek');
  ok(!/almond/i.test(W + P), 'tidak ada sisa Almond Water di kode game');
}
console.log(`\nSCARE: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
