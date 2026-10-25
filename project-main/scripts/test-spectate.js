// Uji STAGE 4: kamera penonton (pemilihan target, L/R, anti-tembus, haluskan, cooldown) + event world 'ping'/'shout' (validasi, tidak masuk digest).
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-spec');
const S = require(D + '/game/spectate.js'), W = require(D + '/net/worldsync.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const st = (o = {}) => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, level: 0, ...o });
const view = (id, slot, o = {}, stale = false) => ({ id, name: id.toUpperCase(), slot, stale, state: st(o) });

section('Hanya pemain "play" yang bisa ditonton');
{
  const vs = [view('c', 3), view('a', 1), view('b', 2, { cg: true }), view('d', 4, { bd: 2 }), view('e', 5, { es: true }), view('f', 6, {}, true)];
  ok(JSON.stringify(S.specIds(vs)) === '["a","c"]', 'tertangkap/bound/lolos/stale dibuang; urut slot');
  ok(S.specIds([]).length === 0 && S.specPick([], 'x') === '', 'tanpa rekan = kosong (tetap kamera penjara)');
}

section('Pilih & ganti target (L/R)');
{
  const ids = ['a', 'b', 'c'];
  ok(S.specPick(ids, 'b') === 'b', 'target valid dipertahankan');
  ok(S.specPick(ids, '') === 'a', 'awal: yang pertama');
  ok(S.specPick(['a', 'c'], 'b', ids) === 'c', 'target hilang: pindah ke berikutnya dari urutan lama');
  ok(S.specPick(['a', 'b'], 'c', ids) === 'a', 'target hilang di ujung: melingkar');
  ok(S.specCycle(ids, 'a', 1) === 'b' && S.specCycle(ids, 'c', 1) === 'a' && S.specCycle(ids, 'a', -1) === 'c' && S.specCycle(ids, 'b', -1) === 'a', 'kanan/kiri melingkar');
  ok(S.specCycle(['a'], 'a', 1) === 'a' && S.specCycle([], 'a', 1) === '', 'satu/nol rekan aman');
}

section('Pose kamera');
{
  const head = S.specHead(st({ x: 5, y: 0, z: 7, yaw: 0, crouch: false }));
  ok(near(head.y, 1.65), 'mata berdiri 1.65');
  ok(near(S.specHead(st({ crouch: true })).y, 1.0), 'mata jongkok 1.0');
  const o = S.specDir(head, 2.6, 0.45);
  ok(near(Math.hypot(o.x, o.y, o.z), 1) && o.z > 0 && o.y > 0, 'arah kamera: di belakang (yaw 0 menghadap -Z) dan naik');
  const p3 = S.specCamPose(head, o.len, 2.6, 0.45), p1 = S.specCamPose(head, 0, 2.6, 0.45);
  ok(near(p3.z, 7 + 2.6) && near(p3.y, 1.65 + 0.45) && p3.pitch < 0, 'orang ketiga: 2.6 m di belakang, sedikit menunduk');
  ok(near(p1.x, 5) && near(p1.y, 1.65) && near(p1.z, 7) && near(p1.pitch, head.pitch) && near(p1.yaw, head.yaw), 'orang pertama = mata rekan persis');
  const yawed = S.specCamPose(S.specHead(st({ yaw: Math.PI / 2 })), o.len, 2.6, 0.45);
  ok(near(yawed.x, 2.6, 1e-9) && near(yawed.z, 0, 1e-9), 'yaw 90 (depan = -X): kamera di belakang rekan, +X');
  ok(near(S.specCamPose(head, o.len / 2, 2.6, 0.45).pitch, (head.pitch + p3.pitch) / 2, 1e-9), 'transisi mode: pitch ikut mulus');
}

section('Anti-tembus');
{
  ok(near(S.clipDist(3, null, 0.25, 0.5), 3), 'bebas: jarak penuh');
  ok(near(S.clipDist(3, 5, 0.25, 0.5), 3), 'dinding jauh: penuh');
  ok(near(S.clipDist(3, 1.5, 0.25, 0.5), 1.25), 'dinding di 1.5: tarik maju sisakan pad');
  ok(near(S.clipDist(3, 0.3, 0.25, 0.5), 0.5), 'dinding sangat dekat: batas minimum');
  ok(near(S.clipDist(0.2, 0.1, 0.25, 0.5), 0.2), 'jarak diminta lebih kecil dari minimum: tidak diperbesar');
}

section('Halus (lerp) bebas frame rate');
{
  const a = { x: 0, y: 0, z: 0, yaw: 3, pitch: 0 }, b = { x: 10, y: 0, z: 0, yaw: -3, pitch: 0 };
  let p60 = a; for (let i = 0; i < 60; i++) p60 = S.smoothPose(p60, b, 1 / 60, 7);
  let p30 = a; for (let i = 0; i < 30; i++) p30 = S.smoothPose(p30, b, 1 / 30, 7);
  ok(near(p60.x, p30.x, 1e-6), 'hasil 1 dtk sama di 60 dan 30 fps');
  ok(p60.x > 9.9 && p60.x < 10, 'mendekati target tanpa melampaui');
  const q = S.smoothPose(a, b, 1 / 60, 7);
  ok(q.yaw > 3 && Math.abs(S.wrapAngle(q.yaw - 3)) < 0.2, 'yaw mengambil jalan terpendek lewat batas +-PI');
  ok(near(S.poseDist(a, b), 10), 'jarak pose');
}

section('Cooldown ping 20 dtk / teriak 30 dtk');
{
  const ping = new S.Cooldown(20), shout = new S.Cooldown(30);
  ok(ping.fire(100) && !ping.fire(110) && near(ping.left(110), 10) && !ping.ready(119.9) && ping.fire(120), 'ping: 1 per 20 dtk');
  ok(shout.fire(0) && !shout.fire(29.9) && shout.fire(30), 'teriak: 1 per 30 dtk');
  ping.reset(); ok(ping.ready(0), 'reset');
}

section('Event world ping/shout: validasi, sekali jalan');
{
  const A = new W.WorldSync(), B = new W.WorldSync();
  const m = A.local({ k: 'ping', x: 1.5, y: 2, z: -3, l: 1 });
  ok(m && m.ev.length === 1 && m.ev[0].k === 'ping', 'local mengembalikan pesan');
  ok(A.local({ k: 'ping', x: 1.5, y: 2, z: -3, l: 1 }) !== null, 'tidak dikumpulkan (dua kali = dua pesan; cooldown di sisi game)');
  const got = B.receive(m);
  ok(got.length === 1 && got[0].k === 'ping' && got[0].x === 1.5 && got[0].l === 1, 'receive meneruskan ping');
  ok(B.receive(m).length === 1, 'tidak digabung (tidak ada dedupe state)');
  ok(A.digest() === null && B.digest() === null, 'tidak masuk digest (tidak dikirim ulang ke pemain terlambat)');
  const sh = B.receive(A.local({ k: 'shout', x: 4, z: 5, l: 0 }));
  ok(sh.length === 1 && sh[0].k === 'shout' && sh[0].z === 5, 'shout diteruskan');
  const bad = [{ k: 'ping', x: NaN, y: 0, z: 0, l: 0 }, { k: 'ping', x: 1e9, y: 0, z: 0, l: 0 }, { k: 'ping', x: 1, y: 0, z: 0, l: 5 }, { k: 'ping', x: '1', y: 0, z: 0, l: 0 }, { k: 'shout', x: 1, z: 2 }, { k: 'shout', x: 1, z: Infinity, l: 0 }, { k: 'shout', z: 1, l: 0 }];
  ok(B.receive({ v: 1, t: 'w', ev: bad }).length === 0, 'koordinat/level tidak valid dibuang');
  ok(B.receive({ v: 1, t: 'w', ev: [{ k: 'ping', x: 1, y: 2, z: 3, l: 0, evil: 'x' }] })[0].evil === undefined, 'field asing dibuang');
}

console.log('\n' + passes + ' lulus, ' + fails + ' gagal');
process.exit(fails ? 1 : 0);
