// Uji logika murni sisi backend/klien: pemetaan username<->email, aturan room, kunci karakter.
const path = require('path');
const D = path.join(__dirname, '..', '.tmp-backend');
const I = require(D + '/auth/identity.js'), R = require(D + '/net/roomrules.js'), C = require(D + '/character/config.js'), P = require(D + '/net/protocol.js');
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

console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
