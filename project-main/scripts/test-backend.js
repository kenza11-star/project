// Uji logika murni sisi backend/klien: pemetaan username<->email, aturan room, kunci karakter.
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-backend');
const I = require(D + '/auth/identity.js'), R = require(D + '/net/roomrules.js'), C = require(D + '/character/config.js'), P = require(D + '/net/protocol.js'), U = require(D + '/net/appupdate.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

section('identitas username <-> email Firebase');
ok(I.usernameToEmail('Kyraa') === 'kyraa@' + I.DEFAULT_AUTH_EMAIL_DOMAIN, 'username dinormalkan huruf kecil + domain internal');
ok(I.emailToUsername(I.usernameToEmail('Kyraa')) === 'kyraa', 'round trip');
ok(I.emailToUsername('someone@gmail.com') === null, 'email dari domain lain ditolak (akun bukan akun game)');
ok(I.emailToUsername('a@' + I.DEFAULT_AUTH_EMAIL_DOMAIN) === null, 'username terlalu pendek ditolak');
ok(I.emailToUsername('bad name@' + I.DEFAULT_AUTH_EMAIL_DOMAIN) === null, 'username berisi spasi ditolak');
ok(I.emailToUsername(null) === null && I.emailToUsername(42) === null, 'bukan string ditolak');
ok(I.emailToUsername('x@y@' + I.DEFAULT_AUTH_EMAIL_DOMAIN) === null, 'karakter @ ganda ditolak');
ok(I.emailToUsername('abc@' + I.DEFAULT_AUTH_EMAIL_DOMAIN.toUpperCase()) === 'abc', 'domain tidak peka huruf besar/kecil');

section('aturan room');
ok(R.generateRoomCode((n) => 0) === 'AAAAAA' && R.generateRoomCode((n) => n - 1).length === 6, 'panjang kode 6');
{ let seen = new Set(); for (let i = 0; i < 2000; i++) for (const ch of R.generateRoomCode((n) => Math.floor(Math.random() * n))) seen.add(ch); ok(![...seen].some((c) => 'O0I1L'.includes(c)), 'kode tanpa karakter mudah tertukar'); ok(seen.size === R.ROOM_CODE_ALPHABET.length, 'semua karakter alfabet bisa muncul'); }
ok(/^[A-HJKMNP-Z2-9]{6}$/.test(R.generateRoomCode((n) => Math.floor(Math.random() * n))), 'format kode cocok dengan CHECK di SQL');
ok(R.normalizeRoomCode(' abc-234 ') === 'ABC234', 'normalisasi kode (spasi, minus, huruf kecil)');
for (const bad of ['ABC23', 'ABC2345', 'ABCO34', 'ABC 23', '', null, 123, {}]) ok(R.normalizeRoomCode(bad) === null, 'kode ditolak: ' + JSON.stringify(bad));
ok(R.validMaxPlayers(2) && R.validMaxPlayers(3) && R.validMaxPlayers(4) && R.validMaxPlayers(5) && R.validMaxPlayers(6), 'max pemain 2-6 valid');
for (const bad of [1, 7, 0, -1, 2.5, '3', null, NaN]) ok(!R.validMaxPlayers(bad), 'max pemain ditolak: ' + String(bad));
ok(R.MAX_ROOM_PLAYERS === undefined && P.MAX_ROOM_PLAYERS === 6, 'batas protokol = 6');
ok(R.validRoomId('fa5922ff-b1c6-4ba7-b28e-d59755090a2e') && !R.validRoomId('x') && !R.validRoomId("fa5922ff-b1c6-4ba7-b28e-d59755090a2e'; drop") && !R.validRoomId(5), 'validasi uuid room');
ok(R.validDisplayName('Kyraa') && R.validDisplayName('Ana Bell_1') && !R.validDisplayName('ab') && !R.validDisplayName('x'.repeat(17)) && !R.validDisplayName('<script>') && !R.validDisplayName(5), 'validasi display name');
ok(Object.keys(R.ROOM_ERROR_TEXT).every((k) => R.ROOM_ERROR_TEXT[k].length > 3), 'semua kode error punya teks');
ok(R.ROOM_STALE_SECONDS === 120, 'ambang stale sama dengan SQL (120 dtk)');
{ const sql = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8'); ok(sql.includes(`interval '${R.ROOM_STALE_SECONDS} seconds'`), 'ambang stale di schema.sql cocok dengan konstanta TS'); ok(sql.includes('between 2 and 4'), 'schema.sql membatasi 2-4 pemain'); }

section('karakter terkunci');
ok(C.CHARACTER_SELECTION_ENABLED === false, 'pemilihan karakter terkunci');
ok(C.COMING_SOON_TEXT === 'COMING SOON', 'teks modal persis "COMING SOON"');
for (const req of ['default', 'vrm-custom', '', null, undefined, 'x'.repeat(99)]) ok(C.resolveCharacterModel(req) === 'default', 'model dipaksa default selagi terkunci: ' + String(req));

section('notifikasi update (versi + Later + deteksi app)');
ok(U.isNewer('1.10.0', '1.9.0') && !U.isNewer('1.9.0', '1.10.0'), 'versi dibandingkan sebagai angka (1.10 > 1.9)');
ok(U.cmpVer('1.0', '1.0.0') === 0 && U.cmpVer('v2.0.0', '1.99.99') === 1, 'segmen kosong = 0; awalan v diterima');
ok(U.cmpVer('abc', '1.0.0') === null && U.cmpVer('1.0.0', null) === null && !U.isNewer('x', '1.0.0'), 'versi tidak valid -> bukan update');
ok(!U.isNewer('1.0.0', '1.0.0') && !U.isNewer('1.0.0', '1.2.0'), 'sama/lebih lama -> tidak ada update');
const NOW = 1e12, INFO = { update: true, version: '1.2.0', notes: [], message: '', url: 'https://x.supabase.co/a.apk' };
ok(U.shouldShow(INFO, null, NOW), 'tanpa Later -> tampil');
ok(!U.shouldShow(INFO, { v: '1.2.0', t: NOW - 3600e3 }, NOW), 'Later 1 jam lalu (versi sama) -> sembunyi');
ok(U.shouldShow(INFO, { v: '1.2.0', t: NOW - 25 * 3600e3 }, NOW), 'Later > 24 jam -> tampil lagi');
ok(U.shouldShow({ ...INFO, version: '1.3.0' }, { v: '1.2.0', t: NOW - 3600e3 }, NOW), 'versi LEBIH BARU dari yang ditunda -> tampil lagi');
ok(!U.shouldShow(INFO, { v: '1.3.0', t: NOW - 3600e3 }, NOW), 'Later untuk versi lebih baru masih berlaku');
ok(U.shouldShow(INFO, { v: '1.2.0', t: NOW + 99e9 }, NOW), 'jam Later di masa depan dianggap kedaluwarsa');
ok(!U.shouldShow(null, null, NOW) && !U.shouldShow({ update: false }, null, NOW) && !U.shouldShow({ ...INFO, url: 'http://x' }, null, NOW) && !U.shouldShow({ ...INFO, version: 'zz' }, null, NOW), 'data kosong/tidak valid -> diam');
ok(U.parseLater('{bad') === null && U.parseLater(null) === null && U.parseLater('{"v":"1.0.0","t":5}').t === 5, 'parse Later aman terhadap data rusak');
const WV = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/120 Mobile Safari/537.36';
ok(U.isAppRuntime(WV, false) && U.isAppRuntime('x', true) && U.isAppRuntime('Mozilla NightRound/1.1.0', false), 'WebView/standalone/marker UA = app');
ok(!U.isAppRuntime('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', false) && !U.isAppRuntime('Mozilla/5.0 (Windows NT 10.0) Chrome/120', false), 'browser biasa = bukan app');
ok(U.clientVersion('A NightRound/1.4.2 B', '1.0.0') === '1.4.2' && U.clientVersion(WV, '1.0.0') === '1.0.0', 'versi klien dari marker UA, fallback APP_VERSION');

console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
