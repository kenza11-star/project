'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { LogOut, Hand, Backpack, RotateCcw, Flashlight, Menu, EyeOff } from 'lucide-react';
import { GameWorld, type GameCtx } from '@/lib/game/world';
import { createPlayer, type PlayerState } from '@/lib/game/inventory';
import { KEY_DEFS } from '@/lib/game/keys';
import { Flashlight as FlashState } from '@/lib/game/flashlight';
import { Stamina } from '@/lib/game/stamina';
import { AudioManager } from '@/lib/game/audio';
import { PostFx } from '@/lib/game/postfx';
import { buildEnv } from '@/lib/game/envmap';
import { setMaterialEnv } from '@/lib/game/materials';
import * as CFG from '@/lib/game/config';
import { lockLandscape } from '@/lib/game/orientation';
import { STAIR_SPEED_MUL } from '@/lib/game/stairs';
import { WakeUp, applyWakeFx, applyBlur, clearWakeFx, newWakeLast, type WakeFx } from '@/lib/game/opening';
import { MonsterView } from '@/lib/3d/monsterview';
import { MonsterSim, type PlayerObs } from '@/lib/game/monster';
import { MonsterController, type MonsterNetIO } from '@/lib/game/monsterctl';
import { DragTrail } from '@/lib/game/dragplan';
import { CaptureFx, safeWakePoint, type CaptureOut } from '@/lib/game/capturefx';
import { HeartBeat, heartFx, pulseShape, Jumpscare } from '@/lib/game/monsterfx';
import { CaptureAudio } from '@/lib/game/captureaudio';
import { ScareFx, combineSpeed } from '@/lib/game/scarefx';
import { buildSlots, liveSlots, modeLabel, type PlayerMode, type Slot } from '@/lib/game/players';
import { RemotePlayers } from '@/lib/3d/RemotePlayers';
import type { NetSession } from '@/lib/net/session';
import { WorldSync } from '@/lib/net/worldsync';
import { PauseState, pauseModeFor, frameGate, type PausePanel } from '@/lib/game/pause';
import { loadSettings, saveSettings, GFX, SENS_BASE, type Settings } from '@/lib/game/settings';
import LoadingScreen from '../ui/LoadingScreen';
import PauseMenu from './PauseMenu';

const EYE = 1.65, EYE_CROUCH = 1.0;
// FOV: tinggi (vertikal) tetap 70 seperti sebelumnya, tetapi dibatasi agar FOV horizontal tidak melebihi FOV_H_MAX
// di layar sangat lebar (18:9, 20:9) supaya tepi layar tidak melar/terdistorsi.
const FOV = 70, FOV_SPRINT = 6, FOV_H_MAX = 100;
const fovFor = (aspect: number) => {
  if (aspect <= 1) return FOV; // portrait (hanya fallback sementara): tidak diubah
  const maxV = 2 * Math.atan(Math.tan((FOV_H_MAX * Math.PI) / 360) / aspect) * 180 / Math.PI;
  return Math.min(FOV, maxV);
};

// Ikon putih sederhana (garis) untuk tombol floating
const IconRun = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="15.5" cy="4.5" r="1.9" /><path d="M13 8.5 10.5 14M13 9l4 2M13 9l-4 1.5-2 3M10.5 14l4 2.5-1 4.5M10.5 14 8 18l-3.5.5" />
  </svg>
);
const IconCrouch = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="6.5" r="1.9" /><path d="M9.5 9.2 10.5 14M10 10.5l5 1.5M10.5 14l5.5.5-.5 5.5h2.5M10.5 14 7 19l-2.5.3" />
  </svg>
);

