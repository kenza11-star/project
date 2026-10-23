'use strict';
// Relay room cadangan untuk blitz.cloud. SATU proses Node yang berjalan terus -> state room di memori (tanpa database, tanpa Supabase).
// API sama dengan /api/rooms/* di aplikasi utama; klien pindah ke sini otomatis bila server utama gagal (lihat lib/net/roomapi.ts).
// Identitas: ID token Firebase yang sama (diverifikasi di sini). Tanpa FIREBASE_* -> server menolak semua request (aman).
const http = require('http');
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ONLINE_S = { waiting: 90, playing: 30 };   // sama dengan SQL: waiting 90 / playing 30
const SEAT_S = { waiting: 300, playing: 120 };   // sama dengan SQL: waiting 300 / playing 120
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 49152;
const LOCKER_LEASE_S = 40;                       // sama dengan LOCKER_LEASE_S (lib/net/lockers.ts) dan interval '40 seconds' di SQL
const LOCKER_ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;

class Err extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

function createApp({ verify, now = () => Date.now(), rand = (n) => crypto.randomInt(n) } = {}) {
  const rooms = new Map(), byCode = new Map(), userRoom = new Map(), hits = new Map();

  const seatMs = (r) => SEAT_S[r.status === 'waiting' ? 'waiting' : 'playing'] * 1000;
  const onMs = (r) => ONLINE_S[r.status === 'waiting' ? 'waiting' : 'playing'] * 1000;
  const holds = (r, m) => !m.left && now() - m.seen < seatMs(r);

  function roomJson(r, slot) { return { roomId: r.id, code: r.code, seed: r.seed, maxPlayers: r.max, status: r.status, slot, hostId: r.host, backend: 'relay' }; }
  function view(r) {
    const members = [...r.members].filter(([, m]) => holds(r, m)).sort((a, b) => a[1].slot - b[1].slot)
      .map(([id, m]) => ({ id, slot: m.slot, name: m.name, host: id === r.host, online: now() - m.seen < onMs(r) }));
    const online = members.filter((m) => m.online).length;   // sama dengan finalizeView() di lib/net/roomview.ts (aplikasi utama)
    return { room_id: r.id, code: r.code, status: r.status, host_id: r.host, max_players: r.max, seed: r.seed, members, active: true, via: 'relay',
      online_count: online, member_count: members.length, can_start: r.status === 'waiting' && online >= 2, server_time: new Date(now()).toISOString(), backend: 'relay', build: 'relay' };
  }
  function getRoom(roomId) { if (!UUID_RE.test(String(roomId))) throw new Err(400, 'invalid'); const r = rooms.get(roomId); if (!r) throw new Err(404, 'room_not_found'); return r; }
  function member(r, uid) { const m = r.members.get(uid); return m && !m.left ? m : null; }

  // Klaim loker HIDUP = pemegang masih anggota room yang ONLINE dan lease < LOCKER_LEASE_S (aturan sama dengan room_lockers_view di SQL).
  // Klaim basi dibuang di sini. Node berjalan satu thread dan handler ini sinkron -> operasi loker otomatis atomik (tanpa balapan).
  function liveLockers(r) {
    const out = {};
    for (const [id, c] of [...r.lockers]) {
      const m = r.members.get(c.uid);
      if (!m || m.left || now() - m.seen >= onMs(r) || now() - c.renewed >= LOCKER_LEASE_S * 1000) { r.lockers.delete(id); continue; }
      out[id] = c.uid;
    }
    return out;
  }
  function dropLockersOf(r, uid) { for (const [id, c] of [...r.lockers]) if (c.uid === uid) r.lockers.delete(id); }

  function leaveInternal(r, uid) {
    const m = r.members.get(uid); if (m) m.left = true;
    dropLockersOf(r, uid);
    if (userRoom.get(uid) === r.id) userRoom.delete(uid);
    const active = [...r.members].filter(([, x]) => !x.left).sort((a, b) => a[1].slot - b[1].slot);
    if (r.host === uid) { if (!active.length) r.status = 'closed'; else r.host = active[0][0]; }
    else if (!active.length) r.status = 'closed';
  }
  function leaveOthers(uid, keepId) { const id = userRoom.get(uid); if (id && id !== keepId) { const r = rooms.get(id); if (r) leaveInternal(r, uid); } }

  const api = {
    create(u, b) {
      const max = b.maxPlayers; if (!Number.isInteger(max) || max < 2 || max > 6) throw new Err(400, 'invalid');
      leaveOthers(u.uid, null);
      let code = ''; for (let i = 0; i < 12; i++) { code = ''; for (let k = 0; k < 6; k++) code += ALPHABET[rand(ALPHABET.length)]; if (!byCode.has(code)) break; code = ''; }
      if (!code) throw new Err(500, 'server');
      const r = { id: crypto.randomUUID(), code, host: u.uid, max, seed: 1 + rand(2 ** 31 - 1), status: 'waiting', members: new Map(), pos: new Map(), world: [], wid: 0, touched: now(), lockers: new Map() };
      r.members.set(u.uid, { slot: 0, name: u.name, seen: now(), left: false, relay: 0 });
      rooms.set(r.id, r); byCode.set(code, r.id); userRoom.set(u.uid, r.id);
      return roomJson(r, 0);
    },
    join(u, b) {
      const code = String(b.code || '').trim().toUpperCase().replace(/[\s-]/g, '');
      if (code.length !== 6 || [...code].some((c) => !ALPHABET.includes(c))) throw new Err(400, 'invalid');
      const id = byCode.get(code); const r = id && rooms.get(id); if (!r) throw new Err(404, 'room_not_found');
      if (r.status === 'closed') throw new Err(410, 'room_closed');
      if (r.status === 'waiting') for (const [uid, m] of [...r.members]) if (uid !== u.uid && (m.left || now() - m.seen > SEAT_S.waiting * 1000)) r.members.delete(uid);
      let m = r.members.get(u.uid);
      if (m) { m.left = false; m.seen = now(); m.name = u.name; }
      else {
        if (r.status === 'playing') throw new Err(409, 'room_started');
        if (r.members.size >= r.max) throw new Err(409, 'room_full');
        let slot = 0; const used = new Set([...r.members.values()].map((x) => x.slot)); while (used.has(slot)) slot++;
        m = { slot, name: u.name, seen: now(), left: false, relay: 0 }; r.members.set(u.uid, m);
      }
      leaveOthers(u.uid, r.id); userRoom.set(u.uid, r.id); r.touched = now();
      return roomJson(r, m.slot);
    },
    leave(u, b) { const r = rooms.get(String(b.roomId)); if (!UUID_RE.test(String(b.roomId))) throw new Err(400, 'invalid'); if (!r) return { left: false }; leaveInternal(r, u.uid); return { left: true }; },
    heartbeat(u, b) { const r = getRoom(b.roomId); const m = member(r, u.uid); if (m) m.seen = now(); return { active: !!m }; },
    start(u, b) {
      const r = getRoom(b.roomId);
      if (r.host !== u.uid) throw new Err(403, 'not_host');
      if (r.status === 'closed') throw new Err(410, 'room_closed');
      if (r.status === 'playing') return { status: 'playing', players: [...r.members.values()].filter((m) => !m.left).length };
      const me = member(r, u.uid); if (me) me.seen = now();
      const n = [...r.members.values()].filter((m) => !m.left && now() - m.seen < ONLINE_S.waiting * 1000).length;
      if (n < 2) throw new Err(409, 'not_ready');
      r.status = 'playing'; r.touched = now(); return { status: 'playing', players: n };
    },
    state(u, q) { const r = getRoom(q.roomId); const m = member(r, u.uid); if (!m) throw new Err(403, 'not_member'); m.seen = now(); return view(r); },
    locker(u, b) {
      const action = b.action;
      if (action !== 'enter' && action !== 'exit' && action !== 'release') throw new Err(400, 'invalid');
      const id = b.locker;
      if (action !== 'release' && !(typeof id === 'string' && LOCKER_ID_RE.test(id))) throw new Err(400, 'invalid');
      const r = getRoom(b.roomId);
      if (r.status === 'closed') throw new Err(410, 'room_closed');
      const m = member(r, u.uid); if (!m) throw new Err(403, 'not_member');
      m.seen = now(); r.touched = now();                       // permintaan ini = bukti pemain hidup
      liveLockers(r);                                          // buang klaim basi (disconnect / keluar / lease habis) SEBELUM memutuskan
      let ok = true, owner = null;
      if (action === 'enter') {
        const cur = r.lockers.get(id);
        if (cur && cur.uid !== u.uid) { ok = false; owner = cur.uid; }          // terisi pemain lain: ditolak
        else { for (const [k, c] of [...r.lockers]) if (c.uid === u.uid && k !== id) r.lockers.delete(k); r.lockers.set(id, { uid: u.uid, renewed: now() }); } // satu pemain = satu loker
      } else if (action === 'exit') { const c = r.lockers.get(id); if (c && c.uid === u.uid) r.lockers.delete(id); }
      else dropLockersOf(r, u.uid);
      return { ok, reason: ok ? null : 'occupied', owner, lockers: liveLockers(r), server_time: new Date(now()).toISOString() };
    },
    sync(u, b) {
      const r = getRoom(b.roomId); const m = member(r, u.uid); if (!m) throw new Err(403, 'not_member');
      m.seen = now(); m.relay = b.need === true ? now() + 6000 : 0; r.touched = now();
      if (b.state && typeof b.state === 'object' && JSON.stringify(b.state).length <= 2048) r.pos.set(u.uid, { state: b.state, at: now() });
      if (Array.isArray(b.world)) for (const w of b.world.slice(0, 12)) if (w && typeof w === 'object' && JSON.stringify(w).length <= 4096) r.world.push({ id: ++r.wid, uid: u.uid, msg: w, at: now() });
      const cut = now() - 180000; while (r.world.length && r.world[0].at < cut) r.world.shift();
      let since = Number.isFinite(b.since) ? Math.floor(b.since) : -1; if (since < 0) since = Math.max(0, r.wid - 60);
      const out = r.world.filter((e) => e.id > since && e.uid !== u.uid).slice(0, 100).map((e) => ({ id: e.id, from: e.uid, msg: e.msg }));
      const cursor = out.length ? out[out.length - 1].id : Math.max(since, r.wid);
      const states = {}; for (const [uid, p] of r.pos) if (uid !== u.uid && now() - p.at < 15000) states[uid] = p.state;
      const need = [...r.members].some(([uid, x]) => uid !== u.uid && !x.left && x.relay > now());
      return { ...view(r), states, world: out, cursor, need_relay: need, lockers: liveLockers(r) };
    },
  };

  function rate(uid) { const t = now(), a = (hits.get(uid) || []).filter((x) => t - x < 60000); if (a.length >= 1500) throw new Err(429, 'rate_limited'); a.push(t); hits.set(uid, a); }
  function sweep() {
    const t = now();
    for (const [id, r] of rooms) {
      const live = [...r.members.values()].some((m) => holds(r, m));
      if ((!live && t - r.touched > 10 * 60000) || (r.status === 'closed' && t - r.touched > 5 * 60000)) { rooms.delete(id); byCode.delete(r.code); for (const [u, rid] of userRoom) if (rid === id) userRoom.delete(u); }
    }
    for (const [k, a] of hits) if (!a.some((x) => t - x < 60000)) hits.delete(k);
  }

  function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Max-Age', '86400'); }
  function send(res, status, data) { cors(res); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function body(req) { return new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Err(413, 'invalid')); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { const v = JSON.parse(Buffer.concat(ch).toString() || '{}'); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch { reject(new Err(400, 'invalid')); } }); req.on('error', () => reject(new Err(400, 'invalid'))); }); }

  const routes = { 'POST /api/rooms': 'create', 'POST /api/rooms/join': 'join', 'POST /api/rooms/leave': 'leave', 'POST /api/rooms/heartbeat': 'heartbeat', 'POST /api/rooms/start': 'start', 'GET /api/rooms/state': 'state', 'POST /api/rooms/sync': 'sync', 'POST /api/rooms/locker': 'locker' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) return send(res, 200, { ok: true, service: 'kynx-relay', rooms: rooms.size });
      const fn = routes[req.method + ' ' + url.pathname]; if (!fn) throw new Err(404, 'invalid');
      const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(req.headers.authorization || ''); if (!m) throw new Err(401, 'unauthorized');
      let u; try { u = await verify(m[1]); } catch { throw new Err(401, 'unauthorized'); }
      if (!u || !u.uid) throw new Err(401, 'unauthorized');
      rate(u.uid);
      const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await body(req);
      send(res, 200, api[fn](u, input));
    } catch (e) {
      if (e instanceof Err) return send(res, e.status, { error: { code: e.code, message: e.code } });
      console.error('[relay] galat tak terduga:', e && e.message); send(res, 500, { error: { code: 'server', message: 'server', detail: String(e && e.message).slice(0, 100) } });
    }
  });
  server.sweeper = setInterval(sweep, 60000); server.sweeper.unref();
  server.on('close', () => clearInterval(server.sweeper));
  return server;
}

module.exports = { createApp };

if (require.main === module) {
  const admin = require('firebase-admin');
  const pk = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '');
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !pk) { console.error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY wajib diisi.'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: pk }) });
  const verify = async (token) => {
    const t = await admin.auth().verifyIdToken(token);
    const fromEmail = typeof t.email === 'string' ? t.email.split('@')[0] : '';
    return { uid: t.uid, name: String(t.name || fromEmail || 'Player').slice(0, 16) };
  };
  const port = Number(process.env.PORT) || 3000;
  createApp({ verify }).listen(port, '0.0.0.0', () => console.log('kynx-relay jalan di port', port));
}
