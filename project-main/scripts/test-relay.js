// Uji HybridTransport + RoomClient dengan 2-4 klien terhadap SERVER TIRUAN yang meniru semantik fungsi SQL relay_sync
// (anggota, online < 30 dtk, posisi terakhir per pemain, log event dengan kursor, need_relay).
// BATAS UJI: ini menguji logika klien (lib/net/hybridTransport.ts + roomclient.ts) -- BUKAN Supabase/Postgres/Vercel sungguhan.
// Menjalankan: npm run test:relay
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-net');
const R = require(D + '/roomclient.js'), H = require(D + '/hybridTransport.js'), W = require(D + '/worldsync.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const flush = () => new Promise((r) => setImmediate(r));

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
        x.fn(); await flush();
      }
      t = end; await flush();
    },
  };
}

// ---- server tiruan (semantik relay_sync / join_room) ----
function makeServer(clock) {
  const S = { status: 'waiting', host: 'a', members: new Map(), pos: new Map(), world: [], nextId: 1, calls: new Map() };
  S.join = (id, name) => {
    const m = S.members.get(id);
    if (m) { m.left = false; m.last = clock.now(); return m.slot; }
    if (S.status === 'playing') { const e = new Error('room_started'); e.code = 'room_started'; throw e; }
    const used = new Set([...S.members.values()].map((x) => x.slot)); let slot = 0; while (used.has(slot)) slot++;
    if (S.members.size >= 4) { const e = new Error('room_full'); e.code = 'room_full'; throw e; }
    S.members.set(id, { name, slot, last: clock.now(), left: false, relayUntil: 0 }); return slot;
  };
  S.sync = async (uid, req) => {
    S.calls.set(uid, (S.calls.get(uid) || 0) + 1);
    const m = S.members.get(uid);
    if (!m || m.left) { const e = new Error('not_member'); e.code = 'not_member'; throw e; }
    m.last = clock.now(); m.relayUntil = req.need ? clock.now() + 6000 : 0;
    if (req.state) S.pos.set(uid, { state: JSON.parse(JSON.stringify(req.state)), at: clock.now() });
    for (const w of req.world || []) S.world.push({ id: S.nextId++, from: uid, msg: JSON.parse(JSON.stringify(w)) });
    const max = S.world.length ? S.world[S.world.length - 1].id : 0;
    let since = req.since; if (since < 0) since = Math.max(0, max - 60);
    const w = S.world.filter((x) => x.id > since && x.from !== uid).slice(0, 100);
    const cursor = w.length ? w[w.length - 1].id : Math.max(since, max);
    const states = {}; for (const [id, p] of S.pos) if (id !== uid && clock.now() - p.at < 15000) states[id] = p.state;
    const need = [...S.members.entries()].some(([id, x]) => id !== uid && !x.left && x.relayUntil > clock.now());
    const members = [...S.members.entries()].filter(([, x]) => !x.left && clock.now() - x.last < 120000)
      .map(([id, x]) => ({ id, slot: x.slot, name: x.name, host: id === S.host, online: clock.now() - x.last < 30000 }));
    return { status: S.status, members, states, world: w, cursor, need_relay: need };
  };
  return S;
}

// ---- Realtime tiruan ----
function makeRtHub() {
  const conns = new Set();
  class FakeRT {
    constructor(uid, opt) { this.uid = uid; this.opt = opt || {}; this.opened = false; }
    async open(ev) {
      if (this.opt.fail) throw new Error('subscribe_timeout');
      this.ev = ev; this.opened = true; conns.add(this);
    }
    send(msg) { for (const c of conns) if (c !== this && c.opened && !c.opt.deaf) c.ev.onState(this.uid, JSON.parse(JSON.stringify(msg))); }
    async close() { this.opened = false; conns.delete(this); }
  }
  return { FakeRT, conns };
}

function setup(rtMode) {
  const clock = fakeClock(), S = makeServer(clock), hub = makeRtHub();
  const players = {};
  const add = (uid, name, rt = 'ok') => {
    S.join(uid, name);
    const transports = [];
    const client = new R.RoomClient({
      selfId: uid, clock,
      factory: () => { const t = new H.HybridTransport({ roomId: 'r1', selfId: uid, clock, sync: (req) => S.sync(uid, req), realtime: () => (rt === 'none' ? null : new hub.FakeRT(uid, { fail: rt === 'fail', deaf: rt === 'deaf' })) }); transports.push(t); return t; },
      beforeReconnect: async () => { S.join(uid, name); },
    });
    players[uid] = { client, transports, name };
    return players[uid];
  };
  return { clock, S, hub, players, add };
}
const loc = (x, z, o = {}) => ({ x, y: 0, z, yaw: 0, pitch: 0, gait: 1, crouch: false, hide: false, level: 0, model: 'default', ...o });
async function move(clock, p, x, z, ms = 1500) { p.client.setLocal(loc(x, z)); await clock.advance(ms); }

