"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subtreeBounds = subtreeBounds;
exports.measureFootprints = measureFootprints;
exports.normalizeMap = normalizeMap;
exports.extractMapData = extractMapData;
exports.panelCentres = panelCentres;
const config_1 = require("./config");
const stairs_1 = require("./stairs");
// ---- matriks kecil (kolom-mayor, sama seperti three.js) ----
function compose(t, q, s) {
    const [x, y, z, w] = q ?? [0, 0, 0, 1];
    const [sx, sy, sz] = s ?? [1, 1, 1];
    const [tx, ty, tz] = t ?? [0, 0, 0];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++)
                s += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = s;
        }
    return o;
}
const pt = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const yawOf = (m) => Math.atan2(-m[2], m[0]);
const scaleOf = (m) => [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
/** Bounds (ruang lokal node) dari mesh node + semua anaknya yang bermesh. Hanya membaca JSON glTF; GLB tidak diubah. */
function subtreeBounds(j, root) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const visit = (i, m, isRoot) => {
        const n = j.nodes[i];
        const L = isRoot ? m : mul(m, compose(n.translation, n.rotation, n.scale));
        if (n.mesh !== undefined)
            for (const p of j.meshes[n.mesh].primitives) {
                const a = j.accessors[p.attributes.POSITION];
                for (const x of [a.min[0], a.max[0]])
                    for (const y of [a.min[1], a.max[1]])
                        for (const z of [a.min[2], a.max[2]]) {
                            const q = pt(L, x, y, z);
                            for (let k = 0; k < 3; k++) {
                                mn[k] = Math.min(mn[k], q[k]);
                                mx[k] = Math.max(mx[k], q[k]);
                            }
                        }
            }
        for (const c of n.children ?? [])
            visit(c, L, false);
    };
    visit(root, compose(), true);
    return { mn, mx };
}
/** Footprint exact (lebar x kedalaman + offset pusat, meter) per template furniture, diukur dari GLB. */
function measureFootprints(j, templates) {
    const out = {};
    for (const kind of Object.keys(templates)) {
        const i = j.nodes.findIndex((n) => n.name === templates[kind]);
        if (i < 0)
            continue;
        const { mn, mx } = subtreeBounds(j, i);
        if (!isFinite(mn[0]))
            continue;
        // kotak EXACT dari mesh (tidak simetris): ox/oz = pusat kotak relatif origin node (ruang lokal, depan = +Z)
        out[kind] = { w: mx[0] - mn[0], d: mx[2] - mn[2], ox: (mx[0] + mn[0]) / 2, oz: (mx[2] + mn[2]) / 2 };
    }
    return out;
}
const deg = (r) => (r * 180) / Math.PI;
const levelOfY = (y) => (y > config_1.LEVEL_Y[1] - 0.5 ? 1 : 0);
const FURN_TYPES = /^(Desk|Chair|Bookshelf|StorageShelf|Cabinet|StorageCabinet|ArchiveCabinet|FilingCabinet|KitchenCabinet|Locker|Fridge|Sofa|DiningTable|MeetingTable|LabTable|ReceptionDesk|Generator|Vent)$/;
const LABEL = { Locker: 'Locker', Fridge: 'Cabinet', Cabinet: 'Cabinet', StorageCabinet: 'Cabinet', ArchiveCabinet: 'Cabinet', KitchenCabinet: 'Cabinet' };
/**
 * Menurunkan extras `interact` dari skema map (idempotent, mengubah JSON in-place):
 *  - Door_NN (extras.type 'door', tanpa `furniture`)  -> interact {type:'door'|'exit_door'}
 *  - Drawer_NN / pintu furniture (extras.furniture)    -> interact {type:'container', container_id, open_type, slide|axis+angle, anchor}
 * Kunci non-exit (Key/Code/Keycard di map) diabaikan: game hanya punya gembok warna di exit lantai 1. Exit lantai 2 disegel permanen.
 */
