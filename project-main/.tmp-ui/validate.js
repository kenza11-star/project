"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasErrors = exports.PASSWORD_MAX = exports.PASSWORD_MIN = exports.USERNAME_MAX = exports.USERNAME_MIN = void 0;
exports.validateUsername = validateUsername;
exports.validatePassword = validatePassword;
exports.validateLogin = validateLogin;
exports.validateRegister = validateRegister;
// Validasi form login/register (logika murni, dites di scripts/test-auth.js).
// Ini HANYA validasi bentuk input di sisi klien supaya pesan error cepat. Keamanan sebenarnya (hash password, rate limit,
// cek duplikat, sesi) wajib dilakukan backend; jangan mengandalkan validasi ini.
exports.USERNAME_MIN = 3, exports.USERNAME_MAX = 16, exports.PASSWORD_MIN = 8, exports.PASSWORD_MAX = 128;
function validateUsername(v) {
    const n = v.trim();
    if (n.length < exports.USERNAME_MIN || n.length > exports.USERNAME_MAX)
        return `Username harus ${exports.USERNAME_MIN}-${exports.USERNAME_MAX} karakter`;
    if (!/^[A-Za-z0-9_.-]+$/.test(n))
        return 'Username hanya boleh huruf, angka, titik, minus, dan garis bawah';
    return null;
}
function validatePassword(v) {
    if (v.length < exports.PASSWORD_MIN)
        return `Password minimal ${exports.PASSWORD_MIN} karakter`;
    if (v.length > exports.PASSWORD_MAX)
        return `Password maksimal ${exports.PASSWORD_MAX} karakter`;
    if (!v.trim())
        return 'Password tidak boleh hanya spasi';
    return null;
}
function validateLogin(i) {
    const e = {};
    const id = i.username.trim();
    if (!id)
        e.username = 'Isi username';
    else if (id.length > exports.USERNAME_MAX)
        e.username = 'Terlalu panjang';
    if (!i.password)
        e.password = 'Isi password';
    return e;
}
function validateRegister(i) {
    const e = {};
    const u = validateUsername(i.username);
    if (u)
        e.username = u;
    const p = validatePassword(i.password);
    if (p)
        e.password = p;
    if (!e.password && i.confirm !== i.password)
        e.confirm = 'Konfirmasi password tidak sama';
    else if (e.password && !i.confirm)
        e.confirm = 'Isi konfirmasi password';
    return e;
}
const hasErrors = (e) => Object.keys(e).length > 0;
exports.hasErrors = hasErrors;