(async () => {
  section('A. Realtime TIDAK tersedia (skenario bug asli): 2 pemain tetap saling melihat lewat relai');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'ramzz', 'none'), b = add('b', 'kyraa', 'none');
    await a.client.start(); await b.client.start();
    ok(a.client.status === 'online' && b.client.status === 'online', 'kedua klien online tanpa Realtime');
    await move(clock, a, 1, 1); await move(clock, b, 5, 5, 3000);
    ok(a.client.remoteCount === 1 && b.client.remoteCount === 1, 'jumlah pemain remote = 1 di kedua sisi (2/2), bukan 1/2');
    ok(a.client.roster()[0].name === 'kyraa' && b.client.roster()[0].name === 'ramzz', 'nama pemain lain benar');
    await a.client.sample; await clock.advance(1000);
    const va = a.client.sample()[0], vb = b.client.sample()[0];
    ok(va && Math.abs(va.state.x - 5) < 0.6 && Math.abs(va.state.z - 5) < 0.6, 'A melihat posisi B (x~5,z~5)');
    ok(vb && Math.abs(vb.state.x - 1) < 0.6 && Math.abs(vb.state.z - 1) < 0.6, 'B melihat posisi A (x~1,z~1)');
    await a.client.stop(); await b.client.stop();
  }

  section('B. Empat pemain tanpa Realtime: semua melihat semua');
  {
    const { clock, players, add } = setup();
    const ids = ['a', 'b', 'c', 'd'];
    ids.forEach((id, i) => add(id, 'P' + (i + 1), 'none'));
    for (const id of ids) await players[id].client.start();
    for (let i = 0; i < ids.length; i++) players[ids[i]].client.setLocal(loc(i * 2, i * 3));
    await clock.advance(4000);
    ok(ids.every((id) => players[id].client.remoteCount === 3), 'tiap pemain melihat 3 pemain lain (4/4)');
    const v = players.a.client.sample().sort((x, y) => x.slot - y.slot);
    ok(v.length === 3 && v.map((x) => Math.round(x.state.x)).join() === '2,4,6', 'posisi 3 pemain lain di A sesuai (2,4,6)');
    for (const id of ids) await players[id].client.stop();
  }

  section('C. Realtime berfungsi: jalur cepat dipakai, relai tetap lambat (hemat request)');
  {
    const { clock, S, players, add } = setup();
    const a = add('a', 'A', 'ok'), b = add('b', 'B', 'ok');
    await a.client.start(); await b.client.start();
    a.client.setLocal(loc(1, 1)); b.client.setLocal(loc(2, 2));
    await clock.advance(8000);
    const ta = a.transports[a.transports.length - 1], tb = b.transports[b.transports.length - 1];
    ok(ta.realtimeUp && tb.realtimeUp, 'Realtime tersambung di kedua klien');
    ok(ta.mode === 'slow' && tb.mode === 'slow', 'relai pada mode lambat saat Realtime sehat');
    const calls0 = S.calls.get('a'); await clock.advance(10000); const per10 = S.calls.get('a') - calls0;
    ok(per10 <= 9, `request relai <= 9 per 10 dtk saat sehat (aktual ${per10})`);
    // pergerakan lewat Realtime: segar dalam < 250 ms
    a.client.setLocal(loc(9, 9)); await clock.advance(300);
    const vb = b.client.sample()[0];
    ok(vb && vb.state.x > 3, 'posisi A tiba di B lewat Realtime (< 300 ms) tanpa menunggu relai');
    await a.client.stop(); await b.client.stop();
  }

  section('D. Realtime gagal terhubung -> relai menyelamatkan; Realtime dicoba lagi berkala');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'A', 'fail'), b = add('b', 'B', 'fail');
    await a.client.start(); await b.client.start();
    await move(clock, a, 3, 3, 3000); await move(clock, b, 4, 4, 3000);
    ok(a.client.remoteCount === 1 && b.client.remoteCount === 1, 'saling terlihat walau Realtime gagal total');
    ok(a.client.status === 'online', 'status ONLINE (bukan MENYAMBUNG ULANG)');
    await a.client.stop(); await b.client.stop();
  }

  section('E. Asimetris: Realtime B tuli -> B tetap menerima A via relai cepat');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'A', 'ok'), b = add('b', 'B', 'deaf');
    await a.client.start(); await b.client.start();
    a.client.setLocal(loc(0, 0)); b.client.setLocal(loc(0, 0));
    await clock.advance(6000);
    a.client.setLocal(loc(7, 7)); await clock.advance(2500);
    const vb = b.client.sample()[0];
    ok(vb && Math.abs(vb.state.x - 7) < 0.8, 'B (tanpa Realtime) melihat A di (7,7)');
    ok(a.transports[a.transports.length - 1].mode === 'fast', 'A beralih ke relai cepat karena server melapor ada penerima tanpa Realtime');
    await a.client.stop(); await b.client.stop();
  }

  section('F. Keluar & reconnect: daftar pemain tetap benar');
  {
    const { clock, S, players, add } = setup();
    const a = add('a', 'A', 'none'), b = add('b', 'B', 'none'), c = add('c', 'C', 'none');
    for (const p of [a, b, c]) await p.client.start();
    a.client.setLocal(loc(1, 1)); b.client.setLocal(loc(2, 2)); c.client.setLocal(loc(3, 3));
    await clock.advance(4000);
    ok(a.client.remoteCount === 2 && c.client.remoteCount === 2, 'awal: 3/3');
    await b.client.stop(); S.members.get('b').left = true;            // B keluar (leave_room)
    await clock.advance(3000);
    ok(a.client.remoteCount === 1 && c.client.remoteCount === 1, 'B keluar -> A dan C melihat 2/3');
    const b2 = add('b', 'B', 'none'); await b2.client.start();           // B kembali (join_room: slot sama)
    b2.client.setLocal(loc(2, 2)); await clock.advance(4000);
    ok(a.client.remoteCount === 2 && c.client.remoteCount === 2 && b2.client.remoteCount === 2, 'B reconnect -> 3/3 lagi di semua sisi');
    ok(a.client.roster().find((r) => r.name === 'B').slot === 1, 'slot B tetap sama setelah reconnect');
    for (const p of [a, c, b2]) await p.client.stop();
  }

  section('G. Server mencabut keanggotaan (not_member) -> klien sambung ulang otomatis');
  {
    const { clock, S, players, add } = setup();
    const a = add('a', 'A', 'none'), b = add('b', 'B', 'none');
    await a.client.start(); await b.client.start();
    a.client.setLocal(loc(1, 1)); b.client.setLocal(loc(2, 2)); await clock.advance(3000);
    const seen = []; b.client.onChange(() => seen.push(b.client.status));
    S.members.get('b').left = true;
    await clock.advance(2500);
    ok(seen.includes('reconnecting'), 'B menyadari terputus (status sempat reconnecting)');
    await clock.advance(6000);
    ok(b.client.status === 'online' && a.client.remoteCount === 1 && b.client.remoteCount === 1, 'B tersambung ulang (join ulang) dan kedua sisi 2/2');
    await a.client.stop(); await b.client.stop();
  }

  section('H. Event dunia lewat relai (tanpa Realtime) + duplikasi dibuang');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'A', 'none'), b = add('b', 'B', 'none');
    await a.client.start(); await b.client.start();
    a.client.setLocal(loc(1, 1)); b.client.setLocal(loc(2, 2));
    const SA = new W.WorldSync(), SB = new W.WorldSync(); const got = [];
    b.client.onWorld((from, raw) => { for (const e of SB.receive(raw)) got.push(e); });
    await clock.advance(5000);
    a.client.sendWorld(SA.local({ k: 'taken', id: 'key_red' })); a.client.sendWorld(SA.local({ k: 'door', i: 3, o: 1 }));
    await clock.advance(2500);
    ok(got.some((e) => e.k === 'taken' && e.id === 'key_red') && got.some((e) => e.k === 'door' && e.i === 3 && e.o === 1), 'B menerima event kunci & pintu dari A via relai');
    const n0 = got.length; a.client.sendWorld(SA.digest()); await clock.advance(2500);
    ok(got.length === n0, 'digest ulang tidak menggandakan efek (idempoten)');
    await a.client.stop(); await b.client.stop();
  }

  section('I. Duplikat posisi dari dua jalur (Realtime + relai) hanya masuk buffer sekali');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'A', 'ok'), b = add('b', 'B', 'ok');
    await a.client.start(); await b.client.start();
    a.client.setLocal(loc(1, 1)); b.client.setLocal(loc(1, 1)); await clock.advance(3000);
    const peer = b.client.peers.get('a');
    const n = peer.buf.size; const seq = peer.seq;
    // kirim ulang state lama (seq <= terakhir) lewat jalur relai: harus diabaikan
    b.transports[b.transports.length - 1].ev.onState('a', { v: 1, ep: peer.ep, seq: seq - 1, x: 99, y: 0, z: 99, yaw: 0, pitch: 0, gait: 0, crouch: false, hide: false, level: 0, model: 'default' });
    ok(peer.buf.size === n && b.client.sample()[0].state.x < 50, 'state lama/duplikat dibuang, posisi tidak melompat');
    await a.client.stop(); await b.client.stop();
  }

  section('J. Pengirim ditentukan server/saluran, bukan isi pesan');
  {
    const { clock, players, add } = setup();
    const a = add('a', 'A', 'none'), b = add('b', 'B', 'none');
    await a.client.start(); await b.client.start();
    await clock.advance(3000);
    const t = b.transports[b.transports.length - 1];
    t.ev.onState('mallory', { v: 1, ep: 1, seq: 1, x: 1, y: 0, z: 1, yaw: 0, pitch: 0, gait: 0, crouch: false, hide: false, level: 0, model: 'default' });
    ok(b.client.remoteCount === 1, 'pengirim non-anggota tidak membuat pemain baru');
    await a.client.stop(); await b.client.stop();
  }

  console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})();
