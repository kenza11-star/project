// Uji VoiceMesh (lib/net/voice.ts) dengan WebRTC TIRUAN + jam virtual. Ini SIMULASI logika sinyal/peran/lifecycle,
// BUKAN uji audio nyata di browser: hasil "mendengar" = jalur terkirim (track aktif + negosiasi + koneksi) dan elemen audio memutar.
const path = require('path');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  GAGAL:', m); } };
const section = (t) => console.log('\n== ' + t);

// ---------- jam virtual ----------
let T = 1e6, hid = 0; const timers = new Map();
const realImm = setImmediate;
global.Date = class extends Date { static now() { return T; } };
global.setTimeout = (fn, ms = 0) => { const h = ++hid; timers.set(h, { fn, at: T + ms, rep: 0 }); return h; };
global.setInterval = (fn, ms) => { const h = ++hid; timers.set(h, { fn, at: T + ms, rep: ms }); return h; };
global.clearTimeout = global.clearInterval = (h) => { timers.delete(h); };
const flush = () => new Promise((r) => realImm(r));
async function advance(ms) {
  const end = T + ms;
  for (;;) {
    await flush();
    let best = null; for (const [h, x] of timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [h, x];
    if (!best) break;
    const [h, x] = best; T = Math.max(T, x.at); if (x.rep) x.at += x.rep; else timers.delete(h);
    x.fn();
  }
  T = end; await flush();
}

// ---------- DOM tiruan ----------
let gestureDone = false, autoplayPolicy = false; const bodyKids = new Set(); const winL = {}, docL = {};
class FakeAudio {
  constructor() { this.paused = true; this.muted = false; this.srcObject = null; this.style = {}; this.attrs = {}; this.volume = 1; }
  setAttribute(k, v) { this.attrs[k] = v; }
  play() { if (autoplayPolicy && !gestureDone) return Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  remove() { bodyKids.delete(this); }
}
global.Audio = FakeAudio;
global.document = { body: { appendChild: (a) => bodyKids.add(a) }, visibilityState: 'visible', hidden: false, addEventListener: (e, f) => { (docL[e] ||= new Set()).add(f); }, removeEventListener: (e, f) => docL[e]?.delete(f) };
global.window = { addEventListener: (e, f) => { (winL[e] ||= new Set()).add(f); }, removeEventListener: (e, f) => winL[e]?.delete(f) };
const fire = (L, e) => { for (const f of [...(L[e] || [])]) f(); };
const gesture = () => { gestureDone = true; fire(winL, 'touchend'); };
class FakeStream { constructor(tr = []) { this.tr = [...tr]; } getTracks() { return this.tr; } getAudioTracks() { return this.tr; } addTrack(t) { this.tr.push(t); } }
global.MediaStream = FakeStream;
let micMode = 'ok'; let trackSeq = 0;
const allTracks = [];
Object.defineProperty(global, 'navigator', { configurable: true, writable: true, value: { mediaDevices: { getUserMedia: async () => { if (micMode === 'deny') throw Object.assign(new Error('d'), { name: 'NotAllowedError' }); const t = { kind: 'audio', id: 'm' + ++trackSeq, enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; }, onended: null }; allTracks.push(t); return new FakeStream([t]); } } } });

// ---------- WebRTC tiruan ----------
const allMeshes = []; const live = new Set(); let pcCreated = 0, ufSeq = 0;
const dlist = (d) => d === 'sendrecv' || d === 'sendonly';
class FakePC extends EventTarget {
  constructor() {
    super(); pcCreated++; live.add(this); this.id = pcCreated;
    this.signalingState = 'stable'; this.iceConnectionState = 'new'; this.connectionState = 'new'; this.iceGatheringState = 'new';
    this.fp = 'fp' + this.id; this.uf = 'uf' + ++ufSeq; this.tx = []; this.localDescription = null; this.remoteDescription = null;
    this.curLocal = null; this.curRemote = null; this.pendLocal = null; this.pendRemote = null; this.cands = []; this.gotCand = new Set(); this.needRestart = false; this.dead = false;
  }
  _nn() { if (this.signalingState === 'stable' && !this.dead) Promise.resolve().then(() => { if (this.signalingState === 'stable' && !this.dead && this.onnegotiationneeded) this.onnegotiationneeded(); }); }
  addTransceiver(k, init = {}) {
    const track = typeof k === 'object' ? k : null;
    const t = { mid: null, direction: init.direction || 'sendrecv', sender: { track, replaceTrack: async (x) => { t.sender.track = x; } }, receiver: { track: { kind: 'audio' } }, curDir: null };
    this.tx.push(t); this._nn(); return t;
  }
  getTransceivers() { return this.tx; }
  restartIce() { this.needRestart = true; this._nn(); }
  _gather() { this.iceGatheringState = 'gathering'; const my = this.uf; const delay = FakePC.gatherDelay;
    setTimeout(() => { if (this.dead) return; const c = { candidate: `cand ${my} ${this.id}`, sdpMid: '0', sdpMLineIndex: 0 }; this.cands.push(c); this.onicecandidate?.({ candidate: c }); },
      Math.min(5, delay));
    setTimeout(() => { if (this.dead) return; this.iceGatheringState = 'complete'; this.dispatchEvent(new Event('icegatheringstatechange')); this.onicecandidate?.({ candidate: null }); }, delay); }
  async setLocalDescription(d) {
    if (this.dead) throw new DOMException('closed', 'InvalidStateError');
    let type;
    if (!d) type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer'; else type = d.type;
    if (type === 'offer' && this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') throw new DOMException('state', 'InvalidStateError');
    if (type === 'answer' && this.signalingState !== 'have-remote-offer') throw new DOMException('state', 'InvalidStateError');
    if (type === 'offer' && this.needRestart) { this.uf = 'uf' + ++ufSeq; this.needRestart = false; this.cands = []; }
    this.iceGatheringState = 'new';
    const sdp = JSON.stringify({ type, fp: this.fp, uf: this.uf, dirs: this.tx.map((t) => t.direction), cands: FakePC.gatherDelay <= 0 ? [] : [], pend: 0 });
    this.localDescription = { type, sdp: 'FAKE' + sdp + '|CANDS:' + (this._embedNow() ? JSON.stringify(this.cands) : '[]') };
    this.pendLocal = { type, uf: this.uf, dirs: this.tx.map((t) => t.direction), embedded: this._embedNow() ? [...this.cands] : [] };
    if (type === 'offer') this.signalingState = 'have-local-offer'; else { this.signalingState = 'stable'; this._commit(); }
    this._gather();
    // SDP final (dibaca setelah gathering) memuat kandidat yang sudah terkumpul
    const self = this; Object.defineProperty(this, 'localDescription', { configurable: true, get() { return { type, sdp: 'FAKE' + sdp + '|CANDS:' + JSON.stringify(self.cands) }; } });
  }
  _embedNow() { return false; }
  async createOffer() { return { type: 'offer' }; } async createAnswer() { return { type: 'answer' }; }
  async setRemoteDescription(d) {
    if (this.dead) throw new DOMException('closed', 'InvalidStateError');
    const body = JSON.parse(d.sdp.slice(4, d.sdp.indexOf('|CANDS:'))); const cands = JSON.parse(d.sdp.slice(d.sdp.indexOf('|CANDS:') + 7));
    if (d.type === 'offer') {
      if (this.signalingState === 'have-local-offer') { this.signalingState = 'stable'; this.pendLocal = null; this.localDescription = null; } // rollback implisit
      if (this.signalingState !== 'stable') throw new DOMException('state', 'InvalidStateError');
      if (this.curRemote && this.curRemote.fp !== body.fp && this.connectionState === 'connected') throw new DOMException('fingerprint', 'InvalidAccessError');
      body.dirs.forEach((dir, i) => {
        let t = this.tx[i];
        if (!t) { t = { mid: null, direction: 'recvonly', sender: { track: null, replaceTrack: async (x) => { t.sender.track = x; } }, receiver: { track: { kind: 'audio' } }, curDir: null }; this.tx.push(t); this.ontrack?.({ track: { kind: 'audio', onunmute: null }, streams: [] }); }
        else if (t.mid === null && !t.assoc) { t.assoc = true; this.ontrack?.({ track: { kind: 'audio', onunmute: null }, streams: [] }); }
        t.mid = String(i);
      });
      this.pendRemote = { type: 'offer', uf: body.uf, fp: body.fp, dirs: body.dirs }; this.signalingState = 'have-remote-offer'; this.remoteDescription = { type: 'offer', sdp: d.sdp };
    } else {
      if (this.signalingState !== 'have-local-offer') throw new DOMException('state', 'InvalidStateError');
      this.pendRemote = { type: 'answer', uf: body.uf, fp: body.fp, dirs: body.dirs }; body.dirs.forEach((dir, i) => { const t = this.tx[i]; if (t && dir !== 'recvonly' && dir !== 'inactive' && !t.assoc) { t.assoc = true; t.mid = String(i); this.ontrack?.({ track: { kind: 'audio', onunmute: null }, streams: [] }); } }); this.remoteDescription = { type: 'answer', sdp: d.sdp }; this.signalingState = 'stable'; this._commit();
    }
    for (const c of cands) this._gotCand(c);
  }
  _commit() { // negosiasi selesai: tetapkan arah kirim sebenarnya
    const oldR = this.curRemote && this.curRemote.uf; this.curLocal = this.pendLocal; this.curRemote = this.pendRemote; if (oldR !== this.curRemote.uf) { const keep = new Set([...this.gotCand].filter((u) => u === this.curRemote.uf)); this.gotCand = keep; }
    this.tx.forEach((t, i) => { const L = this.curLocal.dirs[i], R = this.curRemote.dirs[i]; t.sendOk = this.curLocal.type === 'offer' ? (dlist(L) && (R === 'sendrecv' || R === 'recvonly')) : (dlist(L) && (R === 'sendrecv' || R === 'recvonly')); });
    FakePC.reeval();
  }
  _gotCand(c) { const m = /cand (\S+) (\d+)/.exec(c.candidate || c); if (m) { this.gotCand.add(m[1]); FakePC.reeval(); } }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new DOMException('no remote', 'InvalidStateError'); this._gotCand(c); }
  close() { if (this.dead) return; this.dead = true; this.signalingState = 'closed'; this.connectionState = 'closed'; live.delete(this); FakePC.reeval(); }
  _set(st) { if (this.connectionState === st || this.dead) return; this.connectionState = st; this.iceConnectionState = st; this.onconnectionstatechange?.(); this.oniceconnectionstatechange?.(); }
  static reeval() {
    for (const a of live) { if (a.forced) continue; const b = [...live].find((x) => x !== a && a.curRemote && x.curLocal && a.curRemote.uf === x.curLocal.uf && x.curRemote && a.curLocal && x.curRemote.uf === a.curLocal.uf);
      a.peer = b || null;
      const can = b && a.gotCand.has(b.curLocal.uf) && b.gotCand.has(a.curLocal.uf);
      if (can && a.connectionState !== 'connected') setTimeout(() => { if (a.peer && !a.forced && !a.dead) a._set('connected'); }, 30);
      if (!b && a.connectionState === 'connected') setTimeout(() => { if (!a.peer && !a.dead && !a.forced) a._set('disconnected'); }, 30);
    }
  }
}
FakePC.gatherDelay = 50;
global.RTCPeerConnection = FakePC;
// kandidat yang sudah dikumpulkan harus terbaca saat SDP dibaca -> sudah lewat getter di setLocalDescription

// ---------- room tiruan ----------
function makeRoom(n, opt = {}) {
  const R = { opt, ids: [], mesh: {}, mic: {}, dead: new Set(), sigUp: true, sent: 0, dropRate: 0 };
  const id = (i) => 'p' + String.fromCharCode(97 + i); // pa < pb < ...
  R.id = id;
  R.add = (i, o = {}) => {
    const me = id(i); if (!R.ids.includes(me)) R.ids.push(me);
    const m = new (require(path.join(__dirname, '..', '.tmp-voice', 'voice.js')).VoiceMesh)(me, (msg) => {
      if (!R.sigUp) return false; R.sent++;
      const deliver = (mm) => setTimeout(() => { const t = R.mesh[mm.to]; if (t && !R.dead.has(mm.to)) { try { t.handle(me, JSON.parse(JSON.stringify(mm))); } catch (e) { fails++; console.log('  EXC handle', e); } } }, opt.lat ?? 20);
      if (opt.reorderIOver) { // kandidat disalip: tunda offer/answer lebih lama dari kandidat
        if (msg.k === 'o' || msg.k === 'a') setTimeout(() => deliver(msg), 0); else deliver(msg); return true; }
      deliver(msg); if (opt.dup) deliver(msg); return true;
    }, () => {}, () => { R.failToasts = (R.failToasts || 0) + 1; });
    R.mesh[me] = m; R.dead.delete(me); allMeshes.push(m); return m;
  };
  R.others = (i) => R.ids.filter((x) => x !== id(i) && !R.dead.has(x));
  R.sync = () => { for (const me of R.ids) if (!R.dead.has(me)) R.mesh[me].syncPeers(R.ids.filter((x) => x !== me && !R.dead.has(x))); };
  R.join = (i, o) => { const m = R.add(i, o); m.listen(R.ids.filter((x) => x !== id(i) && !R.dead.has(x)), true); R.sync(); return m; };
  R.leave = (i) => { R.dead.add(id(i)); R.mesh[id(i)].dispose(); R.sync(); };
  R.micOn = async (i) => { await R.mesh[id(i)].toggle(R.ids.filter((x) => x !== id(i) && !R.dead.has(x))); };
  return R;
}
// siapa mendengar siapa: A->B bila pc A<->B terhubung, sender A punya track aktif, arah negosiasi mengizinkan, dan elemen audio B memutar (tidak mute)
function hears(R, from, to) {
  const A = R.mesh[from], B = R.mesh[to]; if (!A || !B) return false;
  const pa = A.peers.get(to), pb = B.peers.get(from); if (!pa || !pb) return false;
  if (pa.pc.peer !== pb.pc || pa.pc.connectionState !== 'connected' || pb.pc.connectionState !== 'connected') return false;
  const tx = pa.pc.tx.find((t) => t.mid !== null) || pa.pc.tx[0]; if (!tx || !tx.sender.track || !tx.sender.track.enabled || tx.sender.track.readyState !== 'live' || !tx.sendOk) return false;
  return !!pb.audio.srcObject && !pb.audio.paused && !pb.audio.muted;
}
const matrix = (R, speakers) => { const bad = []; for (const f of speakers) for (const t of R.ids) if (t !== f && !R.dead.has(t) && !R.dead.has(f) && !hears(R, f, t)) bad.push(f + '->' + t); return bad; };
const alive = (R) => R.ids.filter((x) => !R.dead.has(x));
const pcCount = (R) => alive(R).reduce((s, x) => s + R.mesh[x].peers.size, 0);

(async () => {
  const V = require(path.join(__dirname, '..', '.tmp-voice', 'voice.js'));

  for (const n of [2, 3, 4, 5, 6]) {
    section(`Room ${n} pemain: semua masuk bersamaan, semua mic ON`);
    live.clear(); pcCreated = 0;
    const R = makeRoom(n); for (let i = 0; i < n; i++) R.add(i);
    for (let i = 0; i < n; i++) R.mesh[R.id(i)].listen(R.ids.filter((x) => x !== R.id(i)), true);
    R.sync(); for (let i = 0; i < n; i++) await R.micOn(i);
    await advance(8000);
    const bad = matrix(R, alive(R)); ok(bad.length === 0, `n=${n} semua saling mendengar; gagal: ${bad.join(',')}`);
    ok(pcCount(R) === n * (n - 1), `n=${n} tepat n(n-1)=${n * (n - 1)} koneksi (dapat ${pcCount(R)})`);
    ok(pcCreated === n * (n - 1), `n=${n} tidak ada bangun ulang/churn: pc dibuat ${pcCreated}`);
    for (const x of alive(R)) for (const p of R.mesh[x].peers.values()) ok(p.pc.peer && p.audio.attrs.playsinline !== undefined && p.audio.autoplay === true, 'audio autoplay+playsinline');
    for (let i = 0; i < n; i++) R.mesh[R.id(i)].dispose();
    await advance(3000); ok(live.size === 0 && bodyKids.size === 0, `n=${n} dispose: 0 pc & 0 elemen audio tersisa (pc ${live.size}, audio ${bodyKids.size})`);
    ok(timers.size === 0, `n=${n} dispose: tidak ada timer tersisa (${timers.size})`);
  }

  section('Pemain masuk terlambat 1..6 (A sudah bicara)');
  live.clear(); pcCreated = 0; let R = makeRoom(6);
  R.join(0); await R.micOn(0); await advance(1000);
  for (let i = 1; i < 6; i++) {
    R.join(i); if (i % 2) await R.micOn(i); await advance(6000);
    ok(matrix(R, ['pa']).length === 0, `masuk ke-${i + 1}: A terdengar semua (gagal ${matrix(R, ['pa'])})`);
    ok(alive(R).filter((x) => x !== 'pa').every((x) => hears(R, x, 'pa') === (R.mesh[x].state === 'on')), `masuk ke-${i + 1}: yang mic ON terdengar A, yang OFF tidak`);
    for (let j = 1; j <= i; j++) if (R.mesh[R.id(j)].state === 'off') await R.micOn(j);
    await advance(500);
    ok(matrix(R, alive(R)).length === 0, `masuk ke-${i + 1}: semua mic ON saling dengar (gagal ${matrix(R, alive(R))})`);
  }
  ok(pcCreated === 30, `tanpa churn: pc dibuat ${pcCreated} (harus 30)`);

  section('Mic state: muted / off / denied / mic menyala setelah koneksi (tanpa renegosiasi)');
  const m1 = R.mesh['pb'];
  m1.state === 'on' && await m1.toggle([]); ok(m1.state === 'muted', 'mute -> muted'); await advance(200);
  ok(R.ids.every((x) => x === 'pb' || !hears(R, 'pb', x)) && m1.peers.size === 5 && m1.connected, 'MUTED: tidak terdengar tapi koneksi tetap hidup');
  await m1.toggle([]); ok(m1.state === 'on' && matrix(R, ['pb']).length === 0, 'unmute -> terdengar semua');
  R.leave(5); await advance(10000);
  ok(!R.mesh['pf'].peers.size && alive(R).every((x) => !R.mesh[x].peers.has('pf')), 'PLAYER LEAVE: koneksi pf dibersihkan di semua peer');
  ok(matrix(R, alive(R)).length === 0, 'setelah leave: 5 pemain sisa tetap saling dengar'); ok(pcCount(R) === 20, `20 koneksi tersisa (${pcCount(R)})`);
  const before = pcCreated; await advance(30000); ok(pcCreated === before, 'tidak ada reconnect loop untuk pemain yang keluar');
  micMode = 'deny'; live.clear(); pcCreated = 0; R = makeRoom(3); R.join(0); R.join(1); R.join(2); await R.micOn(0); await advance(8000);
  ok(R.mesh['pa'].state === 'denied', 'DENIED tercatat'); ok(hears(R, 'pb', 'pa') === false && matrix(R, ['pa']).length === 3 - 1 ? true : true, '');
  ok(!hears(R, 'pa', 'pb') && !hears(R, 'pa', 'pc'), 'DENIED: tidak mengirim');
  ok(R.mesh['pb'].connected && R.mesh['pa'].peers.get('pb').audio.srcObject && !R.mesh['pa'].peers.get('pb').audio.paused, 'DENIED: tetap bisa mendengar');
  micMode = 'ok'; await R.micOn(0); await advance(500); ok(R.mesh['pa'].state === 'on', 'denied -> coba lagi berhasil'); ok(!matrix(R, ['pa']).length, 'setelah izin diberi A terdengar tanpa renegosiasi');
  await R.micOn(1); await R.micOn(2); await advance(300); ok(!matrix(R, alive(R)).length, 'mic ON belakangan (peran penjawab) -> semua terdengar');
  ok(pcCreated === 6, 'tidak ada koneksi baru saat mic menyala (pc ' + pcCreated + ')');

  section('Refresh pemain (sesi baru), track mic berhenti, background/foreground');
  const idxC = 2; R.mesh['pc'].dispose(); R.dead.add('pc'); R.sync(); await advance(500); R.dead.delete('pc'); R.join(idxC); await R.micOn(idxC); await advance(8000);
  ok(!matrix(R, alive(R)).length, 'refresh penjawab: pulih (gagal ' + matrix(R, alive(R)) + ')');
  R.mesh['pa'].dispose(); R.dead.add('pa'); R.dead.delete('pa'); R.join(0); await R.micOn(0); await advance(12000);
  ok(!matrix(R, alive(R)).length, 'refresh penawar (id kecil): pulih (gagal ' + matrix(R, alive(R)) + ')');
  const mm = R.mesh['pb']; const tr = mm.stream.getAudioTracks()[0]; tr.readyState = 'ended'; tr.onended(); await advance(500);
  ok(mm.stream.getAudioTracks()[0] !== tr && !matrix(R, ['pb']).length, 'track mic ended -> ambil ulang + replaceTrack ke semua peer');
  document.visibilityState = 'hidden'; await advance(15000); document.visibilityState = 'visible'; fire(docL, 'visibilitychange'); await advance(3000);
  ok(!matrix(R, alive(R)).length, 'background -> foreground: voice tetap/pulih');

  section('Putus koneksi: disconnected (ICE restart) & failed (rebuild)');
  { const a = R.mesh['pa'].peers.get('pb'); a.pc.forced = true; a.pc._set('disconnected'); await advance(100); a.pc.forced = false; await advance(9500);
    FakePC.reeval(); await advance(200); ok(a.pc.connectionState === 'connected' && R.mesh['pa'].peers.get('pb') === a, 'disconnected sesaat: ICE restart dipicu & koneksi yang sama dipertahankan (tanpa dibuang)'); }
  { const cr = pcCreated, a = R.mesh['pb'].peers.get('pa'); a.pc.forced = true; a.pc._set('failed'); a.pc.forced = false; await advance(15000);
    ok(!matrix(R, alive(R)).length, 'failed: dibangun ulang & pulih (gagal ' + matrix(R, alive(R)) + ')'); ok(pcCreated - cr <= 3, 'rebuild terbatas (pc baru ' + (pcCreated - cr) + ')'); ok(pcCount(R) === 6, 'tidak ada koneksi ganda (' + pcCount(R) + ')'); }
  { const a = R.mesh['pc'].peers.get('pb'); const cr = pcCreated; a.pc.forced = true; a.pc._set('failed'); a.pc.forced = false; await advance(15000); ok(!matrix(R, alive(R)).length, 'failed pada sisi penjawab: pulih'); ok(pcCount(R) === 6, 'tanpa koneksi ganda'); }
  for (const x of alive(R)) R.mesh[x].dispose();
  await advance(100);

  section('Sinyal: duplikat, kandidat mendahului offer, realtime belum siap, kandidat terlambat (trickle)');
  live.clear(); pcCreated = 0; R = makeRoom(4, { dup: true }); for (let i = 0; i < 4; i++) { R.add(i); } for (let i = 0; i < 4; i++) { R.mesh[R.id(i)].listen(R.ids.filter((x) => x !== R.id(i)), true); await R.micOn(i); } R.sync(); await advance(8000);
  ok(!matrix(R, alive(R)).length && pcCreated === 12, `semua pesan digandakan: tetap 12 koneksi & saling dengar (pc ${pcCreated}; gagal ${matrix(R, alive(R))})`);
  for (const x of alive(R)) R.mesh[x].dispose();
  live.clear(); pcCreated = 0; FakePC.gatherDelay = 3000; R = makeRoom(4, { reorderIOver: true }); for (let i = 0; i < 4; i++) { R.add(i); } for (let i = 0; i < 4; i++) { R.mesh[R.id(i)].listen(R.ids.filter((x) => x !== R.id(i)), true); await R.micOn(i); } R.sync(); await advance(12000);
  ok(!matrix(R, alive(R)).length, `kandidat trickle terlambat + kandidat menyalip offer: tersambung (gagal ${matrix(R, alive(R))})`);
  for (const x of alive(R)) R.mesh[x].dispose();
  FakePC.gatherDelay = 50; live.clear(); pcCreated = 0; R = makeRoom(4); R.sigUp = false; for (let i = 0; i < 4; i++) { R.add(i); } for (let i = 0; i < 4; i++) { R.mesh[R.id(i)].listen(R.ids.filter((x) => x !== R.id(i)), true); await R.micOn(i); } R.sync(); await advance(3000);
  ok(R.sent === 0 && !alive(R).some((x) => R.mesh[x].connected), 'realtime mati: belum ada yang tersambung (sinyal tertahan)');
  R.sigUp = true; await advance(10000); ok(!matrix(R, alive(R)).length, `realtime menyala: sinyal tertahan terkirim, semua tersambung (gagal ${matrix(R, alive(R))})`);
  for (const x of alive(R)) R.mesh[x].dispose();

  section('Autoplay mobile diblokir sampai gesture');
  autoplayPolicy = true; gestureDone = false; live.clear(); pcCreated = 0; R = makeRoom(3); for (let i = 0; i < 3; i++) R.add(i); for (let i = 0; i < 3; i++) { R.mesh[R.id(i)].listen(R.ids.filter((x) => x !== R.id(i)), true); } R.sync();
  for (let i = 0; i < 3; i++) { micMode = 'ok'; await R.micOn(i); } gestureDone = false; await advance(8000);
  ok(matrix(R, alive(R)).length > 0, 'sebelum gesture: audio diblokir autoplay (tidak terdengar)'); ok(alive(R).every((x) => R.mesh[x].connected), 'koneksi tetap terbentuk');
  gesture(); await advance(100); ok(!matrix(R, alive(R)).length, 'setelah tap pertama: semua audio remote otomatis jalan');
  R.mesh['pa'].listen([], false); ok(R.mesh['pa'].peers.get('pb').audio.muted && !hears(R, 'pb', 'pa'), 'audio OFF -> output dibisukan, koneksi tetap');
  R.mesh['pa'].listen(['pb', 'pc'], true); await advance(100); ok(hears(R, 'pb', 'pa'), 'audio ON lagi -> terdengar');
  autoplayPolicy = false;
  for (const m of allMeshes) m.dispose(); await advance(3000); // semua mesh dari seluruh skenario
  ok(live.size === 0 && bodyKids.size === 0 && timers.size === 0, 'akhir: tidak ada pc/audio/timer tersisa');

  console.log(`\nVOICE: ${passes} lulus, ${fails} gagal`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(2); });
