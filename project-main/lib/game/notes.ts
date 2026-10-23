// Kertas notes berisi PETUNJUK SAMAR (bukan jawaban) untuk puzzle saklar & tiap teka-teki ruangan kode. Logika murni (dites di scripts/test-notes.js).
// Semua isi diturunkan dari seed room + model puzzle -> sama di semua pemain. Tiap note hanya memuat SATU potongan fakta yang benar;
// pemain harus mengumpulkan beberapa note dan menggabungkannya. Tidak ada note yang memuat kode 4 digit atau urutan lengkap.
import { COLORS, GLYPHS, CIRC_LEVERS, DRUMS, SIMON_LEN, popcount, type PuzzleModel } from './puzzleroom';
import { makeRng, type Rng } from './rng';

export type NoteTopic = 'switch' | 'panel' | 'circuit' | 'glyph' | 'metro';
/** Fakta yang dikandung note (dipakai tes untuk memastikan note selalu BENAR terhadap puzzle; tidak ditampilkan ke pemain). */
export type NoteFact =
  | { t: 'chain'; a: number; b: number }            // saklar a ditekan tepat sebelum saklar b
  | { t: 'notFirst'; c: number }                    // panel daya: warna c bukan yang pertama
  | { t: 'before'; a: number; b: number }           // panel daya: warna a ditarik sebelum b
  | { t: 'leverCount'; i: number; n: number }       // sirkuit: tuas i membalik n lampu
  | { t: 'solCount'; n: number }                    // sirkuit: n tuas harus turun
  | { t: 'drum'; d: number; g: number }             // glif: tromol d berbentuk g (digambarkan samar)
  | { t: 'simonCount'; c: number; n: number }       // metronom: warna c muncul n kali
  | { t: 'simonNot'; k: number; c: number };        // metronom: kedipan ke-k bukan warna c
export interface HintNote { id: string; topic: NoteTopic; text: string; fact: NoteFact }
export interface NoteCtx {
  switchOrder: number[];            // order[k] = indeks saklar yang ditekan ke-k
  switchRoomTypes: string[];        // tipe ruangan tiap saklar (indeks saklar)
  model: PuzzleModel | null;        // null = ruangan kode tidak ada pada run ini
}

