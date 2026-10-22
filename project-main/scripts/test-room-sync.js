// Tes SINKRONISASI ROOM host <-> joiner: bug "joiner sudah 2/2 tetapi host tetap 1/2".
//
// APA YANG DIUJI: kode klien ASLI (RoomPoller, roomCounts, finalizeView) berbicara lewat HTTP NYATA dengan DUA sesi pengguna terpisah ke SATU backend
// yang sama. Backend pengujian = blitz-relay/server.js (createApp) -- implementasi in-memory dengan aturan keanggotaan/online yang sama dengan SQL
// (waiting: online 90 dtk / kursi 300 dtk; playing: 30 / 120). Waktu dipercepat 50x (jam server & klien sama-sama virtual) supaya skenario puluhan detik cepat.
//
// YANG TIDAK DIUJI DI SINI (butuh Supabase/Postgres sungguhan): fungsi SQL (join_room, room_state, ...), route Next.js, Firebase. Untuk SQL ada pemeriksaan
// statis konsistensi konstanta di bagian terakhir; uji SQL penuh = `npm run test:sql` (butuh Postgres lokal) dan tes dua HP setelah deploy.
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..');
const { createApp } = require(path.join(root, 'blitz-relay', 'server.js'));
const { RoomPoller } = require(path.join(root, '.tmp-room', 'roompoller.js'));
const { roomCounts } = require(path.join(root, '.tmp-room', 'roomcounts.js'));
const { finalizeView } = require(path.join(root, '.tmp-room', 'roomview.js'));
const rules = require(path.join(root, '.tmp-room', 'roomrules.js'));

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 4000, label = '') { const t = Date.now(); while (Date.now() - t < ms) { try { if (await cond()) return true; } catch { /* coba lagi */ } await sleep(5); } return false; }

const SCALE = 50, T0 = Date.now();
const vnow = () => 1_000_000_000 + Math.floor((Date.now() - T0) * SCALE);
const vclock = { now: vnow, setInterval: (f, ms) => setInterval(f, Math.max(1, ms / SCALE)), clearInterval: (h) => clearInterval(h) };
const vms = (virtualSeconds) => Math.ceil((virtualSeconds * 1000) / SCALE); // detik virtual -> ms nyata

