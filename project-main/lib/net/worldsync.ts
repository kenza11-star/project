// Sinkronisasi state dunia bersama (logika murni, tanpa three/react; dites di scripts/test-net.js).
//
// Cakupan: pintu yang dibuka/ditutup pemain, benda (soda/key) yang diambil, gembok yang dibuka, container berisi loot yang sudah digeledah.
// TIDAK dicakup (tetap lokal per pemain): kejadian acak (pintu dibanting, scare/SCP-106, lampu berkedip), win/lose, inventory.
//
// Model: tiap klien mengirim event saat aksi lokal, dan "digest" (seluruh perubahan sejak awal run) berkala + saat ada pemain baru,
// jadi pemain yang masuk terlambat / reconnect / kehilangan paket tetap konvergen. Merge-nya CRDT sederhana:
//  - taken / lock / cont: himpunan yang hanya bertambah (union), idempoten;
//  - door: last-writer-wins berdasarkan cap waktu ts (jam dinding; selisih jam antarperangkat bisa membuat dua toggle serentak berakhir berbeda
//    sesaat sampai digest berikutnya menyatukan - dapat diterima untuk pintu).
// Pesan jaringan TIDAK dipercaya: semua lewat sanitizeWorldMsg().
import { isMissionId, type MissionId } from './mission';
// Snapshot ruangan puzzle (sama dengan PzSnap di lib/game/puzzleroom.ts; diduplikasi agar modul net berdiri sendiri). Rentang: a 0..5, b 0..31, c 0..215, d 0..5, f 0..31 (bit 4 = pintu rahasia terbuka).
export interface PzSnap { v: number; a: number; b: number; c: number; d: number; f: number; g: number }   // g = PIN 3 digit + status lampu (0..2999)
const isPzSnap = (x: unknown): x is PzSnap => {
  if (!x || typeof x !== 'object') return false; const o = x as Record<string, unknown>;
  const int = (k: string, lo: number, hi: number) => typeof o[k] === 'number' && Number.isInteger(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  return int('v', 0, 1_000_000) && int('a', 0, 5) && int('b', 0, 31) && int('c', 0, 215) && int('d', 0, 5) && int('f', 0, 31) && (o.g === undefined || int('g', 0, 2999));
};

export type NetWorldEvent =
  | { k: 'door'; i: number; o: 0 | 1; ts?: number }
  | { k: 'taken'; id: string }
  | { k: 'lock'; id: string }
  | { k: 'cont'; id: string }
  | { k: 'mission'; id: MissionId }   // misi selesai: HANYA diterima dari host (otoritas); himpunan yang hanya bertambah
  | { k: 'mreq'; id: MissionId }     // permintaan selesai dari non-host ke host (sekali jalan, tidak disimpan)
  | { k: 'sw'; v: number; p: number; r: 0 | 1 }  // puzzle saklar: state otoritatif host (v = versi naik, p = jumlah saklar benar, r = 1 bila baru saja salah urutan); hanya dari host
  | { k: 'swreq'; i: number }
  | ({ k: 'pz'; r: 0 | 1; lp: number } & PzSnap)   // ruangan puzzle: state otoritatif host (versi naik; r = baru salah; lp = tuas terakhir ditekan: stasiun*8+indeks, 0 = tidak ada); hanya dari host
  | { k: 'pzreq'; t: 0 | 1 | 2 | 3 | 4; i: number };   // non-host menekan tuas/tromol -> diminta ke host (sekali jalan, tidak disimpan); t=0: i=0 minta host membuka pintu rahasia, i=1..3 putar digit PIN ke-i, i=4 tombol CEK
export interface WorldMsg { v: 1; t: 'w'; ev: NetWorldEvent[] }

export const MAX_WORLD_EVENTS = 400;
const ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;

export const isWorldMsg = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'w';

export function sanitizeWorldMsg(raw: unknown): WorldMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { v?: unknown; t?: unknown; ev?: unknown };
  if (r.v !== 1 || r.t !== 'w' || !Array.isArray(r.ev)) return null;
  const out: NetWorldEvent[] = [];
  for (const e of r.ev.slice(0, MAX_WORLD_EVENTS)) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    if (x.k === 'door') {
      if (typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 1000 && (x.o === 0 || x.o === 1) && typeof x.ts === 'number' && Number.isFinite(x.ts)) out.push({ k: 'door', i: x.i, o: x.o, ts: x.ts });
    } else if ((x.k === 'taken' || x.k === 'lock' || x.k === 'cont') && typeof x.id === 'string' && ID_RE.test(x.id)) out.push({ k: x.k, id: x.id });
    else if ((x.k === 'mission' || x.k === 'mreq') && isMissionId(x.id)) out.push({ k: x.k, id: x.id });
    else if (x.k === 'sw') {
      if (typeof x.v === 'number' && Number.isInteger(x.v) && x.v >= 0 && x.v <= 1_000_000 && typeof x.p === 'number' && Number.isInteger(x.p) && x.p >= 0 && x.p <= 5 && (x.r === 0 || x.r === 1)) out.push({ k: 'sw', v: x.v, p: x.p, r: x.r });
    } else if (x.k === 'pz') {
      if (isPzSnap(x) && (x.r === 0 || x.r === 1) && typeof x.lp === 'number' && Number.isInteger(x.lp) && x.lp >= 0 && x.lp <= 40) out.push({ k: 'pz', v: x.v, a: x.a, b: x.b, c: x.c, d: x.d, f: x.f, g: x.g ?? 0, r: x.r, lp: x.lp });
    } else if (x.k === 'pzreq') {
      if ((x.t === 0 || x.t === 1 || x.t === 2 || x.t === 3 || x.t === 4) && typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 5) out.push({ k: 'pzreq', t: x.t, i: x.i });
    } else if (x.k === 'swreq' && typeof x.i === 'number' && Number.isInteger(x.i) && x.i >= 0 && x.i < 5) out.push({ k: 'swreq', i: x.i });
  }
  return { v: 1, t: 'w', ev: out };
}

