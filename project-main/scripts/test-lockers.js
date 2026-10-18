// Uji sistem loker/lemari multiplayer (logika; BUKAN Postgres/Vercel sungguhan -- SQL diuji terpisah di scripts/test-sql.sql dan butuh Postgres).
// Mencakup: aturan klaim (kosong / terisi / keluar / disconnect / lease), balapan dua-empat pemain bersamaan terhadap tabel tiruan yang menegakkan
// kunci unik Postgres, LockerClient (antrean, retry, lease, jam server), alur masuk (LockerEntry), dan colekan/snapshot lewat RoomClient+HybridTransport.
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-lockers');
const L = require(D + '/net/lockers.js'), T = require(D + '/net/lockersTables.js'), C = require(D + '/net/lockerclient.js'), F = require(D + '/game/lockerflow.js');
const RC = require(D + '/net/roomclient.js'), HT = require(D + '/net/hybridTransport.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const flush = () => new Promise((r) => setImmediate(r));
const yieldRand = async (rnd) => { const n = Math.floor(rnd() * 4); for (let i = 0; i < n; i++) await Promise.resolve(); };
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// ---------- tabel tiruan (kunci unik seperti Postgres; setiap operasi memberi giliran ke operasi lain -> balapan nyata) ----------
function makeDb(nowRef) {
  const db = { rooms: [{ id: 'r1', status: 'playing' }], room_members: [], room_lockers: [], calls: 0 };
  const iso = (ms) => new Date(ms).toISOString();
  db.addMember = (uid, ageS = 0) => db.room_members.push({ room_id: 'r1', user_id: uid, left_at: null, last_seen: iso(nowRef.t - ageS * 1000) });
  function from(table) {
    const f = [], b = { mode: 'select', patch: null, row: null, single: false };
    const match = (r) => f.every((x) => x.op === 'eq' ? r[x.c] === x.v : x.op === 'neq' ? r[x.c] !== x.v : (x.v === null ? r[x.c] === null : true));
    const q = {
      select() { b.mode = 'select'; return q; }, update(p) { b.mode = 'update'; b.patch = p; return q; }, delete() { b.mode = 'delete'; return q; }, insert(r) { b.mode = 'insert'; b.row = r; return q; },
      eq(c, v) { f.push({ op: 'eq', c, v }); return q; }, neq(c, v) { f.push({ op: 'neq', c, v }); return q; }, is(c, v) { f.push({ op: 'is', c, v }); return q; },
      maybeSingle() { b.single = true; return q; },
      then(res, rej) {
        return (async () => {
          db.calls++; await yieldRand(rnd);
          const rows = db[table];
          if (b.mode === 'select') { const d = rows.filter(match).map((r) => ({ ...r })); return b.single ? { data: d[0] || null, error: null } : { data: d, error: null }; }
          if (b.mode === 'update') { rows.filter(match).forEach((r) => Object.assign(r, b.patch)); return { data: null, error: null }; }
          if (b.mode === 'delete') { db[table] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
          if (table === 'room_lockers') {
            if (rows.some((r) => r.room_id === b.row.room_id && r.locker_id === b.row.locker_id)) return { error: { code: '23505', message: 'duplicate key (pk)' } };
            if (rows.some((r) => r.room_id === b.row.room_id && r.user_id === b.row.user_id)) return { error: { code: '23505', message: 'duplicate key (user)' } };
          }
          rows.push({ ...b.row }); return { data: null, error: null };
        })().then(res, rej);
      },
    };
    return q;
  }
  db.client = { from };
  return db;
}
const mk = (nowRef, users) => { const db = makeDb(nowRef); users.forEach((u) => db.addMember(u)); return db; };
const op = (db, nowRef, uid, locker, action) => T.lockerOpViaTables(db.client, { uid, roomId: 'r1', locker, action, nowMs: nowRef.t });
const throwsCode = async (p) => { try { await p; return null; } catch (e) { return e.code || 'other'; } };

(async () => {
  section('helper murni');
  ok(L.lockerKeyOf('Locker_05#1@abc') === 'Locker_05:1@abc' && L.validLockerId(L.lockerKeyOf('Locker_05#1@abc')), 'id kompartemen (#) diubah jadi id sah');
  ok(!L.validLockerId('a b') && !L.validLockerId('') && !L.validLockerId('x'.repeat(65)) && L.validLockerId('Locker_01'), 'validasi id loker');
  ok(L.sanitizeLockers({ A: 'u1', 'b c': 'u2', D: 5 }).A === 'u1' && Object.keys(L.sanitizeLockers({ A: 'u1', 'b c': 'u2', D: 5 })).length === 1, 'snapshot tidak sah dibuang');
  ok(L.sanitizeLockers([]) === null && L.sanitizeLockers(null) === null && L.sanitizeLockers('x') === null, 'bukan objek -> null');
  ok(Object.keys(L.sanitizeLockers(Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['L' + i, 'u'])))).length === L.MAX_LOCKER_ENTRIES, 'ukuran snapshot dibatasi');
  { const now = 1e12; const rows = [{ locker_id: 'A', user_id: 'u1', renewed_at: now - 5000 }, { locker_id: 'B', user_id: 'u2', renewed_at: now - 41000 }, { locker_id: 'C', user_id: 'off', renewed_at: now - 1000 }];
    const r = L.liveClaims(rows, new Set(['u1', 'u2']), now); ok(r.live.A === 'u1' && !r.live.B && !r.live.C && r.stale.length === 2, 'klaim hidup: pemegang online + lease < 40 dtk'); }

  section('aturan klaim (server: tabel)');
  { const n = { t: Date.parse('2026-10-18T10:00:00Z') }, db = mk(n, ['A', 'B', 'C']);
    let r = await op(db, n, 'A', 'L1', 'enter'); ok(r.ok && r.lockers.L1 === 'A', 'loker KOSONG: A masuk');
    r = await op(db, n, 'B', 'L1', 'enter'); ok(!r.ok && r.reason === 'occupied' && r.owner === 'A' && r.lockers.L1 === 'A', 'loker TERISI: B ditolak, penghuni = A');
    r = await op(db, n, 'B', 'L2', 'enter'); ok(r.ok && r.lockers.L1 === 'A' && r.lockers.L2 === 'B', 'B cari loker lain: berhasil, A tetap di L1');
    r = await op(db, n, 'A', 'L1', 'enter'); ok(r.ok && Object.keys(r.lockers).length === 2, 'A mengulang enter (perbarui lease): idempoten');
    r = await op(db, n, 'A', 'L3', 'enter'); ok(r.ok && !r.lockers.L1 && r.lockers.L3 === 'A', '1 pemain = 1 loker: pindah ke L3 melepas L1');
    r = await op(db, n, 'B', 'L1', 'enter'); ok(r.ok && !r.lockers.L2 && r.lockers.L1 === 'B', 'L1 bebas setelah A pindah: B pindah ke L1');
    r = await op(db, n, 'A', 'L1', 'exit'); ok(r.lockers.L1 === 'B' && r.lockers.L3 === 'A', 'exit loker milik orang lain tidak melepas milik mereka');
    r = await op(db, n, 'A', 'L3', 'exit'); ok(r.ok && !r.lockers.L3, 'KELUAR: slot dibebaskan');
    r = await op(db, n, 'C', 'L3', 'enter'); ok(r.ok && r.lockers.L3 === 'C', 'pemain lain langsung bisa masuk setelah dibebaskan');
    r = await op(db, n, 'C', null, 'release'); ok(r.ok && !r.lockers.L3 && r.lockers.L1 === 'B', 'TERTANGKAP: release melepas semua milik C saja');
    ok(db.room_lockers.length === 1, 'tabel bersih: hanya baris B');
    ok((await throwsCode(op(db, n, 'Z', 'L1', 'enter'))) === 'not_member', 'bukan anggota ditolak');
    db.rooms[0].status = 'closed'; ok((await throwsCode(op(db, n, 'A', 'L1', 'enter'))) === 'room_closed', 'room tertutup ditolak'); db.rooms[0].status = 'playing'; }
  section('disconnect, keluar room, lease');
  { const n = { t: Date.parse('2026-10-18T10:00:00Z') }, db = mk(n, ['A', 'B']);
    await op(db, n, 'A', 'L1', 'enter');
    n.t += 20_000; db.room_members.find((m) => m.user_id === 'B').last_seen = new Date(n.t).toISOString();
    let r = await op(db, n, 'B', 'L1', 'enter'); ok(!r.ok, '20 dtk tanpa heartbeat: A masih dianggap online -> L1 terisi');
    n.t += 20_000; // A tidak mengirim apa pun 40 dtk > jendela online 30 dtk (playing) -> DISCONNECT
    r = await op(db, n, 'B', 'L1', 'enter'); ok(r.ok && r.lockers.L1 === 'B', 'DISCONNECT: A offline > 30 dtk -> slot dilepas, B masuk');
    ok(db.room_lockers.length === 1, 'baris basi A dibersihkan');
    const db2 = mk(n, ['A', 'B']); await op(db2, n, 'A', 'L1', 'enter');
    db2.room_members.find((m) => m.user_id === 'A').left_at = new Date(n.t).toISOString();
    r = await op(db2, n, 'B', 'L1', 'enter'); ok(r.ok, 'A keluar room (left_at) -> slot dilepas');
    const db3 = mk(n, ['A', 'B']); await op(db3, n, 'A', 'L1', 'enter');
    for (let i = 0; i < 5; i++) { n.t += 9000; db3.room_members.forEach((m) => { m.last_seen = new Date(n.t).toISOString(); }); } // 45 dtk, A tetap online tapi tidak memperbarui
    r = await op(db3, n, 'B', 'L1', 'enter'); ok(r.ok && r.lockers.L1 === 'B', 'LEASE habis (45 dtk tanpa perbarui) walau pemegang online -> dilepas (jaring pengaman exit hilang)');
    const db4 = mk(n, ['A', 'B']); await op(db4, n, 'A', 'L1', 'enter');
    for (let i = 0; i < 6; i++) { n.t += 9000; db4.room_members.forEach((m) => { m.last_seen = new Date(n.t).toISOString(); }); await op(db4, n, 'A', 'L1', 'enter'); }
    r = await op(db4, n, 'B', 'L1', 'enter'); ok(!r.ok && r.owner === 'A', 'perbarui lease berkala menjaga slot (54 dtk)');
    const snap = await T.readLockersViaTables(db4.client, 'r1', new Set(['A', 'B']), n.t); ok(snap.L1 === 'A', 'snapshot baca-saja (jalur sync) = klaim hidup');
    ok((await T.readLockersViaTables({ from: () => ({ select: () => ({ eq: async () => ({ error: { code: '42P01' } }) }) }) }, 'r1', new Set(), n.t)) === undefined, 'tabel belum ada (migrasi belum jalan): sync tetap jalan tanpa lockers'); }

  section('DUA PEMAIN BERSAMAAN pada loker yang sama (balapan)');
  { let bothWon = 0, noneWon = 0, errs = 0, tableOk = 0; const N = 300;
    for (let i = 0; i < N; i++) {
      const n = { t: Date.parse('2026-10-18T10:00:00Z') }, db = mk(n, ['A', 'B']);
      const rs = await Promise.all(['A', 'B'].map((u) => op(db, n, u, 'L1', 'enter').catch(() => null)));
      if (rs.some((r) => r === null)) { errs++; continue; }
      const w = rs.filter((r) => r.ok).length; if (w === 2) bothWon++; if (w === 0) noneWon++;
      const rows = db.room_lockers.filter((r) => r.locker_id === 'L1'); if (rows.length === 1) tableOk++;
      const loser = rs.find((r) => !r.ok); if (loser && loser.reason !== 'occupied') errs++;
    }
    ok(bothWon === 0, `tidak pernah dua pemenang (${N} balapan acak)`); ok(noneWon === 0 && errs === 0, 'selalu tepat satu pemenang, tanpa galat'); ok(tableOk === N, 'tabel selalu berisi tepat 1 baris untuk loker itu'); }
  { let bad = 0; const N = 150;
    for (let i = 0; i < N; i++) {
      const n = { t: Date.parse('2026-10-18T10:00:00Z') }, users = ['A', 'B', 'C', 'D'], db = mk(n, users);
      const rs = await Promise.all(users.map((u) => op(db, n, u, i % 2 ? 'L1' : 'L1', 'enter').catch(() => null)));
      if (rs.filter((r) => r && r.ok).length !== 1 || rs.some((r) => r === null)) bad++;
      const per = {}; db.room_lockers.forEach((r) => { per[r.locker_id] = (per[r.locker_id] || 0) + 1; }); if (Object.values(per).some((c) => c > 1)) bad++;
    }
    ok(bad === 0, `4 pemain serentak ke 1 loker: tepat 1 menang (${N} putaran)`); }
  { let bad = 0; const N = 150; // campuran: semua serentak ke 2 loker; tiap pemain maks 1 loker, tiap loker maks 1 pemain
    for (let i = 0; i < N; i++) {
      const n = { t: Date.parse('2026-10-18T10:00:00Z') }, users = ['A', 'B', 'C', 'D'], db = mk(n, users);
      const rs = await Promise.all(users.map((u, k) => op(db, n, u, k % 2 ? 'L1' : 'L2', 'enter').catch(() => null)).concat(users.map((u) => op(db, n, u, 'L1', 'exit').catch(() => null))));
      if (rs.some((r) => r === null)) bad++;
      const byUser = {}, byLocker = {}; db.room_lockers.forEach((r) => { byUser[r.user_id] = (byUser[r.user_id] || 0) + 1; byLocker[r.locker_id] = (byLocker[r.locker_id] || 0) + 1; });
      if (Object.values(byUser).some((c) => c > 1) || Object.values(byLocker).some((c) => c > 1)) bad++;
    }
    ok(bad === 0, `masuk & keluar serentak: invarian 1 pemain/loker dan 1 loker/pemain terjaga (${N} putaran)`); }

  section('LockerClient');
  const fclock = () => { let t = 0, id = 0; const timers = new Map(); return { now: () => t, setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: t + ms, rep: 0 }); return h; }, clearTimeout: (h) => timers.delete(h), setInterval: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: t + ms, rep: ms }); return h; }, clearInterval: (h) => timers.delete(h),
    async advance(ms) { const end = t + ms; for (;;) { let best = null; for (const [h, x] of timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [h, x]; if (!best) break; t = best[1].at; if (best[1].rep) best[1].at += best[1].rep; else timers.delete(best[0]); best[1].fn(); await flush(); } t = end; await flush(); } }; };
  { const n = { t: Date.parse('2026-10-18T10:00:00Z') }, db = mk(n, ['A', 'B']), clk = fclock(); let pokes = 0, failNext = 0, calls = [];
    const api = (uid) => async (req) => { calls.push(uid + ':' + req.action + ':' + (req.locker || '')); if (failNext > 0) { failNext--; throw new Error('net'); } const r = await op(db, n, uid, req.locker, req.action); return { ...r, server_time: new Date(n.t).toISOString() }; };
    const a = new C.LockerClient({ selfId: 'A', api: api('A'), clock: clk, poke: () => pokes++ }), b = new C.LockerClient({ selfId: 'B', api: api('B'), clock: clk });
    let r = await a.claim('L1'); ok(r.ok === true && a.ownerOf('L1') === 'A' && a.keyOf('A') === 'L1' && pokes === 1, 'claim berhasil: snapshot lokal + colekan terkirim');
    r = await b.claim('L1'); ok(r.ok === false && r.reason === 'occupied' && r.owner === 'A' && b.ownerOf('L1') === 'A', 'claim ditolak: tahu penghuninya');
    failNext = 1; r = await b.claim('L2'); ok(r.ok === false && r.reason === 'unavailable', 'server tak terjangkau -> unavailable (gagal-aman)');
    // urutan antrean: claim lalu release lalu claim langsung beruntun
    calls = []; const p1 = a.claim('L5'); a.release('L5'); const p2 = a.claim('L6'); await Promise.all([p1, p2]); await flush();
    ok(calls.join() === 'A:enter:L5,A:exit:L5,A:enter:L6', 'permintaan dieksekusi BERURUTAN (tidak tertukar): ' + calls.join());
    ok(db.room_lockers.length === 1 && db.room_lockers[0].locker_id === 'L6', 'hasil akhir benar di server');
    // retry release
    failNext = 2; calls = []; a.release('L6'); await flush(); await clk.advance(600); await clk.advance(1100); await clk.advance(100);
    ok(db.room_lockers.length === 0 && calls.filter((c) => c.startsWith('A:exit')).length === 3, 'release gagal 2x lalu berhasil (diulang): ' + calls.join());
    // snapshot lama dibuang
    const c = new C.LockerClient({ selfId: 'A', api: async () => ({ ok: true, lockers: {} }), clock: clk }); c.apply({ X: 'u' }, 2000); c.apply({}, 1000);
    ok(c.ownerOf('X') === 'u' && c.droppedStale === 1, 'snapshot dengan jam server lebih lama dibuang'); c.apply({}, 3000); ok(c.ownerOf('X') === null, 'snapshot lebih baru diterapkan');
    c.apply({ bad: 1, 'x y': 'u' }, NaN); ok(Object.keys(c.snapshot()).length === 0, 'snapshot jaringan tidak sah diabaikan');
    // lease: hold memperbarui tiap 10 dtk; kehilangan -> onLost
    n.t = Date.parse('2026-10-18T10:05:00Z'); const d2 = mk(n, ['A', 'B']); const cl2 = fclock(); let lost = 'none';
    const a2 = new C.LockerClient({ selfId: 'A', api: async (req) => ({ ...(await op(d2, n, 'A', req.locker, req.action)), server_time: new Date(n.t).toISOString() }), clock: cl2 });
    await a2.claim('L1'); a2.hold('L1', (o) => { lost = o; });
    for (let i = 0; i < 6; i++) { n.t += 10_000; d2.room_members.forEach((m) => { m.last_seen = new Date(n.t).toISOString(); }); await cl2.advance(10_000); }
    ok(lost === 'none' && d2.room_lockers.length === 1 && Date.parse(d2.room_lockers[0].renewed_at) > n.t - 11_000, 'hold memperbarui lease (60 dtk berlalu, klaim masih hidup)');
    d2.room_lockers.length = 0; d2.room_lockers.push({ room_id: 'r1', locker_id: 'L1', user_id: 'B', claimed_at: new Date(n.t).toISOString(), renewed_at: new Date(n.t).toISOString() });
    n.t += 10_000; d2.room_members.forEach((m) => { m.last_seen = new Date(n.t).toISOString(); }); await cl2.advance(10_000);
    ok(lost === 'B', 'loker ternyata diberikan ke B -> onLost(B) dipanggil'); const before = d2.calls; await cl2.advance(30_000); ok(d2.calls === before, 'setelah kehilangan, pembaruan berhenti');
    a2.dispose(); ok((await a2.claim('L9')).reason === 'unavailable', 'setelah dispose tidak mengirim apa pun'); }

  section('alur masuk loker (LockerEntry): kosong, terisi, keluar, tertangkap');
  const mkFx = (log, o = {}) => ({ openDoors: () => log.push('open'), closeDoors: () => log.push('close'), say: (m) => log.push('say:' + m), valid: () => o.valid !== false, begin: () => log.push('begin'), evict: (ow) => log.push('evict:' + ow) });
  const mkGate = (over) => { const g = { selfId: 'A', owner: null, claims: [], released: [], held: null, alive: true, res: { ok: true }, ownerOf() { return g.owner; }, keyOf: () => null, claim: async (k) => { g.claims.push(k); return g.res; }, release: (k) => g.released.push(k), hold: (k, f) => { g.held = { k, f }; }, stopHold() {}, alive_: 0 }; g.alive = () => g.alive_ !== 1; return Object.assign(g, over || {}); };
  { const e = new F.LockerEntry(), g = mkGate(), log = [];
    ok(e.start('L1', g, mkFx(log), true) === 'pending' && log[0] === 'open', 'kosong: pintu dibuka langsung (optimistik) + minta klaim');
    await flush(); ok(log.join() === 'open,begin' && g.held.k === 'L1' && !e.busy, 'server setuju -> urutan sembunyi dimulai, lease dipegang');
    g.held.f('B'); ok(log.includes('evict:B'), 'lease hilang -> evict dipanggil'); }
  { const e = new F.LockerEntry(), g = mkGate({ owner: 'B' }), log = [];
    ok(e.start('L1', g, mkFx(log), true) === 'occupied' && g.claims.length === 0 && log.join() === 'open,say:LOKER TERISI', 'TERISI (snapshot): ditolak tanpa meminta server, penghuni terlihat (pintu terbuka)'); }
  { const e = new F.LockerEntry(), g = mkGate({ res: { ok: false, reason: 'occupied', owner: 'B' } }), log = [];
    e.start('L1', g, mkFx(log), true); await flush(); ok(log.join() === 'open,open,say:LOKER TERISI' && !log.includes('begin'), 'TERISI (server menolak saat balapan): tidak masuk, pintu terbuka, pesan'); }
  { const e = new F.LockerEntry(), g = mkGate({ res: { ok: false, reason: 'unavailable' } }), log = [];
    e.start('L1', g, mkFx(log), true); await flush(); ok(!log.includes('begin') && log.includes('close') && log.some((x) => x.startsWith('say:LOKER TIDAK')), 'server tak terjangkau: TIDAK masuk, pintu yang kita buka ditutup lagi');
    const e2 = new F.LockerEntry(), g2 = mkGate({ res: { ok: false, reason: 'unavailable' } }), l2 = []; e2.start('L1', g2, mkFx(l2), false); await flush(); ok(!l2.includes('close'), 'pintu yang sudah terbuka sebelumnya tidak ditutup paksa'); }
  { const e = new F.LockerEntry(); let resolve; const g = mkGate({ claim: (k) => new Promise((r) => { resolve = r; g.claims.push(k); }) }), log = [];
    e.start('L1', g, mkFx(log), true); ok(e.start('L1', g, mkFx(log), true) === 'busy' && g.claims.length === 1, 'tekan HIDE dua kali: hanya satu permintaan');
    e.cancelAll(); resolve({ ok: true }); await flush(); ok(!log.includes('begin') && g.released.join() === 'L1', 'TERTANGKAP/restart saat menunggu: hasil dibuang & klaim langsung dilepas'); }
  { const e = new F.LockerEntry(), g = mkGate(), log = []; e.start('L1', g, mkFx(log, { valid: false }), true); await flush();
    ok(!log.includes('begin') && g.released.join() === 'L1' && log.includes('close'), 'pemain sudah menjauh saat server menjawab: batal, klaim dilepas'); }
  { const e = new F.LockerEntry(), g = mkGate(), log = []; g.alive_ = 1; e.start('L1', g, mkFx(log), true); await flush(); ok(!log.includes('begin') && g.released.join() === 'L1', 'pemain mati saat menunggu: batal, klaim dilepas'); }

  section('end-to-end: dua pemain, server tiruan, snapshot ke semua pemain');
  { const n = { t: Date.parse('2026-10-18T10:00:00Z') }, db = mk(n, ['A', 'B']), clk = fclock(); const mkP = (uid) => new C.LockerClient({ selfId: uid, clock: clk, api: async (req) => ({ ...(await op(db, n, uid, req.locker, req.action)), server_time: new Date(n.t).toISOString() }) });
    const A = mkP('A'), B = mkP('B'); const sync = async () => { n.t += 100; const s = await T.readLockersViaTables(db.client, 'r1', new Set(['A', 'B']), n.t); A.apply(s, n.t); B.apply(s, n.t); };
    const gateOf = (c) => ({ selfId: c.selfId, ownerOf: (k) => c.ownerOf(k), keyOf: (u) => c.keyOf(u), claim: (k) => c.claim(k), release: (k) => c.release(k), hold: (k, f) => c.hold(k, f), stopHold: () => c.stopHold(), alive: () => true });
    const eA = new F.LockerEntry(), eB = new F.LockerEntry(), la = [], lb = [];
    eA.start('L1', gateOf(A), mkFx(la), true); eB.start('L1', gateOf(B), mkFx(lb), true); await flush(); await flush(); await flush();
    const wins = [la, lb].filter((l) => l.includes('begin')).length, loses = [la, lb].filter((l) => l.some((x) => x === 'say:LOKER TERISI')).length;
    ok(wins === 1 && loses === 1, 'dua pemain menekan HIDE di loker kosong yang sama: satu masuk, satu dapat LOKER TERISI');
    await sync(); ok(A.ownerOf('L1') === B.ownerOf('L1') && A.ownerOf('L1') !== null, 'semua pemain melihat penghuni yang sama');
    const winner = la.includes('begin') ? 'A' : 'B', loser = winner === 'A' ? 'B' : 'A', W = winner === 'A' ? A : B, Lz = loser === 'A' ? A : B;
    // yang kalah mencari loker lain
    const rl = await Lz.claim('L2'); await sync(); ok(rl.ok && A.keyOf(loser) === 'L2' && A.keyOf(winner) === 'L1', 'yang kalah mencari loker lain: berhasil, masing-masing 1 loker');
    W.release('L1'); await flush(); await flush(); await sync(); ok(A.ownerOf('L1') === null && B.ownerOf('L1') === null, 'penghuni keluar: slot bebas untuk SEMUA pemain'); }

  section('RoomClient + HybridTransport: snapshot otoritatif & colekan');
  { const clk = fclock(); const calls = []; let lockersNow = { L1: 'B' };
    const sync = async (req) => { calls.push(clk.now()); return { status: 'playing', members: [{ id: 'me', slot: 0, name: 'me', host: true, online: true }, { id: 'B', slot: 1, name: 'B', host: false, online: true }], states: {}, world: [], cursor: 0, need_relay: false, lockers: lockersNow, server_time: new Date(1e12 + clk.now()).toISOString() }; };
    let rtMsgs = []; const rt = { async open() {}, send: (m) => rtMsgs.push(m), async close() {} }; let evCapture = null; const origOpen = rt.open; rt.open = async (ev) => { evCapture = ev; };
    const client = new RC.RoomClient({ selfId: 'me', clock: clk, factory: () => new HT.HybridTransport({ roomId: 'r', selfId: 'me', clock: clk, sync, realtime: () => rt }) });
    const got = []; client.onLockers((m, t) => got.push({ m, t })); await client.start(); await clk.advance(10);
    ok(got.length === 1 && got[0].m.L1 === 'B' && got[0].t >= 1e12, 'snapshot loker dari sync diteruskan ke klien beserta jam server');
    const n0 = calls.length; client.sendLockerPoke(); ok(rtMsgs.some((m) => m.t === 'lk'), 'colekan dikirim lewat realtime');
    evCapture.onState('B', { v: 1, t: 'lk' }); await clk.advance(1); ok(calls.length === n0 + 1, 'menerima colekan dari anggota: sinkron SEGERA (tanpa menunggu siklus 1,5 dtk)');
    evCapture.onState('B', { v: 1, t: 'lk' }); evCapture.onState('B', { v: 1, t: 'lk' }); await clk.advance(1); ok(calls.length === n0 + 1, 'colekan beruntun dibatasi (tidak membanjiri server)');
    evCapture.onState('mallory', { v: 1, t: 'lk' }); await clk.advance(400); ok(calls.length === n0 + 1 || calls.length === n0 + 2, 'colekan dari non-anggota diabaikan'); // satu siklus normal boleh terjadi
    lockersNow = { L1: 'B', L2: 'A?' }; await clk.advance(2000); ok(got.at(-1).m.L1 === 'B', 'snapshot berikutnya tetap tersinkron'); await client.stop(); }

  console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})();
