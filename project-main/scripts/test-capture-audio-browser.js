// Uji TAHAP 4 di browser NYATA (Chromium headless + WebAudio sungguhan, tanpa mock): memuat AudioManager + CaptureAudio hasil kompilasi (.tmp-game),
// men-decode file asli public/sfx, memutar suara tangkapan lewat jalur yang sama dengan PlayScene, lalu MENGUKUR keluaran audio (analyser kiri/kanan
// sebelum destination): falloff jarak, panning kiri/kanan, tidak ada suara di luar jangkauan, tepat 2 sumber suara per kejadian walau dipicu berulang.
// Butuh playwright + Chromium (tidak ada di dependency proyek, jadi uji ini opsional: dilewati bila tidak tersedia). BUKAN uji di HP Android.
// Jalankan: npm run test:capture-audio-browser (setelah tsc -p scripts/tsconfig.test.json).
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), G = path.join(ROOT, '.tmp-game'), PUB = path.join(ROOT, 'public');
let pw = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) { try { pw = require(p); break; } catch { /* coba berikutnya */ } }
if (!pw) { console.log('AUDIO CAPTURE (browser): DILEWATI (playwright tidak terpasang)'); process.exit(0); }
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

const mods = ['config', 'sfxclips', 'sfx', 'audio', 'monsterfx', 'monstersync', 'captureaudio'];
const bundle = mods.map((m) => `__defs[${JSON.stringify(m)}] = function (exports, require) {\n${fs.readFileSync(path.join(G, m + '.js'), 'utf8')}\n};`).join('\n');
const HTML = `<!doctype html><meta charset=utf-8><body><script>
const __defs = {}, __cache = {};
const __req = (n) => { n = n.replace(/^\\.\\//, ''); if (__cache[n]) return __cache[n].exports; const m = { exports: {} }; __cache[n] = m; __defs[n](m.exports, __req); return m.exports; };
${bundle}
window.__req = __req;
</script>`;
const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') { res.setHeader('content-type', 'text/html'); return res.end(HTML); }
  const m = /^\/sfx\/([^/?]+)/.exec(req.url); const f = m && path.join(PUB, 'sfx', decodeURIComponent(m[1]));
  if (f && f.startsWith(path.join(PUB, 'sfx')) && fs.existsSync(f)) { res.setHeader('content-type', f.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'); return res.end(fs.readFileSync(f)); }
  res.statusCode = 404; res.end('nf');
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage(); const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const info = await page.evaluate(async () => {
    // ---- pengukuran: tap analyser kiri/kanan tepat sebelum destination + catat panner & start sumber ----
    const rec = { panners: [], starts: [] }, tap = {};
    const oc = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...a) {
      if (dest instanceof AudioDestinationNode && !tap.L) { const c = this.context, sp = c.createChannelSplitter(2); tap.L = c.createAnalyser(); tap.R = c.createAnalyser(); tap.L.fftSize = tap.R.fftSize = 1024; oc.call(this, sp); oc.call(sp, tap.L, 0); oc.call(sp, tap.R, 1); }
      return oc.call(this, dest, ...a);
    };
    const cp = AudioContext.prototype.createPanner; AudioContext.prototype.createPanner = function () { const p = cp.call(this); rec.panners.push(p); return p; };
    const st = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { rec.starts.push({ dur: this.buffer.duration, loop: this.loop, at: this.context.currentTime }); return st.apply(this, a); };
    const A = __req('audio'), CA = __req('captureaudio'), CFG = __req('config'), SFX = __req('sfx').SFX;
    const audio = new A.AudioManager(); audio.init(); const t0 = performance.now();
    while (!audio.isReady() && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    window.__t = { audio, CA, CFG, SFX, rec, tap, peaks: { L: 0, R: 0 } };
    const bufL = new Float32Array(1024), bufR = new Float32Array(1024);
    setInterval(() => { if (!tap.L) return; tap.L.getFloatTimeDomainData(bufL); tap.R.getFloatTimeDomainData(bufR); let sl = 0, sr = 0; for (let i = 0; i < 1024; i++) { sl += bufL[i] * bufL[i]; sr += bufR[i] * bufR[i]; } const l = Math.sqrt(sl / 1024), r = Math.sqrt(sr / 1024); if (l > __t.peaks.L) __t.peaks.L = l; if (r > __t.peaks.R) __t.peaks.R = r; }, 15);   // RMS per jendela 1024 sampel, maksimum selama pemutaran (puncak sampel jenuh oleh kompresor master)
    return { ready: audio.isReady(), state: audio.ctx ? audio.ctx.state : 'tak-ada', ms: Math.round(performance.now() - t0) };
  });
  section('Browser nyata: AudioManager memuat & decode file asli');
  ok(info.ready && info.state === 'running', `audio siap (${info.ms} ms), context ${info.state}`);

  const run = (fn, arg) => page.evaluate(fn, arg);
  const measure = (name, x, z, y = 1.6) => run(async ([name, x, z, y]) => {
    const T = __t; T.peaks.L = T.peaks.R = 0; const n0 = T.rec.starts.length, p0 = T.rec.panners.length;
    T.audio.setListener(0, 1.6, 0, 0, 1); T.audio.setListener(0, 1.6, 0, 0, 1);   // pendengar di (0,1.6,0) menghadap -z (kanan = +x)
    const h = T.audio.start(name, { pos: { x, y, z }, vol: 1 });
    await new Promise((r) => setTimeout(r, 1700));
    const pn = T.rec.panners[p0] || null;
    const o = { played: !!h, starts: T.rec.starts.length - n0, L: T.peaks.L, R: T.peaks.R, panner: pn ? { px: pn.positionX.value, pz: pn.positionZ.value, dm: pn.distanceModel, pm: pn.panningModel, ref: pn.refDistance, max: pn.maxDistance, rf: pn.rolloffFactor } : null };
    if (h) h.stop(); await new Promise((r) => setTimeout(r, 650)); return o;
  }, [name, x, z, y]);

  section('Falloff jarak nyata (capture_scream, sumber di kanan pendengar)');
  const d = {}; for (const m of [2, 12, 24, 33, 40]) d[m] = await measure('capture_scream', m, 0); const pk = (o) => Math.max(o.L, o.R);
  console.log('   RMS keluaran (maks L/R) per jarak: ' + [2, 12, 24, 33].map((m) => `${m}m=${pk(d[m]).toFixed(3)}`).join('  ') + '  40m=' + (d[40].played ? pk(d[40]).toFixed(3) : 'tidak diputar'));
  ok(d[2].played && d[2].starts === 1 && pk(d[2]) > 0.02, `2 m: terdengar jelas (RMS ${pk(d[2]).toFixed(3)}), 1 sumber suara`);
  ok(pk(d[2]) > pk(d[12]) && pk(d[12]) > pk(d[24]) && pk(d[24]) > pk(d[33]), 'amplitudo turun monoton: 2 m > 12 m > 24 m > 33 m (falloff jarak bekerja)');
  ok(pk(d[33]) < 0.25 * pk(d[2]) && pk(d[24]) < 0.7 * pk(d[2]), `jauh jauh lebih pelan (33 m = ${(100 * pk(d[33]) / pk(d[2])).toFixed(0)}% dari 2 m)`);
  ok(!d[40].played && d[40].starts === 0 && d[40].L === 0 && d[40].R === 0, '40 m (di luar jangkauan 36 m): TIDAK diputar, keluaran nol');
  ok(d[2].panner && d[2].panner.dm === 'linear' && d[2].panner.pm === 'equalpower' && d[2].panner.ref === 4 && d[2].panner.max === 36 && Math.abs(d[2].panner.px - 2) < 1e-6 && Math.abs(d[2].panner.pz) < 1e-6, `PannerNode 3D nyata: posisi (2,0), linear, equalpower, ref 4, max 36 (${JSON.stringify(d[2].panner)})`);

  section('Panning kiri/kanan nyata');
  const right = await measure('capture_scream', 6, 0), left = await measure('capture_scream', -6, 0), front = await measure('capture_scream', 0, -6);
  console.log(`   kanan L/R=${right.L.toFixed(3)}/${right.R.toFixed(3)}  kiri L/R=${left.L.toFixed(3)}/${left.R.toFixed(3)}  depan L/R=${front.L.toFixed(3)}/${front.R.toFixed(3)}`);
  ok(right.R > 1.5 * right.L, 'sumber di kanan: kanal kanan jauh lebih keras');
  ok(left.L > 1.5 * left.R, 'sumber di kiri: kanal kiri jauh lebih keras');
  ok(Math.abs(front.L - front.R) < 0.25 * Math.max(front.L, front.R), 'sumber di depan: seimbang');

  section('Impact: falloff & jangkauan 28 m');
  const i2 = await measure('capture_impact', 2, 0), i20 = await measure('capture_impact', 20, 0), i30 = await measure('capture_impact', 30, 0);
  ok(i2.played && i20.played && pk(i2) > pk(i20) && pk(i20) > 0, `benturan 2 m (${pk(i2).toFixed(3)}) > 20 m (${pk(i20).toFixed(3)}) > 0`);
  ok(!i30.played && i30.starts === 0, '30 m (di luar jangkauan benturan 28 m): tidak diputar');

  section('Jalur lengkap PlayScene: kejadian -> CaptureAudio -> AudioManager (sekali per kejadian)');
  const flow = (listener, ev, repeats) => run(async ([listener, ev, repeats]) => {
    const T = __t, cap = new T.CA.CaptureAudio(), n0 = T.rec.starts.length; T.audio.setListener(listener.x, 1.6, listener.z, 0, 1); T.audio.setListener(listener.x, 1.6, listener.z, 0, 1);
    const res = []; for (let i = 0; i < repeats; i++) res.push(cap.accept(ev, 'me', listener));   // pesan kirim-ulang / duplikat
    const played = []; let last = performance.now();
    for (let i = 0; i < 200; i++) { await new Promise((r) => setTimeout(r, 10)); const now = performance.now(), dt = (now - last) / 1000; last = now; for (const c of cap.update(dt)) { const h = T.audio.start(c.name, { pos: c.pos, vol: c.vol }); played.push({ name: c.name, handle: !!h }); } }
    await new Promise((r) => setTimeout(r, 400)); return { res, played, starts: T.rec.starts.length - n0 };
  }, [listener, ev, repeats]);
  const near1 = await flow({ x: 0, z: 0, level: 1 }, { key: '1:1:V', id: 'V', x: 8, z: 0, level: 1, drag: true }, 6);
  ok(near1.res.filter((r) => r === 'scheduled').length === 1 && near1.res.filter((r) => r === 'dup').length === 5, `6x accept kejadian sama -> 1 dijadwalkan, 5 duplikat (${near1.res.join(',')})`);
  ok(near1.played.map((p) => p.name).join() === 'capture_scream,capture_impact' && near1.played.every((p) => p.handle) && near1.starts === 2, `pemain dekat (8 m): TEPAT 2 sumber suara nyata (1 teriakan + 1 benturan), starts=${near1.starts}`);
  const far1 = await flow({ x: 0, z: 0, level: 1 }, { key: '1:2:V', id: 'V', x: 50, z: 0, level: 1, drag: true }, 3);
  ok(far1.played.length === 0 && far1.starts === 0, 'pemain jauh (50 m): tidak ada suara sama sekali');
  const victim = await flow({ x: 0, z: 0, level: 1 }, { key: '1:3:me', id: 'me', x: 1, z: 0, level: 1, drag: true }, 4);
  ok(victim.played.map((p) => p.name).join() === 'capture_scream,capture_impact' && victim.starts === 2, 'korban: 2 sumber suara (satu jalur, tanpa dobel)');
  const stat = await run(async () => { for (let i = 0; i < 120 && __t.audio.voices.size > 0; i++) await new Promise((r) => setTimeout(r, 50)); return { voices: __t.audio.voices.size, state: __t.audio.ctx.state }; });   // tunggu klip selesai (benturan 2 dtk)
  ok(stat.voices === 0 && stat.state === 'running', `semua suara selesai & dibersihkan (voice aktif tersisa ${stat.voices})`);
  ok(!logs.some((l) => /PAGEERROR|gagal dimuat|tidak ditemukan/i.test(l)), 'tanpa error halaman / file SFX hilang' + (logs.length ? ' [' + logs.slice(0, 3).join(' | ') + ']' : ''));

  await browser.close(); srv.close();
  console.log(`\nAUDIO CAPTURE (browser): ${passes} lulus, ${fails} gagal`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); try { srv.close(); } catch { /* */ } process.exit(2); });
