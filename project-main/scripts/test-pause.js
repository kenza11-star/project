// Uji logika pause menu (lib/game/pause.ts, lib/game/settings.ts): kebijakan solo-freeze vs multiplayer-overlay, state machine, gate frame, settings.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const P = require(G + '/pause.js');
const S = require(G + '/settings.js');
const PL = require(G + '/players.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  GAGAL:', msg); } };
const section = (t) => console.log('\n== ' + t);

section('kebijakan per mode');
ok(P.pauseModeFor(1) === 'freeze', 'Single Player -> freeze');
for (const n of [2, 3, 4]) ok(P.pauseModeFor(n) === 'overlay', `${n} pemain -> overlay (bukan pause global)`);
for (const m of [1, 2, 3, 4]) ok(P.pauseModeFor(PL.buildSlots(m, ['A']).length) === (m === 1 ? 'freeze' : 'overlay'), `roster mode ${m} memilih kebijakan yang benar`);

section('frameGate: single player');
{
  const g0 = P.frameGate('play', false, 'freeze');
  ok(g0.simulate && g0.input && !g0.muteAudio, 'solo, menu tertutup: semua jalan');
  const g1 = P.frameGate('play', true, 'freeze');
  ok(!g1.simulate && !g1.input && g1.muteAudio, 'solo, menu terbuka: simulasi, input, audio berhenti');
}
section('frameGate: multiplayer');
for (const n of [2, 3, 4]) {
  const mode = P.pauseModeFor(n);
  const g = P.frameGate('play', true, mode);
  ok(g.simulate, `${n} pemain, menu terbuka: dunia/musuh/timer TETAP berjalan`);
  ok(!g.input, `${n} pemain, menu terbuka: input lokal mati (tidak bisa gerak/interaksi)`);
  ok(!g.muteAudio, `${n} pemain, menu terbuka: audio dunia tetap hidup`);
  const c = P.frameGate('play', false, mode);
  ok(c.simulate && c.input && !c.muteAudio, `${n} pemain, menu tertutup: kontrol kembali penuh`);
}
section('frameGate: status lain');
for (const st of ['loading', 'error', 'escaped']) {
  const a = P.frameGate(st, true, 'freeze'), b = P.frameGate(st, false, 'overlay');
  ok(!a.input && !b.input, `${st}: tidak ada input gameplay`);
  ok(!a.simulate && !b.simulate, `${st}: bukan 'play' -> tidak ada simulasi gameplay baru`);
}

section('PauseState: state machine');
{
  const s = new P.PauseState('freeze');
  ok(!s.open && !s.frozen && !s.inputBlocked && s.panel === 'main', 'awal: tertutup');
  ok(s.show() === true && s.open && s.frozen && s.inputBlocked, 'show: terbuka & beku (solo)');
  ok(s.show() === false, 'show kedua: no-op (tidak menumpuk)');
  s.go('options'); ok(s.panel === 'options', 'go options');
  s.back(); ok(s.open && s.panel === 'main', 'Escape dari sub-panel -> menu utama, menu tetap terbuka');
  s.go('confirm'); s.back(); ok(s.open && s.panel === 'main', 'Escape dari konfirmasi -> batal keluar, kembali ke menu');
  s.back(); ok(!s.open && !s.frozen && !s.inputBlocked, 'Escape dari menu utama -> menutup (RESUME)');
  ok(s.hide() === false, 'hide saat tertutup: no-op');
  s.go('players'); ok(s.panel === 'main', 'go saat tertutup diabaikan');
  s.show(); s.go('howto'); s.hide(); s.show(); ok(s.panel === 'main', 'membuka ulang selalu mulai dari menu utama');
  s.hide(); ok(!s.open, 'tertutup sebelum uji toggle');
  for (let i = 0; i < 200; i++) s.toggle();
  ok(!s.open, 'toggle genap kali kembali tertutup (tidak ada state tersangkut)');
  s.toggle(); ok(s.open, 'toggle ganjil -> terbuka'); s.toggle(); ok(!s.open && !s.frozen, 'dan tertutup lagi: tidak beku');
}
{
  const m = new P.PauseState('overlay');
  m.show();
  ok(m.open && !m.frozen && m.inputBlocked, 'multiplayer: menu terbuka tidak beku, tetapi input terblokir');
  m.hide(); ok(!m.open && !m.inputBlocked, 'multiplayer: tutup mengembalikan kontrol');
}

section('playerRows');
{
  const rows = P.playerRows(PL.buildSlots(4, ['AKU', 'TEMAN']));
  ok(rows.length === 4, '4 baris');
  ok(rows[0].tag === 'YOU' && rows[0].name === 'AKU' && rows[0].connection === 'LOCAL', 'pemain lokal');
  ok(rows[1].tag === 'PARTY' && rows[1].connection === 'NOT CONNECTED', 'anggota party: status koneksi jujur (belum ada networking)');
  ok(rows[2].tag === 'EMPTY' && rows[3].tag === 'EMPTY', 'slot kosong');
  ok(P.playerRows(PL.buildSlots(1, ['AKU'])).length === 1, 'solo: satu baris');
}

section('settings');
{
  const d = S.normalizeSettings(null);
  ok(d.gfx === 'high' && d.sens === 1 && d.volume === 1 && d.invertY === false, 'default = perilaku game sebelumnya');
  ok(S.GFX.high.prMax === 1.25 && S.GFX.high.shadows === true, "'high' = pixel ratio & shadow asli proyek");
  ok(S.SENS_BASE === 0.006, 'sensitivitas dasar = 0.006 (nilai asli)');
  const x = S.normalizeSettings({ gfx: 'ultra', sens: 99, volume: -3, invertY: 'ya' });
  ok(x.gfx === 'high' && x.sens === S.SENS_MAX && x.volume === 0 && x.invertY === false, 'nilai rusak/di luar batas dinormalkan');
  const y = S.normalizeSettings({ gfx: 'low', sens: 0, volume: 0.5, invertY: true });
  ok(y.gfx === 'low' && y.sens === S.SENS_MIN && y.volume === 0.5 && y.invertY === true, 'nilai valid dipertahankan, batas bawah sens');
  ok(S.normalizeSettings({ sens: NaN, volume: Infinity }).sens === 1 && S.normalizeSettings({ volume: Infinity }).volume === 1, 'NaN/Infinity -> default');
  ok(['low', 'medium', 'high'].every((k) => S.GFX[k].prMax > 0 && S.GFX[k].prMax <= 1.25), 'semua level grafik valid');
  ok(S.GFX.low.prMax < S.GFX.medium.prMax && S.GFX.medium.prMax < S.GFX.high.prMax, 'level grafik berurutan');
  const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  S.saveSettings({ gfx: 'medium', sens: 1.5, volume: 0.3, invertY: true });
  const r = S.loadSettings(); ok(r.gfx === 'medium' && r.sens === 1.5 && r.volume === 0.3 && r.invertY === true, 'simpan -> muat bolak-balik');
  mem['bl:settings'] = '{rusak'; ok(S.loadSettings().gfx === 'high', 'JSON rusak -> default, tidak crash');
  delete global.localStorage; ok(S.loadSettings().gfx === 'high', 'tanpa localStorage -> default, tidak crash');
}

console.log(`\nPAUSE: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