const USERS = { kyraa: 'uid-kyraa-0000000000000000', ramzz: 'uid-ramzz-0000000000000000', tiga: 'uid-tiga-00000000000000000', empat: 'uid-empat-0000000000000000' };
async function startBackend() {
  const server = createApp({ now: vnow, verify: async (tok) => { const n = Object.keys(USERS).find((k) => USERS[k] === tok); if (!n) throw new Error('bad'); return { uid: 'user-' + n, name: n }; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}
const apiErr = (code, status = 0) => Object.assign(new Error(code), { code, status });

/** Satu "browser"/sesi pengguna: token sendiri + saklar gangguan jaringan/server untuk skenario gagal. */
function session(name, base) {
  const s = { name, uid: 'user-' + name, down: false, http500: 0, hang: 0, replay: null, calls: 0 };
  s.call = async (method, p, body) => {
    s.calls++;
    if (s.hang > 0) { s.hang--; return new Promise(() => {}); }              // request menggantung selamanya (tab dibekukan / token macet)
    if (s.down) throw apiErr('server');                                       // jaringan putus
    if (s.http500 > 0) { s.http500--; throw apiErr('server', 500); }         // server/DB gagal
    if (s.replay && p.startsWith('/api/rooms/state')) { const r = s.replay; s.replay = null; return JSON.parse(JSON.stringify(r)); } // jawaban basi dari cache/instance lambat
    const res = await fetch(base + p, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + USERS[name] }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch { /* */ }
    if (!res.ok) throw apiErr(j?.error?.code || 'server', res.status);
    return j;
  };
  s.create = (n) => s.call('POST', '/api/rooms', { maxPlayers: n });
  s.join = (code) => s.call('POST', '/api/rooms/join', { code });
  s.state = (id) => s.call('GET', '/api/rooms/state?roomId=' + id);
  s.start = (id) => s.call('POST', '/api/rooms/start', { roomId: id });
  s.leave = (id) => s.call('POST', '/api/rooms/leave', { roomId: id });
  s.hb = (id) => s.call('POST', '/api/rooms/heartbeat', { roomId: id });
  return s;
}
/** Poller klien ASLI untuk satu sesi. `view` = snapshot terakhir yang diterapkan, `shown()` = teks "x/y" seperti di UI. */
function watch(s, room) {
  const w = { views: [], errs: [], playing: [], gone: [], view: null, diag: [], room };
  w.p = new RoomPoller({ room, selfId: s.uid, clock: vclock, fetchState: (id) => s.state(id), rejoin: (c) => s.join(c),
    onView: (v) => { w.view = v; w.views.push(v); }, onErr: (m) => w.errs.push(m), onPlaying: (r) => w.playing.push(r), onGone: (m) => w.gone.push(m), onDiag: (ev, d) => w.diag.push([ev, d]) });
  w.shown = () => { const c = roomCounts(w.view, room.maxPlayers); return c.online + '/' + c.max; };
  w.start = () => { w.p.start(); return w; };
  return w;
}
const names = (v) => (v ? v.members.map((m) => `${m.slot}:${m.id}:${m.name}:${m.online}`).join('|') : '');

(async () => {
  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('1-5. host membuat room, joiner masuk dengan kode, host melihat 1/2 -> 2/2, daftar pemain sama');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2);
    ok(room.code && room.code.length === 6 && room.status === 'waiting' && room.slot === 0 && room.hostId === host.uid, 'host membuat room (kode 6 karakter, slot 0, host = pembuat)');
    ok(room.backend === 'relay', 'respons create memuat identitas backend');
    const hw = watch(host, room).start();
    ok(await until(() => hw.view), 'host menerima snapshot pertama');
    ok(hw.shown() === '1/2' && !roomCounts(hw.view, 2).ready, 'host awal: 1/2 dan belum boleh Mulai');
    const jr = await joiner.join(room.code);
    ok(jr.roomId === room.roomId && jr.slot === 1, 'joiner masuk ke room yang SAMA (roomId sama), slot 1');
    const jw = watch(joiner, jr).start();
    const s1 = await host.state(room.roomId), s2 = await joiner.state(room.roomId);
    ok(s1.members.length === 2 && s1.online_count === 2 && s1.can_start === true, 'backend mencatat tepat 2 anggota aktif; server menghitung online_count=2 dan can_start');
    ok(names(s1) === names(s2) && s1.online_count === s2.online_count, 'host & joiner membaca daftar anggota yang sama dari server');
    ok(await until(() => hw.shown() === '2/2', 3000), 'REGRESI SCREENSHOT: host berubah dari 1/2 menjadi 2/2 setelah joiner masuk');
    ok(await until(() => jw.shown() === '2/2'), 'joiner juga 2/2');
    ok(names(hw.view) === names(jw.view) && names(hw.view).split('|').length === 2, 'tampilan host & joiner: daftar pemain identik (2 baris, identitas benar)');
    ok(roomCounts(hw.view, 2).ready && roomCounts(jw.view, 2).ready, 'tombol Mulai siap menurut server di kedua sisi (host saja yang memakainya)');
    ok(hw.views.some((v) => v.online_count === 1) && hw.view.online_count === 2, 'urutan snapshot host: 1 pemain online lalu 2 pemain online');
    hw.p.stop(); jw.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('6. join berulang / paralel tidak membuat duplikasi');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2);
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => joiner.join(room.code)));
    ok(rs.every((r) => r.slot === 1 && r.roomId === room.roomId), '6 request join paralel: semuanya sukses dengan slot yang sama');
    await joiner.join(room.code); await host.join(room.code);
    const st = await host.state(room.roomId);
    ok(st.members.length === 2 && new Set(st.members.map((m) => m.id)).size === 2, 'tetap tepat 2 anggota unik (host yang "join" kode sendiri juga tidak menggandakan)');
    ok(st.members.find((m) => m.host).id === host.uid && st.host_id === host.uid, 'host tetap host yang sah');
    const intruder = session('tiga', B.base);
    let code = ''; try { await intruder.join(room.code); } catch (e) { code = e.code; }
    ok(code === 'room_full', 'pemain ketiga ditolak (room_full) dan tidak mengubah daftar');
    ok((await host.state(room.roomId)).members.length === 2, 'daftar anggota tidak berubah setelah penolakan');
    await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('7-8. hanya host yang bisa Mulai; syarat jumlah pemain; kedua layar menerima status "playing" yang sama');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2);
    const hw = watch(host, room).start();
    let e1 = ''; try { await host.start(room.roomId); } catch (e) { e1 = e.code; }
    ok(e1 === 'not_ready', 'host sendirian tidak bisa Mulai (not_ready) -- validasi di server, bukan hanya tombol');
    ok((await host.state(room.roomId)).status === 'waiting', 'status room tetap waiting setelah start ditolak');
    const jr = await joiner.join(room.code); const jw = watch(joiner, jr).start();
    ok(await until(() => hw.shown() === '2/2' && jw.shown() === '2/2'), 'kedua layar 2/2 sebelum Mulai');
    let e2 = ''; try { await joiner.start(room.roomId); } catch (e) { e2 = e.code; }
    ok(e2 === 'not_host', 'joiner tidak bisa Mulai (not_host)');
    const r = await host.start(room.roomId);
    ok(r.status === 'playing' && r.players === 2, 'host berhasil Mulai dengan 2 pemain aktif');
    ok(await until(() => hw.playing.length === 1 && jw.playing.length === 1), 'host DAN joiner sama-sama menerima status playing (tepat satu kali)');
    ok(hw.playing[0].roomId === jw.playing[0].roomId && hw.playing[0].status === 'playing' && jw.playing[0].status === 'playing', 'kedua pemain masuk gameplay room yang sama');
    ok(jw.playing[0].slot === 1 && hw.playing[0].slot === 0, 'slot tiap pemain benar saat masuk game');
    ok((await host.start(room.roomId)).status === 'playing', 'Mulai ditekan dua kali = idempoten (tidak error / tidak mengulang)');
    let e3 = ''; try { await session('tiga', B.base).join(room.code); } catch (e) { e3 = e.code; }
    ok(e3 === 'room_started' || e3 === 'room_full', 'pemain baru tidak bisa masuk ke game yang sudah berjalan');
    hw.p.stop(); jw.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('9. keluar & masuk kembali; keluar tidak mengganggu anggota lain');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2); const jr = await joiner.join(room.code);
    const hw = watch(host, room).start(); const jw = watch(joiner, jr).start();
    ok(await until(() => hw.shown() === '2/2' && jw.shown() === '2/2'), 'awal 2/2');
    await jw.p.stop(); await joiner.leave(room.roomId);
    ok(await until(() => hw.shown() === '1/2'), 'joiner keluar: host kembali 1/2');
    ok(hw.gone.length === 0 && hw.view.host_id === host.uid && hw.view.members.length === 1 && hw.view.members[0].id === host.uid, 'keluarnya joiner tidak mengeluarkan host / tidak mengganti host');
    const jr2 = await joiner.join(room.code); const jw2 = watch(joiner, jr2).start();
    ok(jr2.slot === 1, 'masuk kembali mendapat slot yang sama');
    ok(await until(() => hw.shown() === '2/2' && jw2.shown() === '2/2'), 'masuk kembali: host & joiner 2/2 lagi');
    ok((await host.state(room.roomId)).members.length === 2, 'tidak ada baris ganda setelah keluar-masuk');
    hw.p.stop(); jw2.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('10. heartbeat/polling gagal sementara lalu pulih (tanpa dikeluarkan)');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2); const jr = await joiner.join(room.code);
    const hw = watch(host, room).start(); const jw = watch(joiner, jr).start();
    ok(await until(() => hw.shown() === '2/2' && jw.shown() === '2/2'), 'awal 2/2');
    joiner.down = true;                                  // jaringan joiner putus ~20 dtk (virtual) < 90 dtk
    await sleep(vms(20));
    ok(jw.errs.some((m) => m), 'joiner melaporkan galat sinkron (bukan diam)');
    ok(jw.gone.length === 0 && jw.playing.length === 0, 'gagal sebentar TIDAK mengeluarkan joiner dan tidak memulai game');
    ok(hw.shown() === '2/2', 'host masih melihat 2/2 selama gangguan singkat (kursi & online ditahan)');
    joiner.down = false;
    ok(await until(() => jw.errs[jw.errs.length - 1] === null, 3000), 'joiner pulih sendiri (galat dibersihkan)');
    ok(hw.shown() === '2/2' && jw.shown() === '2/2', 'setelah pulih: 2/2 di kedua sisi');
    joiner.down = true;                                  // gangguan LAMA: ~120 dtk virtual (> 90 online, < 300 kursi)
    await sleep(vms(120));
    ok(await until(() => hw.shown() === '1/2', 3000) && hw.view.members.length === 2 && hw.view.members.some((m) => !m.online), 'gangguan lama: host melihat joiner OFFLINE tetapi kursi masih ditahan (menyambung...)');
    joiner.down = false;
    ok(await until(() => hw.shown() === '2/2' && jw.shown() === '2/2', 3000), 'joiner pulih tanpa gabung ulang: 2/2 kembali');
    ok(hw.gone.length === 0 && jw.gone.length === 0, 'tidak ada yang dikeluarkan sepanjang gangguan');
    // kursi terlepas di server (mis. koneksi lama putus) -> klien gabung ulang otomatis SEKALI
    await joiner.leave(room.roomId);
    ok(await until(() => jw.diag.some((d) => d[0] === 'rejoin'), 3000) && await until(() => hw.shown() === '2/2' && jw.shown() === '2/2', 3000), 'kursi dilepas server: klien gabung ulang otomatis dan 2/2 pulih');
    ok((await host.state(room.roomId)).members.length === 2, 'tidak ada duplikasi setelah gabung ulang otomatis');
    hw.p.stop(); jw.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('11. API/database gagal: tidak ada status sukses palsu');
  {
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2);
    const hw = watch(host, room); host.http500 = 3; hw.start();                       // 3 request pertama host: 500
    await sleep(vms(6));
    ok(hw.view === null && hw.errs.some((m) => m), 'selama server 500 host TIDAK menampilkan snapshot karangan (view null) dan melaporkan galat');
    ok(await until(() => hw.view && hw.shown() === '1/2', 4000) && hw.errs[hw.errs.length - 1] === null, 'server pulih: snapshot asli muncul, galat dibersihkan');
    // join gagal -> tidak ada sukses palsu & tidak ada keanggotaan
    joiner.http500 = 1; let jerr = '';
    try { await joiner.join(room.code); } catch (e) { jerr = e.code; }
    ok(jerr === 'server', 'join yang gagal melempar galat (bukan sukses palsu)');
    ok((await host.state(room.roomId)).members.length === 1, 'join gagal tidak menambah anggota');
    const jr = await joiner.join(room.code); const jw = watch(joiner, jr).start();
    // start gagal -> status tetap waiting, tidak ada "playing" palsu
    host.http500 = 1; let serr = '';
    try { await host.start(room.roomId); } catch (e) { serr = e.code; }
    ok(serr === 'server' && (await host.state(room.roomId)).status === 'waiting', 'start yang gagal tidak mengubah status room');
    await sleep(vms(5));
    ok(hw.playing.length === 0 && jw.playing.length === 0, 'tidak ada layar yang masuk gameplay setelah start gagal');
    hw.p.stop(); jw.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('REGRESI SCREENSHOT: joiner sudah 2/2, host tidak boleh tertinggal di 1/2');
  {
    // (a) request host menggantung (tab/token macet) tepat saat joiner masuk
    const B = await startBackend(); const host = session('kyraa', B.base), joiner = session('ramzz', B.base);
    const room = await host.create(2);
    host.hang = 2;                                                                    // 2 request polling pertama host tidak pernah selesai
    const hw = watch(host, room).start();
    const jr = await joiner.join(room.code); const jw = watch(joiner, jr).start();
    ok(await until(() => jw.shown() === '2/2'), 'joiner melihat 2/2 (kondisi di screenshot kedua)');
    ok(await until(() => hw.shown() === '2/2', 5000), 'host tetap konvergen ke 2/2: request macet ditinggalkan dan diganti request baru');
    ok(host.calls >= 3, 'host mengirim ulang request (polling tidak berhenti diam-diam)');
    // (b) jawaban BASI (1 pemain) dari cache/instance lambat datang setelah host sudah 2/2
    const stale = JSON.parse(JSON.stringify(hw.view)); stale.members = stale.members.slice(0, 1); stale.online_count = 1; stale.member_count = 1; stale.can_start = false; stale.server_time = new Date(vnow() - 20_000).toISOString();
    const seen = hw.views.length; host.replay = stale;
    await sleep(vms(8));
    ok(hw.shown() === '2/2' && roomCounts(hw.view, 2).ready, 'snapshot basi (server_time lebih tua) dibuang: host tidak kembali ke 1/2');
    ok(hw.views.slice(seen).every((v) => v.online_count === 2), 'host TIDAK PERNAH sempat menampilkan 1/2 setelah snapshot basi datang (tidak ada kedipan)');
    ok(hw.diag.some((d) => d[0] === 'stale_snapshot_dropped'), 'pembuangan snapshot basi tercatat di diagnostik');
    // (c) joiner dan host sama-sama sibuk dengan operasi bersamaan (dua sesi terpisah, satu room)
    await Promise.all([joiner.hb(room.roomId), host.hb(room.roomId), joiner.join(room.code), host.state(room.roomId), joiner.state(room.roomId)]);
    ok(names(hw.view) === names(jw.view), 'dua sesi memakai room yang sama bersamaan: daftar pemain tetap identik');
    hw.p.stop(); jw.p.stop(); await B.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('hitungan pemain dari SERVER (finalizeView / roomCounts)');
  {
    const base = { status: 'waiting', max_players: 2, members: [{ online: true }, { online: false }] };
    const v = finalizeView(base, { backend: 'b1', build: 'x', nowMs: 1000 });
    ok(v.online_count === 1 && v.member_count === 2 && v.can_start === false && v.backend === 'b1' && v.server_time === new Date(1000).toISOString(), 'anggota offline tidak dihitung aktif; can_start false');
    ok(finalizeView({ ...base, members: [{ online: true }, { online: true }] }, { backend: 'b', build: 'x' }).can_start === true, '2 online + waiting = can_start');
    ok(finalizeView({ status: 'playing', max_players: 2, members: [{ online: true }, { online: true }] }, { backend: 'b', build: 'x' }).can_start === false, 'status playing: can_start false');
    ok(roomCounts({ status: 'waiting', max_players: 2, members: [{ online: true }, { online: true }] }, 2).ready === true, 'server lama tanpa online_count: dihitung dari members[].online (bukan dari karakter yang dirender)');
    ok(roomCounts({ status: 'waiting', max_players: 2, members: [{ online: true }], online_count: 2, can_start: true }, 2).online === 2, 'angka server diutamakan');
    ok(roomCounts(null, 2).online === 1 && roomCounts(null, 3).max === 3, 'tanpa snapshot: 1 pemain (diri sendiri), kapasitas dari sesi room');
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------
  section('konsistensi aturan SQL / fallback tabel / relay / klien (pemeriksaan statis)');
  {
    const v3 = fs.readFileSync(path.join(root, 'supabase', 'migration_v3_presence.sql'), 'utf8');
    const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
    const relay = fs.readFileSync(path.join(root, 'blitz-relay', 'server.js'), 'utf8');
    for (const [label, src] of [['migration_v3', v3], ['schema.sql', schema]]) {
      const m = /room_online_seconds\(p_status text\)[\s\S]*?then (\d+) else (\d+)/.exec(src);
      ok(m && Number(m[1]) === rules.ROOM_WAITING_ONLINE_SECONDS, `${label}: online (waiting) = ${rules.ROOM_WAITING_ONLINE_SECONDS} dtk sama dengan klien/fallback`);
      ok(m && Number(m[2]) === rules.ROOM_ONLINE_SECONDS, `${label}: online (playing) = ${rules.ROOM_ONLINE_SECONDS} dtk`);
      const k = /room_seat_seconds\(p_status text\)[\s\S]*?then (\d+) else (\d+)/.exec(src); ok(k && Number(k[1]) === rules.ROOM_WAITING_SEAT_SECONDS && Number(k[2]) === rules.ROOM_STALE_SECONDS, `${label}: kursi ${rules.ROOM_WAITING_SEAT_SECONDS}/${rules.ROOM_STALE_SECONDS} dtk`);
    }
    ok(/ONLINE_S = \{ waiting: 90, playing: 30 \}/.test(relay) && /SEAT_S = \{ waiting: 300, playing: 120 \}/.test(relay), 'relay: aturan online/kursi sama dengan SQL');
    // definisi fungsi room_view & join_room TERAKHIR di schema.sql harus identik dengan migration_v3 (proyek baru = proyek yang di-migrasi)
    const grab = (src, fn) => { const all = [...src.matchAll(new RegExp('create or replace function public\\.' + fn + '\\([\\s\\S]*?\\$\\$;', 'g'))].map((x) => x[0].replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()); return all[all.length - 1]; };
    for (const fn of ['room_view', 'join_room', 'start_room']) ok(grab(schema, fn) && grab(schema, fn) === grab(v3, fn), `schema.sql dan migration_v3 memakai definisi ${fn} yang IDENTIK`);
    ok(/room_online_seconds\('waiting'\)/.test(fs.readFileSync(path.join(root, 'supabase', 'migration_v4_room_consistency.sql'), 'utf8')), 'migration_v4: send_invite memakai aturan online yang sama dengan room_view');
  }

  console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('TES CRASH:', e); process.exit(2); });