function normalizeMap(j) {
    const N = j.nodes.length, parent = new Array(N).fill(-1);
    j.nodes.forEach((n, i) => { for (const c of n.children ?? [])
        parent[c] = i; });
    const rel = (root, node) => {
        const chain = [];
        for (let k = node; k !== root && k >= 0; k = parent[k])
            chain.push(k);
        let m = compose();
        for (let k = chain.length - 1; k >= 0; k--) {
            const n = j.nodes[chain[k]];
            m = mul(m, compose(n.translation, n.rotation, n.scale));
        }
        return [m[12], m[13], m[14]];
    };
    j.nodes.forEach((n, i) => {
        const e = n.extras;
        if (!e || e.interact)
            return;
        if (e.type === 'door' && !e.furniture && e.interactive) {
            const isExit = !!e.isExit && e.floor === 1;
            e.interact = { type: isExit ? 'exit_door' : 'door', locked: isExit || (!!e.isExit && e.floor === 2), open_angle_deg: deg((e.openRotationY ?? 0) - (e.closedRotationY ?? 0)) || 90, open_time: 0.7 };
            return;
        }
        if (!e.furniture || !e.interactive || (e.type !== 'drawer' && e.type !== 'door'))
            return;
        const root = parent[i], rn = j.nodes[root], ft = rn?.extras?.type ?? '';
        if (!rn || !FURN_TYPES.test(ft))
            return;
        // anchor loot (ruang lokal furniture): ItemSpawn di dalam laci / slot pertama furniture / Interior / default
        const spawns = [];
        const scan = (k) => { for (const c of j.nodes[k].children ?? []) {
            if (j.nodes[c].extras?.type === 'ItemSpawn')
                spawns.push(c);
            else if (j.nodes[c].extras?.type !== 'drawer' && j.nodes[c].extras?.type !== 'door')
                scan(c);
        } };
        if (e.type === 'drawer') {
            scan(i);
        }
        else
            scan(root);
        const interior = (rn.children ?? []).find((c) => j.nodes[c].extras?.type === 'Interior');
        let anchor = [0, 0.3, 0];
        if (spawns.length)
            anchor = rel(root, spawns[0]);
        else if (interior != null) {
            const p = rel(root, interior);
            anchor = [p[0], p[1] + 0.3, p[2]];
        }
        if (e.type === 'drawer') {
            const ax = e.slideAxis ?? [0, 0, 1], d = e.slideDistance ?? 0.4;
            if (!spawns.length) {
                const p = rel(root, i);
                anchor = [p[0], p[1] + 0.05, p[2]];
            }
            e.interact = { type: 'container', container_id: n.name, label: 'Drawer', open_type: 'slide', slide: [ax[0] * d, ax[1] * d, ax[2] * d], anchor, search_time: 0.9, open_time: 0.45 };
        }
        else {
            e.interact = { type: 'container', container_id: rn.name, label: LABEL[ft] ?? 'Cabinet', open_type: 'hinge', axis: [0, 1, 0], angle_deg: deg((e.openRotationY ?? 0) - (e.closedRotationY ?? 0)), anchor, search_time: ft === 'Locker' ? 1.2 : 1.4, open_time: 0.55 };
        }
    });
}
function slabRectOf(j, name) {
    const n = j.nodes.find((x) => x.name === name);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of j.meshes[n.mesh].primitives) {
        const a = j.accessors[p.attributes.POSITION];
        for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], a.min[k]);
            mx[k] = Math.max(mx[k], a.max[k]);
        }
    }
    return { minx: mn[0], maxx: mx[0], minz: mn[2], maxz: mx[2] };
}
function extractMapData(j) {
    normalizeMap(j);
    const N = j.nodes.length;
    const M = new Array(N), parent = new Array(N).fill(-1);
    const walk = (i, pm, par) => {
        const n = j.nodes[i];
        M[i] = mul(pm, compose(n.translation, n.rotation, n.scale));
        parent[i] = par;
        for (const c of n.children ?? [])
            walk(c, M[i], i);
    };
    const I4 = compose();
    for (const r of j.scenes[j.scene ?? 0].nodes)
        walk(r, I4, -1);
    const wp = (i) => [M[i][12], M[i][13], M[i][14]];
    const idxByName = (name) => j.nodes.findIndex((n) => n.name === name);
    const levelOf = (i) => { const nm = j.nodes[i].name ?? ''; return /^F2_|Furniture_F2/.test(nm) ? 1 : levelOfY(wp(i)[1] + 0.01); };
    const bounds = (mesh) => {
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (const p of j.meshes[mesh].primitives) {
            const a = j.accessors[p.attributes.POSITION];
            for (let k = 0; k < 3; k++) {
                mn[k] = Math.min(mn[k], a.min[k]);
                mx[k] = Math.max(mx[k], a.max[k]);
            }
        }
        return { mn, mx };
    };
    const obbOf = (i, id, kind, minHalf = 0, full = false) => {
        const { mn, mx } = full ? subtreeBounds(j, i) : bounds(j.nodes[i].mesh);
        const s = scaleOf(M[i]);
        const c = pt(M[i], (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
        return { id, cx: c[0], cz: c[2], hx: Math.max(minHalf, ((mx[0] - mn[0]) / 2) * s[0]), hz: Math.max(minHalf, ((mx[2] - mn[2]) / 2) * s[2]), yaw: yawOf(M[i]), level: levelOf(i), kind };
    };
    // rooms (RoomVolume: pusat lantai + size [w,h,d])
    const rooms = [];
    j.nodes.forEach((n, i) => {
        const e = n.extras;
        if (e?.type !== 'RoomVolume')
            return;
        const c = wp(i), sz = e.size;
        const name = e.room ?? n.name ?? '';
        rooms.push({ id: n.name ?? name, type: /^Stair$/i.test(name) ? 'ladder' : name.toLowerCase(), rect: { minx: c[0] - sz[0] / 2, minz: c[2] - sz[2] / 2, maxx: c[0] + sz[0] / 2, maxz: c[2] + sz[2] / 2 }, height: sz[1], level: e.floor === 2 ? 1 : 0 });
    });
    // spawn lantai 1
    const si = idxByName('Spawn_F1'), sp = wp(si), sx = j.nodes[si].extras ?? {};
    const fw = sx.facing ?? [0, 0, -1];
    // spawn bawaan map menempel dinding selatan (0,6 m); digeser masuk agar ada ruang bebas >= 1,2 m dari tepi lantai
    const f0 = slabRectOf(j, 'F1_Slab'), cl = (v, a, b) => Math.min(b, Math.max(a, v));
    const spawn = { x: cl(sp[0], f0.minx + 1.2, f0.maxx - 1.2), z: cl(sp[2], f0.minz + 1.2, f0.maxz - 1.2), yaw: Math.atan2(-fw[0], -fw[2]), eye: 1.65, radius: 0.3 };
    // pintu: daun = node Door_NN; engsel di origin node, daun memanjang sepanjang +Z lokal
    const doors = [];
    j.nodes.forEach((n, i) => {
        const it = n.extras?.interact;
        if (!it || (it.type !== 'door' && it.type !== 'exit_door') || n.mesh === undefined)
            return;
        const b = bounds(n.mesh), yaw = yawOf(M[i]);
        const c = pt(M[i], 0, 0, (b.mn[2] + b.mx[2]) / 2);
        const hg = pt(M[i], 0, 0, b.mn[2]), ls = scaleOf(M[i]);
        doors.push({
            hingeX: hg[0], hingeZ: hg[2], len: (b.mx[2] - b.mn[2]) * ls[2],
            leaf: i, frame: -1, name: n.name ?? '', type: it.type, cx: c[0], cz: c[2], yaw,
            nx: Math.round(Math.cos(yaw)), nz: Math.round(-Math.sin(yaw)), level: levelOf(i),
            locked: !!it.locked, openAngle: it.open_angle_deg ?? 90, openTime: it.open_time ?? 0.7,
            closedObb: obbOf(i, 'door:' + n.name, 'door', 0.12),
        });
    });
    const exitDoor = doors.find((d) => d.type === 'exit_door');
    const ti = idxByName('Exit_F1'), tp = wp(ti), tsz = j.nodes[ti].extras?.triggerSize ?? [2, 2, 2];
    const trigger = { minx: tp[0] - tsz[0] / 2, maxx: tp[0] + tsz[0] / 2, minz: tp[2] - tsz[2] / 2, maxz: tp[2] + tsz[2] / 2 };
    // sisi dalam exit = sisi trigger (area berdiri setelah pintu dibuka) berada
    const sgn = ((trigger.minx + trigger.maxx) / 2 - exitDoor.cx) * exitDoor.nx + ((trigger.minz + trigger.maxz) / 2 - exitDoor.cz) * exitDoor.nz >= 0 ? 1 : -1;
    const exit = { door: exitDoor, trigger, insideX: exitDoor.cx + exitDoor.nx * sgn * 1.0, insideZ: exitDoor.cz + exitDoor.nz * sgn * 1.0 };
    // container (grup per container_id; induk = furniture)
    const cmap = new Map();
    j.nodes.forEach((n, i) => { const it = n.extras?.interact; if (it?.type === 'container') {
        const a = cmap.get(it.container_id) ?? [];
        a.push(i);
        cmap.set(it.container_id, a);
    } });
    const containers = [];
    cmap.forEach((parts, id) => {
        const first = parts[0], it = j.nodes[first].extras.interact, root = parent[first], rn = j.nodes[root];
        const { mn, mx } = subtreeBounds(j, root);
        const s = scaleOf(M[root]);
        const yaw = yawOf(M[root]), fx = Math.sin(yaw), fz = Math.cos(yaw); // depan furniture = +Z lokal
        const hz = ((mx[2] - mn[2]) / 2) * s[2];
        const ctr = pt(M[root], (mn[0] + mx[0]) / 2, 0, (mn[2] + mx[2]) / 2);
        const anchorLocal = it.anchor;
        const slideKey = it.open_type !== 'hinge';
        const sl = slideKey ? it.slide : [0, 0, 0];
        const keyLocal = [anchorLocal[0] + sl[0], anchorLocal[1] + sl[1] + (slideKey ? 0.12 : 0.08), anchorLocal[2] + sl[2]];
        const kp = pt(M[root], keyLocal[0], keyLocal[1], keyLocal[2]);
        const lvl = levelOf(root);
        kp[1] = Math.max(kp[1], config_1.LEVEL_Y[lvl] + 0.3); // sama dengan world.spawnKey
        containers.push({
            id, label: it.label, kind: it.label === 'Drawer' ? 'drawer' : it.label === 'Locker' ? 'locker' : 'cabinet', level: lvl,
            rootIdx: root, parts, anchorIdx: null, anchorLocal, bodyMin: mn, bodyMax: mx, searchTime: it.search_time ?? 1, slideKey, keyLocal, keyPos: kp,
            ax: ctr[0] + fx * (hz + 0.7), az: ctr[2] + fz * (hz + 0.7),
        });
        void rn;
    });
    // collider tetap: semua furniture bawaan (kotak = bounds penuh subtree) + blok tangga
    const colliders = [];
    j.nodes.forEach((n, i) => {
        if (!n.extras?.furniture || n.extras.type === 'drawer' || n.extras.type === 'door' || n.extras.type === 'lever')
            return;
        if (!FURN_TYPES.test(n.extras.type ?? ''))
            return;
        const { mn } = subtreeBounds(j, i);
        if (!isFinite(mn[0]))
            return;
        const o = obbOf(i, n.name ?? '', 'fixed', 0, true);
        colliders.push({ idx: i, name: n.name ?? '', obb: o, vis: o });
    });
    // tangga A: seluruh lintasan anak tangga padat di kedua lantai (naik/turun lewat interaksi CLIMB di pendaratan)
    const sti = idxByName('Stairs_A'), st = j.nodes[sti].extras;
    const stepsIdx = idxByName('Stairs_A_Steps');
    const run = st.run, wd = st.width, dirX = st.direction[0] !== 0;
    const scx = (st.bottom[0] + st.top[0]) / 2, scz = (st.bottom[2] + st.top[2]) / 2;
    for (const lv of [0, 1])
        colliders.push({ idx: stepsIdx, name: 'Stairs_A', obb: { id: 'Stairs_A_' + lv, cx: scx, cz: scz, hx: (dirX ? run : wd) / 2 + 0.05, hz: (dirX ? wd : run) / 2 + 0.05, yaw: 0, level: lv, kind: 'fixed' }, vis: { id: 'Stairs_A', cx: scx, cz: scz, hx: run / 2, hz: wd / 2, yaw: 0, level: lv, kind: 'fixed' } });
    const tb = wp(idxByName('StairTrigger_A_Bottom')), tt = wp(idxByName('StairTrigger_A_Top'));
    const ladder = { idx: stepsIdx, bottom: [tb[0], tb[1], tb[2]], top: [tt[0], tt[1], tt[2]] };
    // dinding & lantai
    const wallNodes = [];
    j.nodes.forEach((n, i) => { if (n.mesh !== undefined && n.extras?.type === 'Walls')
        wallNodes.push({ idx: i, level: /^F2_/.test(n.name ?? '') ? 1 : 0 }); });
    const slabRect = (name) => {
        const i = idxByName(name), { mn, mx } = bounds(j.nodes[i].mesh);
        return { minx: mn[0], maxx: mx[0], minz: mn[2], maxz: mx[2] };
    };
    return { rooms, spawn, doors, containers, colliders, wallNodes, floor0: slabRect('F1_Slab'), mezz: slabRect('F2_Slab'), exit, ladder, stair: (0, stairs_1.stairFromExtras)(st), keyCandidateIdx: [], worldPos: wp, nodeName: (i) => j.nodes[i].name ?? '' };
}
/** Pusat panel lampu langit-langit dari satu mesh (segitiga dikelompokkan per panel; jarak antar-panel di map >= 3,6 m). m = matriks dunia kolom-mayor. */
function panelCentres(pos, idx, m) {
    const cl = [];
    const n = idx ? idx.length : Math.floor(pos.length / 3);
    for (let t = 0; t + 2 < n; t += 3) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) {
            const i = idx ? idx[t + k] : t + k, a = pos[i * 3], b = pos[i * 3 + 1], c = pos[i * 3 + 2];
            const q = pt(m, a, b, c);
            x += q[0] / 3;
            y += q[1] / 3;
            z += q[2] / 3;
        }
        const h = cl.find((q) => Math.abs(q.x / q.n - x) < 0.9 && Math.abs(q.z / q.n - z) < 0.9);
        if (h) {
            h.x += x;
            h.y += y;
            h.z += z;
            h.n++;
        }
        else
            cl.push({ x, y, z, n: 1 });
    }
    return cl.map((q) => [q.x / q.n, q.y / q.n, q.z / q.n]);
}
