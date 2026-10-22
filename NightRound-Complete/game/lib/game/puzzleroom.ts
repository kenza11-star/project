// Ruangan puzzle tersembunyi ("bunker") -- logika murni, tanpa three.js (dites di scripts/test-puzzleroom.js).
//
// Isi: (1) tata letak ruangan + koordinat dunia, (2) model puzzle yang SELURUHNYA diturunkan dari seed room (kode 4 digit, urutan saklar, petunjuk,
// sirkuit, simbol, urutan memori) sehingga sama di semua pemain, (3) mesin state (host = otoritas), (4) penempatan palka pintu masuk di bangunan.
//
// Empat teka-teki, masing-masing membuka SATU digit kode:
//   I   PANEL DAYA   5 tuas berwarna. Urutan tarik benar = permutasi dari seed. Petunjuk = teka-teki logika (jawaban pasti tunggal). Salah urutan = semua tuas naik lagi.
//   II  SIRKUIT      5 tuas membalik sekumpulan lampu (susunan kabel dari seed, tidak diberitahu: dicari lewat percobaan). Semua lampu harus menyala.
//   III GLIF         3 tromol simbol. Jawaban tertulis pada papan tersebar di dinding (ada papan palsu yang dicoret).
//   IV  METRONOM     lampu berkedip dalam urutan dari seed; ulangi dengan 4 tuas berwarna. Salah = ulang dari awal.
// Pintu besi bunker berpanel kode: 4 digit (I, II, III, IV). Benar = misi 'code' selesai.
import { makeRng, type Rng } from './rng';
import type { NavGrid } from './layout';
import type { Room } from './mapdata';

// ------------------------------------------------------------------ tata letak (dunia, meter)
/** Bunker berada DI LUAR bangunan (timur, x > 38,4) dan hanya bisa dimasuki lewat palka: tidak terhubung ke grid jalan bangunan. */
export const BK = Object.freeze({
  cx: 52, cz: 19.2,       // pusat lantai ruang utama
  hw: 6, hd: 5,           // setengah lebar (x) / kedalaman (z) bagian dalam
  h: 3.2, t: 0.3,         // tinggi ruangan, tebal dinding
  doorW: 2.2, doorH: 2.7, // pintu besi (di dinding utara)
  chW: 2.6, chD: 3.4,     // bilik di balik pintu: setengah lebar & kedalaman bagian dalam
});
export interface Box2 { minx: number; maxx: number; minz: number; maxz: number }
/** Seluruh bunker (ruang utama + bilik + dinding): dipakai untuk memperluas area jalan collision & menyembunyikan model saat pemain di luar. */
export const BUNKER_AREA: Box2 = Object.freeze({ minx: BK.cx - BK.hw - BK.t, maxx: BK.cx + BK.hw + BK.t, minz: BK.cz - BK.hd - BK.t - BK.chD - BK.t, maxz: BK.cz + BK.hd + BK.t });
/** Batas timur area jalan lantai 1 sesudah diperluas (cukup untuk bunker + 1 m). */
export const WALK_MAXX = BUNKER_AREA.maxx + 1;
export const inBunker = (x: number, z: number, pad = 0) => x >= BUNKER_AREA.minx - pad && x <= BUNKER_AREA.maxx + pad && z >= BUNKER_AREA.minz - pad && z <= BUNKER_AREA.maxz + pad;

/** Dinding padat bunker (tanpa pintu besi: daun pintu = collider terpisah yang dimatikan saat terbuka). */
export function bunkerWalls(): Box2[] {
  const { cx, cz, hw, hd, t, doorW, chW, chD } = BK, W: Box2[] = [];
  const ox = cx - hw - t, ex = cx + hw + t, nz0 = cz - hd - t, sz1 = cz + hd + t;
  W.push({ minx: ox, maxx: cx - hw, minz: nz0, maxz: sz1 });                       // barat
  W.push({ minx: cx + hw, maxx: ex, minz: nz0, maxz: sz1 });                       // timur
  W.push({ minx: ox, maxx: ex, minz: cz + hd, maxz: sz1 });                        // selatan
  W.push({ minx: ox, maxx: cx - doorW / 2, minz: nz0, maxz: cz - hd });            // utara kiri
  W.push({ minx: cx + doorW / 2, maxx: ex, minz: nz0, maxz: cz - hd });            // utara kanan
  const cz0 = nz0 - chD - t;                                                        // bilik di balik pintu
  W.push({ minx: cx - chW - t, maxx: cx - chW, minz: cz0, maxz: nz0 });
  W.push({ minx: cx + chW, maxx: cx + chW + t, minz: cz0, maxz: nz0 });
  W.push({ minx: cx - chW - t, maxx: cx + chW + t, minz: cz0, maxz: cz0 + t });
  return W;
}