/** Penunjuk ruangan yang samar (tanpa menyebut nama ruangan langsung). */
export const ROOM_HINT: Record<string, string> = {
  admin: 'meja-meja administrasi', archive: 'rak arsip yang berdebu', break: 'ruang istirahat yang bau kopi basi', docs: 'ruang dokumen',
  kitchen: 'dapur', locker: 'ruang loker berkarat', meeting: 'ruang rapat', tech: 'ruang teknisi yang berdengung',
};
const GLYPH_HINT = ['tiga sudut', 'tanpa sudut sama sekali', 'empat sudut', 'empat sudut', 'lima ujung runcing', 'dua garis yang saling bersilang'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ord = (i: number) => ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima'][i] ?? String(i + 1);

export function makeHintNotes(seed: number, ctx: NoteCtx): HintNote[] {
  const rng = makeRng((seed ^ 0x4e07e5d1) >>> 0), out: HintNote[] = [];
  const add = (topic: NoteTopic, text: string, fact: NoteFact) => out.push({ id: `hint_${topic}_${out.filter((n) => n.topic === topic).length}`, topic, text, fact });
  const T = (...v: string[]) => rng.pick(v);

  // --- urutan saklar: 4 sambungan "A lalu B" (semuanya terkumpul = urutan lengkap, satu-satu hanya potongan)
  const o = ctx.switchOrder;
  if (o.length === 5 && ctx.switchRoomTypes.length === 5) {
    const h = (i: number) => ROOM_HINT[ctx.switchRoomTypes[i]] ?? 'ruangan yang tak kuingat';
    for (let k = 0; k < 4; k++) {
      const A = h(o[k]), B = h(o[k + 1]);
      add('switch', T(
        `${cap(A)} dulu. Baru ${B}. Jangan dibalik.`,
        `Sebelum ${B}, tangan harus sudah menyentuh ${A}.`,
        `Kalau ${A} belum menyala, ${B} cuma akan menjerit.`,
        `${cap(A)}... lalu ${B}. Aku pernah salah. Alarmnya masih terngiang.`,
      ), { t: 'chain', a: o[k], b: o[k + 1] });
    }
  }

  const m = ctx.model;
  if (!m) return out;
  const cn = (i: number) => COLORS[i].id.toLowerCase();
  const pos = new Array(5).fill(0); m.order.forEach((c, k) => { pos[c] = k; });

  // --- I panel daya: satu fakta negatif + satu relasi (papan di dinding tetap perlu dibaca)
  { const c = rng.pick([0, 1, 2, 3, 4].filter((x) => pos[x] !== 0));
    add('panel', T(`Jangan mulai dari tuas ${cn(c)}. Itu yang membuatku gagal tiga kali.`, `Tuas ${cn(c)} bukan yang pertama. Percayalah, aku sudah mencoba.`), { t: 'notFirst', c });
    const pairs: [number, number][] = []; for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) if (pos[a] < pos[b]) pairs.push([a, b]);
    const [a, b] = rng.pick(pairs);
    add('panel', T(`${cap(cn(a))} selalu mendahului ${cn(b)}, entah kapan. Papan teknisi tidak berbohong, hanya letak tuasnya yang menipu.`, `Tuas ${cn(b)} tidak pernah mendahului ${cn(a)}.`), { t: 'before', a, b }); }

  // --- II sirkuit: jumlah (bukan kombinasi)
  { const i = rng.int(0, CIRC_LEVERS - 1), n = popcount(m.masks[i]);
    add('circuit', T(`Tuas nomor ${i + 1} (hitung dari kiri) mengubah ${n} lampu sekaligus. Catat tiap tuas.`, `Satu tuas tidak pernah hanya mengubah satu lampu. Nomor ${i + 1} mengubah ${n}.`), { t: 'leverCount', i, n });
    const s = popcount(m.solution2);
    add('circuit', T(`Cuma ${s} tuas yang perlu turun supaya semua lampu menyala. Sisanya biarkan.`, `Jangan turunkan semuanya. ${s} tuas sudah cukup.`), { t: 'solCount', n: s }); }

  // --- III glif: bentuk tromol digambarkan samar (papan dinding tetap diperlukan untuk memilih)
  { const ds = rng.shuffle([0, 1, 2].slice()).slice(0, 2).sort((x, y) => x - y);
    ds.forEach((d, idx) => {
      const g = m.glyph[d], hint = GLYPH_HINT[g];
      add('glyph', idx === 0 ? T(`Tromol ${ord(d)}: bentuknya punya ${hint}.`, `Yang di tromol ${ord(d)}... ${hint}. Hanya itu yang kuingat.`)
        : T(`Papan yang dicoret itu bohong. Tromol ${ord(d)}: ${hint}.`, `Tromol ${ord(d)} bukan yang dicoret. ${cap(hint)}.`), { t: 'drum', d, g });
    }); }

  // --- IV metronom: frekuensi warna + satu kedipan yang bukan warna tertentu
  { const c = rng.pick([...new Set(m.simon)]), n = m.simon.filter((v) => v === c).length;
    add('metro', T(`Dari lima kedipan, ${cn(c)} muncul ${n} kali. Hitung, jangan menebak.`, `Lampu ${cn(c)} menyala ${n} kali dalam satu putaran.`), { t: 'simonCount', c, n });
    const k = rng.int(0, SIMON_LEN - 1), cc = rng.pick([0, 1, 2, 3].filter((x) => x !== m.simon[k]));
    add('metro', T(`Kedipan ${ord(k)} bukan ${cn(cc)}. Salah satu saja sudah cukup membuatku mengulang dari awal.`, `Kedipan ke-${k + 1}: bukan ${cn(cc)}.`), { t: 'simonNot', k, c: cc }); }
  return out;
}

/** Berapa note ke container vs permukaan (meja): kira-kira separuh-separuh, jatuh ke sisi lain bila satu sisi kurang. */
export function splitNotes(total: number, containers: number, surfaces: number, rng: Rng): { container: number; surface: number } {
  let c = Math.min(containers, Math.ceil(total / 2) + (rng.chance(0.5) ? 0 : -1)); c = Math.max(0, c);
  let s = Math.min(surfaces, total - c); s = Math.max(0, s);
  c = Math.min(containers, total - s); // sisa dilimpahkan ke container
  return { container: Math.max(0, c), surface: s };
}
