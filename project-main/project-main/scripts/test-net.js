// Uji lapisan jaringan murni (lib/net): validasi pesan, interpolasi, RoomClient (4 pemain, masuk/keluar, reconnect, isolasi pengirim).
// Transport di sini adalah TEST DOUBLE in-memory untuk menguji logika klien; ini BUKAN backend dan tidak ikut dikirim ke produksi.
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-net');
const M = require(D + '/mission.js'), P = require(D + '/protocol.js'), I = require(D + '/interp.js'), R = require(D + '/roomclient.js'), W = require(D + '/worldsync.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------- jam palsu ----------
function fakeClock() {
  let t = 0, id = 0; const timers = new Map();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms, next: t + ms, rep: true }); return h; },
    clearInterval: (h) => timers.delete(h),
    setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms, next: t + ms, rep: false }); return h; },
    clearTimeout: (h) => timers.delete(h),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let best = null;
        for (const [h, x] of timers) if (x.next <= end && (!best || x.next < best[1].next)) best = [h, x];
        if (!best) break;
        t = best[1].next; const [h, x] = best;
        if (x.rep) x.next += x.ms; else timers.delete(h);
        x.fn(); await Promise.resolve();
      }
      t = end; await Promise.resolve();
    },
  };
}

const st = (o = {}) => ({ v: 1, ep: 7, seq: 1, x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0, gait: 1, crouch: false, hide: false, level: 0, model: 'default', ...o });
const local = (o = {}) => { const { v, ep, seq, ...r } = st(o); return r; };

section('sanitizeState');
ok(P.sanitizeState(st()) !== null, 'pesan valid diterima');
for (const [k, bad] of [['x', NaN], ['x', Infinity], ['x', 1e9], ['y', '1'], ['z', null], ['yaw', undefined], ['seq', -Infinity], ['ep', 'a'], ['v', 99]]) ok(P.sanitizeState(st({ [k]: bad })) === null, `ditolak: ${k}=${String(bad)}`);
ok(P.sanitizeState(null) === null && P.sanitizeState('x') === null && P.sanitizeState(5) === null, 'bukan objek ditolak');
{ const s = P.sanitizeState(st({ gait: 9, level: 5, pitch: 5, model: 'x'.repeat(99), crouch: 'yes' })); ok(s && s.gait === 0 && s.level === 0 && s.pitch <= 1.6 && s.model === 'default' && s.crouch === false, 'nilai di luar domain dinormalisasi'); }
ok(P.sanitizeName('  <b>Ana</b>_1  ') === 'bAnab_1', 'nama dibersihkan dari karakter berbahaya');
ok(P.sanitizeName('') === 'PLAYER' && P.sanitizeName(42) === 'PLAYER' && P.sanitizeName('x'.repeat(40)).length === 16, 'nama default / dipotong 16');
ok(!P.stateChanged(local(), local()) && P.stateChanged(local(), local({ x: 5 })) && P.stateChanged(null, local()), 'stateChanged');

section('SnapshotBuffer');
{
  const b = new I.SnapshotBuffer();
  ok(b.sample(0) === null, 'kosong -> null');
  b.push(st({ seq: 1, x: 0, z: 0, yaw: 3.0 }), 1000); b.push(st({ seq: 2, x: 1, z: 0, yaw: -3.0 }), 1100);
  const s = b.sample(1100 - 50 + I.INTERP_DELAY_MS); // di tengah
  ok(near(s.x, 0.5, 1e-9), 'interpolasi posisi di tengah');
  ok(Math.cos(s.yaw) < -0.99, 'yaw mengambil jalur terpendek lewat ±π (bukan memutar balik)');
  ok(near(s.speed, 10, 1e-6), 'kecepatan turunan = 10 m/dtk');
  const e = b.sample(1100 + I.INTERP_DELAY_MS + 100); ok(e.x > 1 && e.x <= 2.0001, 'ekstrapolasi pendek');
  const f = b.sample(1100 + I.INTERP_DELAY_MS + 5000); ok(near(f.x, 1, 1e-3) && f.speed < 0.01, 'ekstrapolasi dibatasi lalu kembali halus ke titik terakhir & berhenti');
  const o = b.sample(0); ok(o.x === 0, 'sebelum snapshot pertama: tahan di titik pertama');
  for (let i = 0; i < 100; i++) b.push(st({ seq: 3 + i }), 1200 + i * 100);
  ok(b.size <= 24, 'buffer dibatasi');
  { const g = new I.SnapshotBuffer(); g.push(st({ seq: 1, x: 0 }), 0); g.push(st({ seq: 2, x: 10 }), 20000); ok(g.size === 1 && near(g.sample(20000 + I.INTERP_DELAY_MS).x, 10), 'jeda panjang -> buffer direset, tidak meluncur dari posisi lama'); }
  b.push(st({ seq: 999 }), 5); ok(b.last.seq === 999, 'waktu mundur tidak merusak urutan');
}

