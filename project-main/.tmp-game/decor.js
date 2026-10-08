"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWallPlanes = extractWallPlanes;
exports.planDecor = planDecor;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Kumpulkan bidang dinding vertikal (koordinat x / z) dari satu mesh. m = matriks dunia kolom-mayor. */
function extractWallPlanes(pos, idx, m, outX, outZ) {
    const n = idx ? idx.length : Math.floor(pos.length / 3);
    const v = (k) => {
        const i = idx ? idx[k] : k, x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    for (let t = 0; t + 2 < n; t += 3) {
        const a = v(t), b = v(t + 1), c = v(t + 2);
        if (Math.max(a[1], b[1], c[1]) < 0.5 || Math.min(a[1], b[1], c[1]) > 1.8)
            continue; // hanya yang menutupi tinggi badan
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz);
        if (l < 1e-9 || Math.abs(ny / l) > 0.2)
            continue;
        if (Math.abs(nx / l) > 0.98)
            outX.add(Math.round(a[0] * 100) / 100);
        else if (Math.abs(nz / l) > 0.98)
            outZ.add(Math.round(a[2] * 100) / 100);
    }
}
// ---------- helper grid ----------
const inGrid = (nav, i, j) => i >= 0 && j >= 0 && i < nav.W && j < nav.H;
function occAt(nav, x, z, wallOnly = false) {
    const [i, j] = nav.cellOf(x, z);
    if (!inGrid(nav, i, j))
        return true;
    return (wallOnly ? nav.wallOnly : nav.occ)[j * nav.W + i] === 1;
}
/** Ada furniture/collider (bukan dinding) dalam radius? Dekor dijauhkan dari furniture (furniture bisa bergeser oleh event). */
function furnitureNear(nav, x, z, rad) {
    const [ci, cj] = nav.cellOf(x, z), n = Math.ceil(rad / 0.1);
    for (let dj = -n; dj <= n; dj++)
        for (let di = -n; di <= n; di++) {
            const i = ci + di, j = cj + dj;
            if (!inGrid(nav, i, j))
                continue;
            const k = j * nav.W + i;
            if (nav.occ[k] && !nav.wallOnly[k])
                return true;
        }
    return false;
}
const roomHeight = (o, x, z) => {
    for (const r of o.rooms)
        if (x >= r.rect.minx && x <= r.rect.maxx && z >= r.rect.minz && z <= r.rect.maxz)
            return r.height;
    return 2.8;
};
/** Bidang dinding yang menghadap ruangan: terdekat ke `est`, tetapi tetap di belakang `ref` (titik bebas) menurut arah normal `sgn`. */
function snapPlane(planes, est, sgn, ref) {
    let best = NaN;
    for (const p of planes) {
        if (Math.abs(p - est) > 0.12 || sgn * (p - ref) >= 0)
            continue;
        if (Number.isNaN(best) || sgn * p > sgn * best)
            best = p;
    }
    return Number.isNaN(best) ? est + sgn * 0.03 : best;
}
/** Titik di permukaan dinding + normal ke dalam ruangan + tangen. Item pusat = P + n * (setengah tebal). */
const at = (s, t, off) => ({ x: s.px + s.tx * t + s.nx * off, z: s.pz + s.tz * t + s.nz * off });
function planDecor(o) {
    const { nav, rng, counts } = o;
    const out = [];
    const taken = [];
    const near = (x, z, g) => taken.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(g, p.g));
    const avoided = (x, z) => o.avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r);
    const mark = (x, z, g = o.minGap) => taken.push({ x, z, g });
    const floorSpot = (gap) => {
        for (let tries = 0; tries < 1500; tries++) {
            const i = Math.floor(rng.range(0, nav.W)), j = Math.floor(rng.range(0, nav.H));
            if (!nav.isReachedCell(i, j))
                continue;
            const [x, z] = nav.center(i, j);
            if (avoided(x, z) || near(x, z, gap))
                continue;
            return { x, z };
        }
        return null;
    };
    const floorSpotNear = (gap) => {
        if (o.anchors.length && rng.chance(0.65)) {
            for (let tries = 0; tries < 40; tries++) {
                const a = rng.pick(o.anchors), ang = rng.range(0, Math.PI * 2), r = rng.range(0.9, 1.6);
                const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
                const [i, j] = nav.cellOf(x, z);
                if (!inGrid(nav, i, j) || !nav.isReachedCell(i, j) || avoided(x, z) || near(x, z, gap))
                    continue;
                return { x, z };
            }
        }
        return floorSpot(gap);
    };
    /** Dinding dalam 0.4-0.5 m dari sel yang bisa dijalani pemain, tanpa furniture di sekitarnya. */
    const wallSpot = (gap, minH = 0, y = 0) => {
        for (let tries = 0; tries < 2500; tries++) {
            const i = Math.floor(rng.range(0, nav.W)), j = Math.floor(rng.range(0, nav.H));
            if (!nav.isReachedCell(i, j))
                continue;
            const [x, z] = nav.center(i, j);
            if (avoided(x, z) || near(x, z, gap))
                continue;
            let hit = null;
            for (const [dx, dz] of DIRS)
                for (let k = 1; k <= 5; k++) {
                    const ci = i + dx * k, cj = j + dz * k;
                    if (!inGrid(nav, ci, cj))
                        break;
                    const q = cj * nav.W + ci;
                    if (nav.occ[q]) {
                        if (nav.wallOnly[q] && (!hit || k < hit.k))
                            hit = { k, dx, dz };
                        break;
                    }
                }
            if (!hit)
                continue;
            if (furnitureNear(nav, x, z, 0.9))
                continue;
            if (minH && roomHeight(o, x, z) < y + minH)
                continue;
            const nx = -hit.dx, nz = -hit.dz, cwx = x + hit.dx * hit.k * 0.1, cwz = z + hit.dz * hit.k * 0.1;
            const spot = nx !== 0
                ? { px: snapPlane(o.planesX, cwx, nx, x), pz: z, nx, nz: 0, tx: 0, tz: 1 }
                : { px: x, pz: snapPlane(o.planesZ, cwz, nz, z), nx: 0, nz, tx: 1, tz: 0 };
            return spot;
        }
        return null;
    };
    const faceYaw = (s) => Math.atan2(s.nx, s.nz); // +Z lokal menghadap ruangan
    const alongYaw = (s) => Math.atan2(-s.tz, s.tx); // +X lokal sejajar dinding
    // ---- kertas: gerombolan 1-3 lembar, sering dekat furniture ----
    for (let n = 0; n < counts.paper; n++) {
        const p = floorSpotNear(2.4);
        if (!p)
            break;
        mark(p.x, p.z, 2.4);
        const sheets = rng.int(1, 3);
        for (let s = 0; s < sheets; s++) {
            const x = p.x + rng.range(-0.3, 0.3), z = p.z + rng.range(-0.3, 0.3);
            if (occAt(nav, x, z))
                continue;
            out.push({ kind: 'paper', x, y: 0.014 + s * 0.002, z, yaw: rng.range(0, Math.PI * 2), sx: rng.range(0.19, 0.23), sy: 1, sz: rng.range(0.26, 0.31), shade: rng.range(0.72, 0.95) });
        }
    }
    // ---- noda lantai (reuse decal map) ----
    for (let n = 0; n < counts.stain; n++) {
        const p = floorSpot(3.2);
        if (!p)
            break;
        mark(p.x, p.z, 3.2);
        const s = rng.range(0.45, 0.85);
        out.push({ kind: 'stain', x: p.x, y: 0.004, z: p.z, yaw: rng.range(0, Math.PI * 2), sx: s, sy: 1, sz: s * rng.range(0.6, 1), shade: 1 });
    }
    // ---- kardus & benda kecil: hanya di jalur sempit antara dinding dan area jalan (tidak pernah menghalangi) ----
    for (let n = 0; n < counts.box; n++) {
        const s = wallSpot(2.8);
        if (!s)
            break;
        const w = rng.range(0.28, 0.4), h = rng.range(0.2, 0.34), d = rng.range(0.24, 0.32), t = rng.range(-0.15, 0.15);
        const c = at(s, t, 0.015 + d / 2);
        if (occAt(nav, c.x, c.z))
            continue;
        mark(c.x, c.z, 2.8);
        const yaw = faceYaw(s) + rng.range(-0.2, 0.2);
        out.push({ kind: 'box', x: c.x, y: 0, z: c.z, yaw, sx: w, sy: h, sz: d, shade: rng.range(0.7, 1) });
        if (rng.chance(0.4))
            out.push({ kind: 'box', x: c.x + rng.range(-0.03, 0.03), y: h, z: c.z, yaw: yaw + rng.range(-0.4, 0.4), sx: w * 0.7, sy: h * 0.6, sz: d * 0.8, shade: rng.range(0.6, 0.9) });
    }
    for (let n = 0; n < counts.can; n++) {
        const s = wallSpot(2.8);
        if (!s)
            break;
        const r = rng.range(0.09, 0.12), h = rng.range(0.2, 0.26), tipped = rng.chance(0.5);
        const c = at(s, rng.range(-0.15, 0.15), 0.015 + (tipped ? h / 2 : r));
        if (occAt(nav, c.x, c.z))
            continue;
        mark(c.x, c.z, 2.8);
        out.push(tipped
            ? { kind: 'can', x: c.x, y: r, z: c.z, yaw: faceYaw(s) + rng.range(-0.5, 0.5), sx: r * 2, sy: h, sz: r * 2, rz: Math.PI / 2, shade: 0.5 }
            : { kind: 'can', x: c.x, y: 0, z: c.z, yaw: rng.range(0, 6.28), sx: r * 2, sy: h, sz: r * 2, shade: 0.5 });
    }
    // ---- kabel di lantai (3 segmen agak berbelok, di sepanjang dinding) ----
    for (let n = 0; n < counts.cable; n++) {
        const s = wallSpot(3);
        if (!s)
            break;
        for (let attempt = 0; attempt < 6; attempt++) {
            const dir = rng.chance(0.5) ? 1 : -1;
            const st = at(s, rng.range(-0.3, 0.3), 0.11);
            let px = st.x, pz = st.z;
            let ang = Math.atan2(-s.tz * dir, s.tx * dir);
            const segs = [];
            let good = true;
            for (let k = 0; k < 3 && good; k++) {
                const len = rng.range(0.6, 1.0), dx = Math.cos(ang), dz = -Math.sin(ang);
                for (let u = 0; u <= len; u += 0.15)
                    if (occAt(nav, px + dx * u, pz + dz * u) || avoided(px + dx * u, pz + dz * u)) {
                        good = false;
                        break;
                    }
                segs.push({ kind: 'cable', x: px + dx * len / 2, y: 0.013, z: pz + dz * len / 2, yaw: ang, sx: len, sy: 0.22, sz: 0.22, shade: 0.28 });
                px += dx * len;
                pz += dz * len;
                ang += rng.range(-0.35, 0.35);
            }
            if (!good)
                continue;
            out.push(...segs);
            mark(s.px, s.pz, 3);
            break;
        }
    }
    // ---- pipa menempel di dinding dekat langit-langit (dinding harus menerus & ruang di depannya kosong) ----
    for (let n = 0; n < counts.pipe; n++) {
        const y = 2.3;
        let placedPipe = false;
        for (let attempt = 0; attempt < 14 && !placedPipe; attempt++) {
            const s = wallSpot(3.2, 0.35, y);
            if (!s)
                break;
            const free = (t) => { const w = at(s, t, -0.1), f = at(s, t, 0.14); return occAt(nav, w.x, w.z, true) && !occAt(nav, f.x, f.z); };
            for (const dir of [1, -1]) {
                let len = 0;
                for (let t = 0; t <= 3.2; t += 0.2) {
                    if (!free(t * dir))
                        break;
                    len = t;
                }
                if (len < 1.2)
                    continue;
                const mid = at(s, dir * len / 2, 0.045);
                out.push({ kind: 'pipe', x: mid.x, y, z: mid.z, yaw: alongYaw(s), sx: len, sy: 0.55, sz: 0.55, shade: rng.range(0.7, 1) });
                mark(s.px, s.pz, 3.2);
                placedPipe = true;
                break;
            }
        }
    }
    // ---- ventilasi: kisi rangka + bagian dalam gelap ----
    for (let n = 0; n < counts.vent; n++) {
        const high = rng.chance(0.6), y = high ? 2.15 : 0.3, s = wallSpot(3, 0.5, y);
        if (!s)
            break;
        const c = at(s, rng.range(-0.1, 0.1), 0.02);
        mark(s.px, s.pz, 3);
        out.push({ kind: 'vent', x: c.x, y, z: c.z, yaw: faceYaw(s), sx: 0.5, sy: 0.3, sz: 0.05, shade: 0.75 });
        out.push({ kind: 'vent', x: c.x + s.nx * 0.012, y, z: c.z + s.nz * 0.012, yaw: faceYaw(s), sx: 0.4, sy: 0.2, sz: 0.05, shade: 0.12 });
    }
    // ---- APAR & rambu peringatan ----
    for (let n = 0; n < counts.extinguisher; n++) {
        const s = wallSpot(5);
        if (!s)
            break;
        const c = at(s, 0, 0.065);
        mark(s.px, s.pz, 5);
        out.push({ kind: 'extinguisher', x: c.x, y: 0.75, z: c.z, yaw: faceYaw(s), sx: 1, sy: 1, sz: 1, shade: 1 });
    }
    for (let n = 0; n < counts.warning; n++) {
        const s = wallSpot(4);
        if (!s)
            break;
        const c = at(s, rng.range(-0.15, 0.15), 0.004);
        mark(s.px, s.pz, 4);
        out.push({ kind: 'warning', x: c.x, y: rng.range(1.5, 1.8), z: c.z, yaw: faceYaw(s), sx: 1, sy: 1, sz: 1, shade: rng.range(0.7, 1) });
    }
    // ---- rambu EXIT kecil di atas pintu biasa (bukan pintu exit asli) ----
    const cand = o.doors.filter((d) => d.level === 0 && d.type === 'door');
    rng.shuffle(cand);
    const exits = [];
    for (const d of cand) {
        if (exits.length >= counts.exit)
            break;
        const y = 2.4, ax = Math.abs(d.nx) > Math.abs(d.nz);
        if (roomHeight(o, d.cx, d.cz) < y + 0.3 || exits.some((e) => Math.hypot(e.x - d.cx, e.z - d.cz) < 8))
            continue;
        const sgn = rng.chance(0.5) ? 1 : -1, nx = ax ? Math.sign(d.nx) * sgn : 0, nz = ax ? 0 : Math.sign(d.nz) * sgn;
        const planes = ax ? o.planesX : o.planesZ, ctr = ax ? d.cx : d.cz, sg = ax ? nx : nz;
        let best = NaN;
        for (const p of planes)
            if (Math.abs(p - ctr) < 0.35 && (Number.isNaN(best) || sg * p > sg * best))
                best = p;
        if (Number.isNaN(best))
            continue;
        exits.push({ x: d.cx, z: d.cz });
        out.push({ kind: 'exit', x: ax ? best + nx * 0.03 : d.cx, y, z: ax ? d.cz : best + nz * 0.03, yaw: Math.atan2(nx, nz), sx: 0.7, sy: 0.7, sz: 0.7, shade: 1 });
    }
    return out;
}