/** Penempelan di dinding: titik di permukaan dinding + normal (menghadap ke dalam ruangan). */
export interface Mount { x: number; z: number; nx: number; nz: number }
const W_ = (lz: number): Mount => ({ x: BK.cx - BK.hw, z: BK.cz + lz, nx: 1, nz: 0 });     // dinding barat
const E_ = (lz: number): Mount => ({ x: BK.cx + BK.hw, z: BK.cz + lz, nx: -1, nz: 0 });    // dinding timur
const N_ = (lx: number): Mount => ({ x: BK.cx + lx, z: BK.cz - BK.hd, nx: 0, nz: 1 });     // dinding utara
const S_ = (lx: number): Mount => ({ x: BK.cx + lx, z: BK.cz + BK.hd, nx: 0, nz: -1 });    // dinding selatan

export const LEVER_Y = 1.45;                  // tinggi pusat panel tuas
export const LAYOUT = Object.freeze({
  arrive: { x: BK.cx - 4.2, z: BK.cz + 3.0, yaw: -Math.PI / 4 },    // tempat muncul setelah turun palka (menghadap timur laut)
  ladder: W_(3.7),                                                   // tangga naik ke palka
  s1: [0, 1, 2, 3, 4].map((i) => W_(-3.5 + 0.85 * i)),                // I: 5 tuas panel daya (dinding barat)
  s1Plaque: S_(3.2),                                                 // I: papan LOG TEKNISI (jauh dari panelnya, di dinding selatan)
  s2: [0, 1, 2, 3, 4].map((i) => E_(-1.7 + 0.85 * i)),                // II: 5 tuas sirkuit (dinding timur)
  s2Board: E_(0),                                                    // II: papan lampu di atas tuas
  s3: S_(-1.8),                                                      // III: kotak tromol di dinding selatan
  glyphSlots: [N_(-3.8), E_(-3.7), W_(1.5), S_(5.1), S_(-4.3)],      // III: 5 tempat papan simbol (3 asli + 2 palsu)
  s4: [0, 1, 2, 3].map((i) => N_(2.9 + 0.62 * i)),                    // IV: 4 tuas berwarna (dinding utara)
  s4Play: N_(5.35),                                                  // IV: tombol PLAY
  keypad: { x: BK.cx + 0.55, z: BK.cz - BK.hd + 0.02, nx: 0, nz: 1 } as Mount, // panel kode di daun pintu besi
  door: { x: BK.cx, z: BK.cz - BK.hd - BK.t / 2 },                   // pusat daun pintu besi
  terminal: { x: BK.cx, z: BK.cz - BK.hd - BK.t - BK.chD + 0.15 },   // terminal di bilik
  lights: [
    { x: BK.cx - 3.0, y: 2.75, z: BK.cz - 1.8, c: 0xffa85a, i: 9, r: 7.5, flicker: false },
    { x: BK.cx + 2.8, y: 2.75, z: BK.cz + 1.8, c: 0xffb878, i: 8, r: 7.5, flicker: true },
    { x: BK.cx + 0.0, y: 2.7, z: BK.cz - 3.6, c: 0xff3a22, i: 7, r: 6.0, flicker: false },
    { x: BK.cx - 4.6, y: 2.6, z: BK.cz + 2.4, c: 0xff9a50, i: 6, r: 5.5, flicker: true },
    { x: BK.cx + 0.0, y: 2.3, z: BK.cz - BK.hd - BK.t - 1.9, c: 0x59ff9a, i: 7, r: 5.0, flicker: false },   // bilik: hijau dingin
  ],
});
/** Penghalang tetap bunker (props) sebagai kotak (pusat dunia, setengah ukuran). Dipakai collision & tes. */
export interface PropBox { id: string; cx: number; cz: number; hx: number; hz: number }
export const PROPS: readonly PropBox[] = Object.freeze([
  { id: 'gen', cx: BK.cx - 1.2, cz: BK.cz - 0.6, hx: 1.2, hz: 0.65 },
  { id: 'desk', cx: BK.cx + 0.7, cz: BK.cz + 4.25, hx: 0.85, hz: 0.42 },
  { id: 'crate1', cx: BK.cx + 3.9, cz: BK.cz + 2.4, hx: 0.5, hz: 0.5 },
  { id: 'barrel1', cx: BK.cx - 5.45, cz: BK.cz - 4.45, hx: 0.3, hz: 0.3 },
  { id: 'barrel2', cx: BK.cx - 4.75, cz: BK.cz - 4.55, hx: 0.3, hz: 0.3 },
]);