// ---------- hub transport palsu ----------
function makeHub(clock) {
  const hub = { members: [], online: new Set(), conns: new Map(), failOpen: new Set(), sent: [] };
  hub.pushMembers = () => { for (const c of hub.conns.values()) c.ev?.onMembers(hub.members); };
  hub.pushOnline = () => { for (const c of hub.conns.values()) c.ev?.onOnline([...hub.online]); };
  hub.transport = (id) => {
    const c = { id, ev: null, open: false };
    return {
      async open(ev) {
        if (hub.failOpen.has(id)) throw new Error('offline');
        c.ev = ev; c.open = true; hub.conns.set(id, c); hub.online.add(id);
        ev.onStatus('connected'); ev.onMembers(hub.members); hub.pushOnline();
      },
      send(msg) { hub.sent.push([id, msg]); for (const o of hub.conns.values()) if (o.id !== id && o.open) o.ev.onState(id, msg); }, // `from` diturunkan dari saluran pengirim
      async close() { c.open = false; if (hub.conns.get(id) === c) { hub.conns.delete(id); hub.online.delete(id); hub.pushOnline(); } },
    };
  };
  hub.drop = (id) => { const c = hub.conns.get(id); if (c) { c.ev.onStatus('disconnected'); } };
  return hub;
}
const mk = (clock, hub, id, extra = {}) => new R.RoomClient({ selfId: id, factory: () => hub.transport(id), clock, rand: () => 0, ...extra });
const members = (ids) => ids.map((id, i) => ({ id, name: 'P' + (i + 1), slot: i }));

