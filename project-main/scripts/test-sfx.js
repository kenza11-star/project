// Uji integrasi SFX baru (file mp3 dari repo Sound): pemetaan fungsi->file, potongan (clip) valid, pemuatan/cache AudioManager (dengan
// AudioContext palsu), varian tanpa pengulangan berurutan, sinkron dengan animasi (sync), cadence langkah, event bantingan, dan tidak
// ada nama SFX yang salah/typo di kode. Dijalankan oleh scripts/run-test.sh (butuh .tmp-game hasil kompilasi).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), G = path.join(ROOT, '.tmp-game'), PUB = path.join(ROOT, 'public');
const CFG = require(G + '/config.js');
const { SFX, CLIPS } = require(G + '/sfx.js');
const { SRC_DUR } = require(G + '/sfxclips.js');
const { AudioManager } = require(G + '/audio.js');
const { EventScheduler } = require(G + '/events.js');
const { makeRng } = require(G + '/rng.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const wavDur = (f) => { const b = fs.readFileSync(f); return (b.length - 44) / (b.readUInt32LE(28) || 44100); };
const fileOf = (n) => (CLIPS[n] ? CLIPS[n].file : n + '.wav');
const durOf = (f) => (SRC_DUR[f] !== undefined ? SRC_DUR[f] : wavDur(path.join(PUB, 'sfx', f)));

(async () => {
section('Data: semua varian & clip valid');
{
  const allNames = new Set(); for (const d of Object.values(SFX)) { d.files.forEach((n) => allNames.add(n)); (d.legacy || []).forEach((n) => allNames.add(n)); }
  const missing = [...allNames].filter((n) => !fs.existsSync(path.join(PUB, 'sfx', fileOf(n))));
  ok(missing.length === 0, `semua file sumber ada di public/sfx (hilang: ${missing.join(', ') || '-'})`);
  let bad = 0;
  for (const [n, c] of Object.entries(CLIPS)) {
    const d = SRC_DUR[c.file];
    if (d === undefined || c.off < 0 || c.dur <= 0.05 || c.off + c.dur > d + 1e-3 || c.gain < 0.2 || c.gain > 12 || c.fi < 0 || c.fo < 0 || c.fi + c.fo > c.dur || (c.hit !== undefined && (c.hit < 0 || c.hit > c.dur))) { bad++; console.log('   clip bermasalah:', n, JSON.stringify(c)); }
  }
  ok(bad === 0, `${Object.keys(CLIPS).length} clip berada di dalam file sumber, gain/fade/hit wajar`);
  const legacyOk = Object.entries(SFX).every(([k, d]) => !d.legacy || d.legacy.every((n) => fs.existsSync(path.join(PUB, 'sfx', n + '.wav'))));
  ok(legacyOk, 'file .wav lama (cadangan) tetap ada & tidak dihapus');
  // 19 file mp3 yang diminta semuanya dipakai
  const mp3 = fs.readdirSync(path.join(PUB, 'sfx')).filter((f) => f.endsWith('.mp3'));
  const used = new Set(Object.values(CLIPS).map((c) => c.file));
  ok(mp3.length === 22 && mp3.every((f) => used.has(f)), `ke-22 file mp3 (19 kiriman + 3 baru dari repo Sound) dipakai oleh clip (${mp3.length} file, tak terpakai: ${mp3.filter((f) => !used.has(f)).join(', ') || '-'})`);
}
section('Pemetaan fungsi -> file (sesuai permintaan)');
{
  const srcOf = (name) => [...new Set(SFX[name].files.map((n) => CLIPS[n] && CLIPS[n].file))];
  const map = {
    step_walk: ['freeeverythingxx-walking-on-concrete-ver-2-268513.mp3', 'Tanggalantai_Walk.mp3'], step_run: ['soumages-running-363346.mp3', 'Tanggalantai_Run.mp3'],
    step_stairs: ['freesound_community-footsteps-stairs-slow-106711.mp3', 'freesound_community-concrete-footsteps-6752.mp3'],
    breath: ['ribhavagrawal-heavy-breathing-sound-effect-type-02-294195.mp3'], pant: ['ribhavagrawal-heavy-breathing-sound-effect-type-02-294195.mp3'],
    heartbeat: ['dragon-studio-heartbeat-sound-372448.mp3'], door_open: ['freesound_community-door-creak-38423.mp3'], door_close: ['dragon-studio-door-close-effect-382710.mp3'],
    door_slam: ['freesound_community-door-slam-angrily-86963.mp3'], impact_slam: ['impact-slam-46.mp3'], floor_creak: ['dragon-studio-floorboard-creak-02-499644.mp3'],
    drawer_open: ['desk-drawer-open-02.mp3', 'desk-drawer-slide-02.mp3'], drawer_close: ['growth-84fc4bc4938dcf852562e065-part-1-v1.mp3', 'desk-drawer-slide-01.mp3'],
    cabinet_open: ['refrigerator-door-open-02.mp3'], cabinet_close: ['door-close-47.mp3'],
    locker_open: ['metal-door-open-02.mp3'], locker_close: ['metal_locker_creak.mp3'], lock_unlock: ['metal-door-unlock-02.mp3'],
  };
  for (const [name, files] of Object.entries(map)) { const got = srcOf(name).sort(), want = files.slice().sort(); ok(JSON.stringify(got) === JSON.stringify(want), `${name} <- ${want.map((f) => f.slice(0, 28)).join(' + ')}`); }
  ok(SFX.distant.files.includes('floor_creak'), 'decit lantai juga jadi variasi suara jauh acak');
  const n = (k) => SFX[k].files.length;
  ok(n('step_walk') >= 14 && n('step_run') >= 18 && n('step_stairs') >= 15 && n('heartbeat') >= 6 && n('breath') >= 3 && n('drawer_open') === 2 && n('drawer_close') === 2, `cukup varian untuk variasi acak (walk ${n('step_walk')}, run ${n('step_run')}, stairs ${n('step_stairs')}, heart ${n('heartbeat')}, breath ${n('breath')})`);
}
section('Nama SFX di kode (tidak ada typo / event salah)');
{
  const src = ['lib/game/world.ts', 'lib/game/opening.ts', 'components/lobby/PlayScene.tsx', 'lib/game/interaction.ts', 'lib/game/container.ts'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const lit = new Set(); for (const m of src.matchAll(/\.(?:play|start)\(\s*'([a-z_]+)'/g)) lit.add(m[1]);
  for (const m of src.matchAll(/name:\s*'(breath|heartbeat)'/g)) lit.add(m[1]);
  for (const k of ['drawer', 'cabinet', 'locker', 'lid']) for (const s of ['_open', '_close']) lit.add(k + s);
  for (const m of src.matchAll(/'(step_[a-z]+)'/g)) lit.add(m[1]);
  const unknown = [...lit].filter((n) => !SFX[n]);
  ok(unknown.length === 0, `semua nama SFX yang dipanggil terdefinisi (${lit.size} nama; tak dikenal: ${unknown.join(', ') || '-'})`);
  ok(/stepSound\(player, running\)/.test(src), 'PlayScene memilih langkah menurut kondisi lari/jalan');
  ok(/rt\.sfx \+ '_open'/.test(src) && /rt\.sfx \+ '_close'/.test(src), 'furniture memutar SFX menurut objek yang berinteraksi (rt.sfx, posisi rt.ax/az)');
  ok(!/play\('step_(carpet|tile)'/.test(src), 'langkah lama tidak lagi dipanggil langsung');
}
section('Cadence langkah: jalan vs lari vs jongkok vs tangga');
{
  const iv = (speed, stride) => stride / speed;
  const walk = iv(CFG.WALK_SPEED, CFG.STRIDE_WALK), run = iv(CFG.SPRINT_SPEED, CFG.STRIDE_RUN), crouch = iv(CFG.CROUCH_SPEED, CFG.STRIDE_CROUCH), stairs = iv(CFG.WALK_SPEED * 0.8, CFG.STRIDE_STAIRS);
  console.log(`  interval langkah: jalan ${walk.toFixed(2)}s, lari ${run.toFixed(2)}s, jongkok ${crouch.toFixed(2)}s, tangga ${stairs.toFixed(2)}s`);
  ok(run < walk * 0.7, 'lari jauh lebih cepat dari jalan');
  ok(crouch > walk, 'jongkok lebih lambat dari jalan');
  const maxDur = (arr) => Math.max(...arr.map((n) => CLIPS[n].dur));
  ok(maxDur(SFX.step_walk.files) <= walk * 1.0, `klip langkah jalan (${maxDur(SFX.step_walk.files)}s) tidak tumpang tindih (interval ${walk.toFixed(2)}s)`);
  ok(maxDur(SFX.step_run.files) <= run * 1.0, `klip langkah lari (${maxDur(SFX.step_run.files)}s) tidak tumpang tindih (interval ${run.toFixed(2)}s)`);
  ok(walk > SFX.step_walk.gap && run > SFX.step_run.gap && stairs > SFX.step_stairs.gap, 'throttle SFX tidak memotong langkah normal');
  ok(CFG.FOOTSTEP_VOLUME > 0 && CFG.FOOTSTEP_VOLUME <= 0.3, 'volume langkah dasar tetap pelan (disesuaikan jalan 1x / lari 1,5x / jongkok 0,35x di PlayScene)');
}
section('Repo Sound: semua 14 file audio terwakili');
{
  // repo kenza11-star/Sound: Lacidrawer(6) + Lemaricabinet(2) + Loker(4) + Tanggalantai(2) = 14 file; 11 di antaranya identik dengan file yang sudah dipakai
  const repo = { 'Lacidrawer/desk-drawer-open-02.mp3': 'desk-drawer-open-02.mp3', 'Lacidrawer/desk-drawer-slide-01.mp3': 'desk-drawer-slide-01.mp3', 'Lacidrawer/desk-drawer-slide-02.mp3': 'desk-drawer-slide-02.mp3',
    'Lacidrawer/metal-door-open-02.mp3': 'metal-door-open-02.mp3', 'Lacidrawer/metal-door-unlock-02.mp3': 'metal-door-unlock-02.mp3', 'Lacidrawer/wooden drawer close.mp3': 'growth-84fc4bc4938dcf852562e065-part-1-v1.mp3',
    'Lemaricabinet/door-close-47.mp3': 'door-close-47.mp3', 'Lemaricabinet/refrigerator-door-open-02.mp3': 'refrigerator-door-open-02.mp3',
    'Loker/impact-slam-46.mp3': 'impact-slam-46.mp3', 'Loker/metal locker creak.mp3': 'metal_locker_creak.mp3', 'Loker/metal-door-open-02.mp3': 'metal-door-open-02.mp3', 'Loker/metal-door-unlock-02.mp3': 'metal-door-unlock-02.mp3',
    'Tanggalantai/Run.mp3': 'Tanggalantai_Run.mp3', 'Tanggalantai/Walk.mp3': 'Tanggalantai_Walk.mp3' };
  const used = new Set(Object.values(CLIPS).map((c) => c.file));
  const miss = Object.entries(repo).filter(([, f]) => !used.has(f) || !fs.existsSync(path.join(PUB, 'sfx', f)));
  ok(Object.keys(repo).length === 14 && miss.length === 0, `14 file repo Sound -> semuanya dipakai oleh clip game (tak terwakili: ${miss.map((m) => m[0]).join(', ') || '-'})`);
}
section('Pintu: animasi selaras suara');
{
  const open = 0.7 * CFG.DOOR_OPEN_SLOW, close = 0.7 * CFG.DOOR_CLOSE_SCALE, creak = CLIPS.door_creak.dur, cl = CLIPS.door_close_hit.dur;
  console.log(`  buka ${open.toFixed(2)}s vs derit ${creak}s | tutup ${close.toFixed(2)}s vs suara tutup ${cl}s | banting ${CFG.DOOR_SLAM_SECONDS}s`);
  ok(open >= creak * 0.8 && open <= creak * 1.1, 'animasi buka pintu lambat, selaras panjang suara derit');
  ok(close >= cl * 0.9 && close <= cl * 1.4 && close < open / 2, 'animasi tutup selaras suara tutup & lebih cepat dari buka');
  ok(CFG.DOOR_SLAM_SECONDS < 0.35, 'banting menutup cepat');
}
section('Event horor acak: bantingan pintu');
{
  ok(CFG.EVENT_WEIGHTS.slam > 0, 'bobot event slam > 0');
  const seen = new Set(); let ndet = 0;
  for (let seed = 1; seed <= 60; seed++) { const s = new EventScheduler(makeRng(seed)), s2 = new EventScheduler(makeRng(seed)); const a = [], b = []; for (let i = 0; i < 40000; i++) { const t = s.update(0.25, () => true); if (t) { seen.add(t); a.push(t); } const t2 = s2.update(0.25, () => true); if (t2) b.push(t2); } if (JSON.stringify(a) === JSON.stringify(b)) ndet++; }
  ok(seen.has('slam') && seen.has('lights') && seen.has('door') && seen.has('furniture') && seen.has('entity'), `semua jenis event muncul: ${[...seen].join(',')}`);
  ok(ndet === 60, 'penjadwal tetap deterministik per seed');
  ok(SFX.door_slam.max >= CFG.SLAM_MAX_DIST && SFX.impact_slam.max >= CFG.SLAM_MAX_DIST && CFG.SLAM_MIN_DIST >= 5, 'bantingan terdengar di seluruh jarak event & tidak pernah di dekat pemain');
  const ws = fs.readFileSync(path.join(ROOT, 'lib/game/world.ts'), 'utf8');
  ok(/case 'slam': return this\.evSlam\(p\)/.test(ws) && /d\.slam \? 'door_slam' : 'door_close'/.test(ws), 'world.ts: event slam terhubung & pintu dibanting memutar door_slam');
}

// ---------------------------------------------------------------- AudioManager dengan AudioContext palsu
section('AudioManager: preload, cache, iris clip, varian, sync');
class FBuf { constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.d = Array.from({ length: ch }, () => new Float32Array(len)); } getChannelData(k) { return this.d[k]; } get duration() { return this.length / this.sampleRate; } }
const mkParam = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {} });
class FCtx {
  constructor() { this.sampleRate = 44100; this.currentTime = 100; this.state = 'running'; this.destination = {}; this.listener = {}; this.started = []; FCtx.last = this; }
  createGain() { return { gain: mkParam(), connect() {}, disconnect() {} }; }
  createDynamicsCompressor() { return { threshold: mkParam(), knee: mkParam(), ratio: mkParam(), attack: mkParam(), release: mkParam(), connect() {} }; }
  createBiquadFilter() { return { type: '', frequency: mkParam(), Q: mkParam(), connect() {}, disconnect() {} }; }
  createPanner() { return { positionX: mkParam(), positionY: mkParam(), positionZ: mkParam(), connect() {}, disconnect() {} }; }
  createBuffer(ch, len, sr) { return new FBuf(ch, len, sr); }
  createBufferSource() { const ctx = this; const s = { buffer: null, loop: false, playbackRate: mkParam(), out: null, connect(o) { this.out = o; }, disconnect() {}, start(when) { ctx.started.push({ buf: this.buffer, when, rate: this.playbackRate.value, gain: this.out && this.out.gain && this.out.gain.value }); }, stop() {}, onended: null }; return s; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  decodeAudioData(ab, ok2) { const dv = new DataView(ab), dur = dv.getFloat64(0, true), ch = new Uint8Array(ab)[8]; const b = new FBuf(ch, Math.floor(dur * this.sampleRate), this.sampleRate); for (const c of b.d) c.fill(0.5); ok2(b); }
}
const harness = async (failMp3) => {
  const urls = [];
  global.window = { AudioContext: FCtx };
  global.fetch = async (url) => {
    urls.push(url); const f = path.join(PUB, url);
    if (!fs.existsSync(f) || (failMp3 && f.endsWith('.mp3'))) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    const dur = f.endsWith('.mp3') ? SRC_DUR[path.basename(f)] : wavDur(f), ab = new ArrayBuffer(16); new DataView(ab).setFloat64(0, dur, true); new Uint8Array(ab)[8] = f.endsWith('.mp3') ? 2 : 1; return { ok: true, arrayBuffer: async () => ab };
  };
  const am = new AudioManager(); am.init(); for (let i = 0; i < 400 && !am.isReady(); i++) await new Promise((r) => setTimeout(r, 5));
  return { am, urls, ctx: FCtx.last };
};
const warn = console.warn; console.warn = () => {};
{
  const { am, urls, ctx } = await harness(false);
  ok(am.isReady(), 'semua SFX selesai dimuat (preload)');
  ok(new Set(urls).size === urls.length, `setiap file sumber hanya di-fetch & di-decode sekali (${urls.length} file)`);
  ok(urls.every((u) => fs.existsSync(path.join(PUB, u))), 'semua URL SFX menunjuk file yang ada (tidak ada 404)');
  // iris clip: panjang, mono, gain & fade dibakar
  let badSlice = 0;
  for (const [n, c] of Object.entries(CLIPS)) {
    const b = am.bufs.get(n); if (!b || b.numberOfChannels !== 1 || Math.abs(b.length - Math.round(c.dur * 44100)) > 2) { badSlice++; continue; }
    const lim = (v) => (v <= 0.9 ? v : 0.9 + 0.1 * Math.tanh((v - 0.9) / 0.1)); // pembatas lembut yang sama dengan AudioManager.slice
    const d = b.getChannelData(0), mid = d[Math.floor(b.length / 2)], want = lim(0.5 * c.gain);
    const fadeFree = c.fi + c.fo < c.dur * 0.9;
    if (Math.abs(d[0]) > 0.02 || Math.abs(d[b.length - 1]) > 0.02 || (fadeFree && c.dur > c.fi + c.fo + 0.02 && Math.abs(d[Math.floor((c.fi + (c.dur - c.fo - c.fi) / 2) * 44100)] - want) > 0.02)) badSlice++;
  }
  ok(badSlice === 0, `iris ${Object.keys(CLIPS).length} clip: mono, panjang tepat, fade-in/out (tanpa klik), gain diterapkan (rusak: ${badSlice})`);
  // varian: tidak berulang berurutan, semua terpakai
  for (const name of ['step_walk', 'step_run', 'step_stairs', 'heartbeat', 'breath', 'drawer_open']) {
    ctx.started.length = 0; const seq = [];
    for (let i = 0; i < 300; i++) { ctx.currentTime += 2; am.stopAll(); am.play(name); const s = ctx.started[ctx.started.length - 1]; seq.push(s.buf); }
    let rep = 0; for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) rep++;
    ok(rep === 0 && new Set(seq).size === SFX[name].files.length, `${name}: ${new Set(seq).size}/${SFX[name].files.length} varian dipakai, pengulangan berurutan = ${rep}`);
  }
  // sync dengan animasi
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); const t0 = ctx.currentTime;
  am.play('cabinet_close', { sync: 0.5, pos: { x: 0, y: 0.9, z: 0 } });
  const cs = ctx.started[0]; ok(Math.abs(cs.when - (t0 + 0.5 - CLIPS.cabinet_close_a.hit)) < 1e-6, `cabinet_close ditunda ${(cs.when - t0).toFixed(3)}s agar benturan jatuh di akhir animasi 0,5s`);
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('drawer_close', { sync: 0.5 });
  ok(ctx.started[0].when === 0, 'drawer_close: clip sudah dipangkas sehingga benturan = 0,5s -> mulai langsung');
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('drawer_open', { sync: 0.5 }); ok(ctx.started[0].when === 0, 'drawer_open mulai langsung (benturan sudah di 0,5s)');
  // independen per objek + jarak
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('locker_open', { pos: { x: 3, y: 0.9, z: 0 } }); ctx.currentTime += 5; am.play('locker_open', { pos: { x: -8, y: 0.9, z: 0 } }); ctx.currentTime += 5; am.play('locker_open', { pos: { x: 100, y: 0.9, z: 0 } });
  ok(ctx.started.length === 2, 'SFX posisional mengikuti objek: yang di luar jangkauan (100 m > 12 m) tidak diputar, tiap objek memutar sendiri');
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('door_slam', { pos: { x: 30, y: 1, z: 0 } }); ok(ctx.started.length === 1, 'bantingan pintu terdengar sampai 30 m');
  ctx.currentTime += 1; am.stopAll(); am.play('floor_creak'); ctx.started.length = 0; ctx.currentTime += 0.5; am.play('floor_creak'); ok(ctx.started.length === 0, 'decit lantai dibatasi gap (tidak spam)');
  am.dispose();
}
{
  const { am, ctx } = await harness(true); // semua .mp3 gagal dimuat -> cadangan .wav lama
  ok(am.isReady(), 'bila mp3 gagal dimuat, loader tetap selesai');
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('door_open'); am.play('step_walk'); ctx.currentTime += 5; am.play('drawer_close');
  ok(ctx.started.length === 3, 'cadangan: file .wav lama otomatis dipakai (door_open, step_walk, drawer_close) tanpa error');
  ctx.started.length = 0; ctx.currentTime += 5; am.stopAll(); am.play('floor_creak'); ok(ctx.started.length === 0, 'SFX tanpa cadangan hanya diam (tidak error)');
  am.dispose();
}
console.warn = warn;
console.log(`\nSFX: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
