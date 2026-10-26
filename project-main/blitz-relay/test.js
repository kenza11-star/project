// Uji relay: alur host + pemain masuk, kapasitas, start, sync posisi/event, reconnect, keamanan dasar. Jalankan: node test.js
const { createApp } = require('./server.js');
let fails = 0, passes = 0; const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
let T = 1e9; const now = () => T;
const verify = async (tok) => { if (!tok.startsWith('tok_')) throw new Error('bad'); const [, uid, name] = tok.split('_'); return { uid, name }; };
const tk = (uid, name) => `tok_${uid}_${name}_` + 'x'.repeat(20);
(async () => {
  const srv = createApp({ verify, now }); await new Promise((r) => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (who, method, path, body) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + tk(...who) } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
  const H = ['hostuid', 'kyraa'], J = ['joinuid', 'ramzz'], K = ['thirduid', 'third'];

  console.log('== auth & dasar');
  ok((await call(null, 'POST', '/api/rooms', { maxPlayers: 2 })).s === 401, 'tanpa token ditolak');
  ok((await fetch(base + '/health')).status === 200, 'health ok');
  ok((await fetch(base + '/api/rooms', { method: 'OPTIONS' })).status === 204, 'CORS preflight');
  ok((await call(H, 'POST', '/api/rooms', { maxPlayers: 9 })).j.error.code === 'invalid', 'max pemain tidak valid');

  console.log('== host buat, pemain masuk, host MELIHAT pemain (bug utama)');
  const c = await call(H, 'POST', '/api/rooms', { maxPlayers: 2 }); const room = c.j;
  ok(c.s === 200 && /^[A-HJKMNP-Z2-9]{6}$/.test(room.code) && room.slot === 0 && room.hostId === 'hostuid', 'room dibuat, host slot 0');
  let st = (await call(H, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j;
  ok(st.members.length === 1 && st.members[0].host, 'awalnya 1 anggota');
  const j = await call(J, 'POST', '/api/rooms/join', { code: room.code.toLowerCase() });
  ok(j.s === 200 && j.j.slot === 1 && j.j.roomId === room.roomId, 'pemain masuk pakai kode (huruf kecil ok), slot 1');
  st = (await call(H, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j;
  ok(st.members.length === 2 && st.members.every((m) => m.online) && st.members[1].name === 'ramzz', 'HOST melihat 2 pemain online (2/2)');
  ok((await call(K, 'POST', '/api/rooms/join', { code: room.code })).j.error.code === 'room_full', 'room penuh ditolak');
  ok((await call(K, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j.error.code === 'not_member', 'non-anggota tidak bisa baca state');
  ok((await call(H, 'POST', '/api/rooms/join', { code: 'ZZZZZZ' })).j.error.code === 'room_not_found', 'kode salah');

  console.log('== mulai permainan');
  ok((await call(J, 'POST', '/api/rooms/start', { roomId: room.roomId })).j.error.code === 'not_host', 'hanya host yang mulai');
  ok((await call(H, 'POST', '/api/rooms/start', { roomId: room.roomId })).j.status === 'playing', 'host mulai');
  ok((await call(H, 'POST', '/api/rooms/start', { roomId: room.roomId })).j.status === 'playing', 'start idempoten');
  ok((await call(J, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j.status === 'playing', 'pemain melihat status playing');
  ok((await call(K, 'POST', '/api/rooms/join', { code: room.code })).j.error.code === 'room_started', 'pemain baru tidak bisa masuk game berjalan');

  console.log('== sync posisi & event');
  const pos = { v: 1, ep: 5, seq: 1, x: 1, y: 0, z: 2 };
  let a = (await call(H, 'POST', '/api/rooms/sync', { roomId: room.roomId, state: pos, world: [{ ev: [1] }], since: -1, need: false })).j;
  ok(a.members.length === 2 && Object.keys(a.states).length === 0, 'host tidak menerima posisinya sendiri');
  let b = (await call(J, 'POST', '/api/rooms/sync', { roomId: room.roomId, state: null, world: [], since: -1, need: true })).j;
  ok(b.states.hostuid && b.states.hostuid.x === 1, 'pemain menerima posisi host');
  ok(b.world.length === 1 && b.world[0].from === 'hostuid', 'pemain menerima event dunia host');
  b = (await call(J, 'POST', '/api/rooms/sync', { roomId: room.roomId, since: b.cursor, need: true })).j;
  ok(b.world.length === 0, 'event tidak dikirim dua kali (kursor)');
  a = (await call(H, 'POST', '/api/rooms/sync', { roomId: room.roomId, since: -1, need: false })).j;
  ok(a.need_relay === true, 'host diberi tahu ada penerima yang butuh relai cepat');

  console.log('== reconnect, stale, keluar');
  T += 40000;
  st = (await call(H, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j;
  ok(st.members.length === 2 && st.members.find((m) => m.id === 'joinuid').online === false, 'playing: 40 dtk tanpa sinyal -> offline tapi kursi masih ada');
  const rj = await call(J, 'POST', '/api/rooms/join', { code: room.code });
  ok(rj.s === 200 && rj.j.slot === 1, 'anggota lama bisa masuk lagi ke game berjalan, slot sama');
  ok((await call(J, 'POST', '/api/rooms/heartbeat', { roomId: room.roomId })).j.active === true, 'heartbeat aktif');
  await call(J, 'POST', '/api/rooms/leave', { roomId: room.roomId });
  ok((await call(J, 'GET', '/api/rooms/state?roomId=' + room.roomId)).j.error.code === 'not_member', 'setelah keluar bukan anggota');
  await call(H, 'POST', '/api/rooms/leave', { roomId: room.roomId });
  ok((await call(H, 'POST', '/api/rooms/join', { code: room.code })).j.error.code === 'room_closed', 'room kosong ditutup');

  console.log('== ruang tunggu: host tidak boleh start sendirian');
  const w = (await call(H, 'POST', '/api/rooms', { maxPlayers: 3 })).j;
  ok((await call(H, 'POST', '/api/rooms/start', { roomId: w.roomId })).j.error.code === 'not_ready', 'minimal 2 pemain online');
  ok((await call(H, 'POST', '/api/rooms/start', { roomId: 'bukan-uuid' })).j.error.code === 'invalid', 'roomId tidak valid ditolak');
  const j2 = (await call(J, 'POST', '/api/rooms/join', { code: w.code })).j;
  ok(j2.slot === 1, 'slot kosong terendah dipakai');
  T += 200000;
  ok((await call(K, 'POST', '/api/rooms/join', { code: w.code })).j.slot === 2, 'kursi pemain diam 200 dtk masih ditahan (<300) -> pemain baru dapat slot 2');
  T += 200000;
  ok((await call(['fourth', 'fourth'], 'POST', '/api/rooms/join', { code: w.code })).j.slot === 0, 'kursi diam >300 dtk dilepas (host & J) -> slot terendah (0) dipakai ulang');
  console.log('== loker/lemari: 1 pemain per loker (otoritatif di relay)');
  {
    const q = (await call(H, 'POST', '/api/rooms', { maxPlayers: 3 })).j;
    await call(J, 'POST', '/api/rooms/join', { code: q.code }); await call(K, 'POST', '/api/rooms/join', { code: q.code });
    await call(H, 'POST', '/api/rooms/start', { roomId: q.roomId });
    const lk = (who, locker, action) => call(who, 'POST', '/api/rooms/locker', { roomId: q.roomId, locker, action });
    let r = (await lk(H, 'Locker_01', 'enter')).j; ok(r.ok === true && r.lockers.Locker_01 === 'hostuid', 'loker kosong: host masuk');
    r = (await lk(J, 'Locker_01', 'enter')).j; ok(r.ok === false && r.reason === 'occupied' && r.owner === 'hostuid', 'loker terisi: pemain lain ditolak, penghuni = host');
    r = (await lk(J, 'Locker_02', 'enter')).j; ok(r.ok === true && r.lockers.Locker_01 === 'hostuid' && r.lockers.Locker_02 === 'joinuid', 'pemain lain cari loker lain: berhasil');
    let sy = (await call(K, 'POST', '/api/rooms/sync', { roomId: q.roomId, since: -1, need: false })).j; ok(sy.lockers && sy.lockers.Locker_01 === 'hostuid' && sy.lockers.Locker_02 === 'joinuid', 'sync membawa snapshot loker ke SEMUA pemain');
    r = (await lk(H, 'Locker_01', 'exit')).j; ok(r.ok && !r.lockers.Locker_01, 'penghuni KELUAR: slot dibebaskan');
    r = (await lk(K, 'Locker_01', 'enter')).j; ok(r.ok === true, 'pemain lain langsung bisa masuk setelah dibebaskan');
    r = (await lk(K, null, 'release')).j; ok(r.ok && !r.lockers.Locker_01 && r.lockers.Locker_02 === 'joinuid', 'TERTANGKAP: release melepas loker pemain itu saja');
    ok((await lk(H, 'bad id', 'enter')).j.error.code === 'invalid' && (await lk(H, 'Locker_01', 'bogus')).j.error.code === 'invalid', 'id loker / aksi tidak sah ditolak');
    ok((await call(['zzz', 'zzz'], 'POST', '/api/rooms/locker', { roomId: q.roomId, locker: 'Locker_01', action: 'enter' })).j.error.code === 'not_member', 'non-anggota ditolak');
    ok((await call(null, 'POST', '/api/rooms/locker', { roomId: q.roomId, locker: 'Locker_01', action: 'enter' })).s === 401, 'tanpa token ditolak');
    // DUA PEMAIN SERENTAK (request HTTP paralel sungguhan) pada loker yang sama, berulang
    let bad = 0;
    for (let i = 0; i < 60; i++) {
      const id = 'Race_' + i; const rs = await Promise.all([lk(H, id, 'enter'), lk(J, id, 'enter'), lk(K, id, 'enter')]);
      const wins = rs.filter((x) => x.j.ok === true).length; if (wins !== 1) bad++;
      const snap = (await call(H, 'POST', '/api/rooms/sync', { roomId: q.roomId, since: -1, need: false })).j.lockers;
      if (Object.keys(snap).filter((k) => k === id).length !== 1) bad++;
      if (Object.values(snap).length !== new Set(Object.values(snap)).size) bad++; // 1 pemain = 1 loker
    }
    ok(bad === 0, 'tiga pemain serentak ke satu loker (60 putaran): selalu tepat satu pemenang, 1 loker per pemain');
    // DISCONNECT: pemegang tidak mengirim sinyal > 30 dtk (playing) -> slot dilepas; pemain online lain tetap tersinkron
    await lk(H, 'Locker_09', 'enter');
    T += 20000; await call(J, 'POST', '/api/rooms/heartbeat', { roomId: q.roomId }); await call(K, 'POST', '/api/rooms/heartbeat', { roomId: q.roomId });
    ok((await lk(J, 'Locker_09', 'enter')).j.ok === false, '20 dtk tanpa sinyal: host masih dianggap online -> loker terisi');
    T += 20000; await call(J, 'POST', '/api/rooms/heartbeat', { roomId: q.roomId });
    sy = (await call(J, 'POST', '/api/rooms/sync', { roomId: q.roomId, since: -1, need: false })).j; ok(!sy.lockers.Locker_09, 'DISCONNECT (40 dtk): slot host dilepas di snapshot semua pemain');
    ok((await lk(J, 'Locker_09', 'enter')).j.ok === true, 'pemain lain bisa mengambil loker yang ditinggal disconnect');
    // keluar room melepas klaim; lease habis walau pemegang online
    await call(J, 'POST', '/api/rooms/leave', { roomId: q.roomId });
    sy = (await call(K, 'POST', '/api/rooms/sync', { roomId: q.roomId, since: -1, need: false })).j; ok(!sy.lockers.Locker_09 && !sy.lockers.Locker_02, 'pemain KELUAR room: klaimnya hilang');
    await lk(K, 'Locker_05', 'enter');
    for (let i = 0; i < 5; i++) { T += 9000; await call(K, 'POST', '/api/rooms/heartbeat', { roomId: q.roomId }); await call(H, 'POST', '/api/rooms/heartbeat', { roomId: q.roomId }); }
    ok((await lk(H, 'Locker_05', 'enter')).j.ok === true, 'lease 40 dtk habis tanpa perbarui: loker dilepas walau pemegang masih online');
  }
  srv.close(); console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`); process.exit(fails ? 1 : 0);
})();
