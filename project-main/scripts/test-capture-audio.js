// Uji TAHAP 4 (audio tangkapan): protokol lokasi kejadian, penjadwal audio (logika murni), dan alur jaringan dengan SIM monster asli + GLB peta asli
// pada beberapa klien (bus palsu): korban, pemain dekat, pemain jauh, pemain di lantai lain, otoritas. Memeriksa: tiap klien menerima kejadian tepat
// SEKALI (pesan kirim-ulang & duplikat tidak memicu ulang), lokasi sama di semua klien, hanya yang dalam jangkauan yang mendengar, tidak ada suara
// global, anti-spam, kompatibel dengan pesan lama. BUKAN uji perangkat/browser: pemutaran WebAudio nyata dicakup scripts/test-capture-audio-browser.js.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), G = path.join(ROOT, '.tmp-game'), PUB = path.join(ROOT, 'public');
const { buildWorld } = require('./testworld.js');
const CFG = require(G + '/config.js');
const { SFX, CLIPS } = require(G + '/sfx.js');
const { SRC_DUR } = require(G + '/sfxclips.js');
const { MonsterNav } = require(G + '/monsternav.js');
const { MonsterSim, doorAhead } = require(G + '/monster.js');
const SY = require(G + '/monstersync.js');
const FX = require(G + '/monsterfx.js');
const { CaptureAudio } = require(G + '/captureaudio.js');
const { MonsterController } = require(G + '/monsterctl.js');
const { swingPoints } = require(G + '/door.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const near = (a, b, e) => Math.abs(a - b) <= e;
const SELF = 'monster_scream,capture_impact,player_scream', NL = 3, FULL = 'capture_scream_mid,capture_impact,capture_scream';   // per tangkapan (urut waktu): teriakan monster -> benturan -> teriakan James; hum & scream_lo di-mute   // lapisan per tangkapan, urut waktu

section('Aset: memakai ulang file yang benar-benar ada (tanpa nama karangan)');
{
  const sc = SFX.capture_scream, im = SFX.capture_impact;
  ok(JSON.stringify(sc.files) === '["james_scream"]' && JSON.stringify(SFX.capture_scream_mid.files) === '["monster_jumpscare"]' && JSON.stringify(SFX.monster_scream.files) === '["monster_jumpscare"]' && JSON.stringify(SFX.player_scream.files) === '["james_scream"]' && JSON.stringify(im.files) === '["impact_slam"]', 'capture_scream <- james_scream, capture_scream_mid/monster_scream <- monster_jumpscare, player_scream <- james_scream, capture_impact <- impact_slam');
  ok(['monster_jumpscare', 'james_scream'].every((n) => CLIPS[n] && fs.existsSync(path.join(PUB, 'sfx', CLIPS[n].file)) && CLIPS[n].off + CLIPS[n].dur <= SRC_DUR[CLIPS[n].file] + 1e-3), 'clip monster_jumpscare & james_scream ada & di dalam file sumber');
  const wav = path.join(PUB, 'sfx', 'monster_scream.wav'), b = fs.readFileSync(wav);
  ok(fs.existsSync(wav) && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE', 'public/sfx/monster_scream.wav ada & berformat WAV');
  const sr = b.readUInt32LE(24), dur = (b.length - 44) / b.readUInt32LE(28);
  ok(dur > 0.8 && dur < 6, `teriakan ${dur.toFixed(2)} dtk @${sr} Hz`);
  ok(CLIPS.impact_slam && fs.existsSync(path.join(PUB, 'sfx', CLIPS.impact_slam.file)) && CLIPS.impact_slam.off + CLIPS.impact_slam.dur <= SRC_DUR[CLIPS.impact_slam.file] + 1e-3, `clip impact_slam (${CLIPS.impact_slam.file}) ada & di dalam file sumber`);
  ok(sc.max > 0 && im.max > 0 && sc.ref > 0 && im.ref > 0 && sc.ref < sc.max && im.ref < im.max, `keduanya POSISIONAL dengan falloff (scream ref ${sc.ref}->max ${sc.max} m, impact ref ${im.ref}->max ${im.max} m); max>0 = tidak pernah global`);
  ok(sc.prio >= 9 && im.prio >= 9 && sc.gap > 0 && im.gap > 0, 'prioritas tinggi (tidak digusur suara kecil) + gap anti-dobel di perangkat');
  const before = fs.readdirSync(path.join(PUB, 'sfx')).length; ok(before === 64, `jumlah file audio (public/sfx: 61 lama + monster_jumpscare, james_scream, bgm_horror = 64 file, sekarang ${before})`);
}

section('Protokol: lokasi kejadian opsional, ketat, kompatibel pesan lama');
{
  const base = { v: 1, t: 'mc', e: 3, s: 9, id: 'B', dg: 1 };
  ok(SY.sanitizeMonsterMsg({ ...base, cx: 12.5, cz: -3.25, cl: 1 }).cx === 12.5, 'pesan baru dengan lokasi diterima');
  const old = SY.sanitizeMonsterMsg(base); ok(old && old.cx === undefined && old.cz === undefined && old.cl === undefined, 'pesan LAMA (tanpa lokasi) tetap valid');
  for (const [name, extra] of [['cx saja', { cx: 1 }], ['cl di luar 0..1', { cx: 1, cz: 1, cl: 2 }], ['cx NaN', { cx: NaN, cz: 1, cl: 0 }], ['cx string', { cx: '1', cz: 1, cl: 0 }], ['cx terlalu jauh', { cx: 9999, cz: 1, cl: 0 }], ['cl pecahan', { cx: 1, cz: 1, cl: 0.5 }], ['Infinity', { cx: Infinity, cz: 1, cl: 0 }]])
    ok(SY.sanitizeMonsterMsg({ ...base, ...extra }) === null, 'ditolak: ' + name);
  const m = SY.sanitizeMonsterMsg({ ...base, cx: 1, cz: 2, cl: 0, extra: 'x', __proto__: { z: 1 } }); ok(m && !('extra' in m), 'field tak dikenal dibuang');
}

section('CaptureAudio: jadwal, sekali per kejadian, jangkauan, anti-spam');
{
  const ev = (k, id, x, z, level = 1) => ({ key: k, id, x, z, level, drag: true });
  const L = { x: 0, z: 0, level: 1 };
  const play = (a, secs, dt = 1 / 60) => { const got = []; let t = 0; for (let i = 0; i < Math.round(secs / dt); i++) { t += dt; for (const c of a.update(dt)) got.push({ t, ...c, pos: { ...c.pos } }); } return got; };
  let a = new CaptureAudio(); ok(a.accept(ev('1:1:B', 'B', 5, 0), 'me', L) === 'scheduled', 'dekat -> dijadwalkan');
  let got = play(a, 3);
  ok(got.map((c) => c.name).join() === FULL, 'tepat 1 teriakan monster, 1 benturan, 1 teriakan James (urut waktu)');
  const G = Object.fromEntries(got.map((c) => [c.name, c]));
  ok(near(G.capture_scream_mid.t, FX.JS_SCREAM_AT, 0.03) && near(G.capture_impact.t, FX.JS_IMPACT_AT, 0.03) && near(G.capture_scream.t, FX.JS_PLAYER_SCREAM_AT, 0.03), 'timeline: teriakan monster di JS_SCREAM_AT, benturan di JS_IMPACT_AT, teriakan James di JS_PLAYER_SCREAM_AT');
  ok(got.every((c, i) => i === 0 || c.t >= got[i - 1].t) && FX.JS_SCREAM_AT < FX.JS_IMPACT_AT && FX.JS_PLAYER_SCREAM_AT - FX.JS_SCREAM_AT >= 1.5 && !got.some((c) => c.name === 'capture_hum' || c.name === 'capture_scream_lo'), 'urutan waktu menaik; tepat 1 teriakan monster + 1 teriakan James, terpisah >= 1,5 dtk (tidak tumpang tindih); hum & scream_lo di-mute');
  ok(got.every((c) => c.pos.x === 5 && c.pos.z === 0 && near(c.pos.y, CFG.LEVEL_Y[1] + CFG.CAPTURE_AUDIO_Y, 1e-9)), 'suara di LOKASI kejadian (bukan posisi pendengar), tinggi = lantai 2 + tinggi kepala');
  ok(G.capture_scream.vol === 1 && G.capture_impact.vol === 1, 'pendengar lain: volume puncak sama dengan korban pada lantai yang sama (kekerasan diatur falloff jarak engine)');
  for (let i = 0; i < 20; i++) a.accept(ev('1:1:B', 'B', 5, 0), 'me', L); ok(play(a, 3).length === 0, '20x pesan duplikat (kunci sama) -> tidak ada suara lagi');
  ok(a.accept(ev('1:1:B', 'B', 5, 0), 'me', L) === 'dup', 'hasil accept = dup');
  // jangkauan
  a = new CaptureAudio(); const r = (d) => { const b = new CaptureAudio(); return { res: b.accept(ev('k', 'B', d, 0), 'me', L), got: play(b, 3) }; };
  ok(r(SFX.capture_scream.max - 1).got.map((c) => c.name).join() === 'capture_scream', `${SFX.capture_scream.max - 1} m: hanya teriakan (benturan jangkauannya ${SFX.capture_impact.max} m)`);
  ok(r(SFX.capture_impact.max - 1).got.map((c) => c.name).join() === 'capture_scream_mid,capture_impact,capture_scream', `${SFX.capture_impact.max - 1} m: teriakan monster + benturan + teriakan James terdengar`);
  ok(r(SFX.capture_scream_mid.max - 1).got.map((c) => c.name).join() === 'capture_scream_mid,capture_scream' && r(5).got.map((c) => c.name).join() === FULL, 'dekat: semua lapisan; jangkauan tiap lapisan mengikuti SFX[name].max (spasial, tidak ada yang global)');
  ok(r(SFX.capture_scream.max + 2).res === 'far' && r(SFX.capture_scream.max + 2).got.length === 0, `${SFX.capture_scream.max + 2} m: di luar jangkauan -> tidak dijadwalkan sama sekali`);
  // lantai lain
  const f = new CaptureAudio(); f.accept(ev('f', 'B', 3, 0, 0), 'me', L); const fg = play(f, 3); ok(fg.length === NL && fg.every((c) => near(c.vol, CFG.CAPTURE_AUDIO_OTHER_FLOOR_VOL, 1e-9)) && fg[0].pos.y < 2, 'lantai lain: lebih pelan (suara tembus lantai), sumber tetap di lantainya');
  // korban sendiri
  const v = new CaptureAudio(); ok(v.accept(ev('v', 'me', 0.5, 0.5), 'me', L) === 'scheduled' && play(v, 3).length === NL, 'korban mendengar tangkapannya sendiri (satu jalur yang sama, semua lapisan sekali)');
  const v2 = new CaptureAudio(); ok(v2.accept(ev('v', 'me', NaN, NaN), 'me', { x: 7, z: 8, level: 1 }) === 'scheduled', 'lokasi tak diketahui: korban tetap mendengar (di posisinya)'); const vg = play(v2, 3); ok(vg.length === NL && vg[0].pos.x === 7 && vg[0].pos.z === 8, 'lokasi cadangan korban = posisinya sendiri');
  ok(new CaptureAudio().accept(ev('n', 'B', NaN, NaN), 'me', L) === 'nopos', 'pemain lain + lokasi tak diketahui: tidak diputar (tidak mengarang posisi)');
  // anti-spam
  const s = new CaptureAudio(); ok(s.accept(ev('a', 'B', 2, 0), 'me', L) === 'scheduled', 'kejadian 1'); play(s, 0.2);
  ok(s.accept(ev('b', 'C', 2, 0), 'me', L) === 'spam', 'kejadian lain < MIN_GAP -> dibuang (anti-banjir)');
  ok(s.accept(ev('c', 'me', 1, 0), 'me', L) === 'scheduled', '...kecuali korban sendiri (tidak pernah dibungkam)');
  play(s, 3); ok(s.accept(ev('d', 'B', 2, 0), 'me', L) === 'cooldown', 'korban yang sama dengan kunci baru < cooldown -> dibuang');
  play(s, CFG.CAPTURE_AUDIO_VICTIM_COOLDOWN + 1); ok(s.accept(ev('e', 'B', 2, 0), 'me', L) === 'scheduled', 'setelah cooldown, tangkapan sah berikutnya dijadwalkan lagi');
  // banjir kunci berbeda
  const fl = new CaptureAudio(); let sched = 0, total = 0; for (let i = 0; i < 600; i++) { if (fl.accept(ev('x' + i, 'V' + (i % 3), 3, 0), 'me', L) === 'scheduled') sched++; total++; play(fl, 1 / 60, 1 / 60); }
  ok(sched <= Math.ceil(10 / CFG.CAPTURE_AUDIO_MIN_GAP) + 1, `banjir ${total} kejadian palsu dalam 10 dtk -> maks ${sched} diputar`);
  // clear / terlambat / fps / pause
  const c = new CaptureAudio(); c.accept(ev('z', 'B', 2, 0), 'me', L); c.clear(); ok(play(c, 3).length === 0 && c.pending === 0, 'clear() (restart/unmount) membatalkan yang terjadwal');
  ok(c.accept(ev('z', 'B', 2, 0), 'me', L) === 'scheduled', 'clear() juga melupakan kunci lama (run baru, epoch/seq mulai dari awal)');
  const late = new CaptureAudio(); late.accept(ev('l', 'B', 2, 0), 'me', L); late.update(CFG.CAPTURE_AUDIO_LATE_DROP + 3); ok(late.update(0.01).length === 0 && late.pending === 0, 'tab di-background lama: suara basi dibuang, bukan diputar telat');
  const t30 = (() => { const q = new CaptureAudio(); q.accept(ev('q', 'B', 2, 0), 'me', L); return play(q, 3, 1 / 30).map((x) => x.t); })(), t144 = (() => { const q = new CaptureAudio(); q.accept(ev('q', 'B', 2, 0), 'me', L); return play(q, 3, 1 / 144).map((x) => x.t); })();
  ok(t30.length === NL && t144.length === NL && t30.every((t, i) => near(t, t144[i], 0.04)), 'waktu sama pada 30 dan 144 FPS');
  const z = new CaptureAudio(); z.accept(ev('y', 'B', 2, 0), 'me', L); ok(z.update(0).length === 0 && z.update(-1).length === 0, 'dt 0 / negatif tidak memutar apa pun');
  const off = CFG.CAPTURE_AUDIO_ENABLED; ok(off === true, 'CAPTURE_AUDIO_ENABLED = true secara bawaan');
}

section('Jaringan + SIM asli + peta asli: 5 klien, sekali per kejadian, lokasi sama, hanya yang dekat mendengar');
{
  const { cw, md } = buildWorld(), St = md.stair, top = { x: St.bx + St.sgn * St.run + 0.6, z: St.zc }, LV = CFG.MONSTER_LEVEL;
  const fixedOf = (lv) => md.colliders.filter((c) => c.obb.level === lv).map((c) => c.obb);
  const nav1 = new MonsterNav(cw, 1, fixedOf(1), top);
  const avoid = [{ x: md.spawn.x, z: md.spawn.z, r: 2.6 }, { x: md.exit.insideX, z: md.exit.insideZ, r: 1.8 }];
  if (md.ladder) avoid.push({ x: md.ladder.bottom[0], z: md.ladder.bottom[2], r: 1.7 });
  for (let u = 0; u <= St.run + 1.2; u += 1.2) avoid.push({ x: St.bx + St.sgn * u, z: St.zc, r: 2.0 });
  for (const d of md.doors) for (const sp of swingPoints({ hingeX: d.hingeX, hingeZ: d.hingeZ, len: d.len, yaw: d.yaw, openRad: (d.openAngle * Math.PI) / 180, half: 0.04 })) avoid.push({ x: sp.x, z: sp.z, r: 0.45 });
  const dragEnv = { rooms: md.rooms, avoid };
  const mkEnv = () => { const op = new Set(); return { op, openDoorNear(x, z, level, dx, dz) { const d = doorAhead(md.doors.filter((q) => q.level === level && !op.has(q.name)), x, z, dx, dz); if (!d) return false; op.add(d.name); cw.removeObbs((o) => o.id === 'door:' + d.name); return true; }, doorBlocking() { return false; } }; };
  const env = mkEnv();
  const bus = { t: 0, clients: {}, q: [] };
  const add = (id, slot, lis) => {
    const c = { id, slot, hs: [], lis, onCatch: [], results: [], cues: [], selfCatch: 0, cap: new CaptureAudio() }; bus.clients[id] = c;
    c.io = { selfId: id, selfSlot: slot, peers: () => Object.values(bus.clients).filter((o) => o.id !== id).map((o) => ({ id: o.id, slot: o.slot, online: true })), send: (m) => { for (const o of Object.values(bus.clients)) if (o.id !== id) bus.q.push({ at: bus.t + 60, to: o.id, from: id, m: JSON.parse(JSON.stringify(m)) }); }, onMessage: (fn) => { c.hs.push(fn); return () => { c.hs = c.hs.filter((x) => x !== fn); }; } };
    c.ctl = new MonsterController(() => new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv), c.io, () => bus.t);
    c.ctl.onCatchSelf = () => { c.selfCatch++; };
    c.ctl.onCatch = (ev) => { c.onCatch.push({ ...ev, t: bus.t }); c.results.push(c.cap.accept(ev, id, c.lis)); };
    return c;
  };
  const step = (ms) => { bus.t += ms; for (let i = bus.q.length - 1; i >= 0; i--) if (bus.q[i].at <= bus.t) { const q = bus.q.splice(i, 1)[0]; const c = bus.clients[q.to]; if (c) for (const h of c.hs) h(q.from, q.m); } };
  const m0 = new MonsterSim(nav1, cw, LV, 4242, env, top, undefined, dragEnv); let P = null;
  for (let k = 0; k < 500 && !P; k++) { const a = m0.rng.range(0, 6.28), q = { x: m0.x + Math.sin(a) * 3.2, z: m0.z + Math.cos(a) * 3.2 }; if (nav1.isOk(q.x, q.z) && !cw.segmentBlocked(m0.x, m0.z, q.x, q.z, 1, 0.02)) P = q; }
  // posisi pendengar (tetap): B korban di P; C 5 m; A (otoritas) 30 m (teriakan 36 m masuk, benturan 28 m tidak); D 60 m; E lantai bawah tepat di bawah
  const A = add('A', 0, { x: P.x + 30, z: P.z, level: 1 }), B = add('B', 1, { x: P.x, z: P.z, level: 1 }), C = add('C', 2, { x: P.x + 5, z: P.z, level: 1 }), D = add('D', 3, { x: P.x + 60, z: P.z, level: 1 }), E = add('E', 4, { x: P.x, z: P.z, level: 0 });
  const obs = (id, x, z, lv, o = {}) => ({ id, x, z, level: lv, gait: 'idle', crouch: false, hidden: true, grace: 999, caught: false, ...o });
  const ps = { A: obs('A', A.lis.x, A.lis.z, 1), B: obs('B', P.x, P.z, 1, { hidden: false, grace: 0, gait: 'run' }), C: obs('C', C.lis.x, C.lis.z, 1), D: obs('D', D.lis.x, D.lis.z, 1), E: obs('E', E.lis.x, E.lis.z, 0) };
  const all = [A, B, C, D, E], dtv = 1 / 30; let catchAt = -1; const cuesLog = Object.fromEntries(all.map((c) => [c.id, []]));
  const frame = () => { step(1000 / 30); ps.B.caught = B.selfCatch > 0; for (const c of all) { const self = ps[c.id], rem = Object.keys(ps).filter((k) => k !== c.id).map((k) => ps[k]); c.ctl.update(dtv, self, rem); for (const q of c.cap.update(dtv)) cuesLog[c.id].push({ t: bus.t, ...q, pos: { ...q.pos } }); } };
  for (let i = 0; i < 30 * 120 && catchAt < 0; i++) { frame(); if (B.selfCatch > 0) catchAt = bus.t; }
  for (let i = 0; i < 30 * 4; i++) frame();   // kirim-ulang 150/300 ms + latensi 60 ms + timeline suara (0,95 dtk)
  ok(catchAt > 0, `tangkapan terjadi di sim asli (t=${(catchAt / 1000).toFixed(1)} dtk)`);
  ok(all.every((c) => c.onCatch.length === 1), `SETIAP klien menerima kejadian tepat 1x walau pesan dikirim 3x: ${all.map((c) => c.id + '=' + c.onCatch.length).join(' ')}`);
  ok(new Set(all.map((c) => c.onCatch[0].key)).size === 1 && all.every((c) => c.onCatch[0].id === 'B'), 'kunci kejadian & id korban sama di semua klien');
  const L0 = A.onCatch[0]; ok(all.every((c) => near(c.onCatch[0].x, L0.x, 0.011) && near(c.onCatch[0].z, L0.z, 0.011) && c.onCatch[0].level === LV), `lokasi kejadian IDENTIK di semua klien (${L0.x.toFixed(2)}, ${L0.z.toFixed(2)}, lantai ${L0.level})`);
  ok(near(Math.hypot(L0.x - P.x, L0.z - P.z), 0, CFG.MONSTER_CATCH_RADIUS + 0.2) || Math.hypot(L0.x - P.x, L0.z - P.z) < 4, 'lokasi = tempat monster menangkap (dekat korban)');
  ok(B.selfCatch === 1 && A.selfCatch + C.selfCatch + D.selfCatch + E.selfCatch === 0, 'jumpscare (onCatchSelf) tetap hanya untuk korban');
  const names = (id) => cuesLog[id].map((c) => c.name).join();
  ok(names('B') === SELF, 'korban: semua lapisan tepat sekali (satu jalur, tanpa dobel)');
  ok(names('C') === FULL, 'pemain dekat (5 m, lantai sama): mendengar semua lapisan');
  ok(names('A') === 'capture_scream_mid,capture_scream', `otoritas non-korban di 30 m: hanya teriakan monster+James (benturan ${SFX.capture_impact.max} m) -> otoritas ikut mendengar, bukan hanya korban`);
  ok(names('D') === '' && D.results[0] === 'far', 'pemain jauh (60 m): tidak ada suara (tidak dijadwalkan)');
  ok(names('E') === FULL && cuesLog.E[0].vol < cuesLog.C[0].vol, 'pemain di lantai bawah tepat di bawah: terdengar, lebih pelan');
  ok(all.every((c) => cuesLog[c.id].every((q) => near(q.pos.x, L0.x, 0.011) && near(q.pos.z, L0.z, 0.011))), 'semua suara berada di lokasi kejadian (3D), tidak ada yang tanpa posisi (= tidak ada suara global)');
  const cc = cuesLog.C, tOf = (id, n) => cuesLog[id].find((q) => q.name === n).t, rel = (tOf('C', 'capture_scream_mid') - C.onCatch[0].t) / 1000, rel2 = (tOf('C', 'capture_impact') - C.onCatch[0].t) / 1000;
  ok(near(rel, FX.JS_SCREAM_AT, 0.08) && near(rel2, FX.JS_IMPACT_AT, 0.08), `urutan sama dengan jumpscare: teriakan +${rel.toFixed(2)}s, benturan +${rel2.toFixed(2)}s dari penerimaan`);
  const spread = Math.max(...['B', 'C', 'A', 'E'].map((id) => tOf(id, id === 'B' ? 'player_scream' : 'capture_scream'))) - Math.min(...['B', 'C', 'A', 'E'].map((id) => tOf(id, id === 'B' ? 'player_scream' : 'capture_scream'))); ok(spread <= 120, `sinkron antar klien: selisih teriakan ${spread.toFixed(0)} ms (latensi jaringan simulasi 60 ms)`);
  // tidak ada pemutaran ulang
  const n0 = all.map((c) => cuesLog[c.id].length).join(); for (let i = 0; i < 30 * 15; i++) frame(); ok(all.map((c) => cuesLog[c.id].length).join() === n0 && all.every((c) => c.onCatch.length === 1), '15 dtk berikutnya (monster menyeret): tidak ada suara/kejadian tambahan');
  // duplikat & pemalsuan
  const inject = (from, m, to) => { bus.q.push({ at: bus.t + 10, to, from, m }); };
  const lastKeyMsg = (() => { const k = A.onCatch[0].key.split(':'); return { v: 1, t: 'mc', e: +k[0], s: +k[1], id: k[2], dg: 1, cx: L0.x, cz: L0.z, cl: LV }; })();
  for (let i = 0; i < 10; i++) for (const c of [B, C, D, E]) inject('A', lastKeyMsg, c.id);
  for (let i = 0; i < 5; i++) step(50); ok(all.slice(1).every((c) => c.onCatch.length === 1) && all.every((c) => cuesLog[c.id].length === +n0.split(',')[all.indexOf(c)]), '40 pesan duplikat dari otoritas -> tidak ada kejadian/suara baru');
  const forged = { ...lastKeyMsg, s: 777, id: 'C', cx: C.lis.x, cz: C.lis.z }; for (const c of [A, B, C, D, E]) inject('D', forged, c.id);
  for (let i = 0; i < 5; i++) step(50); ok(all.every((c) => c.onCatch.length === 1), 'pesan tangkapan dari NON-otoritas (dipalsukan) diabaikan di semua klien');
  const bad = { ...lastKeyMsg, s: 778, id: 'C', cx: 99999 }; for (const c of [B, C, D, E]) inject('A', bad, c.id); for (let i = 0; i < 5; i++) step(50); ok(all.every((c) => c.onCatch.length === 1), 'pesan otoritas dengan lokasi di luar batas ditolak');
  // banjir kejadian berbeda dari "otoritas" (mis. bug/penyerang yang menjadi otoritas)
  let flood = 0; const cBefore = cuesLog.C.length;
  for (let i = 0; i < 100; i++) { const m = { ...lastKeyMsg, s: 1000 + i, id: 'V' + (i % 7), cx: C.lis.x + 2, cz: C.lis.z }; inject('A', m, 'C'); step(100); for (const q of C.cap.update(0.1)) { cuesLog.C.push({ t: bus.t, ...q }); } flood++; }
  const floodCues = cuesLog.C.length - cBefore; ok(floodCues <= NL * (Math.ceil(10 / CFG.CAPTURE_AUDIO_MIN_GAP) + 1), `banjir 100 pesan berbeda dalam 10 dtk -> hanya ${floodCues} suara (maks ${NL * (Math.ceil(10 / CFG.CAPTURE_AUDIO_MIN_GAP) + 1)}); jumlah suara terbatas anti-spam`);
  // pesan lama (tanpa lokasi): lokasi dari replika monster di klien itu
  step(1000); const oldMsg = { v: 1, t: 'mc', e: lastKeyMsg.e, s: 5000, id: 'Q', dg: 0 }; const before = C.onCatch.length; inject('A', oldMsg, 'C'); step(100);
  const got = C.onCatch[before]; const vv = C.ctl.view; ok(got && Number.isFinite(got.x) && near(got.x, vv.x, 0.5) && near(got.z, vv.z, 0.5), 'pesan lama tanpa lokasi: memakai posisi monster di replika klien (fallback), bukan 0,0');
  // klien yang belum punya snapshot monster
  const fresh = add('F', 5, { x: 0, z: 0, level: 1 }); const fv = fresh.ctl; const msgOld = { v: 1, t: 'mc', e: 1, s: 1, id: 'Z', dg: 0 };
  // otoritas = A (slot 0): kirim ke F
  inject('A', msgOld, 'F'); step(100); ok(fresh.onCatch.length === 1 && Number.isNaN(fresh.onCatch[0].x) && fresh.results[0] === 'nopos', 'tanpa snapshot & tanpa lokasi: x/z = NaN dan tidak diputar (tidak mengarang posisi)');
}

section('Solo (tanpa jaringan): satu kejadian, korban mendengar sekali');
{
  let nowMs = 0, fired = false; const stub = () => ({ enabled: true, x: 4.2, z: -1.5, yaw: 0, state: 'chase', anim: 'run', speed: 3, targetId: 'me', level: 1, onStairs: false, wp: 0, restore() {}, update() { if (fired) return []; fired = true; return [{ type: 'catch', id: 'me', drag: true }]; } });
  const ctl = new MonsterController(stub, null, () => nowMs), cap = new CaptureAudio(); let n = 0, self = 0, last = null; const res = [];
  ctl.onCatch = (e) => { n++; last = e; res.push(cap.accept(e, 'me', { x: 4, z: -1, level: 1 })); }; ctl.onCatchSelf = () => { self++; };
  const me = { id: 'me', x: 4, z: -1, level: 1, gait: 'run', crouch: false, hidden: false, grace: 0, caught: false };
  const cues = []; for (let i = 0; i < 240; i++) { nowMs += 16.7; ctl.update(1 / 60, me, []); for (const c of cap.update(1 / 60)) cues.push(c.name); }
  ok(n === 1 && self === 1 && res[0] === 'scheduled' && cues.join() === SELF, 'solo: onCatch 1x, onCatchSelf 1x, semua lapisan sekali');
  ok(last && last.x === 4.2 && last.z === -1.5 && last.level === 1 && /^1:1:me$/.test(last.key), `lokasi = posisi monster saat menangkap, kunci ${last && last.key}`);
}

section('Pemasangan di source (pembersihan, tanpa timer, tanpa suara global)');
{
  const P = fs.readFileSync(path.join(ROOT, 'components', 'lobby', 'PlayScene.tsx'), 'utf8'), A = fs.readFileSync(path.join(ROOT, 'lib', 'game', 'captureaudio.ts'), 'utf8');
  ok(!/setTimeout|setInterval|requestAnimationFrame/.test(A.replace(/\/\/.*$/gm, '')), 'captureaudio.ts tidak memakai timer (waktu per frame; tidak ada timer yatim)');
  ok(/capAudio\.clear\(\); mctl\?\.dispose\(\)/.test(P), 'restart/run baru: capAudio.clear() sebelum kontroler baru');
  ok(/mctl\.onCatch = \(ev\) => \{ capAudio\.accept\(ev, monSelf,/.test(P), 'onCatch (semua klien, sekali per kejadian) -> capAudio.accept');
  ok(/for \(const c of capAudio\.update\(dt\)\) audio\.play\(c\.name, \{ pos: c\.pos, vol: c\.vol, rate: c\.rate \}\)/.test(P), 'suara selalu diputar dengan pos (spasial), tidak ada audio.play global untuk tangkapan');
  ok(/if \(!CFG\.CAPTURE_AUDIO_ENABLED\) for \(const c of f\.cues\)/.test(P) && !/for \(const c of f\.cues\) audio\.play/.test(P.replace(/if \(!CFG\.CAPTURE_AUDIO_ENABLED\) for \(const c of f\.cues\) audio\.play/, '')), 'suara lama di timeline jumpscare hanya aktif bila fitur dimatikan (tidak dobel dengan jalur baru)');
  ok(!/sendMonster|sendWorld/.test(A), 'captureaudio.ts tidak mengirim pesan apa pun (hanya mengonsumsi event dari jaringan yang sudah ada)');
  const C = fs.readFileSync(path.join(ROOT, 'lib', 'game', 'monsterctl.ts'), 'utf8'); ok((C.match(/\.onCatch\?\.\(/g) || []).length === 2, 'onCatch dipanggil tepat di 2 tempat: jalur otoritas (lokal) dan jalur penerima (setelah ledger.accept)');
  ok(/this\.ledger\.accept\(m, now\)\) \{\s*if \(m\.id === net\.selfId\)[\s\S]*this\.onCatch\?\.\(/.test(C), 'jalur penerima: onCatch hanya setelah ledger.accept (dedupe) dan hanya dari otoritas sah');
}

section('Pingsan: suara teredam + detak jantung melambat (lokal, tidak menyentuh anti-spam)');
{
  ok(FX.faintMuffle(0) === 0 && FX.faintMuffle(1) > 0.8 && FX.faintMuffle(0.3) < FX.faintMuffle(0.7), 'muffle naik mulus 0 -> ~0,9 mengikuti faint');
  const a = FX.faintHeartFx(0), b = FX.faintHeartFx(1);
  ok(b.interval > a.interval * 2 && b.rate < a.rate && b.volume < a.volume, `detak makin lambat & pelan & rendah (jeda ${a.interval.toFixed(2)} -> ${b.interval.toFixed(2)} dtk, rate ${a.rate.toFixed(2)} -> ${b.rate.toFixed(2)})`);
  const count = (f, secs) => { const hb = new FX.FaintBeat(); let n = 0; for (let i = 0, N = Math.round(secs * 60); i < N; i++) if (hb.update(1 / 60, f)) n++; return n; };
  const early = count(0.05, 6), late = count(1, 6);
  ok(early > late && late >= 2 && late <= 4, `detak per 6 dtk: ${early} (awal pingsan) -> ${late} (pingsan penuh)`);
  const hb = new FX.FaintBeat(); ok(hb.update(1 / 60, 0.5) === true && hb.update(1 / 60, 0.5) === false && hb.update(1 / 60, 0) === false && hb.update(1 / 60, 0.5) === true, 'detak langsung saat mulai pingsan; faint 0 mereset penjadwal');
  const J = new FX.Jumpscare(false); let mx = 0, firstF = -1, t = 0; for (;;) { const f = J.update(1 / 60); t += 1 / 60; if (f.faint > 0 && firstF < 0) firstF = t; mx = Math.max(mx, f.faint); if (f.done) break; }
  ok(firstF > 2.3 && mx > 0.99, `timeline jumpscare memberi faint 0 -> 1 (mulai ${firstF.toFixed(2)} dtk)`);
  const P = fs.readFileSync(path.join(ROOT, 'components', 'lobby', 'PlayScene.tsx'), 'utf8');
  ok(/if \(f\.faint > 0\) \{[\s\S]*audio\.setMuffle\(q\)[\s\S]*faintBeat\.update\(dt, f\.faint\)[\s\S]*audio\.play\('heartbeat'/.test(P), 'PlayScene: faint -> audio.setMuffle + detak melambat (faintBeat)');
  ok(/const beginCapture = \(\) => \{ jsMuffled = false; capMuffle = -1;/.test(P) && /\(capMuffle > 0 \|\| jsMuffled\) && !wake\) audio\.setMuffle\(0\)/.test(P), 'peredam jumpscare diserahkan ke capture / dibersihkan saat respawn-restart');
  const CA = fs.readFileSync(path.join(ROOT, 'lib', 'game', 'captureaudio.ts'), 'utf8');
  ok(/return 'cooldown'/.test(CA) && /return 'spam'/.test(CA) && /return 'dup'/.test(CA) && /CAPTURE_AUDIO_MIN_GAP/.test(CA) && /CAPTURE_AUDIO_VICTIM_COOLDOWN/.test(CA), 'logika anti-spam (dup/cooldown/spam) tetap ada');
}

console.log(`\nAUDIO CAPTURE: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
