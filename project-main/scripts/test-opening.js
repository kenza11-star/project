// Uji opening "bangun setelah pingsan" (lib/game/opening.ts): urutan efek, kehalusan (tanpa lompatan), batas goyang kamera
// (anti motion-sickness), kembali PERSIS normal, independen dari FPS, dan penulisan style DOM yang hemat.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const { WakeUp, applyWakeFx, clearWakeFx, newWakeLast, VIG_DEFAULT, VIG_START_DEFAULT } = require(G + '/opening.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const run = (o, fps = 60, extra = 0) => { // simulasi: kembalikan semua frame (salinan) sampai selesai
  const w = new WakeUp(o), dt = 1 / fps, frames = [], cues = [];
  frames.push({ ...w.peek(), cues: undefined });
  for (let i = 0; i < Math.ceil((w.duration + extra) * fps) + 2; i++) { const f = w.update(dt); frames.push({ ...f, cues: undefined }); for (const c of f.cues) cues.push({ ...c, t: f.t }); }
  return { w, frames, cues };
};
const maxAbs = (a, k) => Math.max(...a.map((f) => Math.abs(f[k])));
const maxStep = (a, k) => { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i][k] - a[i - 1][k])); return m; };
const mono = (a, k, dir) => { for (let i = 1; i < a.length; i++) if ((a[i][k] - a[i - 1][k]) * dir < -1e-9) return false; return true; };

