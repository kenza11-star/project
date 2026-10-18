// Uji logika murni jalur cadangan room (lib/net/roomview.ts): daftar anggota, online/offline, kursi, kursor event dunia.
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-fallback');
const V = require(D + '/net/roomview.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const now = Date.parse('2026-10-13T10:00:00Z');
const ago = (s) => new Date(now - s * 1000).toISOString();
const room = { id: 'r1', code: 'EBH3EW', status: 'waiting', host_id: 'host', max_players: 2, seed: '123' };

console.log('== buildView (ruang tunggu)');
{
  const rows = [
    { user_id: 'join', slot: 1, last_seen: ago(2), left_at: null, profiles: { display_name: 'ramzz' } },
    { user_id: 'host', slot: 0, last_seen: ago(1), left_at: null, profiles: [{ display_name: 'kyraa' }] },
  ];
  const v = V.buildView(room, rows, now);
  ok(v.members.length === 2 && v.members[0].id === 'host' && v.members[1].id === 'join', 'host & pemain masuk tampil, urut slot');
  ok(v.members[0].host === true && v.members[1].host === false, 'penanda host benar');
  ok(v.members.every((m) => m.online), 'keduanya online -> 2/2');
  ok(v.members[0].name === 'kyraa' && v.members[1].name === 'ramzz', 'nama dari profil (objek maupun array)');
  ok(v.max_players === 2 && v.seed === 123 && v.active === true, 'tipe angka & active');
}
console.log('== online/kursi ruang tunggu vs bermain');
{
  const rows = [{ user_id: 'a', slot: 0, last_seen: ago(60), left_at: null, profiles: { display_name: 'a' } }];
  ok(V.buildView({ ...room, status: 'waiting' }, rows, now).members[0].online === true, 'waiting: 60 dtk masih online (<90)');
  ok(V.buildView({ ...room, status: 'playing' }, rows, now).members[0].online === false, 'playing: 60 dtk offline (>30)');
  const old = [{ user_id: 'a', slot: 0, last_seen: ago(200), left_at: null, profiles: null }];
  ok(V.buildView({ ...room, status: 'waiting' }, old, now).members.length === 1 && !V.buildView({ ...room, status: 'waiting' }, old, now).members[0].online, 'waiting: 200 dtk masih pegang kursi, offline');
  ok(V.buildView({ ...room, status: 'playing' }, old, now).members.length === 0, 'playing: 200 dtk kursi lepas');
  ok(V.buildView(room, old, now).members[0].name === 'Player', 'nama default bila profil kosong');
  const left = [{ user_id: 'a', slot: 0, last_seen: ago(1), left_at: ago(1), profiles: null }];
  ok(V.buildView(room, left, now).members.length === 0, 'anggota yang sudah keluar tidak tampil');
}
console.log('== pickWorld (kursor event)');
{
  const rows = [1, 2, 3, 4].map((i) => ({ id: String(i), user_id: i % 2 ? 'x' : 'me', msg: { i } }));
  const a = V.pickWorld(rows, 4, 1, 'me');
  ok(a.world.map((w) => w.id).join() === '3' && a.cursor === 3, 'hanya event orang lain setelah since; kursor = id terakhir dikirim');
  const b = V.pickWorld(rows, 4, 3, 'me');
  ok(b.world.length === 0 && b.cursor === 4, 'tanpa event baru: kursor maju ke id terbesar room');
  const big = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, user_id: 'x', msg: i }));
  const c = V.pickWorld(big, 200, -1, 'me');
  ok(c.world[0].id === 141 && c.world.length === 60 && c.cursor === 200, 'since<0: hanya ekor 60 event terakhir');
  ok(V.pickWorld([], 0, NaN, 'me').cursor === 0, 'since tidak valid aman');
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
