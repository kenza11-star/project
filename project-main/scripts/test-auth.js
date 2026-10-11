// Uji validasi form auth (logika murni).
const path = require('path');
const V = require(path.join(__dirname, '..', '.tmp-ui', 'validate.js'));
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  GAGAL:', msg); } };

ok(V.validateUsername('abc') === null && V.validateUsername('Player_01.x-y') === null, 'username valid');
ok(V.validateUsername('ab') !== null && V.validateUsername('a'.repeat(17)) !== null, 'username terlalu pendek/panjang');
ok(V.validateUsername('bad name') !== null && V.validateUsername('a<b>c') !== null && V.validateUsername('émile') !== null, 'username dengan karakter terlarang ditolak');
ok(V.validateUsername('  abc  ') === null, 'spasi tepi di-trim');
ok(V.validateEmail('a@b.co') === null && V.validateEmail('x.y+z@mail.example.com') === null, 'email valid');
for (const bad of ['', 'abc', 'a@b', 'a@b.', '@b.com', 'a b@c.com', 'a@b.c']) ok(V.validateEmail(bad) !== null, `email tidak valid ditolak: "${bad}"`);
ok(V.validateEmail('a'.repeat(250) + '@b.com') !== null, 'email > 254 ditolak');
ok(V.validatePassword('12345678') === null && V.validatePassword('abcdefgh') === null, 'password 8 karakter diterima');
ok(V.validatePassword('1234567') !== null && V.validatePassword('x'.repeat(129)) !== null && V.validatePassword('        ') !== null, 'password terlalu pendek/panjang/spasi ditolak');

ok(Object.keys(V.validateLogin({ identifier: 'abc', password: 'x' })).length === 0, 'login lengkap lolos');
ok(V.validateLogin({ identifier: ' ', password: '' }).identifier && V.validateLogin({ identifier: ' ', password: '' }).password, 'login kosong ditolak');
ok(!V.validateLogin({ identifier: 'abc', password: 'pendek' }).password, 'login tidak memaksa aturan panjang password (itu urusan server)');

const good = { username: 'Player1', email: 'p@x.io', password: 'rahasia123', confirm: 'rahasia123' };
ok(!V.hasErrors(V.validateRegister(good)), 'register valid lolos');
ok(V.validateRegister({ ...good, confirm: 'beda' }).confirm, 'konfirmasi berbeda ditolak');
ok(V.validateRegister({ ...good, username: 'a' }).username && V.validateRegister({ ...good, email: 'x' }).email && V.validateRegister({ ...good, password: 'short', confirm: 'short' }).password, 'field register salah ditolak per field');
ok(Object.keys(V.validateRegister({ username: '', email: '', password: '', confirm: '' })).length === 4, 'semua field kosong -> 4 error');

console.log(`auth: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