section('Awal: hampir hitam, blur kuat, teredam, lambat');
{
  const { frames } = run({ seed: 7 });
  const f0 = frames[0];
  ok(f0.black >= 0.95 && f0.black < 1, `mulai hampir hitam, bukan hitam total (${f0.black.toFixed(2)})`);
  ok(Math.abs(f0.blur - 11) < 1e-6, 'blur paling kuat di awal');
  ok(f0.vig >= 0.9 && f0.vigStart <= 15, 'vignette kuat di awal');
  ok(f0.muffle >= 0.9, 'audio sangat teredam di awal');
  ok(f0.speed <= 0.5 && f0.look <= 0.65, 'gerak & bidik lambat di awal');
}
section('Urutan efek: semua berubah monoton & halus');
for (const seed of [1, 2, 3, 99, 12345]) {
  const { frames } = run({ seed });
  ok(mono(frames, 'black', -1) && mono(frames, 'blur', -1) && mono(frames, 'muffle', -1) && mono(frames, 'vig', -1), `seed ${seed}: black/blur/muffle/vignette hanya turun`);
  ok(mono(frames, 'vigStart', 1) && mono(frames, 'speed', 1) && mono(frames, 'look', 1), `seed ${seed}: vigStart/speed/look hanya naik`);
  ok(maxStep(frames, 'black') < 0.02 && maxStep(frames, 'blur') < 0.2 && maxStep(frames, 'muffle') < 0.01 && maxStep(frames, 'vig') < 0.01, `seed ${seed}: tanpa lompatan per frame (fade/blur/audio/vignette)`);
  ok(maxStep(frames, 'speed') < 0.01 && maxStep(frames, 'look') < 0.01, `seed ${seed}: percepatan gerak halus`);
}
{
  const { frames } = run({ seed: 5 }); const n = frames.length;
  const t = (s) => frames[Math.round(s * 60)];
  ok(t(1.0).black > 0.9 && t(2.0).black < t(1.0).black && t(3.6).black < 0.01, 'layar terbuka perlahan (1s masih gelap, ~3,5s terang)');
  ok(t(2.0).blur > t(4.0).blur && t(4.0).blur > t(6.0).blur && t(6.3).blur < 0.01, 'blur turun bertahap sampai hilang');
  ok(t(3.0).muffle > 0.25 && t(3.0).muffle < 0.9 && t(6.8).muffle < 0.02, 'audio teredam -> jernih bertahap');
  ok(t(7.4).speed > 0.99 && t(7.4).look > 0.99, 'gerak mendekati normal tepat sebelum selesai');
  ok(n > 440, 'durasi ~7,5 detik');
}
section('Kamera: goyang halus & kecil (anti motion-sickness)');
for (const seed of [1, 2, 3, 99, 12345, 777]) {
  const { frames } = run({ seed });
  const DEG = 180 / Math.PI;
  ok(maxAbs(frames, 'roll') * DEG <= 5.2, `seed ${seed}: roll maks ${(maxAbs(frames, 'roll') * DEG).toFixed(1)} derajat (<= 5,2)`);
  ok(maxAbs(frames, 'pitch') * DEG <= 9, `seed ${seed}: pitch maks ${(maxAbs(frames, 'pitch') * DEG).toFixed(1)} derajat (<= 9)`);
  ok(maxAbs(frames, 'yaw') * DEG <= 3, `seed ${seed}: yaw maks ${(maxAbs(frames, 'yaw') * DEG).toFixed(1)} derajat (<= 3)`);
  ok(maxAbs(frames, 'dip') <= 0.11 && maxAbs(frames, 'drift') <= 0.075, `seed ${seed}: dip & drift kecil`);
  // kecepatan sudut kamera (derajat/detik): tidak boleh cepat
  const angV = Math.max(maxStep(frames, 'roll'), maxStep(frames, 'pitch'), maxStep(frames, 'yaw')) * 60 * DEG;
  ok(angV < 12, `seed ${seed}: kecepatan sudut maks ${angV.toFixed(1)} derajat/detik (< 12)`);
}
section('Selesai: kembali PERSIS normal tanpa "pop"');
{
  const { w, frames } = run({ seed: 4 }, 60, 1);
  const last = frames[frames.length - 1], pre = frames.find((f) => f.t > w.duration - 1 / 60 - 1e-9 && !f.done);
  ok(last.done && last.black === 0 && last.blur === 0 && last.vig === VIG_DEFAULT && last.vigStart === VIG_START_DEFAULT, 'visual normal persis');
  ok(last.muffle === 0 && last.speed === 1 && last.look === 1 && last.drift === 0, 'audio/gerak/bidik normal persis');
  ok(last.yaw === 0 && last.pitch === 0 && last.roll === 0 && last.dip === 0, 'kamera tanpa offset sisa');
  ok(pre && pre.blur < 0.01 && pre.muffle < 0.005 && pre.speed > 0.998 && Math.abs(pre.roll) < 0.002 && Math.abs(pre.pitch) < 0.002 && Math.abs(pre.yaw) < 0.002 && Math.abs(pre.dip) < 0.002, 'satu frame sebelum selesai sudah hampir normal (tidak melompat)');
  const w2 = new WakeUp({ seed: 4 }); for (let i = 0; i < 700; i++) w2.update(1 / 60);
  ok(w2.update(0.016).done && w2.update(0.016).cues.length === 0, 'setelah selesai tetap normal & tanpa suara tambahan');
}
section('Independen dari FPS & tahan lag spike');
{
  const at = (fps, s) => { const w = new WakeUp({ seed: 8 }); let f = w.peek(); for (let i = 0; i < Math.round(s * fps); i++) f = w.update(1 / fps); return { ...f, cues: undefined }; };
  for (const s of [1.5, 3, 5]) {
    const a = at(20, s), b = at(30, s), c = at(60, s);
    const keys = ['black', 'muffle', 'speed', 'look', 'roll', 'pitch', 'yaw', 'dip', 'drift', 'vig'];
    ok(keys.every((k) => Math.abs(a[k] - c[k]) < 2e-3 && Math.abs(b[k] - c[k]) < 2e-3), `nilai sama di 20/30/60 FPS pada t=${s}s`);
    ok(Math.abs(b.blur - c.blur) < 2e-3 && !b.lowPower && !c.lowPower, `blur sama di 30 & 60 FPS pada t=${s}s (20 FPS sengaja mematikan blur)`);
  }
  const w = new WakeUp({ seed: 8 }); w.update(2.0); // lag 2 detik: maju maksimal 0,1 detik
  ok(Math.abs(w.peek().t - 0.1) < 1e-9, 'lag spike tidak melompati animasi (maks 0,1 detik per update)');
}
section('Suara: napas & detak jantung samar, tidak berlebihan');
{
  const { cues } = run({ seed: 3 });
  const br = cues.filter((c) => c.name === 'breath'), hb = cues.filter((c) => c.name === 'heartbeat');
  ok(br.length === 3, `napas 3x (${br.length})`);
  ok(br.every((c) => c.vol <= 0.55) && br[0].vol > br[2].vol, 'napas pelan & makin pelan');
  ok(hb.length >= 5 && hb.length <= 9, `detak jantung ${hb.length}x`);
  ok(hb.every((c) => c.vol <= 0.42) && hb[hb.length - 1].vol < hb[0].vol * 0.6, 'detak jantung samar & menghilang (jauh di bawah detak saat kelelahan: 0,8-1,3)');
  ok(cues.every((c) => c.t < 7.5 - 0.5) || br[2].t < 7, 'tidak ada suara tepat di akhir');
  ok(hb.every((c, i) => i === 0 || c.t - hb[i - 1].t >= 0.9), 'jeda antar detak >= 0,9 s (tidak panik)');
}
section('Prefers-reduced-motion & durasi lain');
{
  const { frames } = run({ seed: 2, reduced: true });
  ok(maxAbs(frames, 'roll') === 0 && maxAbs(frames, 'pitch') === 0 && maxAbs(frames, 'yaw') === 0 && maxAbs(frames, 'dip') === 0 && maxAbs(frames, 'drift') === 0, 'reduced-motion: tanpa goyang kamera');
  ok(frames[0].blur <= 5.5 + 1e-9, 'reduced-motion: blur separuh');
  const { w, frames: f4 } = run({ seed: 2, duration: 4 });
  ok(w.duration === 4 && f4[f4.length - 1].done && maxStep(f4, 'blur') < 0.35 && maxAbs(f4, 'roll') * 180 / Math.PI <= 5.2, 'durasi 4 detik: tetap halus & aman');
  const a = run({ seed: 11 }).frames, b = run({ seed: 11 }).frames, c = run({ seed: 12 }).frames;
  ok(a.every((f, i) => f.roll === b[i].roll) && a.some((f, i) => f.roll !== c[i].roll), 'deterministik per seed, berbeda antar seed');
}
section('Penerapan DOM: hemat & bersih');
{
  const mk = () => { const style = { opacity: '', filter: '', props: {}, setProperty(k, v) { this.props[k] = v; this.writes++; }, removeProperty(k) { delete this.props[k]; }, writes: 0 }; return { style }; };
  const canvas = mk(), vig = mk(), last = newWakeLast(), targets = { canvas, vignette: vig };
  let opW = 0, fW = 0, prevOp = '', prevF = '';
  const w = new WakeUp({ seed: 6 });
  applyWakeFx(targets, w.peek(), last);
  ok(parseFloat(canvas.style.opacity) < 0.05 && canvas.style.filter === 'blur(11px)', `frame 0: layar hampir hitam (opacity ${canvas.style.opacity}) + blur 11px`);
  ok(vig.style.props['--vg'] === '0.95' && vig.style.props['--vs'] === '14%', 'vignette lebar & kuat lewat variabel CSS');
  for (let i = 0; i < 460; i++) { const f = w.update(1 / 60); if (f.done) break; applyWakeFx(targets, f, last); if (canvas.style.opacity !== prevOp) { opW++; prevOp = canvas.style.opacity; } if (canvas.style.filter !== prevF) { fW++; prevF = canvas.style.filter; } }
  console.log(`  penulisan style selama opening: opacity ${opW}x, blur ${fW}x, vignette ${vig.style.writes / 2}x (dari 450 frame)`);
  ok(opW <= 200 && fW <= 60 && vig.style.writes / 2 <= 150, 'penulisan style dibatasi (dikuantisasi), bukan tiap frame');
  clearWakeFx(targets, last);
  ok(canvas.style.opacity === '' && canvas.style.filter === '' && Object.keys(vig.style.props).length === 0, 'selesai: inline style dibersihkan total (vignette & canvas kembali seperti semula)');
  const vig2 = mk(); const w3 = new WakeUp({ seed: 6 }); const l2 = newWakeLast();
  applyWakeFx({ canvas: mk(), vignette: null }, w3.peek(), l2); applyWakeFx({ canvas: mk(), vignette: vig2 }, w3.peek(), l2);
  ok(vig2.style.props['--vg'] === '0.95', 'vignette yang baru muncul (mount belakangan) tetap menerima nilai');
}
section('Hemat daya: blur dimatikan halus bila FPS rendah');
{
  const fast = new WakeUp({ seed: 3 }); let spikeOk = true;
  for (let i = 0; i < 450; i++) { const f = fast.update(i === 120 ? 0.1 : 1 / 60); if (f.lowPower) spikeOk = false; }
  ok(spikeOk, 'FPS normal + satu lonjakan lag 100 ms: blur tidak dimatikan');
  const slow = new WakeUp({ seed: 3 }); const bl = []; let low = -1, prev = 0, jump = 0;
  for (let i = 0; i < 400; i++) { const f = slow.update(1 / 20); if (f.lowPower && low < 0) low = f.t; bl.push(f.blur); if (i && Math.abs(f.blur - prev) > jump) jump = Math.abs(f.blur - prev); prev = f.blur; if (f.done) break; }
  ok(low > 0.5 && low < 3, `20 FPS terus-menerus: lowPower aktif di t=${low.toFixed(2)}s`);
  ok(bl[bl.length - 1] === 0 && bl.every((b) => b >= 0), 'blur berakhir 0');
  ok(jump < 11 * 0.05 / 0.4 + 0.2, `blur turun halus (maks ${jump.toFixed(2)} px per frame 20 FPS)`);
  const w = new WakeUp({ seed: 3 }); let f2; for (let i = 0; i < 40; i++) f2 = w.update(1 / 20); // ~2 detik di 20 FPS
  ok(f2.lowPower && f2.blur === 0 && f2.black < 0.97 && f2.vig > VIG_DEFAULT, 'sisa efek (fade hitam, vignette) tetap jalan tanpa blur');
}
console.log(`\nOpening: ${passes} lulus, ${fails} gagal`);
if (fails) process.exit(1);
