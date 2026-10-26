// Pustaka uji v16 (navigasi monster): pintu nyata (meniru World.stepDoor + monsterEnv, memakai doornav.js yang SAMA dengan game), ukuran clearance independen, simulasi patroli/seret.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const CFG = require(G + '/config.js');
const D = require(G + '/door.js');
const DN = require(G + '/doornav.js');
const { doorAhead } = require(G + '/monster.js');
const R = CFG.MONSTER_RADIUS, DT = 1 / 30;
exports.R = R; exports.DT = DT;

exports.leafOf = (d) => ({ hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: d.closedObb.hx });

// Pintu nyata untuk satu lantai. net = log pesan 'door' (sinkron multiplayer).
exports.mkDoors = function mkDoors(cw, md, LV) {
  const net = [];
  const rts = md.doors.filter((d) => d.level === LV && d.type === 'door').map((d) => {
    const leaf = exports.leafOf(d);
    return { d, leaf, vis: { ...leaf, half: 0.04 }, obb: cw.obbs.find((o) => o.id === 'door:' + d.name), t: 0, target: 0, pend: false };
  });
  const step = (rt, dt, mon, extra) => {
    if (rt.t !== rt.target) {
      const base = rt.d.openTime || 0.7, rate = dt / (rt.target ? base * CFG.DOOR_OPEN_SLOW : base * CFG.DOOR_CLOSE_SCALE);
      const nt = rt.target ? Math.min(1, rt.t + rate) : Math.max(0, rt.t - rate);
      const hitMon = !!mon && !rt.target && D.sweepHitsPlayer(rt.vis, D.ease(rt.t), D.ease(nt), mon.x, mon.z, R + 0.02);
      const hitPl = !!extra && !rt.target && D.sweepHitsPlayer(rt.vis, D.ease(rt.t), D.ease(nt), extra.x, extra.z, CFG.PLAYER_RADIUS + 0.02);
      if (!hitMon && !hitPl) rt.t = nt;
    }
    const a = D.ease(rt.t); D.applyPose(rt.obb, rt.leaf, a);
    if (!rt.obb.enabled) { const inside = !!mon && cw.constructor.distToObb(rt.obb, mon.x, mon.z) < R + 0.03; rt.pend = inside; if (!inside) rt.obb.enabled = true; }
  };
  const open = (rt) => { if (rt.target === 0) { rt.target = 1; net.push({ k: 'door', i: rts.indexOf(rt), o: 1 }); } };
  const env = {
    openDoorNear(x, z, level, dx, dz) { const cand = rts.filter((r) => r.d.level === level && r.t < 0.98), hit = doorAhead(cand.map((r) => r.d), x, z, dx, dz, 1.6); if (!hit) return false; const rt = cand.find((r) => r.d === hit); if (rt.d.locked) return false; open(rt); return true; },
    gateDoor(x, z, level, dx, dz) {
      const RR = R + 0.12;
      for (const rt of rts) { if (rt.d.level !== level || rt.t >= 0.98) continue; let hit = false;
        for (const s of [0.2, 0.5, 0.85, 1.3]) { const px = x + dx * s, pz = z + dz * s; if (D.leafDist(rt.leaf, 0, px, pz) < RR || D.leafDist(rt.leaf, D.ease(rt.t), px, pz) < RR) { hit = true; break; } }
        if (!hit) continue; if (rt.d.locked) return false; open(rt); return true; }
      return false;
    },
    doorBackoff(x, z, level, dx, dz) {
      const cand = rts.filter((r) => r.d.level === level && r.t < 0.98 && !r.d.locked), hit = doorAhead(cand.map((r) => r.d), x, z, dx, dz, 1.9); if (!hit) return null;
      const rt = cand.find((r) => r.d === hit), bo = DN.backoffFor(rt.leaf, x, z, dx, dz, R); if (!bo) return null; open(rt); return bo;
    },
    unjam(x, z, level) { let any = false; for (const rt of rts) { if (rt.d.level !== level || rt.d.locked || Math.hypot(rt.d.cx - x, rt.d.cz - z) > 2.6) continue; if (rt.t >= 0.98 && rt.target === 1) continue; if (rt.target === 0) net.push({ k: 'door', i: rts.indexOf(rt), o: 1 }); rt.target = 1; rt.t = 1; rt.pend = false; D.applyPose(rt.obb, rt.leaf, 1); any = true; } return any; },
    // = World.monsterDoorTrap / monsterCloseDoor
    doorTrap(x, z, level) {
      for (let i = 0; i < rts.length; i++) { const rt = rts[i]; if (rt.d.level !== level || Math.hypot(rt.d.cx - x, rt.d.cz - z) > rt.leaf.len + 1.8) continue; const geo = DN.trapGeo(rt.leaf, x, z, R); if (!geo) continue; if (geo.pocket ? rt.t < 0.5 : !(rt.t > 0.05 && rt.t < 0.98)) continue; return { idx: i, ...geo }; }
      return null;
    },
    closeDoor(idx, level) { const rt = rts[idx]; if (!rt || rt.d.level !== level) return true; if (rt.t === 0 && rt.target === 0) return true; if (rt.target === 1) { rt.target = 0; net.push({ k: 'door', i: idx, o: 0 }); } return false; },
  };
  const restore = () => { for (const r of rts) { r.t = 0; r.target = 0; r.pend = false; r.obb.enabled = true; D.applyPose(r.obb, r.leaf, 0); } net.length = 0; };
  return { rts, env, step, restore, net };
};

// Clearance independen dari nav: jari-jari terbesar (<= 1,3 m) yang masih bebas dinding/furnitur di titik itu (pencarian biner pada collision asli).
exports.clearance = (cw, x, z, lv) => { let lo = 0, hi = 1.3; if (cw.blocked(x, z, 0.02, lv)) return 0; for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (cw.blocked(x, z, m, lv)) hi = m; else lo = m; } return lo; };

// Sampel titik di sepanjang polyline tiap 0,25 m.
exports.sample = (from, pts) => { const out = []; let p = from; for (const q of pts) { const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.25)); for (let i = 1; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, z: p.z + ((q.z - p.z) * i) / n }); p = q; } return out; };