export class WorldSync {
  private doors = new Map<number, { o: 0 | 1; ts: number }>();
  private pz: PzSnap | null = null;   // state ruangan puzzle terbaru (LWW berdasarkan versi dari host)
  private sw: { v: number; p: number } | null = null;   // state puzzle saklar terbaru (LWW berdasarkan versi dari host)
  private sets = { taken: new Set<string>(), lock: new Set<string>(), cont: new Set<string>(), mission: new Set<string>() };
  constructor(private now: () => number = () => Date.now()) {}

  /** Aksi lokal: catat dan kembalikan pesan untuk dikirim (null = tidak ada perubahan / tidak perlu dikirim). */
  local(e: NetWorldEvent): WorldMsg | null {
    if (e.k === 'door') {
      const prev = this.doors.get(e.i);
      if (prev && prev.o === e.o) return null;
      const ts = Math.max(this.now(), (prev?.ts ?? 0) + 1);   // monoton per pintu
      this.doors.set(e.i, { o: e.o, ts });
      return { v: 1, t: 'w', ev: [{ k: 'door', i: e.i, o: e.o, ts }] };
    }
    if (e.k === 'mreq') return { v: 1, t: 'w', ev: [{ k: 'mreq', id: e.id }] };
    if (e.k === 'pzreq') return { v: 1, t: 'w', ev: [{ k: 'pzreq', t: e.t, i: e.i }] };
    if (e.k === 'pz') { if (this.pz && e.v <= this.pz.v) return null; this.pz = { v: e.v, a: e.a, b: e.b, c: e.c, d: e.d, f: e.f, g: e.g ?? 0 }; return { v: 1, t: 'w', ev: [e] }; }
    if (e.k === 'swreq') return { v: 1, t: 'w', ev: [{ k: 'swreq', i: e.i }] };
    if (e.k === 'sw') { if (this.sw && e.v <= this.sw.v) return null; this.sw = { v: e.v, p: e.p }; return { v: 1, t: 'w', ev: [e] }; }
    const set = this.sets[e.k];
    if (set.has(e.id) || set.size >= MAX_WORLD_EVENTS) return null;
    set.add(e.id);
    return { v: 1, t: 'w', ev: [{ k: e.k, id: e.id } as NetWorldEvent] };
  }

  /** Seluruh perubahan sejauh ini (dikirim berkala dan saat ada pemain baru). null bila kosong. */
  digest(): WorldMsg | null {
    const ev: NetWorldEvent[] = [];
    for (const [i, d] of this.doors) ev.push({ k: 'door', i, o: d.o, ts: d.ts });
    for (const k of ['taken', 'lock', 'cont', 'mission'] as const) for (const id of this.sets[k]) ev.push({ k, id } as NetWorldEvent);
    if (this.pz) ev.push({ k: 'pz', ...this.pz, r: 0, lp: 0 });
    if (this.sw) ev.push({ k: 'sw', v: this.sw.v, p: this.sw.p, r: 0 }); // r=0: pemain terlambat tidak membunyikan alarm lama
    return ev.length ? { v: 1, t: 'w', ev: ev.slice(0, MAX_WORLD_EVENTS) } : null;
  }

  /** Pesan dari pemain lain: validasi, gabungkan, dan kembalikan HANYA event yang benar-benar mengubah state (untuk diterapkan ke dunia). */
  /** `fromHost`: pengirim adalah host room. Event 'mission' dari non-host DIBUANG (host = otoritas status misi). */
  receive(raw: unknown, fromHost = true): NetWorldEvent[] {
    const m = sanitizeWorldMsg(raw); if (!m) return [];
    const eff: NetWorldEvent[] = [];
    for (const e of m.ev) {
      if (e.k === 'door') {
        const prev = this.doors.get(e.i), ts = e.ts ?? 0;
        if (prev && prev.ts >= ts) continue;                 // lebih lama / sama: abaikan
        this.doors.set(e.i, { o: e.o, ts });
        if (!prev || prev.o !== e.o) eff.push({ k: 'door', i: e.i, o: e.o });
      } else if (e.k === 'pz') {
        if (!fromHost || (this.pz && e.v <= this.pz.v)) continue;
        this.pz = { v: e.v, a: e.a, b: e.b, c: e.c, d: e.d, f: e.f, g: e.g ?? 0 }; eff.push(e);
      } else if (e.k === 'mreq' || e.k === 'swreq' || e.k === 'pzreq') {
        eff.push(e);                                         // dikerjakan host saja (World.applyNet); tidak digabung
      } else if (e.k === 'sw') {
        if (!fromHost || (this.sw && e.v <= this.sw.v)) continue;   // hanya host yang menentukan; versi lama/sama diabaikan
        this.sw = { v: e.v, p: e.p }; eff.push(e);
      } else {
        if (e.k === 'mission' && !fromHost) continue;
        const set = this.sets[e.k];
        if (set.has(e.id) || set.size >= MAX_WORLD_EVENTS) continue;
        set.add(e.id); eff.push(e);
      }
    }
    return eff;
  }
  reset() { this.doors.clear(); this.sets.taken.clear(); this.sets.lock.clear(); this.sets.cont.clear(); this.sets.mission.clear(); this.sw = null; this.pz = null; }
}
