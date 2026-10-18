"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lateralLimit = exports.stairU = exports.STAIR_SPEED_MUL = exports.STAIR_MARGIN = void 0;
exports.stairFromExtras = stairFromExtras;
exports.stairHeight = stairHeight;
exports.inStairFootprint = inStairFootprint;
exports.stepAxis = stepAxis;
exports.movePlayer = movePlayer;
exports.floorTarget = floorTarget;
exports.canStandAt = canStandAt;
/** Margin kotak badan tangga (rel samping 5 cm) = sama dengan OBB `Stairs_A_*` di mapdata. */
exports.STAIR_MARGIN = 0.05;
const EXIT_HYST = 0.02;
/** Kecepatan jalan di tangga dibanding lantai datar. */
exports.STAIR_SPEED_MUL = 0.8;
function stairFromExtras(st) {
    if (!st || !st.direction || st.direction[0] === 0 || st.direction[2] !== 0)
        return null; // hanya tangga lurus sepanjang X
    const sgn = st.direction[0] > 0 ? 1 : -1;
    return {
        bx: st.bottom[0], zc: (st.bottom[2] + st.top[2]) / 2, sgn, run: st.run, hw: st.width / 2,
        rise: st.rise, steps: st.steps, baseY: st.bottom[1], tread: st.run / st.steps, stepH: st.rise / st.steps,
    };
}
const stairU = (S, x) => (x - S.bx) * S.sgn;
exports.stairU = stairU;
const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/**
 * Tinggi lantai di bawah pemain pada jarak u. Permukaan anak tangga ke-k pada GLB = baseY + stepH*(k+1) untuk u di [k*tread, (k+1)*tread)
 * (diverifikasi terhadap mesh Stairs_A_Steps). Kaki naik BERTAHAP tepat sebelum tepi tegak (riser) selebar RISE_FRAC tapak,
 * sehingga kaki/kamera tidak pernah tenggelam di bawah permukaan anak tangga dan tidak menyentak.
 */
const RISE_FRAC = 0.35;
function stairHeight(S, u) {
    const x = u + RISE_FRAC * S.tread; // dahului riser berikutnya sebesar lebar rampa
    if (x <= 0)
        return S.baseY;
    if (x >= S.run)
        return S.baseY + S.rise;
    const k = Math.floor(x / S.tread), frac = x / S.tread - k;
    return S.baseY + S.stepH * (k + sstep(frac / RISE_FRAC));
}
const lateralLimit = (S, R) => S.hw - R;
exports.lateralLimit = lateralLimit;
/** Apakah titik (x,z) berada di dalam bukaan tangga (di antara kedua ujung & lebar)? Dipakai untuk placement/validasi. */
function inStairFootprint(S, x, z, pad = 0) {
    const u = (0, exports.stairU)(S, x);
    return u >= -pad && u <= S.run + pad && Math.abs(z - S.zc) <= S.hw + pad;
}
/**
 * Satu langkah gerak sumbu-tunggal (ddx atau ddz). Mengembalikan true bila bergerak.
 * - Di tangga: hanya dibatasi lebar; melewati ujung = keluar ke lantai (level berganti di sini, BUKAN teleport: posisi tetap kontinu).
 * - Di lantai: collision normal; masuk tangga hanya lewat mulut (kaki di lantai 1 / ujung atas di lantai 2).
 */
function stepAxis(cw, S, p, ddx, ddz, R, topLevel = 1) {
    const nx = p.x + ddx, nz = p.z + ddz;
    if (!S) {
        if (cw.blocked(nx, nz, R, p.level))
            return false;
        p.x = nx;
        p.z = nz;
        return true;
    }
    const reach = exports.STAIR_MARGIN + R; // jarak titik pusat pemain dari ujung tangga saat menempel badan tangga
    const u = (0, exports.stairU)(S, nx), v = nz - S.zc, ucur = (0, exports.stairU)(S, p.x);
    if (p.onStairs) {
        if (Math.abs(v) > (0, exports.lateralLimit)(S, R) + 1e-6)
            return false; // dinding samping
        if (u <= -reach - EXIT_HYST) { // keluar di kaki tangga -> lantai bawah
            if (cw.blocked(nx, nz, R, 0))
                return false;
            p.x = nx;
            p.z = nz;
            p.onStairs = false;
            p.level = 0;
            return true;
        }
        if (u >= S.run + reach + EXIT_HYST) { // keluar di ujung atas -> lantai atas
            if (cw.blocked(nx, nz, R, topLevel))
                return false;
            p.x = nx;
            p.z = nz;
            p.onStairs = false;
            p.level = topLevel;
            return true;
        }
        p.x = nx;
        p.z = nz;
        return true;
    }
    // di lantai: mulut tangga
    const latOk = Math.abs(v) <= (0, exports.lateralLimit)(S, R) + 1e-6;
    if (latOk && p.level === 0 && p.y < S.baseY + 0.45 && ucur <= -reach + 1e-6 && u > -reach && u < 0.8) {
        p.x = nx;
        p.z = nz;
        p.onStairs = true;
        return true;
    }
    if (latOk && p.level === topLevel && p.y > S.baseY + S.rise - 0.45 && ucur >= S.run + reach - 1e-6 && u < S.run + reach && u > S.run - 0.8) {
        p.x = nx;
        p.z = nz;
        p.onStairs = true;
        return true;
    }
    if (cw.blocked(nx, nz, R, p.level))
        return false;
    p.x = nx;
    p.z = nz;
    return true;
}
/** Gerak pemain sejauh (dx,dz) dalam beberapa sub-langkah (frame lag tidak bisa menembus dinding tipis). */
function movePlayer(cw, S, p, dx, dz, R, topLevel = 1) {
    const n = Math.min(6, Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08)));
    for (let q = 0; q < n; q++) {
        stepAxis(cw, S, p, dx / n, 0, R, topLevel);
        stepAxis(cw, S, p, 0, dz / n, R, topLevel);
    }
}
/** Tinggi lantai target di bawah pemain (kamera mengikuti dengan interpolasi). */
function floorTarget(S, p, levelY) {
    if (S && p.onStairs)
        return stairHeight(S, (0, exports.stairU)(S, p.x));
    return levelY(p.level);
}
/** Bolehkah berdiri (setelah jongkok)? Di tangga: cukup lebar tangga, bukan grid. */
function canStandAt(cw, S, p, R) {
    if (S && p.onStairs)
        return Math.abs(p.z - S.zc) <= (0, exports.lateralLimit)(S, R) + 1e-6;
    return !cw.blocked(p.x, p.z, R, p.level);
}