// ------------------------------------------------------------------ data umum
export interface ColorDef { id: string; css: string; hex: number }
export const COLORS: readonly ColorDef[] = Object.freeze([
  { id: 'MERAH', css: '#e8402f', hex: 0xe8402f }, { id: 'HIJAU', css: '#34d460', hex: 0x34d460 }, { id: 'BIRU', css: '#4a86ff', hex: 0x4a86ff },
  { id: 'KUNING', css: '#f4d233', hex: 0xf4d233 }, { id: 'PUTIH', css: '#f2f0e4', hex: 0xf2f0e4 },
]);
export const GLYPHS: readonly string[] = Object.freeze(['SEGITIGA', 'LINGKARAN', 'KOTAK', 'BELAH KETUPAT', 'BINTANG', 'SILANG']);
export const ORDER_N = 5, CIRC_LEVERS = 5, CIRC_LAMPS = 5, CIRC_FULL = 31, DRUMS = 3, SIMON_COLORS = 4, SIMON_LEN = 5, CODE_LEN = 4;
export const GLYPH_SLOTS = 5;
export type Station = 1 | 2 | 3 | 4;

// ------------------------------------------------------------------ petunjuk logika (teka-teki I)
export type OrderClue =
  | { t: 'first'; a: number } | { t: 'last'; a: number } | { t: 'mid'; a: number }
  | { t: 'before'; a: number; b: number } | { t: 'after1'; a: number; b: number } | { t: 'apart'; a: number; b: number };
