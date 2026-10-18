// Uji RoomPoller (polling ruang tunggu): pemain yang masuk harus terlihat host, polling tidak boleh mati diam-diam, gagal tidak mengeluarkan pemain.
// Server di sini adalah TEST DOUBLE in-memory (bukan backend).
const path = require('path');
const { RoomPoller, POLL_MS, STUCK_MS } = require(path.join(__dirname, '..', '.tmp-net', 'roompoller.js'));
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

function fakeClock() {
  let t = 0, id = 0; const timers = new Map();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms, next: t + ms }); return h; },
    clearInterval: (h) => timers.delete(h),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let best = null;
        for (const [h, x] of timers) if (x.next <= end && (!best || x.next < best[1].next)) best = [h, x];
        if (!best) break;
        t = best[1].next; best[1].next += best[1].ms; best[1].fn();
        for (let i = 0; i < 6; i++) await Promise.resolve(); // biarkan promise selesai
      }
      t = end; for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}
const room = { roomId: 'r1', code: 'ABC234', seed: 1, maxPlayers: 2, status: 'waiting', slot: 0, hostId: 'host' };
const member = (id, online = true, host = false) => ({ id, slot: host ? 0 : 1, name: id, host, online });
const snap = (members, status = 'waiting') => ({ room_id: 'r1', code: 'ABC234', status, host_id: 'host', max_players: 2, seed: 1, members, active: true });
const apiErr = (code, message) => Object.assign(new Error(message || code), { code });

function setup(fetchState, extra = {}) {
  const clock = fakeClock(), log = { views: [], errs: [], playing: [], gone: [] };
  const p = new RoomPoller({
    room, selfId: 'host', clock, fetchState, rejoin: extra.rejoin || (async () => ({})),
    onView: (v) => log.views.push(v), onErr: (m) => log.errs.push(m), onPlaying: (r) => log.playing.push(r), onGone: (m) => log.gone.push(m),
  });
  return { p, clock, log };
}

(async () => {
  section('host melihat tamu yang masuk');
  { let guest = false;
    const { p, clock, log } = setup(async () => snap(guest ? [member('host', true, true), member('kyra')] : [member('host', true, true)]));
    p.start(); await clock.advance(100);
    ok(log.views.length === 1 && log.views[0].members.length === 1, 'snapshot awal 1 pemain');
    guest = true; await clock.advance(POLL_MS + 600);
    ok(log.views.length === 2 && log.views[1].members.length === 2, 'tamu terlihat setelah 1 siklus polling');
    const n = log.views.length; await clock.advance(POLL_MS * 4);
    ok(log.views.length === n, 'snapshot identik tidak memicu render ulang');
    p.stop(); }

  section('request macet tidak membekukan polling');
  { let calls = 0, guest = false;
    const { p, clock, log } = setup(() => { calls++; if (calls === 2) return new Promise(() => {}); return Promise.resolve(snap(guest ? [member('host', true, true), member('kyra')] : [member('host', true, true)])); });
    p.start(); await clock.advance(100);
    ok(log.views.length === 1, 'poll 1 sukses');
    guest = true;
    await clock.advance(POLL_MS + 600);                       // poll 2 mulai dan menggantung selamanya
    ok(p.polls === 2, 'poll 2 dimulai');
    await clock.advance(STUCK_MS - 2000);
    ok(log.views.length === 1, 'selama menggantung (belum macet) tetap menunggu');
    await clock.advance(3000 + 600);
    ok(p.polls >= 3 && log.views.length === 2, 'setelah dianggap macet, request baru diganti dan tamu terlihat');
    p.stop(); }

  section('hasil lama yang datang terlambat tidak menimpa hasil baru');
  { let calls = 0, releaseOld;
    const old = new Promise((r) => { releaseOld = r; });
    const { p, clock, log } = setup(() => { calls++; if (calls === 1) return old; return Promise.resolve(snap([member('host', true, true), member('kyra')])); });
    p.start(); await clock.advance(STUCK_MS + 1500);
    ok(log.views.length === 1 && log.views[0].members.length === 2, 'hasil baru diterapkan');
    releaseOld(snap([member('host', true, true)])); await clock.advance(50);
    ok(log.views.length === 1, 'hasil lama (1 pemain) dibuang');
    p.stop(); }

  section('gagal berkali-kali tidak mengeluarkan pemain, pulih sendiri');
  { let down = true;
    const { p, clock, log } = setup(async () => { if (down) throw apiErr('server', 'Tidak bisa menghubungi server.'); return snap([member('host', true, true), member('kyra')]); });
    p.start(); await clock.advance(60_000);
    ok(log.gone.length === 0 && log.playing.length === 0, '60 dtk gagal terus: tidak ada onGone');
    ok(log.errs.length > 3 && log.errs[0] === 'Tidak bisa menghubungi server.', 'galat dilaporkan');
    ok(p.polls < 25, 'backoff: tidak membanjiri server (' + p.polls + ' request)');
    down = false; p.kick(); await clock.advance(100);
    ok(log.views.length === 1 && log.errs[log.errs.length - 1] === null, 'kick() setelah pulih: tamu terlihat, galat dibersihkan');
    p.stop(); }

  section('kick() menyegarkan segera (kembali dari WhatsApp)');
  { let guest = false;
    const { p, clock, log } = setup(async () => snap(guest ? [member('host', true, true), member('kyra')] : [member('host', true, true)]));
    p.start(); await clock.advance(100); guest = true;
    p.kick(); await clock.advance(10);
    ok(log.views.length === 2, 'tamu terlihat < 10 ms setelah kick');
    p.stop(); }

  section('status room');
  { const { p, clock, log } = setup(async () => snap([member('host', true, true), member('kyra')], 'playing'));
    p.start(); await clock.advance(100);
    ok(log.playing.length === 1 && log.playing[0].status === 'playing' && log.playing[0].hostId === 'host', 'status playing -> onPlaying sekali');
    await clock.advance(5000); ok(log.playing.length === 1 && p.polls === 1, 'polling berhenti setelah onPlaying'); p.stop(); }
  { const { p, clock, log } = setup(async () => { throw apiErr('room_closed'); });
    p.start(); await clock.advance(100);
    ok(log.gone.length === 1 && log.gone[0] === 'Room ditutup.', 'room_closed -> onGone'); p.stop(); }
  { let joins = 0, member_ = false;
    const { p, clock, log } = setup(async () => { if (!member_) throw apiErr('not_member'); return snap([member('host', true, true)]); }, { rejoin: async () => { joins++; member_ = true; } });
    p.start(); await clock.advance(3500);
    ok(joins === 1 && log.gone.length === 0 && log.views.length === 1, 'not_member -> gabung ulang sekali lalu pulih'); p.stop(); }
  { const { p, clock, log } = setup(async () => { throw apiErr('not_member'); }, { rejoin: async () => { throw apiErr('room_full', 'Room penuh.'); } });
    p.start(); await clock.advance(3500);
    ok(log.gone.length === 1 && log.gone[0] === 'Room penuh.', 'gabung ulang gagal -> onGone dengan pesan server'); p.stop(); }

  section('stop()');
  { const { p, clock } = setup(async () => snap([member('host', true, true)]));
    p.start(); await clock.advance(100); p.stop(); const n = p.polls; await clock.advance(20_000);
    ok(p.polls === n, 'tidak polling setelah stop'); }

  console.log(`\n${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})();