// Game Backrooms: map dari BACKROOMS_LEVEL_0.glb. Kontrol: analog kiri (jalan), geser kanan (lihat) / WASD.
// Tombol: Senter (F), Jongkok (C), Lari (Shift, memakai stamina), Tangan (E) = interaksi dengan objek di bawah crosshair.
// `net` = sesi multiplayer online (room Supabase). Tanpa `net` (Single Player / offline) perilaku sama persis dengan sebelumnya.
// Dengan `net`: seed dunia berasal dari room, titik spawn = slot room, pemain lain dirender sebagai instance model default masing-masing,
// dan posisi lokal dikirim lewat RoomClient (timer sendiri, TIDAK dihentikan oleh menu pause).
export default function PlayScene({ roster, onExit, net }: { roster: Slot[]; onExit: () => void; net?: NetSession | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const atmRef = useRef<HTMLDivElement>(null);
  const vigRef = useRef<HTMLDivElement>(null); // vignette yang sudah ada; opening hanya mengubah variabel CSS-nya
  const [run, setRun] = useState(false);
  const [crouch, setCrouch] = useState(false);
  const [msg, setMsg] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'play' | 'escaped' | 'error' | 'dead'>('loading');
  const [deadReady, setDeadReady] = useState(false); // layar 'tertangkap' siap (solo: tombol Main lagi)
  const heartRef = useRef<HTMLDivElement>(null); const deadRef = useRef<HTMLDivElement>(null);
  const [bag, setBag] = useState(false);
  const [flOn, setFlOn] = useState(false);
  const [flLow, setFlLow] = useState(false);
  const [hideBtn, setHideBtn] = useState<null | 'in' | 'out'>(null); // tombol sembunyi muncul saat membidik locker/lemari/kasur, atau saat sedang bersembunyi
  const [hfx, setHfx] = useState<{ kind: 'locker' | 'bed'; a: number } | null>(null); // masker celah intip (alpha dikuantisasi, bukan per frame)
  // HUD yang sering berubah (persen senter, bar stamina) ditulis langsung ke DOM: tanpa render ulang React per frame
  const flTxt = useRef<HTMLSpanElement>(null);
  const stamFill = useRef<HTMLElement>(null);
  const showPct = (p: number) => { if (flTxt.current) flTxt.current.textContent = p + '%'; setFlLow(p <= CFG.FLASH_LOW_PCT); };
  const showStam = (v: number) => { if (stamFill.current) stamFill.current.style.width = v + '%'; };
  const [tired, setTired] = useState(false);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const msgT = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Satu PlayerState per slot terisi (slot kosong tidak punya state); inventory tiap pemain terpisah. Yang dikontrol di perangkat ini = players[0] (slot 0).
  // Belum ada networking: slot 'remote' hanya terdaftar & punya titik spawn, belum disimulasikan.
  const live = useRef<Slot[]>([]);
  const players = useRef<PlayerState[]>([]);
  if (!players.current.length) { live.current = liveSlots(roster); players.current = live.current.map((sl) => createPlayer(sl.id, sl.name)); }
  const worldRef = useRef<GameWorld | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const exitRef = useRef(onExit); exitRef.current = onExit;
  const fl = useRef(new FlashState());
  const stamina = useRef(new Stamina());
  const st = useRef({
    run: false, crouch: false, status: 'loading' as string,
    act: () => {}, hide: () => {}, restart: () => {}, canStand: (): boolean => true,
    resetInput: () => {}, applySettings: (_s: Settings) => {}, sens: 1, invertY: false,
  });
  // ---- Pause menu ----
  // Single Player (1 slot): menu = freeze penuh. Multiplayer (2-4 slot): menu = overlay LOKAL saja, dunia/simulasi tetap jalan (lib/game/pause.ts).
  const pz = useRef<PauseState>(null as unknown as PauseState);
  if (!pz.current) pz.current = new PauseState(pauseModeFor(roster.length));
  const [menu, setMenu] = useState<{ open: boolean; panel: PausePanel }>({ open: false, panel: 'main' });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const syncMenu = () => setMenu({ open: pz.current.open, panel: pz.current.panel });
  const afterClose = () => { st.current.resetInput(); audioRef.current?.unlock(); }; // kontrol kembali bersih; audio lanjut (solo)
  const openMenu = () => { if (st.current.status !== 'play') return; if (pz.current.show()) { st.current.resetInput(); setBag(false); syncMenu(); } };
  const closeMenu = () => { if (pz.current.hide()) { afterClose(); syncMenu(); } };
  const menuBack = () => { pz.current.back(); if (!pz.current.open) afterClose(); syncMenu(); };
  const toggleMenu = () => (pz.current.open ? closeMenu() : openMenu());
  const goPanel = (p: PausePanel) => { pz.current.go(p); syncMenu(); };
  const patchSettings = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const say = (t: string, ms = 1800) => {
    setMsg(t);
    if (msgT.current) clearTimeout(msgT.current);
    msgT.current = setTimeout(() => setMsg(''), ms);
  };
  const toggleRun = () => {
    if (pz.current.open) return; // menu terbuka: kontrol lokal tidak aktif
    if (!st.current.run && !stamina.current.canSprint()) return; // stamina habis: tidak bisa sprint
    const v = !st.current.run; st.current.run = v; setRun(v);
    if (v && st.current.crouch) { st.current.crouch = false; setCrouch(false); }
  };
  const toggleCrouch = () => {
    if (st.current.status !== 'play' || pz.current.open) return;
    const v = !st.current.crouch;
    if (!v && !st.current.canStand()) return; // tidak bisa berdiri bila ruang di sekitar terlalu sempit
    st.current.crouch = v; setCrouch(v);
    if (v && st.current.run) { st.current.run = false; setRun(false); }
  };
  const interact = () => st.current.act();
  const me = players.current[0];
  // Daftar PLAYERS di menu pause: online -> pemain remote yang benar-benar terhubung (status jujur); offline -> slot lokal seperti sebelumnya.
  const pauseRoster: Slot[] = (() => {
    if (!net) return roster;
    const peers = net.client.roster();
    const st = net.client.status;
    return buildSlots(net.maxPlayers as PlayerMode, [me.name, ...peers.map((p) => p.name)]).map((sl, i) => (
      i === 0 ? { ...sl, connection: st === 'online' ? 'ONLINE' : st === 'closed' ? 'DISCONNECTED' : 'RECONNECTING' }
        : sl.status === 'remote' ? { ...sl, connection: peers[i - 1]?.stale ? 'NO SIGNAL' : 'ONLINE' } : sl));
  })();

  const toggleFlash = (internal = false) => { // internal = dipanggil sistem (mis. otomatis mati saat bersembunyi), bukan input pemain
    if (st.current.status !== 'play' || (!internal && pz.current.open)) return;
    const f = fl.current;
    const was = f.on;
    f.toggle();
    if (!was && !f.on) { say('Battery habis. Pakai battery dari inventory.', 2200); return; }
    audioRef.current?.play('flash_click');
    setFlOn(f.on);
  };

  const useItem = (id: string) => {
    if (pz.current.open) return;
    const inv = me.inventory;
    if (id === 'soda') { if (inv.remove(id)) say('Minum Soda... segar.'); }
    else if (id === 'battery') {
      if (fl.current.full) say('Senter masih penuh.', 1500);
      else if (inv.remove(id)) { fl.current.recharge(); showPct(100); audioRef.current?.play('battery_use'); say('Battery diganti: senter 100%', 2200); }
    }
    else if (id === 'note') { const t = inv.readNote(me.noteIdx++); if (t) say(t, 5000); }
    else if (id === 'medkit') say('Medkit disimpan untuk nanti.');
    force();
  };

  useEffect(() => {
    const S = st.current;
    const canvas = cv.current!;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = CFG.EXPOSURE_BASE;
    let post: PostFx | null = null, envH: { tex: THREE.Texture; dispose: () => void } | null = null; // pipeline: scene -> RT (HalfFloat) -> 1 pass grading+tonemap -> layar
    try { if (CFG.POSTFX) post = new PostFx(r); } catch (e) { console.warn('postfx off', e); post = null; }
    try { envH = buildEnv(r); setMaterialEnv(envH.tex); } catch (e) { console.warn('env off', e); envH = null; setMaterialEnv(null); }
    if (CFG.SHADOWS) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; } // bayangan lembut; autoUpdate hanya saat senter ON
    // highlight lampu tidak 'meledak' kuning, bayangan lebih pekat (tanpa biaya per-frame)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CFG.FOG_COLOR); scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY); // gelap netral-kehijauan tipis, bukan kuning
    const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 45); cam.rotation.order = 'YXZ'; scene.add(cam);
    // ambient kecil: area tanpa lampu benar-benar gelap, area berlampu terang dari lampu map (bukan dari cahaya palsu di kamera)
    const hemi = new THREE.HemisphereLight(0xb8b49c, 0x07060a, CFG.AMBIENT); scene.add(hemi);
    // senter: satu SpotLight mengikuti POV (tanpa shadow, ringan untuk HP). Intensitas 0 saat OFF (tidak menambah/menghapus light -> tanpa recompile shader)
    const spot = new THREE.SpotLight(0xfff0c8, 0, CFG.FLASH_DISTANCE, CFG.FLASH_ANGLE, 0.75, 2);
    if (CFG.SHADOWS) { spot.castShadow = true; spot.shadow.mapSize.set(CFG.SHADOW_MAP, CFG.SHADOW_MAP); spot.shadow.camera.near = 0.15; spot.shadow.camera.far = Math.min(CFG.FLASH_DISTANCE, 12); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.03; spot.shadow.radius = 3; }
    spot.position.set(0.1, -0.08, 0); cam.add(spot);
    const aim = new THREE.Object3D(); aim.position.set(0, 0, -6); cam.add(aim); spot.target = aim;

    // debu melayang: satu Points kecil di sekitar kamera (1 draw call), tanpa asset
    const dN = CFG.DUST_COUNT, dPos = new Float32Array(dN * 3), dVel = new Float32Array(dN * 3);
    for (let i = 0; i < dN; i++) { dPos[i * 3] = (Math.random() - 0.5) * 7; dPos[i * 3 + 1] = (Math.random() - 0.5) * 3; dPos[i * 3 + 2] = -Math.random() * 6; dVel[i * 3] = (Math.random() - 0.5) * 0.05; dVel[i * 3 + 1] = -0.01 - Math.random() * 0.03; dVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05; }
    const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    const dMat = new THREE.PointsMaterial({ color: 0xe8d8a0, size: 0.025, transparent: true, opacity: 0.28, depthWrite: false, sizeAttenuation: true });
    const dust = new THREE.Points(dGeo, dMat); dust.frustumCulled = false; cam.add(dust);

    // film grain: tile noise 96px dibuat sekali -> CSS variable (tanpa asset, tanpa pass render)
    if (post && atmRef.current) atmRef.current.style.display = 'none'; // grading/grain/vignette sudah di post-process
    else if (CFG.ATMOS_ENABLED && atmRef.current) {
      try {
        const gc = document.createElement('canvas'); gc.width = gc.height = 96; const g2 = gc.getContext('2d');
        if (g2) { const im = g2.createImageData(96, 96); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = v; im.data[i + 2] = v * 0.9; im.data[i + 3] = 255; } g2.putImageData(im, 0, 0); atmRef.current.style.setProperty('--grain', `url(${gc.toDataURL('image/png')})`); atmRef.current.style.setProperty('--grain-o', String(CFG.GRAIN_OPACITY)); }
      } catch { /* tanpa grain bila canvas 2D tidak tersedia */ }
    }

    void lockLandscape(false); // cadangan: Lobby sudah mencoba lock + fullscreen saat klik Play; di sini tanpa fullscreen
    const audio = new AudioManager(); audioRef.current = audio; audio.init();
    const remotes = net ? new RemotePlayers(scene) : null; // pemain lain (instance model default per pemain)
    const offNet = net ? net.client.onChange(() => force()) : null; // HUD/daftar pemain ikut berubah saat ada yang masuk/keluar/reconnect
    let netGait: 0 | 1 | 2 = 0;
    // Sinkronisasi state dunia (pintu, benda, gembok, container): lihat lib/net/worldsync.ts. Event lokal dikirim; digest berkala menutup paket hilang / pemain terlambat.
    const wsync = net ? new WorldSync() : null;
    let netLive = false; // dunia siap (startRun selesai): event masuk sebelum itu diabaikan TANPA digabung, jadi digest berikutnya tetap membawanya
    const offWorld = net && wsync ? net.client.onWorld((_from, raw) => { const w = world; if (!netLive || !w) return; for (const e of wsync.receive(raw)) w.applyNet(e); }) : null;
    let lastPeers = 0, digestN = 0;
    const digestTimer = net && wsync ? setInterval(() => {
      const pc = net.client.peerCount(); digestN++;
      if (netLive && (pc > lastPeers || digestN % 4 === 0)) { const d = wsync.digest(); if (d) net.client.sendWorld(d); } // segera saat ada pemain baru, selain itu tiap 4 dtk
      lastPeers = pc;
    }, 1000) : null;
    const player = me;
    const ctx: GameCtx = { player, say, changed: () => force() };
    let world: GameWorld | null = null;
    let cancelled = false;
    const pos = { yaw: 0, pitch: 0 };
    // ---- opening bangun setelah pingsan: sekali saat pertama masuk game (bukan saat 'Main lagi') ----
    let wake: WakeUp | null = null, opened = false, wakeLook = 1;
    const wakeEl = { canvas: canvas as HTMLElement, get vignette(): HTMLElement | null { return vigRef.current; } };
    const wakeLast = newWakeLast();
    // jumpscare SCP-106: slow tepat 1,5 dtk + blur halus; satu efek aktif sekali (tidak menumpuk)
    const scareFx = new ScareFx({ slowSeconds: CFG.SCARE_SLOW_SECONDS, slowMul: CFG.SCARE_SLOW_MUL, blurPx: CFG.SCARE_BLUR_PX, blurIn: CFG.SCARE_BLUR_IN, blurOut: CFG.SCARE_BLUR_OUT });

    // ---- monster (lantai atas): kontroler (otoritas/replika) + tampilan 3D + detak jantung + jumpscare ----
    let mview: MonsterView | null = null, mctl: MonsterController | null = null, js: Jumpscare | null = null, respawnIn = 0, jsFrame: ReturnType<Jumpscare['update']> | null = null;
    const heartBeat = new HeartBeat(); let monStep = 0, monVig = -1;
    // TAHAP 4 -- audio tangkapan spasial: dijadwalkan dari MonsterController.onCatch (semua klien, sekali per kejadian), diputar per frame di monsterFrame (tanpa timer).
    const capAudio = new CaptureAudio();
    // TAHAP 2 -- Monster Drag. 'wait' = jumpscare selesai, menunggu monster mulai menyeret; 'moving' = sedang diseret (mengikuti jejak monster);
    // 'held' = sampai di tujuan dan TETAP tertangkap (status 'dead', kontrol mati) sampai transisi bangun (TAHAP 3). 'none' = alur lama (respawn).
    let dragMode: 'none' | 'wait' | 'moving' | 'held' = 'none', dragWait = 0; const dragTrail = new DragTrail();
    // TAHAP 3 -- Capture POV (hanya korban: dipicu onCatchSelf, tidak ada pesan/state gelap yang dikirim ke pemain lain). Tanpa setTimeout: semua waktu dihitung per frame.
    let capture: CaptureFx | null = null, capOut: CaptureOut | null = null, capWake = false, capBlack = -1, capMuffle = -1;
    const jsReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const monSelf = net ? net.client.selfId : 'me';
    const monIO: MonsterNetIO | null = net ? { selfId: net.client.selfId, selfSlot: net.slot, peers: () => net.client.roster().map((r) => ({ id: r.id, slot: r.slot, online: !r.stale })), send: (m) => { net.client.sendMonster(m); }, onMessage: (fn) => net.client.onMonster(fn) } : null;
    const gaitName = (g: number) => (g === 2 ? 'run' : g === 1 ? 'walk' : 'idle');
    const setDeadScreen = (a: number, text: boolean) => { const el = deadRef.current; if (!el) return; el.style.opacity = a >= 1 ? '1' : a <= 0 ? '0' : a.toFixed(3); el.classList.toggle('show', text); };
    const setCaptureBlack = (b: number) => { const q = Math.round(b * 100) / 100; if (q !== capBlack) { capBlack = q; setDeadScreen(q, false); } };   // hanya opacity overlay (compositor), ditulis bila berubah
    /** Batalkan/bersihkan seluruh efek capture (restart, respawn, unmount): overlay, peredam audio, dan WakeUp milik capture. WakeUp opening tidak disentuh. */
    const resetCapture = () => {
      capture?.cancel(); capture = null; capOut = null; capBlack = -1;
      if (capWake) { wake = null; wakeLook = 1; clearWakeFx(wakeEl, wakeLast); audio.setMuffle(0); capWake = false; }
      else if (capMuffle > 0 && !wake) audio.setMuffle(0);
      capMuffle = -1;
    };
    const beginCapture = () => { capture = new CaptureFx({ openSeconds: CFG.CAPTURE_OPEN_SECONDS, darkenSeconds: CFG.CAPTURE_DARKEN_SECONDS, darkenMax: CFG.CAPTURE_DARKEN_MAX, settleSeconds: CFG.CAPTURE_SETTLE_SECONDS, holdSeconds: CFG.CAPTURE_HOLD_SECONDS, maxDragSeconds: CFG.MONSTER_DRAG_MAX_SECONDS + CFG.MONSTER_DRAG_WAIT + 5, reduced: jsReduced }); capture.start(); capOut = capture.update(0); setCaptureBlack(capOut.black); };
    /** Hold selesai: kontrol & state pemain dipulihkan, lalu bangun (WakeUp dari opening: fade-in, blur/vignette turun, suara jernih). Posisi tetap di ruangan tujuan. */
    const wakeFromCapture = () => {
      if (!world || S.status !== 'dead') { resetCapture(); return; }
      const w = world, pt = safeWakePoint((x, z) => w.cw.blocked(x, z, CFG.PLAYER_RADIUS, player.level), player.x, player.z, 3);   // furnitur bergeser saat gelap: jangan bangun di dalam benda
      if (pt) { player.x = pt.x; player.z = pt.z; }
      capture = null; capOut = null; capBlack = -1; capMuffle = -1; dragMode = 'none'; dragWait = 0; dragTrail.clear();
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stamina.current.reset(); pos.pitch = 0; S.resetInput?.();
      wake = new WakeUp({ duration: CFG.CAPTURE_WAKE_SECONDS, maxBlur: CFG.CAPTURE_WAKE_BLUR, reduced: jsReduced, seed: Math.floor(Math.random() * 1e6) }); capWake = true;
      applyWakeFx(wakeEl, wake.peek(), wakeLast);   // kanvas sudah hampir hitam SEBELUM overlay dilepas: tanpa kedip
      setDeadScreen(0, false); setDeadReady(false);
      S.status = 'play'; setStatus('play'); force();   // kebal CAPTURE_GRACE dihitung otoritas saat flag 'tertangkap' hilang (monsterctl.trackWake)
    };
    const setupMonster = (seed: number) => {
      capAudio.clear(); mctl?.dispose(); mctl = null; js = null; jsFrame = null; respawnIn = 0; monStep = 0; dragMode = 'none'; dragWait = 0; dragTrail.clear(); mview?.endGrab(); setDeadScreen(0, false); setDeadReady(false);
      if (!CFG.MONSTER_ENABLED || !world || !mview || !mview.ready) return;
      const nav = world.buildMonsterNav(), top = world.stairTop(); if (!nav || !top) return;   // lantai atas tidak terjangkau: tanpa monster
      const w = world;
      const lo = CFG.MONSTER_TWO_FLOORS ? w.buildMonsterNavLower() : null, st = w.stair;   // dua lantai: lantai bawah + tangga (null -> hanya lantai atas)
      const multi = lo && st ? { navLo: lo, stair: st } : undefined;
      mctl = new MonsterController(() => new MonsterSim(nav, w.cw, CFG.MONSTER_LEVEL, seed, w.monsterEnv, top, multi, w.dragEnv()), monIO, () => performance.now());
      mctl.onCatchSelf = (drag) => startJumpscare(drag);
      mctl.onCatch = (ev) => { capAudio.accept(ev, monSelf, { x: player.x, z: player.z, level: player.level }); };   // posisi pendengar = pemain lokal saat kejadian diterima
    };
    /** Tertangkap: kontrol berhenti (status 'dead'), kamera -> monster, tangan menjangkau & menutupi, teriakan, lalu mati/respawn. Dipanggil sekali per tangkapan. */
    const startJumpscare = (drag = false) => {
      if (js || !mview || !mview.ready || !world || S.status !== 'play') return;
      js = new Jumpscare(jsReduced); jsFrame = null; mview.beginGrab(); respawnIn = 0;
      dragMode = drag ? 'wait' : 'none'; dragWait = 0; dragTrail.clear(); // drag: otoritas monster sudah memilih ruangan tujuan; alur lama (respawn) bila tidak ada
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stick.id = -1; stick.vx = stick.vy = 0; look.id = -1;
      S.status = 'dead'; setStatus('dead'); setBag(false);
      world.abortHide(); // tertangkap: slot loker (bila sedang bersembunyi) dibebaskan di server
    };
    const endJumpscare = () => {
      js = null; jsFrame = null; mview?.endGrab();
      if (dragMode !== 'none' && CFG.CAPTURE_POV_ENABLED) { dragWait = 0; beginCapture(); return; }   // TAHAP 3: tanpa teks; layar terbuka lalu perlahan gelap selama diseret
      setDeadScreen(1, true);
      if (dragMode !== 'none') { dragWait = 0; return; }   // akan diseret: tidak respawn; tetap tertangkap sampai transisi bangun (TAHAP 3)
      if (net) respawnIn = 1.6; else setDeadReady(true);   // online: respawn otomatis (dunia/room tetap); solo: tombol Main lagi (restart seperti layar escaped)
    };
    /** Seretan selesai (atau tak pernah dimulai): pemain TETAP tertangkap di posisinya. TAHAP 3 menghubungkan transisi bangun di sini. Solo: tombol Main lagi tetap tersedia. */
    const dragArrived = () => { if (dragMode === 'held') return; dragMode = 'held'; dragTrail.clear(); if (capture) capture.arrive(); else if (!net) setDeadReady(true); };
    const respawnLocal = () => {
      if (!world) return; resetCapture(); dragMode = 'none'; const spawns = world.spawnPoints(roster.map((sl) => sl.offset)), pt = spawns[net ? net.slot : 0] || world.spawn;
      player.level = 0; player.y = 0; player.onStairs = false; player.x = pt.x; player.z = pt.z; pos.yaw = world.spawn.yaw; pos.pitch = 0;
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stamina.current.reset();
      S.status = 'play'; setStatus('play'); setDeadScreen(0, false); // kebal ~16 dtk dihitung otoritas (monsterctl.GRACE_AFTER_CATCH)
    };

    const beginRun = () => {
      if (!world) return;
      resetCapture(); scareFx.reset(); applyBlur(wakeEl, 0, wakeLast);
      const runInfo = world.startRun(net ? net.seed : undefined); // seed baru tiap mulai / restart (kecuali MAP_SEED diset); online: seed room supaya layout sama untuk semua pemain
      if (net && wsync) { wsync.reset(); world.netSink = (e) => { const m = wsync.local(e); if (m) net.client.sendWorld(m); }; netLive = true; }
      const spawns = world.spawnPoints(roster.map((sl) => sl.offset)); // slot 0 = titik spawn asli (tidak berubah); slot lain di sekitarnya, bebas collision
      players.current.forEach((p, i) => {
        const pt = spawns[net ? net.slot : live.current[i].index] || world!.spawn;
        p.inventory.clear(); p.inventory.add('battery', CFG.START_BATTERIES); // battery awal di inventory
        p.level = 0; p.y = 0; p.onStairs = false; p.noteIdx = 0; p.x = pt.x; p.z = pt.z; p.yaw = world!.spawn.yaw; p.pitch = 0;
      });
      fl.current.reset(); stamina.current.reset();
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); setFlOn(false); showPct(100); showStam(100); setTired(false);
      pos.yaw = world.spawn.yaw; pos.pitch = 0;
      if (CFG.OPENING_ENABLED && !opened) {
        opened = true;
        wake = new WakeUp({ duration: CFG.OPENING_SECONDS, maxBlur: CFG.OPENING_BLUR_PX, reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, seed: Math.floor(Math.random() * 1e6) });
        applyWakeFx(wakeEl, wake.peek(), wakeLast); // layar sudah hampir hitam sebelum game tampil
      }
      if (pz.current.hide()) syncMenu(); // restart tidak pernah mewarisi menu terbuka
      setupMonster(runInfo.seed); // monster lantai atas untuk run ini (kontroler baru, jumpscare/respawn direset)
      S.status = 'play'; setStatus('play'); setBag(false); force();
    };
    S.restart = beginRun;
    S.canStand = () => !world || world.canStand(player);
    S.hide = () => {
      if (S.status !== 'play' || pz.current.open || !world) return;
      if (!world.hiding) { world.ix.refresh(cam, ctx); if (world.interactBlocked(player)) { say('Tidak terjangkau', 900); return; } }
      if (!world.tryHide(player, say)) say('Tidak ada tempat sembunyi', 1000);
    };
    S.act = () => {
      if (S.status !== 'play' || pz.current.open || !world) return;
      if (world.hiding) { world.tryHide(player, say); return; } // saat bersembunyi, tombol interaksi = keluar
      world.ix.refresh(cam, ctx); // target terbaru tepat saat tombol ditekan
      if (world.interactBlocked(player)) { say('Tidak terjangkau', 900); return; } // tidak boleh menembus dinding
      if (!world.ix.activate(ctx)) say('Tidak ada yang bisa dilakukan', 1000);
    };

    const mvP = CFG.MONSTER_ENABLED ? MonsterView.load(scene, CFG.MONSTER_URL) : Promise.resolve(null); // model monster dimuat paralel dengan map; gagal -> game tanpa monster
    GameWorld.load(scene, () => { /* layar Loading hanya tampil sampai map selesai; tanpa persentase */ })
      .then(async (w) => {
        const mv = await mvP;
        if (cancelled) { w.dispose(); mv?.dispose(); return; }
        world = w; worldRef.current = w; w.audio = audio; w.onScare = () => { scareFx.trigger(); }; mview = mv;
        // Loker/lemari online: server memutuskan 1 pemain per loker (lib/net/lockers.ts). Single Player: gate null -> sembunyi lokal seperti sebelumnya.
        if (net) { const lk = net.lockers; w.lockerNet = { selfId: net.client.selfId, ownerOf: (k) => lk.ownerOf(k), keyOf: (u) => lk.keyOf(u), claim: (k) => lk.claim(k), release: (k) => lk.release(k), hold: (k, f) => lk.hold(k, f), stopHold: () => lk.stopHold(), alive: () => S.status === 'play' }; }
        beginRun();
      })
      .catch((e) => { console.error(e); if (!cancelled) { S.status = 'error'; setStatus('error'); } });

    const keys: Record<string, boolean> = {};
    const kd = (e: KeyboardEvent) => {
      if (!pz.current.frozen) audio.unlock(); // pause solo: audio tetap diam
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') { // saat bermain: buka/tutup menu (sub-panel -> kembali). Di luar status bermain: keluar seperti sebelumnya.
        if (S.status === 'play') { if (!e.repeat) { if (pz.current.open) menuBack(); else openMenu(); } } else exitRef.current();
        return;
      }
      if (pz.current.open) return; // menu terbuka: tombol gameplay diabaikan
      keys[key] = true;
      if (e.repeat) return;
      if (key === 'c') toggleCrouch();
      if (key === 'e') S.act();
      if (key === 'h') S.hide();
      if (key === 'f') toggleFlash();
      if (key === 'i') setBag((b) => !b);
    };
    const ku = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };
    const blur = () => { for (const k in keys) keys[k] = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    const vis = () => { if (document.hidden) { blur(); audio.suspend(); } else if (!pz.current.frozen) audio.unlock(); }; // app/tab di background: audio diam, tombol tidak 'nyangkut'
    document.addEventListener('visibilitychange', vis);
    const view = { w: 1, h: 1 }; let fov = FOV, baseFov = FOV;
    const stick = { id: -1, x: 0, y: 0, vx: 0, vy: 0 }; const look = { id: -1, x: 0, y: 0 };
    // Fallback landscape (.rotfix = UI diputar 90deg lewat CSS): petakan koordinat layar -> koordinat lokal yang sudah diputar
    const pt = (e: PointerEvent) => document.documentElement.classList.contains('rotfix')
      ? { x: e.clientY, y: document.documentElement.clientWidth - e.clientX }
      : { x: e.clientX, y: e.clientY };
    const pd = (e: PointerEvent) => {
      if (pz.current.open) return; // menu terbuka: sentuhan tidak masuk ke gameplay
      audio.unlock(); // browser mewajibkan gesture sebelum audio boleh bunyi
      try { canvas.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
      const p = pt(e);
      if (p.x < view.w / 2 && stick.id < 0) {
        stick.id = e.pointerId; stick.x = p.x; stick.y = p.y;
        const b = baseRef.current!;
        b.style.display = 'block'; b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      } else if (look.id < 0) { look.id = e.pointerId; look.x = p.x; look.y = p.y; }
    };
    const pm = (e: PointerEvent) => {
      if (S.status === 'dead') return; // tertangkap: kontrol berhenti (menoleh pun terkunci)
      const p = pt(e);
      if (e.pointerId === stick.id) {
        const R = 50;
        let dx = p.x - stick.x, dy = p.y - stick.y;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        stick.vx = dx / R; stick.vy = dy / R;
        knobRef.current!.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (e.pointerId === look.id) {
        const sn = SENS_BASE * S.sens * wakeLook; // sensitivitas dari OPTIONS (1.0 = nilai asli)
        pos.yaw -= (p.x - look.x) * sn;
        pos.pitch = Math.max(-1.2, Math.min(1.2, pos.pitch - (p.y - look.y) * sn * (S.invertY ? -1 : 1)));
        look.x = p.x; look.y = p.y;
      }
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerId === stick.id) {
        stick.id = -1; stick.vx = stick.vy = 0;
        baseRef.current!.style.display = 'none';
        knobRef.current!.style.transform = '';
      }
      if (e.pointerId === look.id) look.id = -1;
    };
    S.resetInput = () => { // dipanggil saat menu dibuka/ditutup: tidak ada tombol/stick yang 'nyangkut'
      for (const k in keys) keys[k] = false;
      stick.id = -1; stick.vx = stick.vy = 0; look.id = -1;
      if (baseRef.current) baseRef.current.style.display = 'none';
      if (knobRef.current) knobRef.current.style.transform = '';
    };
    canvas.addEventListener('pointerdown', pd); canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerup', pu); canvas.addEventListener('pointercancel', pu);
    // Ukuran area game diambil dari container (bukan angka window yang bisa basah saat rotasi). Idempoten: tidak melakukan apa-apa bila ukuran sama.
    const resize = () => {
      // clientWidth/Height = ukuran layout (tidak ikut berubah oleh transform rotate fallback, beda dengan getBoundingClientRect)
      const host = canvas.parentElement;
      const w = Math.max(1, Math.round(host && host.clientWidth ? host.clientWidth : window.innerWidth));
      const h = Math.max(1, Math.round(host && host.clientHeight ? host.clientHeight : window.innerHeight));
      if (w === view.w && h === view.h) return;
      view.w = w; view.h = h;
      r.setSize(w, h, false); post?.resize(r);
      cam.aspect = w / h;
      baseFov = fovFor(cam.aspect); fov = baseFov; cam.fov = fov; // FOV mengikuti aspect ratio, tanpa stretch
      cam.updateProjectionMatrix();
    };
    // Beberapa browser Android melaporkan ukuran lama tepat saat orientationchange: cek ulang beberapa kali setelahnya.
    const orientTimers: ReturnType<typeof setTimeout>[] = [];
    const onOrient = () => { resize(); [120, 350, 800].forEach((ms) => orientTimers.push(setTimeout(resize, ms))); };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas.parentElement ?? canvas);
    window.addEventListener('resize', resize); window.addEventListener('orientationchange', onOrient);
    window.visualViewport?.addEventListener('resize', resize);
    screen.orientation?.addEventListener?.('change', onOrient);

    let raf = 0, last = performance.now(), eye = EYE, bobT = 0, lastPrompt: string | null = null;
    let shadowOn = CFG.SHADOWS, shF = 0; const shP = new THREE.Vector3(), shQ = new THREE.Quaternion();
    let pr = Math.min(window.devicePixelRatio || 1, 1.25), fpsT = 0, fpsN = 0; // resolusi adaptif: turun otomatis bila FPS rendah
    let wasHiding = false, hideFlash = false, lastHide: null | 'in' | 'out' = null, lastFxA = 0, lastFxK: 'locker' | 'bed' | null = null, hbT = 0, panT = 0, swayT = 0, paused = false, creakCd = 0, stride = 1.05, idleT = 0, stepAcc = 0, flickT = 0, flickR = 1, lastFl = 100, lastStam = 100, lastTired = false;
    let prMax = Math.min(window.devicePixelRatio || 1, 1.25), lastGfx = '';
    S.applySettings = (cfg: Settings) => {
      S.sens = cfg.sens; S.invertY = cfg.invertY; audio.setVolume(cfg.volume);
      if (cfg.gfx === lastGfx) return; // volume/sensitivitas tidak mengganggu skala resolusi adaptif
      lastGfx = cfg.gfx;
      const g = GFX[cfg.gfx];
      prMax = Math.min(window.devicePixelRatio || 1, g.prMax); pr = prMax;
      r.setPixelRatio(pr); r.setSize(view.w, view.h, false); post?.resize(r);
      shadowOn = CFG.SHADOWS && g.shadows; spot.castShadow = shadowOn;
    };
    const _hp = new THREE.Vector3();
    /** Logika monster per frame: otoritas/replika, bahaya -> detak jantung + HUD + vignette, model 3D, langkah, jumpscare, respawn. */
    const monsterFrame = (dt: number, simulate: boolean) => {
      for (const c of capAudio.update(dt)) audio.play(c.name, { pos: c.pos, vol: c.vol });   // TAHAP 4: teriakan/benturan tangkapan di lokasi kejadian (3D, falloff jarak)
      const he = heartRef.current;
      if (!world || !mctl || !mview || !mview.ready) { if (he && he.style.opacity !== '0') he.style.opacity = '0'; return; }
      const live = (S.status === 'play' && simulate) || S.status === 'dead';   // pause solo membekukan monster; saat 'dead' otoritas tetap berjalan
      const v = mctl.view, lvY = world.monsterFloorY(v.level, v.onStairs, v.x);   // tinggi lantai di bawah monster (lantai 1/2 atau anak tangga)
      const selfObs: PlayerObs = { id: monSelf, x: player.x, z: player.z, level: player.level, gait: gaitName(netGait), crouch: S.crouch, hidden: !!world.hiding, grace: 0, stairs: player.onStairs, caught: S.status === 'dead' };
      if (live) {
        const rem: PlayerObs[] = net ? net.client.sample().map((rv) => ({ id: rv.id, x: rv.state.x, z: rv.state.z, level: rv.state.level, gait: gaitName(rv.state.gait), crouch: !!rv.state.crouch, hidden: !!rv.state.hide, grace: 0, caught: !!rv.state.cg, stairs: rv.state.y > CFG.LEVEL_Y[0] + 0.2 && rv.state.y < CFG.LEVEL_Y[1] - 0.2 })) : [];
        mctl.update(dt, selfObs, rem);
      }
      // ---- seretan (TAHAP 2): kontrol sudah mati (status 'dead'); korban mengikuti jejak monster, bukan teleport ke tujuan ----
      if (dragMode !== 'none' && dragMode !== 'held' && S.status === 'dead' && !js) {
        const mine = v.active && v.state === 'drag' && v.targetId === monSelf;
        if (dragMode === 'wait') {
          dragWait += dt;
          if (mine) { dragMode = 'moving'; dragTrail.seed(player.x, player.z); }
          else if (dragWait >= CFG.MONSTER_DRAG_WAIT) dragArrived();   // seretan tak pernah dimulai (otoritas hilang): tetap tertangkap di tempat
        }
        if (dragMode === 'moving') {
          if (mine) {
            dragTrail.push(v.x, v.z);
            const b = dragTrail.behind();
            // titik jejak = jalur yang pernah dilewati monster, jadi aman; tetap divalidasi (furnitur bisa bergeser) dengan cadangan: posisi monster
            if (b && !world.cw.blocked(b.x, b.z, CFG.PLAYER_RADIUS, player.level)) { player.x = b.x; player.z = b.z; }
            else if (!world.cw.blocked(v.x, v.z, CFG.PLAYER_RADIUS, player.level)) { player.x = v.x; player.z = v.z; }
            pos.yaw = v.yaw; pos.pitch = 0;   // menghadap monster yang menariknya (model remote menghadap yaw + 180 derajat)
          } else dragArrived();
        }
      }
      // ---- bahaya -> detak jantung (suara + HUD berdenyut/bergetar) + vignette merah bertahap ----
      const dang = S.status === 'play' && simulate ? mctl.dangerFor(selfObs) : 0, fx = heartFx(dang);
      if (heartBeat.update(dt, dang)) audio.play('heartbeat', { vol: fx.volume * 0.9, rate: 0.92 + 0.25 * dang });
      if (he) {
        if (dang > 0.02) { const tt = performance.now() * 0.001, sh = fx.shake * (jsReduced ? 0.3 : 1); he.style.opacity = String(Math.min(1, 0.3 + dang)); he.style.setProperty('--hs', (1 + fx.amp * pulseShape(heartBeat.phase)).toFixed(3)); he.style.setProperty('--hx', (Math.sin(tt * 47) * sh).toFixed(2) + 'px'); he.style.setProperty('--hy', (Math.cos(tt * 53) * sh).toFixed(2) + 'px'); }
        else if (he.style.opacity !== '0') he.style.opacity = '0';
      }
      const vEl = vigRef.current;
      if (vEl && !wake) { const q = Math.round(dang * 50); if (q !== monVig) { monVig = q; if (q === 0) { vEl.style.removeProperty('--vg'); vEl.style.removeProperty('--vs'); vEl.style.removeProperty('--vr'); } else { vEl.style.setProperty('--vg', fx.vig.toFixed(2)); vEl.style.setProperty('--vs', fx.vigStart.toFixed(1) + '%'); vEl.style.setProperty('--vr', String(fx.red)); } } }
      // ---- model 3D: hanya digambar/dianimasikan di dekat pemain (HP) ----
      const d = Math.hypot(v.x - player.x, v.z - player.z), show = v.active && !v.stale && d < CFG.MONSTER_VIEW_RANGE && (player.level === v.level || player.onStairs || v.onStairs || d < 9);
      if (!js) { mview.place(v.x, lvY, v.z, v.yaw); mview.setAnim(v.anim, 0.25, v.speed); }
      mview.update(dt, show || !!js);
      if (live && v.active && !v.stale && d < 30 && v.speed > 0.3) { // langkah berat monster (posisional, 1 sumber, mengikuti kecepatan)
        monStep += dt; const iv = v.anim === 'run' ? 0.36 : 0.8;
        if (monStep >= iv) { monStep = 0; audio.play('entity_steps', { pos: { x: v.x, y: lvY + 0.3, z: v.z }, vol: v.anim === 'run' ? 1 : 0.75, rate: v.anim === 'run' ? 1.12 : 0.92 }); }
      }
      // ---- jumpscare & respawn ----
      if (js) {
        const f = js.update(dt); jsFrame = f;
        if (!CFG.CAPTURE_AUDIO_ENABLED) for (const c of f.cues) audio.play(c.name === 'scream' ? 'monster_scream' : 'impact_slam', { vol: c.name === 'scream' ? 1 : 0.7 });   // perilaku lama; bila aktif, suara datang dari capAudio (korban + pemain lain, spasial, sekali)
        setDeadScreen(f.black, f.black > 0.9);
        if (f.done) endJumpscare();
      } else if (respawnIn > 0 && (respawnIn -= dt) <= 0) respawnLocal();
    };
    /** Kamera jumpscare: menoleh ke wajah monster, tangannya menjangkau & menutupi kamera, getar/miring/FOV punch (menimpa kamera normal). */
    const monsterCam = (dt: number) => {
      const f = jsFrame; if (!js || !f || !mview || !world) return;
      const wr = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      mview.headPos(_hp); const dx = _hp.x - cam.position.x, dy = _hp.y - cam.position.y, dz = _hp.z - cam.position.z, hd = Math.hypot(dx, dz) || 1;
      const yaw = pos.yaw + wr(Math.atan2(-dx, -dz) - pos.yaw) * f.lookW, pitch = pos.pitch + (Math.atan2(dy, hd) - pos.pitch) * f.lookW;
      cam.rotation.set(pitch + f.shakeY, yaw + f.shakeX, f.roll); cam.updateMatrixWorld(true);
      const tf = fov + f.fovAdd; if (Math.abs(cam.fov - tf) > 0.05) { cam.fov = tf; cam.updateProjectionMatrix(); }
      mview.placeForJumpscare(cam, yaw, player.y, f);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, yaw, dt);
    };
    const draw = (t: number) => { if (post) post.render(r, scene, cam, t * 0.001); else r.render(scene, cam); };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      fpsT += dt; fpsN++;
      if (fpsT >= 2) {
        const avg = fpsT / fpsN; fpsT = 0; fpsN = 0;
        if (avg > 0.025 && pr > 0.7) { pr = Math.max(0.7, pr - 0.15); r.setPixelRatio(pr); r.setSize(view.w, view.h, false); post?.resize(r); }
        else if (avg > 0.028 && pr <= 0.7 && shadowOn) { shadowOn = false; spot.castShadow = false; }
        else if (avg > 0.03 && pr <= 0.7 && !shadowOn && post) { post.dispose(); post = null; } // terakhir: lepas post-process bila masih berat // resolusi sudah minimum tapi masih berat: matikan shadow pass (sekali, atmosfer tetap)
        else if (avg < 0.0185 && pr < prMax) { pr = Math.min(prMax, pr + 0.1); r.setPixelRatio(pr); r.setSize(view.w, view.h, false); post?.resize(r); }
      }
      if (!world || S.status === 'loading' || S.status === 'error') { draw(t); return; }
      if (S.status !== 'play' && pz.current.open) { pz.current.hide(); syncMenu(); } // status berubah (escaped/error): menu tidak boleh tertinggal
      const gate = frameGate(S.status, pz.current.open, pz.current.mode);
      const playing = S.status === 'play';
      if (net && remotes) {
        // Multiplayer: dijalankan SEBELUM gerbang pause dan tidak bergantung pada menu. Posisi kita tetap dikirim dan pemain lain tetap digambar/diperbarui
        // walau menu lokal terbuka (menu multiplayer hanya overlay lokal).
        remotes.update(dt, net.client.sample(), (id) => world!.occupantVisible(id)); // penghuni loker terlihat bila pintu lokernya terbuka
        const caught = S.status === 'dead';   // tertangkap/diseret: posisi tetap dikirim agar pemain lain melihat korban dibawa monster; cg = jangan ditangkap lagi
        if (playing || caught) net.client.setLocal({ x: player.x, y: player.y, z: player.z, yaw: pos.yaw, pitch: pos.pitch, gait: caught ? (dragMode === 'moving' ? 1 : 0) : netGait, crouch: S.crouch || caught, hide: !!world.hiding, ...(caught ? { cg: true } : {}), level: player.level, model: 'default' });
      }
      if (paused !== gate.muteAudio) { paused = gate.muteAudio; if (S.status === 'play') { if (paused) audio.suspend(); else audio.unlock(); } } // audio diam hanya saat pause solo (freeze)
      // PAUSE SOLO: seluruh simulasi berhenti (world.update: musuh/SCP/event/timer/pintu/lampu, gerak, senter, stamina, opening/scare fx).
      // Hanya render ulang frame terakhir; `last` tetap diperbarui di atas sehingga tidak ada lonjakan dt saat RESUME.
      if (playing && !gate.simulate) { draw(t); return; }
      const inputOn = gate.input; // multiplayer overlay: simulasi jalan terus, tetapi input lokal mati
      // opening: waktu hanya maju saat game berjalan (dijeda = ikut berhenti)
      let wk: WakeFx | null = null;
      const sf = scareFx.update(playing ? dt : 0); // waktu efek hanya maju saat game berjalan
      if (wake && playing) {
        const o = wake.update(dt);
        applyWakeFx(wakeEl, o, wakeLast, sf.blur);
        audio.setMuffle(o.muffle);
        for (const q of o.cues) audio.play(q.name, { vol: q.vol, rate: q.rate }); // napas/detak jantung pelan lewat sfx yang sudah ada
        if (o.done) { wake = null; wakeLook = 1; capWake = false; clearWakeFx(wakeEl, wakeLast); audio.setMuffle(0); } else { wk = o; wakeLook = o.look; }
      }
      if (!wake) applyBlur(wakeEl, sf.blur, wakeLast);
      let fwd = inputOn ? -stick.vy + (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0) : 0;
      let str = inputOn ? stick.vx + (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0) : 0;
      const hiding = playing && world.hiding;
      if (hiding) { fwd = 0; str = 0; if (S.run) { S.run = false; setRun(false); } }
      const mag = Math.hypot(fwd, str);
      if (mag > 1) { fwd /= mag; str /= mag; }
      const moving = mag > 0.05;

      // ---- sprint & stamina ----
      if (S.run && !moving && (idleT += dt) > 0.35) { S.run = false; setRun(false); } else if (moving) idleT = 0; // sprint otomatis lepas saat berhenti
      const wantRun = (S.run || keys['shift']) && !S.crouch && fwd > 0.1 && moving;
      const running = playing && wantRun && stamina.current.canSprint();
      netGait = !moving ? 0 : running ? 2 : 1;
      if (playing) {
        if (stamina.current.update(dt, running) === 'exhausted') { S.run = false; setRun(false); audio.play('breath'); panT = 0.9; }
        const sp100 = Math.round(stamina.current.pct / 2) * 2;
        if (sp100 !== lastStam) { lastStam = sp100; showStam(sp100); }
        if (stamina.current.exhausted !== lastTired) { lastTired = stamina.current.exhausted; setTired(lastTired); }
      }
      if (playing && (stamina.current.exhausted || stamina.current.pct < CFG.HEART_BELOW)) {
        // detak jantung: makin cepat & keras saat stamina menipis; paling cepat saat habis (kecapean). Napas terengah berulang selama kelelahan.
        const ex = stamina.current.exhausted, low = Math.min(1, Math.max(0, 1 - stamina.current.pct / CFG.HEART_BELOW));
        if ((hbT -= dt) <= 0) { hbT = ex ? 0.4 : 1.0 - 0.45 * low; audio.play('heartbeat', { vol: ex ? 1.3 : 0.8 + 0.3 * low, rate: ex ? 1.28 : 1 + 0.18 * low }); }
        if (ex && (panT -= dt) <= 0) { panT = 2.3; audio.play('pant', { vol: 1, rate: 1 + Math.random() * 0.06 }); }
      }
      for (let i = 0; i < dN; i++) { // debu ikut bergerak pelan; keluar jangkauan -> muncul lagi di sisi lain
        const k = i * 3; dPos[k] += dVel[k] * dt; dPos[k + 1] += dVel[k + 1] * dt; dPos[k + 2] += dVel[k + 2] * dt;
        if (dPos[k + 1] < -1.6) dPos[k + 1] = 1.6; if (dPos[k + 2] > 0.5) dPos[k + 2] = -6; else if (dPos[k + 2] < -6.5) dPos[k + 2] = 0;
        if (dPos[k] > 3.5) dPos[k] = -3.5; else if (dPos[k] < -3.5) dPos[k] = 3.5;
      }
      dGeo.attributes.position.needsUpdate = true;
      const speed = (S.crouch ? CFG.CROUCH_SPEED : running ? CFG.SPRINT_SPEED : CFG.WALK_SPEED) * (player.onStairs ? STAIR_SPEED_MUL : 1) * combineSpeed(wk ? wk.speed : 1, sf.speed);
      const ya = pos.yaw + (wk ? wk.drift : 0); // kaki belum stabil: arah jalan sedikit melenceng (bidik tidak berubah)
      const sp = speed * dt, s = Math.sin(ya), c = Math.cos(ya);
      const dx = (-s * fwd + c * str) * sp, dz = (-c * fwd - s * str) * sp;
      const R = S.crouch ? CFG.PLAYER_RADIUS_CROUCH : CFG.PLAYER_RADIUS; // jongkok = collider lebih kecil & rendah
      const ox = player.x, oz = player.z;
      if (!hiding) world.move(player, dx, dz, R); // collision dinding/furniture/pintu + tangga (naik/turun bertahap, tanpa teleport)
      player.yaw = pos.yaw; player.pitch = pos.pitch;

      // ---- langkah kaki (pelan; berdasar jarak tempuh nyata, bukan tiap frame) ----
      if (playing) {
        stepAcc += Math.hypot(player.x - ox, player.z - oz);
        if (stepAcc >= stride) {
          // cadence per kondisi: jalan ~1,8 langkah/dtk, lari ~3,3/dtk (sesuai ritme rekaman), jongkok ~1,5/dtk, tangga ~1,8/dtk (jarak tempuh nyata / panjang langkah)
          stepAcc = 0; stride = (player.onStairs ? CFG.STRIDE_STAIRS : S.crouch ? CFG.STRIDE_CROUCH : running ? CFG.STRIDE_RUN : CFG.STRIDE_WALK) * (0.94 + Math.random() * 0.12); // variasi kecil antar langkah
          // jalan: normal; lari: lebih keras; jongkok: sangat pelan; tangga: langkah tangga. Pemilihan varian rekaman diacak tanpa pengulangan berurutan (AudioManager)
          audio.play(world.stepSound(player, running), { vol: CFG.FOOTSTEP_VOLUME * (S.crouch ? 0.35 : running ? 1.5 : 1), rate: S.crouch ? 0.96 : 1 });
          // decit papan lantai: jarang & acak, hanya saat berjalan (bukan lari/tangga)
          if (!running && !player.onStairs && (creakCd -= 1) <= 0 && Math.random() < CFG.FLOOR_CREAK_CHANCE) { creakCd = Math.ceil(CFG.FLOOR_CREAK_GAP / 0.55); audio.play('floor_creak', { vol: S.crouch ? 0.5 : 1 }); }
        }
      }

      eye += ((S.crouch ? EYE_CROUCH : EYE) - eye) * Math.min(1, dt * 9);
      player.y += (world.floorY(player) - player.y) * Math.min(1, dt * 14); // tinggi kaki mengikuti anak tangga dengan halus
      fov += ((running && moving ? baseFov + FOV_SPRINT : baseFov) - fov) * Math.min(1, dt * 6);
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
      if (moving) bobT += dt * (running ? 11 : S.crouch ? 5 : 7.5);
      const bob = moving ? Math.sin(bobT) * (running ? 0.035 : 0.018) * (player.onStairs ? 1.6 : 1) : 0;
      swayT += dt;
      const sway = moving ? 0 : CFG.SWAY_IDLE; // napas pelan saat diam; saat jalan cukup head bob (tidak mengubah arah bidik berarti)
      const roll = moving ? Math.cos(bobT * 0.5) * (running ? 0.012 : 0.005) : Math.sin(swayT * 0.7) * CFG.SWAY_IDLE;
      const cp = capture && S.status === 'dead' ? capOut : null;   // goyang/terkulai saat diseret (visual saja)
      cam.position.set(player.x, player.y + eye + bob + (wk ? wk.dip : 0) + (cp ? cp.dip : 0), player.z);
      cam.rotation.set(pos.pitch + Math.sin(swayT * 1.1) * sway + (wk ? wk.pitch : 0) + (cp ? cp.pitch : 0), pos.yaw + (wk ? wk.yaw : 0), roll + (wk ? wk.roll : 0) + (cp ? cp.roll : 0)); // offset opening hanya visual
      cam.updateMatrixWorld(true);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, pos.yaw, dt);
      world.update(dt, t, player, cam, ctx, playing);
      monsterFrame(dt, gate.simulate);
      if (capture && S.status === 'dead' && !js) {   // TAHAP 3: overlay gelap + peredam audio ikut gelap; selesai hold -> bangun
        const o = capture.update(dt); capOut = o; setCaptureBlack(o.black);
        const mq = Math.round(o.muffle * 20) / 20; if (mq !== capMuffle) { capMuffle = mq; audio.setMuffle(mq); }
        if (o.wake) wakeFromCapture();
      }
      // ---- bersembunyi: kamera dipindah ke dalam locker / kolong kasur; menoleh dibatasi; senter dimatikan sementara ----
      const hv = world.hv.active ? world.hv : null;
      if (hv) {
        const dyaw = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
        if (hv.look === 'ease') { pos.yaw += dyaw(hv.yaw - pos.yaw) * Math.min(1, dt * 7); pos.pitch += (0 - pos.pitch) * Math.min(1, dt * 7); }
        else { pos.yaw = hv.yaw + Math.max(-hv.limYaw, Math.min(hv.limYaw, dyaw(pos.yaw - hv.yaw))); pos.pitch = Math.max(hv.pitchMin, Math.min(hv.pitchMax, pos.pitch)); }
        player.yaw = pos.yaw; player.pitch = pos.pitch;
        cam.position.set(hv.x, hv.y, hv.z); cam.rotation.set(pos.pitch + Math.sin(swayT * 1.1) * 0.004, pos.yaw, 0);
        cam.updateMatrixWorld(true);
        audio.setListener(cam.position.x, cam.position.y, cam.position.z, pos.yaw, dt);
        if (!wasHiding && fl.current.on) { hideFlash = true; toggleFlash(true); }
      } else if (wasHiding && hideFlash) { hideFlash = false; if (!fl.current.on) toggleFlash(true); }
      wasHiding = !!hv;
      monsterCam(dt); // jumpscare menimpa kamera (hanya saat tertangkap)
      const hb: null | 'in' | 'out' = !inputOn ? null : world.hiding ? (world.hidePrompt() ? 'out' : null) : world.hideTarget() ? 'in' : null;
      if (hb !== lastHide) { lastHide = hb; setHideBtn(hb); }
      const fxA = hv ? Math.round(hv.alpha * 10) / 10 : 0, fxK = hv ? hv.kind : null;
      if (fxA !== lastFxA || fxK !== lastFxK) { lastFxA = fxA; lastFxK = fxK; setHfx(fxK && fxA > 0 ? { kind: fxK, a: fxA } : null); }

      // ---- senter: battery hanya berkurang saat ON ----
      const f = fl.current;
      if (playing && f.update(dt) === 'died') { audio.play('flash_die'); setFlOn(false); say('Battery habis. Pakai battery dari inventory.', 2600); }
      if ((flickT -= dt) <= 0) { flickT = 0.07; flickR = Math.random(); }
      spot.intensity = CFG.FLASH_INTENSITY * f.factor(flickR);
      const pc = f.pct; if (pc !== lastFl) { lastFl = pc; showPct(pc); }
      hemi.intensity = CFG.AMBIENT * (0.2 + 0.8 * world.lightMul) * (CFG.LFX_DARK_AMBIENT + (1 - CFG.LFX_DARK_AMBIENT) * world.lightDim); // lampu padam -> ambient ikut turun

      // prompt crosshair (state hanya berubah bila teks berubah)
      const p = inputOn ? (world.hiding ? world.hidePrompt() : world.ix.prompt(ctx)) : null;
      if (p !== lastPrompt) { lastPrompt = p; setPrompt(p); }
      if (playing && world.escaped(player)) { S.status = 'escaped'; setStatus('escaped'); }
      r.toneMappingExposure = CFG.EXPOSURE_BASE + 0.012 * Math.sin(performance.now() * 0.0011) + 0.008 * Math.sin(performance.now() * 0.0037); // 'napas' exposure sangat halus (gratis)
      if (shadowOn) { // shadow pass hanya bila senter ON dan kamera bergerak (atau tiap 6 frame untuk objek dinamis)
        const moved = !shP.equals(cam.position) || !shQ.equals(cam.quaternion); if (moved) { shP.copy(cam.position); shQ.copy(cam.quaternion); }
        r.shadowMap.autoUpdate = f.on && spot.intensity > 0.5 && (moved || (++shF % 6) === 0);
      }
      // // senter mati -> tidak ada render shadow pass
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      scareFx.reset(); canvas.style.filter = ''; resetCapture(); canvas.style.opacity = ''; // timer/efek dibersihkan saat unmount
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('orientationchange', onOrient); window.visualViewport?.removeEventListener('resize', resize);
      screen.orientation?.removeEventListener?.('change', onOrient); ro?.disconnect(); orientTimers.forEach(clearTimeout);
      offNet?.(); offWorld?.(); if (digestTimer) clearInterval(digestTimer); remotes?.dispose(); mctl?.dispose(); mview?.dispose(); mctl = null; mview = null;
      world?.abortHide(); net?.lockers.release(null); world?.dispose(); worldRef.current = null; // keluar dari game: lepas slot loker (leave_room juga melepasnya)
      audio.dispose(); audioRef.current = null;
      canvas.removeEventListener('pointerdown', pd); canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu); canvas.removeEventListener('pointercancel', pu);
      cam.remove(dust); dGeo.dispose(); dMat.dispose();
      scene.remove(cam); cam.remove(spot); cam.remove(aim);
      post?.dispose(); envH?.dispose(); setMaterialEnv(null);
      r.dispose(); r.forceContextLoss();
      if (msgT.current) { clearTimeout(msgT.current); msgT.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pengaturan: simpan + terapkan langsung (grafik, sensitivitas, volume, invert) tanpa mereset permainan. Dideklarasikan setelah effect utama
  // sehingga S.applySettings sudah terpasang saat pertama dijalankan.
  useEffect(() => { saveSettings(settings); st.current.applySettings(settings); }, [settings]);

  const lockState = worldRef.current?.lockState() ?? {};
  const inv = me.inventory;
  const keyIds = new Set(KEY_DEFS.map((k) => k.id as string));
  const items = inv.list().filter((i) => !keyIds.has(i.id));

  return (
    <div className="play" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={cv} />
      {CFG.ATMOS_ENABLED && <div ref={atmRef} className="atmos" aria-hidden />}
      <div ref={baseRef} className="joybase"><div ref={knobRef} className="joyknob" /></div>
      {status === 'play' && <div ref={vigRef} className="vignette" aria-hidden />}
      {status === 'play' && (
        <div ref={heartRef} className="heart" aria-hidden>
          <svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 2.7 5 6 5c2 0 3.4 1 4 2.2h4C14.6 6 16 5 18 5c3.3 0 5 3.4 3.6 6.7C19.5 16.4 12 21 12 21z" /></svg>
        </div>
      )}
      <div ref={deadRef} className={'deadscreen' + (deadReady ? ' ready' : '')} aria-live="polite">
        <div className="deadtxt">KAMU TERTANGKAP</div>
        {deadReady && !net && (
          <div className="row" style={{ maxWidth: 320 }}>
            <button className="gbtn" onClick={() => { setDeadReady(false); st.current.restart(); }}><RotateCcw size={16} /> Main lagi</button>
            <button className="gbtn" onClick={onExit}><LogOut size={16} /> Keluar</button>
          </div>
        )}
      </div>
      {status === 'play' && hfx && <div className={'hidefx ' + hfx.kind} style={{ opacity: hfx.a }} aria-hidden>{hfx.kind === 'locker' ? <><i /><b /><i /><b /><i /><b /><i /><b /><i /></> : <><i /><s /></>}</div>}
      {status === 'play' && !hfx && <div className="crosshair" aria-hidden />}
      {status === 'play' && prompt && <div className="ixprompt">{prompt}</div>}
      <div className="playhud">
        <div className="keychips" aria-label="Keys">
          {KEY_DEFS.map((k) => {
            const used = !!lockState[k.id], has = inv.hasKey(k.id);
            return <span key={k.id} className={'kchip' + (has ? ' has' : '') + (used ? ' used' : '')} style={{ ['--c' as any]: k.css }}>{used ? '✓' : ''}</span>;
          })}
        </div>
        <div className={'flhud' + (flOn ? ' on' : '') + (flLow ? ' low' : '')}><Flashlight size={12} /> <span ref={flTxt}>100%</span></div>
        <div className={'stambar' + (tired ? ' tired' : '')}><i ref={stamFill} style={{ width: '100%' }} /></div>
        {net
          ? <div className="slotinfo">{modeLabel(net.maxPlayers as PlayerMode)} · {1 + net.client.remoteCount}/{net.maxPlayers} online · {net.client.status === 'online' ? 'ROOM ' + net.code : net.client.status === 'reconnecting' ? 'MENYAMBUNG ULANG...' : net.client.status === 'connecting' ? 'MENYAMBUNG...' : 'TERPUTUS'}</div>
          : roster.length > 1 && <div className="slotinfo">{modeLabel(roster.length as PlayerMode)} · {live.current.length}/{roster.length} slot · offline</div>}
      </div>
      {status === 'play' && <button className={'gico exit' + (menu.open ? ' on' : '')} onClick={toggleMenu} aria-label={menu.open ? 'Tutup menu' : 'Menu'} aria-haspopup="dialog" aria-expanded={menu.open}><Menu size={20} /></button>}
      <button className={'gico bagbtn' + (bag ? ' on' : '')} onClick={() => setBag((b) => !b)} aria-label="Inventory"><Backpack size={20} /></button>
      {bag && (
        <div className="bag">
          {KEY_DEFS.map((k) => (
            <div className="bagrow keyrow" key={k.id} style={{ ['--c' as any]: k.css }}>
              <span><i className="kdot" />{k.label}</span><b>{lockState[k.id] ? 'terpakai' : 'x' + inv.count(k.id)}</b>
            </div>
          ))}
          {items.length === 0 && <div className="bagrow dim">Kosong</div>}
          {items.map((it) => (
            <div className="bagrow" key={it.id}>
              <span>{it.label} x{it.count}</span>
              {it.usable && <button className="gbtn small" onClick={() => useItem(it.id)}>{it.id === 'note' ? 'Baca' : 'Pakai'}</button>}
            </div>
          ))}
        </div>
      )}
      {msg && <div className="playmsg">{msg}</div>}
      <LoadingScreen active={status === 'loading'} />
      {status === 'error' && <div className="playcover">Gagal memuat map.<button className="gbtn" onClick={onExit}>Kembali</button></div>}
      {status === 'escaped' && (
        <div className="playcover">
          ESCAPED
          <div className="row" style={{ maxWidth: 320 }}>
            <button className="gbtn" onClick={() => st.current.restart()}><RotateCcw size={16} /> Main lagi</button>
            <button className="gbtn" onClick={onExit}><LogOut size={16} /> Keluar</button>
          </div>
        </div>
      )}
      {status === 'play' && menu.open && (
        <PauseMenu mode={pz.current.mode} panel={menu.panel} settings={settings} roster={pauseRoster} online={!!net}
          onPanel={goPanel} onBack={menuBack} onResume={closeMenu} onLeave={() => exitRef.current()} onSettings={patchSettings} />
      )}
      {status === 'play' && !menu.open && (
        <div className="fabs" onContextMenu={(e) => e.preventDefault()}>
          <button className={'fab f-flash' + (flOn ? ' on' : '')} onPointerDown={(e) => { e.preventDefault(); toggleFlash(); }} aria-label="Senter"><Flashlight size={24} /></button>
          <button className={'fab f-run' + (run ? ' on' : '') + (tired ? ' tired' : '')} onPointerDown={(e) => { e.preventDefault(); toggleRun(); }} aria-label="Lari"><IconRun /></button>
          <button className={'fab f-crouch' + (crouch ? ' on' : '')} onPointerDown={(e) => { e.preventDefault(); toggleCrouch(); }} aria-label="Jongkok"><IconCrouch /></button>
          {hideBtn && <button className={'fab f-hide' + (hideBtn === 'out' ? ' on' : '')} onPointerDown={(e) => { e.preventDefault(); st.current.hide(); }} aria-label={hideBtn === 'out' ? 'Keluar' : 'Sembunyi'}><EyeOff size={24} /></button>}
          <button className="fab f-act" onPointerDown={(e) => { e.preventDefault(); interact(); }} aria-label="Interaksi"><Hand size={30} /></button>
        </div>
      )}
    </div>
  );
}