/** pos[warna] = urutan tarik (0..4). */
export function clueHolds(c: OrderClue, pos: number[]): boolean {
  switch (c.t) {
    case 'first': return pos[c.a] === 0;
    case 'last': return pos[c.a] === ORDER_N - 1;
    case 'mid': return pos[c.a] === (ORDER_N - 1) / 2;
    case 'before': return pos[c.a] < pos[c.b];
    case 'after1': return pos[c.b] === pos[c.a] + 1;
    case 'apart': return Math.abs(pos[c.a] - pos[c.b]) > 1;
  }
}
export function clueText(c: OrderClue): string {
  const n = (i: number) => COLORS[i].id;
  switch (c.t) {
    case 'first': return `${n(c.a)} ditarik PERTAMA.`;
    case 'last': return `${n(c.a)} ditarik TERAKHIR.`;
    case 'mid': return `${n(c.a)} ditarik di urutan TENGAH.`;
    case 'before': return `${n(c.a)} ditarik SEBELUM ${n(c.b)}.`;
    case 'after1': return `${n(c.b)} ditarik TEPAT SETELAH ${n(c.a)}.`;
    case 'apart': return `${n(c.a)} dan ${n(c.b)} TIDAK pernah ditarik berurutan.`;
  }
}
let PERMS: number[][] | null = null;
/** Semua 120 urutan (dihitung sekali). */
export function allOrders(): number[][] {
  if (PERMS) return PERMS;
  const out: number[][] = [], a = [0, 1, 2, 3, 4];
  const rec = (k: number) => { if (k === a.length) { out.push(a.slice()); return; } for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  rec(0);
  return (PERMS = out);
}
const posOf = (order: number[]) => { const p = new Array(order.length).fill(0); order.forEach((c, k) => { p[c] = k; }); return p; };
/** Berapa urutan yang cocok dengan semua petunjuk (1 = jawaban tunggal). */
export function countOrders(clues: OrderClue[]): number {
  let n = 0; for (const o of allOrders()) { const p = posOf(o); if (clues.every((c) => clueHolds(c, p))) n++; } return n;
}
/** Susun petunjuk benar-semua yang hanya menyisakan SATU urutan (jawaban pasti tunggal & adil), lalu buang yang mubazir. */
export function makeOrderClues(order: number[], rng: Rng): OrderClue[] {
  const pos = posOf(order), pool: OrderClue[] = [];
  for (let a = 0; a < ORDER_N; a++) {
    pool.push({ t: 'first', a }, { t: 'last', a }, { t: 'mid', a });
    for (let b = 0; b < ORDER_N; b++) if (a !== b) pool.push({ t: 'before', a, b }, { t: 'after1', a, b }, ...(a < b ? [{ t: 'apart', a, b } as OrderClue] : []));
  }
  const truth = rng.shuffle(pool.filter((c) => clueHolds(c, pos)));
  // bobot: pernyataan relasi lebih dulu (lebih 'berpikir'), pernyataan posisi mutlak belakangan
  const rank = (c: OrderClue) => (c.t === 'first' || c.t === 'last' || c.t === 'mid' ? 1 : 0);
  truth.sort((x, y) => rank(x) - rank(y) || 0);
  const chosen: OrderClue[] = [];
  for (const c of truth) { if (countOrders(chosen) === 1) break; chosen.push(c); }
  for (let i = chosen.length - 1; i >= 0; i--) { const rest = chosen.filter((_, j) => j !== i); if (countOrders(rest) === 1) chosen.splice(i, 1); }
  for (const c of truth) { if (chosen.length >= 4) break; if (!chosen.includes(c)) chosen.push(c); }   // minimal 4 baris agar papan terbaca seperti log nyata
  return rng.shuffle(chosen);
}

// ------------------------------------------------------------------ model puzzle (dari seed)
export interface PuzzleModel {
  seed: number;
  code: number[];                 // 4 digit; digit k dibuka teka-teki ke-(k+1)
  layout1: number[];              // layout1[posisi fisik tuas] = indeks warna
  order: number[];                // order[k] = warna yang harus ditarik ke-k
  clues: OrderClue[];
  masks: number[];                // II: masks[tuas] = lampu (bitmask 5 bit) yang dibalik tuas itu
  start: number;                  // II: lampu menyala saat semua tuas naik
  solution2: number;              // II: himpunan tuas yang menyalakan semua lampu (tunggal)
  glyph: number[];                // III: simbol benar per tromol
  drum0: number[];                // III: posisi awal tromol (tidak ada yang sudah benar)
  slotTrue: number[];             // III: slotTrue[k] = tempat papan petunjuk tromol ke-k (0..4)
  decoy: { slot: number; glyph: number }[]; // III: papan palsu (dicoret)
  layout4: number[];              // IV: layout4[posisi fisik tuas] = indeks warna
  simon: number[];                // IV: urutan warna (indeks 0..3)
}
const rankGF2 = (rows: number[], n: number): number => {
  const m = rows.slice(); let r = 0;
  for (let bit = 0; bit < n; bit++) { const p = m.findIndex((v, i) => i >= r && ((v >> bit) & 1)); if (p < 0) continue; [m[r], m[p]] = [m[p], m[r]]; for (let i = 0; i < m.length; i++) if (i !== r && ((m[i] >> bit) & 1)) m[i] ^= m[r]; r++; }
  return r;
};
export const popcount = (v: number) => { let n = 0; for (; v; v &= v - 1) n++; return n; };
const xorMasks = (masks: number[], set: number) => { let l = 0; for (let i = 0; i < masks.length; i++) if ((set >> i) & 1) l ^= masks[i]; return l; };
/** Lampu menyala (bitmask) untuk himpunan tuas turun `set`. */
export const lampsFor = (m: Pick<PuzzleModel, 'masks' | 'start'>, set: number) => (m.start ^ xorMasks(m.masks, set)) & CIRC_FULL;

export function makePuzzleModel(seed: number): PuzzleModel {
  const s = seed >>> 0, R = (k: number) => makeRng((s ^ k) >>> 0);
  // kode: 4 digit, bukan semua sama
  const rc = R(0x5eed0c0d); let code: number[];
  do { code = [0, 1, 2, 3].map(() => rc.int(0, 9)); } while (code.every((d) => d === code[0]));
  // I
  const r1 = R(0x0d3a1001), order = r1.shuffle([0, 1, 2, 3, 4]), layout1 = r1.shuffle([0, 1, 2, 3, 4]), clues = makeOrderClues(order, r1);
  // II: matriks 5x5 biner yang bisa dibalik (rank 5) -> tiap keadaan lampu punya tepat satu kombinasi tuas
  const r2 = R(0x0c1c2002); let masks: number[] = [];
  for (let g = 0; g < 500; g++) {
    masks = Array.from({ length: CIRC_LEVERS }, () => r2.int(1, CIRC_FULL - 1));
    if (new Set(masks).size === masks.length && rankGF2(masks, CIRC_LAMPS) === CIRC_LAMPS && masks.every((v) => popcount(v) >= 2 && popcount(v) <= 3)) break;
  }
  let solution2 = 0; do { solution2 = r2.int(1, 31); } while (popcount(solution2) < 2 || popcount(solution2) > 4);
  const start = CIRC_FULL ^ xorMasks(masks, solution2);
  // III
  const r3 = R(0x0613f003), glyph = r3.shuffle([0, 1, 2, 3, 4, 5]).slice(0, DRUMS);
  const drum0 = glyph.map((g) => { let v; do { v = r3.int(0, GLYPHS.length - 1); } while (v === g); return v; });
  const slots = r3.shuffle([0, 1, 2, 3, 4]), slotTrue = slots.slice(0, DRUMS);
  const decoy = slots.slice(DRUMS).map((slot) => ({ slot, glyph: r3.int(0, GLYPHS.length - 1) }));
  // IV
  const r4 = R(0x0511a004), layout4 = r4.shuffle([0, 1, 2, 3]); let simon: number[];
  do { simon = Array.from({ length: SIMON_LEN }, () => r4.int(0, SIMON_COLORS - 1)); } while (new Set(simon).size < 3 || simon.some((v, i) => i >= 2 && v === simon[i - 1] && v === simon[i - 2]));
  return { seed: s, code, layout1, order, clues, masks, start, solution2, glyph, drum0, slotTrue, decoy, layout4, simon };
}
export const codeString = (m: Pick<PuzzleModel, 'code'>) => m.code.join('');
/** Cek kode yang diketik di panel pintu. */
export const checkCode = (m: Pick<PuzzleModel, 'code'>, entered: string) => /^\d{4}$/.test(entered) && entered === m.code.join('');

// ------------------------------------------------------------------ mesin state (host = otoritas; klien menerapkan snapshot)
export type PzResult = 'ignored' | 'ok' | 'done' | 'reset';
/** Snapshot jaringan (semua bilangan bulat kecil). a=tuas benar I, b=tuas turun II (bitmask), c=tromol (basis 6), d=langkah benar IV, f=bit selesai per teka-teki. */
export interface PzSnap { v: number; a: number; b: number; c: number; d: number; f: number }
export const packDrums = (d: number[]) => d[0] + 6 * d[1] + 36 * d[2];
export const unpackDrums = (c: number) => [c % 6, Math.floor(c / 6) % 6, Math.floor(c / 36) % 6];
export const isPzSnap = (x: unknown): x is PzSnap => {
  if (!x || typeof x !== 'object') return false; const o = x as Record<string, unknown>;
  const int = (k: string, lo: number, hi: number) => typeof o[k] === 'number' && Number.isInteger(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  return int('v', 0, 1_000_000) && int('a', 0, ORDER_N) && int('b', 0, CIRC_FULL) && int('c', 0, 215) && int('d', 0, SIMON_LEN) && int('f', 0, 15);
};

export class RoomPuzzle {
  v = 0; a = 0; b = 0; d = 0; f = 0; drums: number[];
  constructor(readonly m: PuzzleModel) { this.drums = m.drum0.slice(); }
  doneAt(st: Station) { return (this.f >> (st - 1) & 1) === 1; }
  get allDone() { return this.f === 15; }
  /** Digit ke-k (0..3) bila teka-tekinya selesai, selain itu null. */
  digit(k: number): number | null { return this.doneAt((k + 1) as Station) ? this.m.code[k] : null; }
  digits(): (number | null)[] { return [0, 1, 2, 3].map((k) => this.digit(k)); }
  // I
  down1(i: number): boolean { const c = this.m.layout1[i]; return this.m.order.indexOf(c) < this.a; }
  press1(i: number): PzResult {
    if (!Number.isInteger(i) || i < 0 || i >= ORDER_N || this.doneAt(1) || this.down1(i)) return 'ignored';
    this.v++;
    if (this.m.order[this.a] === this.m.layout1[i]) { this.a++; if (this.a >= ORDER_N) { this.f |= 1; return 'done'; } return 'ok'; }
    this.a = 0; return 'reset';
  }
  // II
  down2(i: number): boolean { return ((this.b >> i) & 1) === 1; }
  lamps(): number { return lampsFor(this.m, this.b); }
  flip2(i: number): PzResult {
    if (!Number.isInteger(i) || i < 0 || i >= CIRC_LEVERS || this.doneAt(2)) return 'ignored';
    this.v++; this.b ^= 1 << i;
    if (this.lamps() === CIRC_FULL) { this.f |= 2; return 'done'; }
    return 'ok';
  }
  // III
  turn3(k: number): PzResult {
    if (!Number.isInteger(k) || k < 0 || k >= DRUMS || this.doneAt(3)) return 'ignored';
    this.v++; this.drums[k] = (this.drums[k] + 1) % GLYPHS.length;
    if (this.drums.every((g, j) => g === this.m.glyph[j])) { this.f |= 4; return 'done'; }
    return 'ok';
  }
  // IV
  pick4(i: number): PzResult {
    if (!Number.isInteger(i) || i < 0 || i >= SIMON_COLORS || this.doneAt(4)) return 'ignored';
    this.v++;
    if (this.m.simon[this.d] === this.m.layout4[i]) { this.d++; if (this.d >= SIMON_LEN) { this.f |= 8; return 'done'; } return 'ok'; }
    this.d = 0; return 'reset';
  }
  /** Tekan generik (dipakai host untuk permintaan jaringan). */
  press(st: Station, i: number): PzResult { return st === 1 ? this.press1(i) : st === 2 ? this.flip2(i) : st === 3 ? this.turn3(i) : this.pick4(i); }
  snapshot(): PzSnap { return { v: this.v, a: this.a, b: this.b, c: packDrums(this.drums), d: this.d, f: this.f }; }
  /** Terapkan state otoritatif host. true bila berubah (versi lebih baru & sah). */
  apply(s: PzSnap): boolean {
    if (!isPzSnap(s) || !(s.v > this.v)) return false;
    this.v = s.v; this.a = s.a; this.b = s.b; this.drums = unpackDrums(s.c); this.d = s.d; this.f = s.f; return true;
  }
  /** Tandai semua selesai (misi 'code' diselesaikan di luar puzzle, mis. tombol debug / pemain lain). */
  completeAll() {
    if (this.f === 15 && this.a === ORDER_N) return;
    this.v++; this.f = 15; this.a = ORDER_N; this.d = SIMON_LEN; this.drums = this.m.glyph.slice();
    this.b = this.m.solution2;
  }
}

// ------------------------------------------------------------------ palka pintu masuk (di bangunan)
export interface HatchSpot { room: string; x: number; z: number; yaw: number; ax: number; az: number }
export interface PlanHatchOpts { rooms: Room[]; spawn: { x: number; z: number }; keepouts: { x: number; z: number; r: number }[]; avoid?: { x: number; z: number; r: number }[] }
/** Ruangan yang disukai (sepi / tersembunyi) beserta bobotnya; sisanya hanya cadangan. */
export const HATCH_ROOM_WEIGHTS: [string, number][] = [['hidden1', 5], ['svce', 3], ['svcw', 3], ['tech', 2], ['archive', 1], ['locker', 1]];
const FALLBACK_TYPES = ['admin', 'break', 'docs', 'kitchen', 'meeting', 'archive', 'locker', 'tech', 'svce', 'svcw', 'hidden1'];
const DIR4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Titik lantai bebas (terjangkau, ada ruang berdiri) di ruangan sepi. Panggil SETELAH furniture ditempatkan. Palka tidak punya collision, jadi jalan tidak berubah. */
export function planHatch(nav: NavGrid, rng: Rng, o: PlanHatchOpts): HatchSpot | null {
  const lv0 = o.rooms.filter((r) => r.level === 0);
  const pref = lv0.filter((r) => HATCH_ROOM_WEIGHTS.some(([t]) => t === r.type));
  const order: Room[] = [];
  const left = pref.slice();
  while (left.length) { // urutan acak berbobot tanpa pengembalian
    const w = left.map((r) => HATCH_ROOM_WEIGHTS.find(([t]) => t === r.type)![1]);
    const pick = rng.weighted(left.map((r, i) => [i, w[i]] as [number, number]));
    order.push(left.splice(pick, 1)[0]);
  }
  for (const r of rng.shuffle(lv0.filter((r) => !pref.includes(r) && FALLBACK_TYPES.includes(r.type)))) order.push(r);
  const occFree = (i: number, j: number, rad: number) => { for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nav.W || jj >= nav.H || nav.occ[jj * nav.W + ii]) return false; } return true; };
  for (const rm of order) {
    const R = rm.rect;
    for (let a = 0; a < 500; a++) {
      const x = rng.range(R.minx + 0.9, R.maxx - 0.9), z = rng.range(R.minz + 0.9, R.maxz - 0.9);
      const [ci, cj] = nav.cellOf(x, z);
      if (ci < 0 || cj < 0 || ci >= nav.W || cj >= nav.H || !nav.isReachedCell(ci, cj) || !occFree(ci, cj, 6)) continue;
      if (Math.hypot(x - o.spawn.x, z - o.spawn.z) < 8) continue;
      if (o.keepouts.some((k) => Math.hypot(k.x - x, k.z - z) < k.r) || (o.avoid ?? []).some((k) => Math.hypot(k.x - x, k.z - z) < k.r)) continue;
      // lebih suka dekat dinding / sudut (lebih tersembunyi): dinding terdekat <= 1,7 m
      let wall = 9; for (const [dx, dz] of DIR4) { let d = 0.6; while (d < 1.8) { const [wi, wj] = nav.cellOf(x + dx * d, z + dz * d); if (nav.wallOnly[wj * nav.W + wi]) break; d += 0.1; } wall = Math.min(wall, d); }
      if (wall > 1.7) continue;
      // titik berdiri di depan palka: arah terbuka terjauh dari dinding
      let best: { ax: number; az: number } | null = null, bd = -1;
      for (const [dx, dz] of DIR4) {
        const ax = x + dx * 1.0, az = z + dz * 1.0, [ai, aj] = nav.cellOf(ax, az);
        if (ai < 0 || aj < 0 || ai >= nav.W || aj >= nav.H || !nav.isReachedCell(ai, aj) || !occFree(ai, aj, 3)) continue;
        let d = 1.0; while (d < 3) { const [wi, wj] = nav.cellOf(x + dx * d, z + dz * d); if (nav.wallOnly[wj * nav.W + wi]) break; d += 0.1; }
        if (d > bd) { bd = d; best = { ax, az }; }
      }
      if (!best) continue;
      return { room: rm.id, x, z, yaw: rng.int(0, 3) * (Math.PI / 2) + rng.range(-0.12, 0.12), ax: best.ax, az: best.az };
    }
  }
  return null;
}
