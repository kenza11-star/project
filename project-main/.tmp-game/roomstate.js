"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planRoomState = planRoomState;
exports.planShift = planShift;
// Variasi kecil kondisi ruangan per seed (logika murni, tanpa three.js, bisa dites):
// pintu terbuka, lampu redup/berkedip, container kosong sudah terbuka, furniture sedikit bergeser, jumlah dekor.
// Layout utama tidak berubah; semua variasi hanya memilih dari kandidat yang aman (jauh dari spawn/exit, tidak menyentuh key).
const collision_1 = require("./collision");
const layout_1 = require("./layout");
const far = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) >= r;
/** Ambil n (acak dalam [lo,hi], maks `frac` dari kandidat) indeks dari daftar kandidat. */
const take = (rng, c, [lo, hi], frac) => rng.shuffle(c.slice()).slice(0, Math.min(rng.int(lo, hi), Math.floor(c.length * frac)));
function planRoomState(o) {
    const { rng, cfg } = o;
    const doorC = [];
    o.doors.forEach((d, i) => { if (d.type === 'door' && !d.locked && d.level === 0 && far(o.spawn, d.cx, d.cz, 3.5) && far(o.exit, d.cx, d.cz, 4))
        doorC.push(i); });
    const lightC = [];
    o.lights.forEach((l, i) => { if (far(o.spawn, l.x, l.z, 7) && far(o.exit, l.x, l.z, 7))
        lightC.push(i); }); // sekitar spawn & exit tetap terang
    const contC = o.containers.filter((c) => far(o.spawn, c.x, c.z, 3.5));
    const lights = take(rng, lightC, cfg.lights, 0.3);
    const dimLights = [], flickerLights = [];
    for (const i of lights)
        (rng.chance(0.5) ? dimLights : flickerLights).push(i);
    const decorMul = {};
    for (const k of ['paper', 'stain', 'box', 'can', 'cable', 'vent'])
        decorMul[k] = rng.range(1 - cfg.decorVar, 1 + cfg.decorVar);
    return {
        openDoors: take(rng, doorC, cfg.doors, 0.35), dimLights, flickerLights,
        openContainers: take(rng, contC, cfg.containers, 0.4).map((c) => c.id),
        decorMul,
    };
}
const boxOf = (x, z, q) => ({ cx: x, cz: z, hx: q.hx, hz: q.hz, cos: Math.cos(q.yaw), sin: Math.sin(q.yaw) });
/** Validasi pergeseran furniture q sejauh (dx,dz). Mengembalikan nav baru + jumlah sel terjangkau, atau null bila tidak aman:
 *  seluruh lintasan & area ayunan tidak boleh menimpa dinding/furniture lain/keepout, dan jalan, titik wajib, serta akses container tetap terjangkau. */
function planShift(a) {
    const { q, dx, dz } = a;
    const nav = new layout_1.NavGrid(a.cw, 0, a.fixed);
    for (const o of a.placements)
        if (o !== q)
            nav.addObb({ id: o.id, cx: o.x, cz: o.z, hx: o.hx, hz: o.hz, yaw: o.yaw, level: 0, kind: o.kind }, 0.05);
    for (let k = 0.1; k <= 1.0001; k += 0.1) { // lintasan digeser langkah 10%
        const ob = { id: q.id, cx: q.x + dx * k, cz: q.z + dz * k, hx: q.hx, hz: q.hz, yaw: q.yaw, level: 0, kind: q.kind };
        if (nav.hits(nav.occ, ob, 0.1) || nav.hits(nav.occ, { ...ob, ...(0, layout_1.swingBox)(q.kind, ob) }, 0.02))
            return null;
        const sw = (0, layout_1.swingBox)(q.kind, ob);
        for (const kp of a.keepouts)
            if (collision_1.CollisionWorld.distToObb({ ...sw, cos: Math.cos(sw.yaw), sin: Math.sin(sw.yaw) }, kp.x, kp.z) < kp.r)
                return null;
        for (const f of nav.fixed)
            if (f.kind !== 'rail' && (0, layout_1.boxesOverlap)(ob, f, 0.05))
                return null;
    }
    const nx = q.x + dx, nz = q.z + dz;
    for (const k of a.keepouts)
        if (collision_1.CollisionWorld.distToObb(boxOf(nx, nz, q), k.x, k.z) < k.r)
            return null;
    for (const k of a.pickups)
        if (Math.hypot(k.x - nx, k.z - nz) < 0.9 + Math.max(q.hx, q.hz))
            return null;
    nav.addObb({ id: q.id, cx: nx, cz: nz, hx: q.hx, hz: q.hz, yaw: q.yaw, level: 0, kind: q.kind }, 0.05);
    const n = nav.flood(a.spawn.x, a.spawn.z);
    if (n < a.baseReach * 0.97)
        return null;
    for (const m of a.mustOk)
        if (!nav.reached(m.x, m.z, m.rad ?? 0.25))
            return null;
    for (const p of a.accessPts)
        if (!nav.reached(p.x, p.z, 1.6))
            return null;
    for (const o of a.placements)
        if (o !== q && layout_1.SEARCHABLE.includes(o.kind) && !nav.reached(o.ax, o.az, 0.15))
            return null; // titik akses furniture lain tetap bebas
    if (layout_1.SEARCHABLE.includes(q.kind) && !nav.reached(q.ax + dx, q.az + dz, 0.15))
        return null;
    return { nav, n };
}
