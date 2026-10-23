// Uji kertas notes: isi benar terhadap puzzle, samar (tidak ada jawaban langsung), deterministik per seed, penempatan terbagi.
const path = require('path');
const G = path.join(__dirname, '..', '.tmp-game');
const N = require(G + '/notes.js'), P = require(G + '/puzzleroom.js'), S = require(G + '/switchpuzzle.js'), { makeRng } = require(G + '/rng.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);
const mkCtx = (sd) => { const r = makeRng(sd ^ 0x1234567), types = r.shuffle(S.SWITCH_ROOM_TYPES.slice()).slice(0, 5); return { switchOrder: S.switchOrder(sd), switchRoomTypes: types, model: P.makePuzzleModel((sd ^ 0x7b4c1e55) >>> 0) }; };
const perms = (() => { const out = [], a = [0, 1, 2, 3, 4]; const rec = (k) => { if (k === 5) { out.push(a.slice()); return; } for (let i = k; i < 5; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } }; rec(0); return out; })();

section('Isi note selalu benar & tidak memberi jawaban langsung (300 seed)');
{
  let wrong = 0, count = 0, dupId = 0, long = 0, leak = 0, determ = 0, singleSolves = 0; const sigs = new Set(); const topics = {};
  for (let k = 1; k <= 300; k++) {
    const sd = k * 104729, ctx = mkCtx(sd), notes = N.makeHintNotes(sd, ctx), m = ctx.model, o = ctx.switchOrder;
    if (JSON.stringify(notes) !== JSON.stringify(N.makeHintNotes(sd, mkCtx(sd)))) determ++;
    if (notes.length !== 12) count++;
    if (new Set(notes.map((n) => n.id)).size !== notes.length) dupId++;
    sigs.add(notes.map((n) => n.text).join('|'));
    const pos = new Array(5).fill(0); m.order.forEach((c, i) => { pos[c] = i; });
    for (const n of notes) {
      topics[n.topic] = (topics[n.topic] || 0) + 1;
      const f = n.fact; let t = false;
      if (f.t === 'chain') t = o.indexOf(f.b) === o.indexOf(f.a) + 1;
      else if (f.t === 'notFirst') t = pos[f.c] !== 0;
      else if (f.t === 'before') t = pos[f.a] < pos[f.b];
      else if (f.t === 'leverCount') t = P.popcount(m.masks[f.i]) === f.n;
      else if (f.t === 'solCount') t = P.popcount(m.solution2) === f.n;
      else if (f.t === 'drum') t = m.glyph[f.d] === f.g;
      else if (f.t === 'simonCount') t = m.simon.filter((v) => v === f.c).length === f.n;
      else if (f.t === 'simonNot') t = m.simon[f.k] !== f.c;
      if (!t) wrong++;
      if (n.text.length > 150 || n.text.length < 12) long++;
      if (n.text.includes(P.codeString(m)) || /\d{4}/.test(n.text)) leak++;
      // satu note tidak boleh menyelesaikan puzzle-nya: urutan saklar / panel masih banyak kemungkinan
      if (f.t === 'chain' && perms.filter((p) => p.indexOf(f.b) === p.indexOf(f.a) + 1).length < 20) singleSolves++;
      if (f.t === 'notFirst' && perms.filter((p) => p[0] !== f.c).length < 50) singleSolves++;
      // petunjuk saklar tidak menyebut nama ruangan langsung & hanya menyebut dua penunjuk
      if (n.topic === 'switch') { const hits = Object.values(N.ROOM_HINT).filter((h) => n.text.toLowerCase().includes(h)).length; if (hits !== 2) leak++; if (/\b(kitchen|archive|locker|meeting|tech|admin|docs|break)\b/i.test(n.text)) leak++; }
    }
  }
  ok(wrong === 0, `semua fakta note benar terhadap puzzle (salah: ${wrong})`);
  ok(count === 0, '12 note per run (4 saklar + 2 panel + 2 sirkuit + 2 glif + 2 metronom)');
  ok(dupId === 0, 'id note unik per run');
  ok(determ === 0, 'deterministik dari seed (sama di semua pemain)');
  ok(long === 0, 'teks pendek (12-150 karakter)');
  ok(leak === 0, 'tidak memuat kode 4 digit / nama ruangan langsung; note saklar hanya dua penunjuk');
  ok(singleSolves === 0, 'satu note tidak pernah menyelesaikan puzzle (urutan masih banyak kemungkinan)');
  ok(sigs.size >= 280, `isi beragam antar room (${sigs.size} susunan berbeda dari 300 seed)`);
  ok(topics.switch === 1200 && topics.panel === 600 && topics.circuit === 600 && topics.glyph === 600 && topics.metro === 600, 'sebaran topik sesuai');
}
section('Tanpa ruangan kode: hanya note saklar');
{ const ctx = mkCtx(555); ctx.model = null; const n = N.makeHintNotes(555, ctx); ok(n.length === 4 && n.every((x) => x.topic === 'switch'), 'model null -> 4 note saklar saja'); }
section('Pembagian penempatan container / permukaan');
{
  let bad = 0;
  for (let t = 0; t < 400; t++) for (const [c, s] of [[20, 10], [20, 0], [0, 10], [3, 2], [0, 0], [30, 30], [1, 20], [20, 1]]) {
    const r = N.splitNotes(12, c, s, makeRng(t * 31 + c * 7 + s)); const placed = r.container + r.surface;
    if (r.container > c || r.surface > s || r.container < 0 || r.surface < 0 || placed !== Math.min(12, c + s)) bad++;
  }
  ok(bad === 0, 'tidak melebihi kandidat; semua note tertempatkan bila kandidat cukup');
  const r = N.splitNotes(12, 30, 30, makeRng(1)); ok(r.container >= 5 && r.container <= 6 && r.surface >= 6 && r.surface <= 7, `kira-kira separuh-separuh (${r.container}/${r.surface})`);
}
console.log(`\nHASIL: ${passes} lulus, ${fails} gagal`);
process.exit(fails ? 1 : 0);