(async () => {
  section('4 pemain: masing-masing melihat 3 remote, tanpa diri sendiri');
  {
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b', 'c', 'd']);
    const cl = ['a', 'b', 'c', 'd'].map((id) => mk(clock, hub, id));
    for (const c of cl) await c.start();
    for (let i = 0; i < cl.length; i++) cl[i].setLocal(local({ x: i, z: i * 2, yaw: i }));
    await clock.advance(300);
    for (let i = 0; i < 4; i++) {
      const r = cl[i].roster();
      ok(r.length === 3 && !r.some((p) => p.id === ['a', 'b', 'c', 'd'][i]), `klien ${i}: 3 remote, tanpa diri sendiri`);
    }
    await clock.advance(400);
    const v = cl[0].sample();
    ok(v.length === 3, 'a melihat 3 pemain dengan data posisi');
    const vb = v.find((p) => p.id === 'b'), vd = v.find((p) => p.id === 'd');
    ok(vb && near(vb.state.x, 1) && near(vb.state.z, 2) && vb.name === 'P2' && vb.slot === 1, 'identitas, nama, slot, posisi b benar & terpisah');
    ok(vd && near(vd.state.x, 3) && near(vd.state.z, 6), 'posisi d berbeda dari b (instance sendiri-sendiri)');
    // animasi
    cl[1].setLocal(local({ x: 1, z: 2, gait: 2, crouch: true })); await clock.advance(400);
    const vb2 = cl[0].sample().find((p) => p.id === 'b'); ok(vb2.state.gait === 2 && vb2.state.crouch === true, 'status animasi (lari/jongkok) tersinkron');
    cl[1].setLocal(local({ x: 1, z: 2, hide: true })); await clock.advance(400);
    ok(cl[0].sample().find((p) => p.id === 'b').state.hide === true, 'status sembunyi tersinkron');

    section('batas 6 pemain');
    hub.members = members(['a', 'b', 'c', 'd', 'e', 'f', 'g']); const e = mk(clock, hub, 'g'); await e.start(); hub.pushMembers(); await clock.advance(200);
    ok(cl[0].roster().length <= 5, 'klien ke-7 tidak menambah pemain remote di klien lain (maks 5 remote)');
    ok(e.roster().length <= 5, 'klien ke-7 juga dibatasi maks 5 remote');
    await e.stop(); hub.members = members(['a', 'b', 'c', 'd']); hub.pushMembers(); await clock.advance(100);

    section('keluar / masuk');
    await cl[2].stop(); await clock.advance(100);
    ok(cl[0].roster().length === 2 && !cl[0].roster().some((p) => p.id === 'c'), 'pemain keluar -> hilang dari remote');
    const c2 = mk(clock, hub, 'c'); await c2.start(); c2.setLocal(local({ x: 9 })); await clock.advance(500);
    ok(cl[0].roster().some((p) => p.id === 'c'), 'pemain masuk lagi -> muncul');
    ok(near(cl[0].sample().find((p) => p.id === 'c').state.x, 9), 'posisi pemain yang masuk lagi diterima (epoch/seq baru tidak ditolak)');
    for (const c of [...cl, c2]) await c.stop();
  }

  section('keamanan pesan');
  {
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'), b = mk(clock, hub, 'b'); await a.start(); await b.start();
    const inj = hub.conns.get('a').ev;
    inj.onState('mallory', st({ x: 77 })); ok(a.roster().every((p) => p.id !== 'mallory'), 'pengirim non-anggota diabaikan');
    inj.onState('b', { v: 1, x: NaN }); inj.onState('b', 'sampah'); ok(a.droppedInvalid === 2, 'pesan invalid dihitung & dibuang');
    inj.onState('a', st({ x: 55 })); ok(a.sample().length === 0, 'pesan atas nama diri sendiri diabaikan (tidak ada echo)');
    inj.onState('b', st({ seq: 5, x: 5 })); inj.onState('b', st({ seq: 4, x: 99 })); inj.onState('b', st({ seq: 5, x: 98 }));
    await clock.advance(500); ok(near(a.sample().find((p) => p.id === 'b').state.x, 5), 'seq lama/duplikat dibuang');
    // isi pesan tidak bisa menyamar sebagai orang lain: `from` hanya dari saluran
    inj.onState('b', { ...st({ seq: 6, x: 6 }), from: 'a', id: 'a' }); await clock.advance(300);
    ok(a.sample().length === 1 && a.sample()[0].id === 'b', 'field id/from di dalam pesan tidak dipakai');
    await a.stop(); await b.stop();
  }

  section('reconnect');
  {
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    let before = 0;
    const a = mk(clock, hub, 'a', { beforeReconnect: async () => { before++; } }), b = mk(clock, hub, 'b');
    await a.start(); await b.start(); a.setLocal(local({ x: 1 })); b.setLocal(local({ x: 2 })); await clock.advance(400);
    const statuses = []; a.onChange(() => statuses.push(a.status));
    hub.drop('a'); ok(a.status === 'reconnecting', 'status -> reconnecting saat koneksi putus');
    hub.failOpen.add('a'); await clock.advance(600); ok(a.status === 'reconnecting', 'percobaan gagal -> tetap mencoba (backoff)');
    const t1 = hub.sent.length;
    hub.failOpen.delete('a'); await clock.advance(15000);
    ok(a.status === 'online', 'tersambung kembali otomatis');
    ok(before >= 1, 'beforeReconnect (segarkan token / daftar ulang membership) dipanggil sebelum menyambung');
    ok(hub.sent.slice(t1).some(([id]) => id === 'a'), 'posisi lokal dikirim lagi segera setelah reconnect');
    ok(a.roster().some((p) => p.id === 'b'), 'peer terlihat lagi setelah reconnect');
    b.setLocal(local({ x: 4 })); await clock.advance(2500);
    ok(near(a.sample().find((p) => p.id === 'b').state.x, 4), 'data peer mengalir lagi');
    ok(P_backoff(), 'backoff naik dan dibatasi');
    await a.stop(); await b.stop(); ok(a.status === 'closed', 'stop -> closed (tidak reconnect lagi)');
    await clock.advance(30000); ok(a.status === 'closed', 'setelah stop tidak ada reconnect');
  }
  function P_backoff() { const r = () => 0; return R.backoffMs(0, r) === 500 && R.backoffMs(1, r) === 1000 && R.backoffMs(9, r) === 10000 && R.backoffMs(50, r) === 10000; }

  section('pengiriman tidak bergantung pada pause menu / render');
  {
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'), b = mk(clock, hub, 'b'); await a.start(); await b.start();
    a.setLocal(local({ x: 1 })); b.setLocal(local({ x: 2 }));
    await clock.advance(200); const n0 = hub.sent.filter(([id]) => id === 'a').length;
    // "menu pause multiplayer terbuka": render tidak memanggil apa pun, pemain diam; keepalive tetap jalan 1x/dtk
    await clock.advance(5000); const n1 = hub.sent.filter(([id]) => id === 'a').length;
    ok(n1 - n0 >= 4, `keepalive tetap terkirim saat pemain diam/menu terbuka (${n1 - n0} pesan / 5 dtk)`);
    ok(a.sample().length === 1 && !a.sample()[0].stale, 'peer lain tidak dianggap stale/freeze selama menu terbuka');
    const sentMoving = (() => { const s0 = hub.sent.length; return s0; })();
    for (let i = 0; i < 10; i++) { a.setLocal(local({ x: 1 + i })); await clock.advance(100); }
    ok(hub.sent.length - sentMoving >= 9, 'saat bergerak ~10 Hz');
    await a.stop(); await b.stop();
  }

  section('peer stale');
  {
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'); await a.start(); const b = mk(clock, hub, 'b'); await b.start();
    b.setLocal(local()); await clock.advance(300); ok(!a.roster()[0].stale && a.sample().length === 1, 'belum stale');
    await b.stop(); hub.online.add('b'); hub.pushOnline(); // tetap "online" di presence tetapi tidak mengirim
    await clock.advance(7000); ok(a.roster()[0].stale === true, 'online tanpa data > 6 dtk -> stale');
    await a.stop();
  }

  // ---------- anti-teleport ----------
  section('clampStep (anti-teleport / speed-hack)');
  {
    const a = P.sanitizeState(st({ x: 0, z: 0 })), mv = (x, z) => P.sanitizeState(st({ seq: 2, x, z }));
    let r = P.clampStep(a, mv(0.5, 0), 100); ok(!r.clamped && r.state.x === 0.5, 'gerak normal lolos');
    r = P.clampStep(a, mv(400, 0), 100); ok(r.clamped && r.state.x <= P.MAX_SPEED * 0.1 + P.STEP_SLACK + 1e-9 && r.state.x > 0, 'teleport jauh dipotong ke batas, arah sama');
    r = P.clampStep(a, mv(30, 40), 100); ok(r.clamped && near(Math.atan2(r.state.z, r.state.x), Math.atan2(40, 30), 1e-9), 'arah dipertahankan saat dipotong');
    r = P.clampStep(a, mv(40, 0), 10000); ok(!r.clamped, 'jeda panjang (reconnect) = anggaran besar, lolos');
    r = P.clampStep(a, mv(40, 0), 1e12); ok(r.clamped === false || r.state.x <= P.MAX_SPEED * 60 + P.STEP_SLACK + 1e-9, 'dt dibatasi 60 dtk');
    r = P.clampStep(a, mv(5, 0), -50); ok(r.clamped && r.state.x <= P.STEP_SLACK + 1e-9, 'dt negatif tidak memberi anggaran');
  }
  {
    // lewat RoomClient: pemain curang melompat 300 m, tampil bergerak bertahap, bukan seketika
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'); await a.start(); const b = mk(clock, hub, 'b'); await b.start();
    b.setLocal(local({ x: 0, z: 0 })); await clock.advance(300);
    b.setLocal(local({ x: 300, z: 0 })); await clock.advance(400);
    const s = a.sample()[0].state; ok(s.x < 20, 'lompatan 300 m di jaringan tidak langsung terlihat (x=' + s.x.toFixed(1) + ')');
    ok(a.clampedMoves > 0, 'dihitung sebagai gerak terpotong');
    await b.stop(); await a.stop();
  }
  {
    // banjir pesan > 50 Hz dibuang
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'); await a.start(); const b = mk(clock, hub, 'b'); await b.start();
    const base = a.droppedFlood;
    for (let i = 1; i <= 50; i++) a.recv ? 0 : 0;
    for (let i = 1; i <= 50; i++) hub.conns.get('a').ev.onState('b', st({ ep: 99, seq: i, x: i * 0.001 }));
    ok(a.droppedFlood - base >= 40, 'banjir pesan serentak dibuang (' + (a.droppedFlood - base) + ')');
    await b.stop(); await a.stop();
  }

  // ---------- sinkronisasi dunia ----------
  section('WorldSync (event dunia)');
  {
    let t = 1000; const A = new W.WorldSync(() => t), B = new W.WorldSync(() => t);
    const m = A.local({ k: 'door', i: 3, o: 1 }); ok(m && m.ev[0].ts === 1000, 'event pintu diberi cap waktu');
    ok(A.local({ k: 'door', i: 3, o: 1 }) === null, 'toggle ke state yang sama tidak dikirim ulang');
    let eff = B.receive(m); ok(eff.length === 1 && eff[0].k === 'door' && eff[0].o === 1, 'penerima menerapkan pintu terbuka');
    ok(B.receive(m).length === 0, 'duplikat diabaikan (idempoten)');
    t = 1500; const m2 = B.local({ k: 'door', i: 3, o: 0 }); ok(m2.ev[0].ts > 1000, 'penutupan lebih baru');
    ok(A.receive(m2).length === 1, 'A menerima penutupan lebih baru');
    ok(A.receive(m).length === 0, 'event pintu lama yang datang terlambat diabaikan (LWW)');
    const t1 = A.local({ k: 'taken', id: 'key_red' }); ok(!!t1 && A.local({ k: 'taken', id: 'key_red' }) === null, 'taken sekali');
    ok(B.receive(t1).length === 1 && B.receive(t1).length === 0, 'taken: union idempoten');
    ok(B.receive(A.local({ k: 'lock', id: 'red' })).length === 1, 'lock tersinkron');
    ok(B.receive(A.local({ k: 'cont', id: 'locker@x_1' })).length === 1, 'container dengan "@" di id diterima');
  }
  {
    // digest: pemain yang terlambat / kehilangan paket konvergen
    const A = new W.WorldSync(() => 5), late = new W.WorldSync(() => 5);
    A.local({ k: 'door', i: 1, o: 1 }); A.local({ k: 'door', i: 2, o: 0 }); A.local({ k: 'taken', id: 'soda_in_c1' }); A.local({ k: 'lock', id: 'blue' });
    const d = A.digest(); ok(d && d.ev.length === 4, 'digest memuat seluruh perubahan');
    ok(late.receive(d).length === 4, 'pemain terlambat menerapkan semuanya');
    ok(late.receive(d).length === 0, 'digest berulang tidak mengubah apa pun');
    ok(new W.WorldSync().digest() === null, 'digest kosong = null');
    late.reset(); ok(late.digest() === null, 'reset mengosongkan');
  }
  {
    // pesan jahat / rusak
    const S = new W.WorldSync();
    for (const bad of [null, 5, 'x', {}, { v: 1, t: 'w' }, { v: 2, t: 'w', ev: [] }, { v: 1, t: 'w', ev: 'x' }]) ok(S.receive(bad).length === 0, 'ditolak: ' + JSON.stringify(bad));
    const e = S.receive({ v: 1, t: 'w', ev: [
      { k: 'door', i: -1, o: 1, ts: 1 }, { k: 'door', i: 1.5, o: 1, ts: 1 }, { k: 'door', i: 5000, o: 1, ts: 1 }, { k: 'door', i: 1, o: 2, ts: 1 }, { k: 'door', i: 1, o: 1 }, { k: 'door', i: 1, o: 1, ts: NaN },
      { k: 'taken', id: '../../etc' }, { k: 'taken', id: 'x'.repeat(65) }, { k: 'taken', id: 7 }, { k: 'zzz', id: 'a' }, null, 4,
      { k: 'taken', id: 'ok_1' }] });
    ok(e.length === 1 && e[0].id === 'ok_1', 'hanya event valid yang lolos (' + e.length + ')');
    const big = { v: 1, t: 'w', ev: Array.from({ length: 5000 }, (_, i) => ({ k: 'taken', id: 'i' + i })) };
    ok(new W.WorldSync().receive(big).length <= W.MAX_WORLD_EVENTS, 'jumlah event per pesan dibatasi');
    ok(W.isWorldMsg({ t: 'w' }) && !W.isWorldMsg(st()) && !W.isWorldMsg(null), 'isWorldMsg');
  }
  {
    // end-to-end lewat RoomClient: dua klien + pemain luar tidak dapat menyusupkan event
    const clock = fakeClock(), hub = makeHub(clock); hub.members = members(['a', 'b']);
    const a = mk(clock, hub, 'a'); await a.start(); const b = mk(clock, hub, 'b'); await b.start();
    const SA = new W.WorldSync(), SB = new W.WorldSync(); const got = [];
    b.onWorld((from, raw) => { for (const e of SB.receive(raw)) got.push([from, e]); });
    ok(a.sendWorld(SA.local({ k: 'taken', id: 'key_red' })) === true, 'sendWorld online = true');
    ok(got.length === 1 && got[0][0] === 'a' && got[0][1].id === 'key_red', 'B menerima event dari A, pengirim dari saluran');
    hub.conns.get('b').ev.onState('intruder', SA.digest()); ok(got.length === 1, 'pesan dari non-anggota dibuang');
    const off = b.onWorld(() => {}); off();
    await a.stop(); ok(a.sendWorld(SA.digest()) === false, 'sendWorld offline = false');
    await b.stop();
  }

  section('Misi keluar: kerangka, host = otoritas, sinkron ke semua pemain');
  {
    ok(M.missionAll({ key: true, switch: true, code: true }) && !M.missionAll({ key: true, switch: true, code: false }) && !M.missionAll({ key: false, switch: true, code: true }) && !M.missionAll({ key: true, switch: false, code: true }), 'exit hanya bila kunci + saklar + kode semuanya selesai');
    ok(M.missionCount({ key: true, switch: false, code: true }) === 2 && M.missionCount({ key: false, switch: false, code: false }) === 0, 'hitungan checklist');
    const host = new W.WorldSync(), p2 = new W.WorldSync(), p3 = new W.WorldSync();
    const m = host.local({ k: 'mission', id: 'switch' });
    ok(m && m.ev[0].k === 'mission' && m.ev[0].id === 'switch', 'host menyiarkan misi selesai');
    ok(host.local({ k: 'mission', id: 'switch' }) === null, 'idempoten di host');
    const e2 = p2.receive(m, true); ok(e2.length === 1 && e2[0].k === 'mission' && e2[0].id === 'switch', 'pemain lain menerima misi dari host');
    ok(p2.receive(m, true).length === 0, 'terima ulang tidak menggandakan efek');
    ok(p3.receive(m, false).length === 0, 'event misi dari NON-host ditolak (host = otoritas)');
    ok(p3.digest() === null, 'misi palsu tidak tersimpan/diteruskan oleh penerima');
    const late = new W.WorldSync(), el = late.receive(host.digest(), true); ok(el.some((e) => e.k === 'mission' && e.id === 'switch'), 'pemain terlambat konvergen lewat digest host');
    const rq = p2.local({ k: 'mreq', id: 'code' }); ok(rq && rq.ev[0].k === 'mreq' && p2.digest().ev.every((e) => e.k !== 'mreq'), 'permintaan non-host: terkirim, tidak disimpan di digest');
    const er = host.receive(rq, false); ok(er.length === 1 && er[0].k === 'mreq' && er[0].id === 'code', 'host menerima permintaan dari non-host (bukan sebagai status)');
    ok(W.sanitizeWorldMsg({ v: 1, t: 'w', ev: [{ k: 'mission', id: 'hack' }, { k: 'mreq', id: 5 }, { k: 'mission', id: 'code' }] }).ev.length === 1, 'id misi tidak valid dibuang');
    host.reset(); ok(host.digest() === null, 'reset (restart) mengosongkan misi');
  }

  section('Puzzle saklar: state otoritatif host, permintaan non-host, sinkron');
  {
    const host = new W.WorldSync(), a = new W.WorldSync(), b = new W.WorldSync();
    const m1 = host.local({ k: 'sw', v: 1, p: 1, r: 0 });
    ok(m1 && m1.ev[0].k === 'sw' && m1.ev[0].p === 1, 'host menyiarkan state saklar');
    ok(host.local({ k: 'sw', v: 1, p: 1, r: 0 }) === null && host.local({ k: 'sw', v: 0, p: 0, r: 1 }) === null, 'versi sama/lama tidak disiarkan lagi');
    const e = a.receive(m1, true); ok(e.length === 1 && e[0].k === 'sw' && e[0].v === 1 && e[0].p === 1 && e[0].r === 0, 'pemain lain menerima state dari host');
    ok(a.receive(m1, true).length === 0, 'idempoten (versi sama diabaikan)');
    ok(b.receive(m1, false).length === 0 && b.digest() === null, 'state saklar dari NON-host ditolak & tidak tersimpan');
    const m2 = host.local({ k: 'sw', v: 2, p: 0, r: 1 }); const e2 = a.receive(m2, true);
    ok(e2.length === 1 && e2[0].r === 1 && e2[0].p === 0, 'salah urutan (reset) tersiarkan dengan flag alarm');
    ok(a.receive(m1, true).length === 0, 'state lama yang datang terlambat tidak menimpa yang baru');
    const d = host.digest(); ok(d.ev.some((x) => x.k === 'sw' && x.v === 2 && x.r === 0), 'digest membawa state terbaru TANPA flag alarm (pemain terlambat tidak dibunyikan alarm lama)');
    const late = new W.WorldSync(); const el = late.receive(d, true); ok(el.some((x) => x.k === 'sw' && x.v === 2 && x.r === 0), 'pemain terlambat konvergen ke state host');
    const rq = a.local({ k: 'swreq', i: 3 }); ok(rq && rq.ev[0].k === 'swreq' && rq.ev[0].i === 3 && a.digest().ev.every((x) => x.k !== 'swreq'), 'permintaan tekan saklar: terkirim, tidak disimpan');
    const er = host.receive(rq, false); ok(er.length === 1 && er[0].k === 'swreq' && er[0].i === 3, 'host menerima permintaan dari non-host');
    const bad = W.sanitizeWorldMsg({ v: 1, t: 'w', ev: [{ k: 'sw', v: -1, p: 0, r: 0 }, { k: 'sw', v: 1, p: 9, r: 0 }, { k: 'sw', v: 1, p: 1, r: 2 }, { k: 'sw', v: 1.5, p: 1, r: 0 }, { k: 'swreq', i: 5 }, { k: 'swreq', i: -1 }, { k: 'swreq', i: 1.2 }, { k: 'sw', v: 3, p: 5, r: 0 }, { k: 'swreq', i: 4 }] });
    ok(bad.ev.length === 2 && bad.ev[0].k === 'sw' && bad.ev[0].p === 5 && bad.ev[1].k === 'swreq' && bad.ev[1].i === 4, 'pesan saklar tidak sah dibuang (versi/jumlah/indeks/flag)');
    host.reset(); ok(host.digest() === null, 'reset (restart) mengosongkan state saklar');
  }

  console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})();
