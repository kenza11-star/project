// Uji frame impact jumpscare: urutan frame, selesai sendiri (tidak ada loop permanen), deterministik, mode reduced aman.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const I = require(G + '/impactfx.js'), M = require(G + '/monsterfx.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const seq = (reduced) => { const a = []; for (let t = 0; t <= M.JS_TOTAL + 5; t += 0.005) { const o = I.impactAt(t, reduced); a.push([t, o.idx, o.a, o.blur, o.fov, Math.abs(o.sx) + Math.abs(o.sy), o.zoom]); } return a; };

console.log('== Urutan frame (normal)');
{
  const a = seq(false), idxs = []; for (const r of a) if (idxs[idxs.length - 1] !== r[1]) idxs.push(r[1]);
  console.log('  urutan idx:', idxs.join(' > '));
  ok(idxs.join() === '0,1,2,3,4,5,0', 'tepat 1>2>3>4>5 lalu mati, tidak pernah mengulang');
  ok(a.filter((r) => r[0] < M.JS_IMPACT_AT - 1e-6).every((r) => r[1] === 0), 'tidak ada efek sebelum benturan');
  const first = a.find((r) => r[1] === 1)[0]; ok(Math.abs(first - M.JS_IMPACT_AT) < 0.011, 'frame 1 tepat di JS_IMPACT_AT');
  ok(I.IMPACT_END < 2.5 && I.IMPACT_END > 2.3 && I.IMPACT_END > M.JS_IMPACT_AT + 1, 'selesai sebelum fase fade jumpscare (2,5 dtk): ' + I.IMPACT_END.toFixed(2));
  ok(a.filter((r) => r[0] >= I.IMPACT_END + 0.01).every((r) => r[1] === 0 && r[2] === 0 && r[3] === 0 && r[4] === 0 && r[5] === 0), 'lewat IMPACT_END semua nol (tidak nyangkut)');
  const hard = a.filter((r) => r[1] >= 1 && r[1] <= 4); ok(hard[hard.length - 1][0] - hard[0][0] < 0.6, 'frame keras total < 0,6 dtk');
  ok(a.every((r) => r[2] >= 0 && r[2] <= 1 && r[3] >= 0 && r[3] <= 8 && r[4] >= 0 && r[4] <= 9.01 && r[5] <= 0.13), 'nilai a/blur/fov/getar dalam batas aman');
}
{
  const a = seq(false), z = (i) => Math.max(...a.filter((r) => r[1] === i).map((r) => r[6]));
  ok(z(2) >= 2.5 && z(2) > z(1) && z(3) >= 2 && z(4) >= 2, 'close-up wajah: frame 2 paling dekat, frame 3-4 tetap dekat (zoom ' + [1, 2, 3, 4].map(z).join('/') + ')');
  ok(a.every((r) => r[6] >= 1 && r[6] <= 3.01) && a.filter((r) => r[0] >= I.IMPACT_END + 0.01).every((r) => r[6] === 1), 'zoom 1..3 dan kembali ke 1 setelah selesai (layar tidak nyangkut zoom)');
  ok(seq(true).every((r) => r[6] <= 1.13), 'reduced motion: zoom hampir tidak ada');
}
console.log('== Deterministik & aman');
{
  ok(JSON.stringify(seq(false)) === JSON.stringify(seq(false)), 'hasil sama untuk waktu yang sama (fungsi murni)');
  ok(I.impactAt(NaN).idx === 0 && I.impactAt(-5).idx === 0 && I.impactAt(1e9).idx === 0 && I.impactAt(Infinity).idx === 0, 'NaN/negatif/tak hingga -> mati');
  ok(/^M[\d.\sLZM-]+$/.test(I.IMPACT_RAYS_A) && I.IMPACT_RAYS_A.length > 500 && I.IMPACT_RAYS_A !== I.IMPACT_RAYS_B && !/NaN/.test(I.IMPACT_RAYS_A + I.IMPACT_RAYS_B), 'path garis kecepatan valid, dua varian berbeda');
}
console.log('== Reduced motion');
{
  const a = seq(true), idxs = new Set(a.map((r) => r[1]));
  ok([...idxs].every((i) => i === 0 || i === 5), 'tanpa frame B&W/negatif/glitch/merah-kilat (tanpa strobo)');
  ok(a.every((r) => r[2] <= 0.46 && r[5] === 0), 'merah lembut & tanpa getar');
  ok(a.filter((r) => r[0] >= M.JS_IMPACT_AT + 0.71).every((r) => r[1] === 0), 'selesai sendiri < 0,71 dtk setelah benturan');
}
console.log('== Gaya CSS (C3): VHS/RGB ala referensi, ringan, tanpa strobo berulang');
{
  const fs = require('fs'), raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), css = raw.split('\n').filter((l) => /impactfx|ixflash/.test(l)).join('\n');
  ok(!/backdrop-filter/.test(css), 'tanpa backdrop-filter (berat di mobile)');
  ok(!/mix-blend-mode/.test(css) && !/infinite/.test(css), 'tanpa mix-blend-mode dan tanpa animasi berulang');
  ok(!/0,\s*255,\s*(0|255)|#0f0|#0ff/.test(css), 'tidak ada hijau/cyan neon (palet: merah, putih, biru)');
  ok(/rgba\((2[0-5]\d),\s*\d{1,2},\s*\d{1,2}/.test(css) && /rgba\(50,\s*130,\s*255/.test(css) && /rgba\(255,\s*245,\s*240/.test(css), 'palet glitch mengandung merah, biru, dan putih (pecah RGB merah/biru)');
  ok((css.match(/animation:ixflash/g) || []).length === 1 && /ixflash\s+\.05s/.test(css), 'tepat SATU kilatan, <= 0,05 dtk, tidak berulang');
  const kf = raw.match(/@keyframes ixflash\{[^}]*\}[^}]*\}/)[0], fop = +kf.match(/0%\{opacity:([\d.]+)/)[1]; ok(fop <= 0.5, 'opasitas awal kilat <= 0,5 (' + fop + ')');
  const lines = css.match(/\.ix-lines\{[^}]*\}/)[0], op = +lines.match(/opacity:([\d.]+)/)[1]; ok(op <= 0.55, 'opasitas garis kecepatan <= 0,55 (' + op + ')');
  ok(/mask-image:radial-gradient\(circle at center,transparent (2[2-9]|[3-9]\d)%/.test(lines), 'garis kecepatan tidak menutupi area wajah (tengah)');
  const n = (p) => (p.match(/M/g) || []).length; ok(n(I.IMPACT_RAYS_A) <= 42 && n(I.IMPACT_RAYS_B) <= 42, 'garis kecepatan ~40 (' + n(I.IMPACT_RAYS_A) + '/' + n(I.IMPACT_RAYS_B) + ')');
  ok(/ix-bw::after\{background:radial-gradient\(.*rgba\(0,0,0,\.9\d\) 100%/.test(css), 'vignette tepi mendekati hitam');
  ok(/\[data-sh="1"\] \.ix-glitch[^}]*\.ix-noise\{display:none !important\}/.test(css), 'mode shader (data-sh=1) menyembunyikan lapisan CSS yang duplikat');
  ok(/data-f="3"\] \.ix-glitch[^}]*\{display:block\}/.test(css) && /data-f="3"\] \.ix-noise/.test(css), 'puncak (frame 3) memakai robekan + noise');
}
console.log('== Glitch C3: kekuatan, waktu puncak, meluruh cepat, aman');
{
  const F = ['ch', 'tr', 'sc', 'ns', 'fl'], HARD = I.IMPACT_FRAME_DUR.reduce((s, v) => s + v, 0), A = M.JS_IMPACT_AT;
  let range = true, outside = true, flashFrames = new Set(), peakCh = 0, peakTr = 0, seeds = new Set(), flashT = [];
  for (let r = -0.2; r <= 1.8; r += 0.002) {
    const o = I.impactAt(A + r, false); for (const k of F) if (!(o[k] >= 0 && o[k] <= 1)) range = false;
    if (o.idx === 0 && (F.some((k) => o[k] !== 0) || o.seed !== 0)) outside = false;
    if (o.fl > 0) { flashFrames.add(o.idx); flashT.push(r); }
    if (r < 0.26) { peakCh = Math.max(peakCh, o.ch); peakTr = Math.max(peakTr, o.tr); } if (r >= 0 && r < HARD) seeds.add(o.seed);
  }
  ok(range, 'semua kekuatan glitch (ch/tr/sc/ns/fl) di rentang 0..1');
  ok(outside, 'glitch nol di luar jendela impact (tidak ada efek tertinggal)');
  ok(flashFrames.size === 1 && flashFrames.has(1) && Math.max(...flashT) - Math.min(...flashT) <= 0.071, 'kilat kontras hanya di frame 1 dan <= 0,07 dtk (satu kali)');
  ok(peakCh >= 0.9 && peakTr >= 0.9, 'puncak pecah RGB & robekan >= 0,9 dalam 0,26 dtk pertama sesudah benturan (JS_IMPACT_AT)');
  ok(seeds.size >= 12, 'pola glitch berubah ~25 Hz selama frame keras (' + seeds.size + ' seed berbeda)');
  const o0 = { ...I.impactAt(A + 0.001, false) }, oTail = { ...I.impactAt(A + HARD + I.IMPACT_GLITCH_TAIL * I.IMPACT_AFTER_DUR + 0.01, false) };   // impactAt memakai objek bersama: salin nilainya
  ok(o0.idx === 1 && o0.ch >= 0.9 && o0.fl === 1, 'efek puncak dimulai tepat di JS_IMPACT_AT (' + A + ' dtk)');
  ok(F.every((k) => oTail[k] === 0) && oTail.idx === 5, 'sisa glitch nol sebelum aftershock selesai (reda cepat: ~0,24 dtk sesudah frame keras)');
  let mono = true, prev = 9; for (let r = HARD - I.IMPACT_FRAME_DUR[3]; r < HARD + 0.9; r += 0.002) { const o = I.impactAt(A + r, false), v = o.ch + o.tr; if (v > prev + 0.0001) mono = false; prev = v; }
  ok(mono, 'dari frame 4 sampai habis kekuatan glitch hanya menurun (meluruh, tidak membesar lagi)');
  let face = true; for (let r = HARD; r < HARD + I.IMPACT_AFTER_DUR; r += 0.01) { const o = I.impactAt(A + r, false); if (o.a > 0.5 || o.blur > 2.5) face = false; }
  ok(face, 'aftershock tidak menutupi wajah: kabut merah <= 0,5 dan blur <= 2,5 px (dulu 0,8 / 7)');
  const rd = { ...I.impactAt(A + 0.1, true) }; ok(F.every((k) => rd[k] === 0) && rd.seed === 0, 'reduced motion: tanpa glitch/pecah RGB/kilat');
  // perubahan C2 tetap ada
  const j = new M.Jumpscare(false); let reach95 = 0, peak = 0, pk = 0, last = null; for (let i = 0; i < 3.7 * 60; i++) { const f = j.update(1 / 60); const c = { t: f.t, d: f.dist }; if (Math.abs(f.t - 0.95) < 0.009) reach95 = f.reach; if (last) { const v = Math.abs(c.d - last.d) * 60; if (v > peak) { peak = v; pk = c.t; } } last = c; }
  ok(M.JS_FACE_ABOVE === 0.04 && M.JS_GRAB_DELAY === 0.45 && reach95 === 1 && peak >= 2.5 && Math.abs(pk - 0.95) < 0.03, 'perubahan C2 utuh: JS_FACE_ABOVE 0,04, JS_GRAB_DELAY 0,45, lunge ease-in puncak ' + peak.toFixed(2) + ' m/s di t=' + pk.toFixed(2));
  const fs = require('fs'), px = fs.readFileSync(path.join(__dirname, '..', 'lib', 'game', 'postfx.ts'), 'utf8'), ps = fs.readFileSync(path.join(__dirname, '..', 'components', 'lobby', 'PlayScene.tsx'), 'utf8');
  ok(/uniform vec4 uGl;/.test(px) && /bool gl = /.test(px) && /if \(gl\)/.test(px) && /setGlitch\(/.test(px) && /clearGlitch\(\)/.test(px), 'PostFx (pass yang sudah ada) punya uniform glitch, cabang bergerbang, setGlitch/clearGlitch');
  ok(!/new THREE\.WebGLRenderTarget|new THREE\.EffectComposer|ShaderPass/.test(px.replace(/this\.rt = new THREE\.WebGLRenderTarget[^;]*;/, '')), 'tidak ada render pass/target baru selain yang sudah ada');
  ok(/post\.setGlitch\(o\.ch, o\.tr, o\.sc, o\.ns, o\.fl, o\.seed\)/.test(ps) && /impSh = impC = impS = impN = -1; post\?\.clearGlitch\(\)/.test(ps) && /post\?\.clearGlitch\(\); \} return; \}/.test(ps), 'PlayScene: glitch dikirim per frame, dimatikan saat impact selesai dan di impactHide (restart/unmount)');
}

console.log(fails ? '\n' + fails + ' GAGAL, ' + passes + ' lulus' : '\nSemua lulus (' + passes + ')'); process.exit(fails ? 1 : 0);
