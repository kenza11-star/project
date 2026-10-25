'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { LogOut, Hand, Backpack, RotateCcw, Flashlight, Menu, EyeOff, MessageSquare, Mic, MicOff, Volume2, VolumeX, Send, Key, Battery, Coffee, FileText, Plus, ChevronLeft, ChevronRight, Eye, Camera, MapPin, Megaphone } from 'lucide-react';
import { GameWorld, type GameCtx } from '@/lib/game/world';
import { inBunker } from '@/lib/game/puzzleroom';
import { inPrison, PRISON_SLOTS } from '@/lib/game/prisonroom';
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
import { HeartBeat, heartFx, pulseShape, Jumpscare, FaintBeat, faintHeartFx, faintMuffle } from '@/lib/game/monsterfx';
import { CaptureAudio } from '@/lib/game/captureaudio';
import { ScareFx, combineSpeed } from '@/lib/game/scarefx';
import { buildSlots, liveSlots, modeLabel, type PlayerMode, type Slot } from '@/lib/game/players';
import { RemotePlayers } from '@/lib/3d/RemotePlayers';
import type { NetSession } from '@/lib/net/session';
import { WorldSync, type NetWorldEvent } from '@/lib/net/worldsync';
import { RescueHost } from '@/lib/game/rescue';
import { Cooldown, clipDist, poseDist, smoothPose, specCamPose, specCycle, specDir, specHead, specIds, specPick, type SpecMode, type SpecPose } from '@/lib/game/spectate';   // STAGE 4: kamera penonton
import { PingMarkers } from '@/lib/3d/PingMarkers';
import { VoiceMesh } from '@/lib/net/voice';
import type { ChatEvent } from '@/lib/net/roomclient';
import { PauseState, pauseModeFor, frameGate, type PausePanel } from '@/lib/game/pause';
import { loadSettings, saveSettings, GFX, SENS_BASE, type Settings } from '@/lib/game/settings';
import LoadingScreen from '../ui/LoadingScreen';
import PauseMenu from './PauseMenu';

const EYE = 1.65, EYE_CROUCH = 1.0;
// Overlay darah jumpscare (CSS saja): [kiri %, atas %, diameter px] percikan; [kiri %, panjang px] tetesan
const BLOOD_SPLATS: [number, number, number][] = [[10, 16, 170], [82, 12, 210], [92, 60, 140], [16, 72, 190], [48, 86, 230], [66, 40, 100], [30, 36, 120]];
const BLOOD_DRIPS: [number, number][] = [[6, 150], [19, 90], [37, 120], [58, 70], [73, 170], [88, 110]];
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
export default function PlayScene({ roster, onExit, onRetry, net }: { roster: Slot[]; onExit: () => void; onRetry?: () => void; net?: NetSession | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const atmRef = useRef<HTMLDivElement>(null);
  const vigRef = useRef<HTMLDivElement>(null); // vignette yang sudah ada; opening hanya mengubah variabel CSS-nya
  const [run, setRun] = useState(false);
  const [crouch, setCrouch] = useState(false);
  const [msg, setMsg] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'play' | 'escaped' | 'error' | 'dead' | 'over'>('loading');
  const [struggleUi, setStruggleUi] = useState(false); const strBarRef = useRef<HTMLDivElement>(null), strTimeRef = useRef<HTMLSpanElement>(null);   // STAGE 2 (solo): minigame berontak saat digantung
  const [rescueUi, setRescueUi] = useState(false); const rescueBarRef = useRef<HTMLDivElement>(null); const [winUi, setWinUi] = useState(false);   // STAGE 3: bar tahan-tangan penyelamat; layar menang online
  const [spec, setSpec] = useState<{ id: string; name: string; mode: SpecMode; n: number } | null>(null); const [specCd, setSpecCd] = useState({ p: 0, s: 0 });   // STAGE 4: penonton (online, 'bound'): target + mode; sisa cooldown ping/teriak (detik, ditulis hanya saat berubah)
  const [deadReady, setDeadReady] = useState(false); // layar 'tertangkap' siap (solo: tombol Main lagi)
  const heartRef = useRef<HTMLDivElement>(null); const deadRef = useRef<HTMLDivElement>(null);
  const bloodRef = useRef<HTMLDivElement>(null);   // overlay darah jumpscare (variabel CSS --bl/--bs/--ca ditulis per frame)
  const subRef = useRef<HTMLDivElement>(null), subTxtRef = useRef<HTMLDivElement>(null), subTimeRef = useRef<HTMLSpanElement>(null), subBarRef = useRef<HTMLDivElement>(null);   // subtitle di atas layar hitam (settle/hold)
  const [bag, setBag] = useState(false);
  const [noteView, setNoteView] = useState<{ i: number; n: number; text: string } | null>(null); // kertas notes yang sedang dibaca (tulisan tangan)
  const [chatOpen, setChatOpen] = useState(false);
  const [kp, setKp] = useState(false); const [kpCode, setKpCode] = useState(''); const fadeRef = useRef<HTMLDivElement>(null);
  const [chatLog, setChatLog] = useState<ChatEvent[]>([]);
  const chatIn = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);        // slot hotbar terpilih
  const voice = useRef<VoiceMesh | null>(null);
  const voiceNet = useRef<unknown>(null);
  const [, setMicTick] = useState(0);
  const sigRef = useRef('');
  const [flOn, setFlOn] = useState(false);
  const [flLow, setFlLow] = useState(false);
  const [hideBtn, setHideBtn] = useState<null | 'in' | 'out'>(null); // tombol sembunyi muncul saat membidik locker/lemari/kasur, atau saat sedang bersembunyi
  const [hfx, setHfx] = useState<{ kind: 'locker' | 'bed'; a: number } | null>(null); // masker celah intip (alpha dikuantisasi, bukan per frame)
  // HUD yang sering berubah (persen senter, bar stamina) ditulis langsung ke DOM: tanpa render ulang React per frame
  const flTxt = useRef<HTMLSpanElement>(null);
  const stamFill = useRef<HTMLElement>(null);
  const sodaT = useRef(0); // sisa detik buff kecepatan soda
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
    act: () => {}, actUp: () => {}, hide: () => {}, restart: () => {}, tap: () => {}, canStand: (): boolean => true,
    specMove: (_d: 1 | -1) => {}, specMode: () => {}, ping: () => {}, shout: () => {},   // STAGE 4
    kp: false, kpKey: (_k: string): boolean => false, resetInput: () => {}, applySettings: (_s: Settings) => {}, sens: 1, invertY: false,
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

  const closeKp = () => { st.current.kp = false; setKp(false); setKpCode(''); st.current.resetInput(); };
  const kpPress = (k: string): boolean => {
    if (k === 'Escape') { closeKp(); return true; }
    const w = worldRef.current; if (!w) return false;
    if (/^\d$/.test(k)) { setKpCode((c) => (c.length < 4 ? c + k : c)); return true; }
    if (k === 'Backspace') { setKpCode((c) => c.slice(0, -1)); return true; }
    if (k === 'Enter') { kpSubmit(); return true; }
    return false;
  };
  const kpRef = useRef(''); kpRef.current = kpCode;
  const kpSubmit = () => {
    const w = worldRef.current; if (!w) return; const c = kpRef.current;
    if (c.length < 4) return;
    if (w.submitCode(c)) { closeKp(); say('Kode benar - pintu besi terbuka', 2200); } else { setKpCode(''); say('Kode salah', 1200); w.audio?.alarm(); }
  };
  st.current.kpKey = kpPress;
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
      i === 0 ? { ...sl, connection: st === 'online' ? 'ONLINE' : st === 'closed' ? 'DISCONNECTED' : 'RECONNECTING', mic: voice.current?.state === 'on' }
        : sl.status === 'remote' ? { ...sl, connection: peers[i - 1]?.stale ? 'NO SIGNAL' : 'ONLINE', mic: !!peers[i - 1] && net.client.micOf(peers[i - 1].id) } : sl));
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

  const useSlotRef = useRef<(i: number) => void>(() => {});
  const useItem = (id: string) => {
    if (pz.current.open) return;
    const inv = me.inventory;
    if (id === 'soda') { if (inv.remove(id)) { sodaT.current = CFG.SODA_BUFF_SECONDS; say('Minum Soda... segar.'); } }
    else if (id === 'battery') {
      if (fl.current.full) say('Senter masih penuh.', 1500);
      else if (inv.remove(id)) { fl.current.recharge(); showPct(100); audioRef.current?.play('battery_use'); say('Battery diganti: senter 100%', 2200); }
    }
    else if (id === 'note') { const n = inv.notes().length, t = inv.readNote(me.noteIdx); if (t) { setNoteView({ i: me.noteIdx % n, n, text: t }); me.noteIdx++; setBag(false); } }
    else if (id === 'medkit') say('Medkit disimpan untuk nanti.');
    force();
  };

  useSlotRef.current = (i) => useSlot(i);
  const KEY_HINT = (label: string) => say(label + ': dekati gembok exit untuk memakainya.', 2200);
  const useSlot = (i: number) => {
    setSel(i);
    const s = hotSlots()[i]; if (!s) return;
    if (s.id === 'flash') toggleFlash();
    else if (s.key) KEY_HINT(s.label);
    else useItem(s.id);
  };
  /** Isi hotbar: senter (tetap), key yang dibawa/terpakai, lalu item lain -- otomatis dari inventory (pungut = langsung masuk hotbar). */
  const hotSlots = () => {
    const inv = me.inventory;
    const out: { id: string; label: string; count: number; key?: string; css?: string; used?: boolean }[] = [{ id: 'flash', label: 'Senter', count: 0 }];
    for (const k of KEY_DEFS) if (inv.hasKey(k.id)) out.push({ id: k.id, label: k.label, count: inv.count(k.id), key: k.id, css: k.css });
    for (const it of inv.list()) if (!KEY_DEFS.some((k) => k.id === it.id)) out.push({ id: it.id, label: it.label, count: it.count });
    return out;
  };
  const sendChat = () => {
    const el = chatIn.current; if (!el || !net) return;
    if (net.client.sendChat(el.value, net.selfName)) el.value = '';
    el.focus();
  };
  const getVoice = () => {
    if (!net) return null;
    if (voice.current && voiceNet.current !== net) { voice.current.dispose(); voice.current = null; } // klien room berganti: jangan kirim sinyal lewat klien lama
    voiceNet.current = net;
    if (!voice.current) { const vm: VoiceMesh = new VoiceMesh(net.client.selfId, (m) => net.client.sendRtc(m), () => { setMicTick((x) => x + 1); net.client.setMic(vm.state === 'on'); }, () => say('Koneksi voice gagal, mencoba lagi...', 2600)); voice.current = vm; } // setMic: broadcast status mic hanya saat berubah
    return voice.current;
  };
  const toggleAudio = () => { const v = getVoice(); if (v) v.listen(net!.client.peerIds(), !v.listening); };
  const toggleMic = async () => {
    const v = getVoice(); if (!v) return;
    await v.toggle(net!.client.peerIds());
    if (voice.current.state === 'denied') say('Mic tidak diizinkan: kamu hanya bisa mendengar.', 2600);
  };

  // chat & voice (online): pesan masuk -> log + balon di atas kepala pemain; hotbar/chat di-refresh tanpa render per frame
  useEffect(() => {
    const iv = setInterval(() => {
      const inv = me.inventory, now = Date.now();
      const sig = inv.list().map((i) => i.id + i.count).join() + '|' + (chatLog.some((c) => now - c.at < 10000) ? Math.floor(now / 1000) : 0) + '|' + (worldRef.current ? JSON.stringify(worldRef.current.lockState()) + JSON.stringify(worldRef.current.missionState()) : '');
      if (sig !== sigRef.current) { sigRef.current = sig; force(); }
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLog]);
  useEffect(() => () => { voice.current?.dispose(); voice.current = null; }, []);
  useEffect(() => { if (net) getVoice()?.listen(net.client.peerIds(), true); /* audio default ON saat masuk room online */ }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const spot = new THREE.SpotLight(0xfff0c8, 0, CFG.FLASH_DISTANCE, CFG.FLASH_ANGLE, 1, 2);
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
    const offNet0 = net ? net.client.onChange(() => { force(); voice.current?.syncPeers(net.client.peerIds()); }) : null;
    const offChat = net ? net.client.onChat((e) => { setChatLog((l) => [...l.slice(-19), e]); if (!e.self) remotes?.say(e.id, e.text); }) : null;
    const offRtc = net ? net.client.onRtc((from, m) => voice.current?.handle(from, m)) : null;
    const offMic = net ? net.client.onMic(() => force()) : null; // daftar pemain (pause) ikut menampilkan ikon mic
    const offNet = () => { offNet0?.(); offChat?.(); offRtc?.(); offMic?.(); }; // HUD/daftar pemain ikut berubah saat ada yang masuk/keluar/reconnect
    let netGait: 0 | 1 | 2 = 0;
    // Sinkronisasi state dunia (pintu, benda, gembok, container): lihat lib/net/worldsync.ts. Event lokal dikirim; digest berkala menutup paket hilang / pemain terlambat.
    const wsync = net ? new WorldSync() : null;
    let netLive = false; // dunia siap (startRun selesai): event masuk sebelum itu diabaikan TANPA digabung, jadi digest berikutnya tetap membawanya
    const offWorld = net && wsync ? net.client.onWorld((from, raw) => { const w = world; if (!netLive || !w) return; for (const e of wsync.receive(raw, from === net.hostId)) { if (e.k === 'rreq' || e.k === 'rs' || e.k === 'rok') rescueNet(from, e); else if (e.k === 'ping' || e.k === 'shout') specNet(from, e); else w.applyNet(e); } }) : null;
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
    const heartBeat = new HeartBeat(), faintBeat = new FaintBeat(); let monStep = 0, monVig = -1, jsMuffled = false;   // faintBeat/jsMuffled: pingsan (jumpscare akhir + diseret) -> detak melambat & suara teredam
    // TAHAP 4 -- audio tangkapan spasial: dijadwalkan dari MonsterController.onCatch (semua klien, sekali per kejadian), diputar per frame di monsterFrame (tanpa timer).
    const capAudio = new CaptureAudio();
    // TAHAP 2 -- Monster Drag. 'wait' = jumpscare selesai, menunggu monster mulai menyeret; 'moving' = sedang diseret (mengikuti jejak monster);
    // 'held' = sampai di tujuan dan TETAP tertangkap (status 'dead', kontrol mati) sampai transisi bangun (TAHAP 3). 'none' = alur lama (respawn).
    let dragMode: 'none' | 'wait' | 'moving' | 'held' = 'none', dragWait = 0; const dragTrail = new DragTrail();
    // STAGE 2 -- penjara: 'bound' = digantung di slot penjara. Status tetap 'dead' (kontrol mati, tidak bisa ditangkap lagi: cg ikut terkirim); bd = indeks slot dikirim ke semua pemain.
    let boundSlot = -1, bindSlot = -1, boundFade = 0, boundT = 0, boundAllT = 0, overT = 0, struggleOn = false, struggleFill = 0, struggleT = 0;
    const clearBound = () => { stopRescue(); boundSlot = -1; bindSlot = -1; boundFade = 0; boundT = 0; boundAllT = 0; struggleOn = false; setStruggleUi(false); };
    const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // TAHAP 3 -- Capture POV (hanya korban: dipicu onCatchSelf, tidak ada pesan/state gelap yang dikirim ke pemain lain). Tanpa setTimeout: semua waktu dihitung per frame.
    let capture: CaptureFx | null = null, capOut: CaptureOut | null = null, capWake = false, capBlack = -1, capMuffle = -1, capStart = 0;
    const jsReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const monSelf = net ? net.client.selfId : 'me';
    const monIO: MonsterNetIO | null = net ? { selfId: net.client.selfId, selfSlot: net.slot, peers: () => net.client.roster().map((r) => ({ id: r.id, slot: r.slot, online: !r.stale })), send: (m) => { net.client.sendMonster(m); }, onMessage: (fn) => net.client.onMonster(fn) } : null;
    const gaitName = (g: number) => (g === 2 ? 'run' : g === 1 ? 'walk' : 'idle');
    const setDeadScreen = (a: number, text: boolean) => { const el = deadRef.current; if (!el) return; el.style.opacity = a >= 1 ? '1' : a <= 0 ? '0' : a.toFixed(3); el.classList.toggle('show', text); };
    const setCaptureBlack = (b: number) => { const q = Math.round(b * 100) / 100; if (q !== capBlack) { capBlack = q; setDeadScreen(q, false); } };   // hanya opacity overlay (compositor), ditulis bila berubah
    // Subtitle saat layar hitam (fase settle/hold): kalimat acak, muncul per huruf, sisa waktu + bar. Hanya ref/DOM langsung, tanpa re-render React.
    const CAP_LINES = ['Gelap... tapi aku masih mendengarnya.', 'Jangan berhenti bernapas. Bangun.', 'Ia belum selesai denganmu.'], CAP_TYPE_MS = 40;
    let capSubT0 = -1, capSubTxt = '', capSubN = -1, capSubSec = '';
    const capSubHide = () => { capSubT0 = -1; capSubN = -1; capSubSec = ''; const el = subRef.current; if (el) el.style.opacity = '0'; };
    const capSubUpdate = (o: CaptureOut) => {
      const el = subRef.current; if (!el) return;
      if (o.phase !== 'settle' && o.phase !== 'hold') { if (capSubT0 >= 0) capSubHide(); return; }
      if (capSubT0 < 0) { capSubT0 = o.t; capSubTxt = CAP_LINES[Math.floor(Math.random() * CAP_LINES.length)]; el.style.opacity = '1'; }
      const el_ = o.t - capSubT0, total = CFG.CAPTURE_SETTLE_SECONDS + CFG.CAPTURE_HOLD_SECONDS, rem = Math.max(0, total - el_);
      const n = jsReduced ? capSubTxt.length : Math.min(capSubTxt.length, Math.floor((el_ * 1000) / CAP_TYPE_MS));
      if (n !== capSubN) { capSubN = n; if (subTxtRef.current) subTxtRef.current.textContent = capSubTxt.slice(0, n); }
      const sec = rem.toFixed(1) + 's'; if (sec !== capSubSec) { capSubSec = sec; if (subTimeRef.current) subTimeRef.current.textContent = sec; }
      if (subBarRef.current) subBarRef.current.style.transform = 'scaleX(' + (total > 0 ? rem / total : 0).toFixed(3) + ')';
    };
    // Overlay darah jumpscare: --bl (opacity, naik dari lunge ke grab), --bs (skala percikan; tetap 1 bila reduced motion), --ca (px geser merah/biru). Hanya DOM/ref.
    const jsFx = (f: ReturnType<Jumpscare['update']>) => {
      const el = bloodRef.current; if (!el) return;
      if (el.style.display !== 'block') el.style.display = 'block';
      el.style.setProperty('--bl', f.blood.toFixed(3)); el.style.setProperty('--bs', (jsReduced ? 1 : f.blood).toFixed(3)); el.style.setProperty('--ca', (f.split * 14).toFixed(2));
    };
    const jsFxHide = () => { const el = bloodRef.current; if (el) { el.style.display = 'none'; el.style.setProperty('--bl', '0'); } };
    /** Batalkan/bersihkan seluruh efek capture (restart, respawn, unmount): overlay, peredam audio, dan WakeUp milik capture. WakeUp opening tidak disentuh. */
    const resetCapture = () => {
      capture?.cancel(); capture = null; capOut = null; capBlack = -1; capSubHide();
      if (capWake) { wake = null; wakeLook = 1; clearWakeFx(wakeEl, wakeLast); audio.setMuffle(0); capWake = false; }
      else if ((capMuffle > 0 || jsMuffled) && !wake) audio.setMuffle(0);
      capMuffle = -1; jsMuffled = false; faintBeat.update(0, 0);
    };
    const beginCapture = () => { jsMuffled = false; capMuffle = -1; capture = new CaptureFx({ openSeconds: CFG.CAPTURE_OPEN_SECONDS, darkenSeconds: CFG.CAPTURE_DARKEN_SECONDS, darkenMax: CFG.CAPTURE_DARKEN_MAX, blinkMax: CFG.CAPTURE_BLINK_MAX, settleSeconds: CFG.CAPTURE_SETTLE_SECONDS, holdSeconds: CFG.CAPTURE_HOLD_SECONDS, maxDragSeconds: CFG.MONSTER_DRAG_MAX_SECONDS + 10, reduced: jsReduced }); capStart = performance.now(); capSubHide(); capture.start(); capOut = capture.update(0); setCaptureBlack(capOut.black); };
    /** STAGE 2: korban sudah di slot penjara: kontrol tetap mati, kamera hampir terkunci, fade-in singkat dari gelap. Solo: mulai minigame berontak. */
    const enterBound = (bs: { slot: number; yaw: number }) => {
      resetCapture(); dragMode = 'none'; dragWait = 0; dragTrail.clear(); audio.setMuffle(0); faintBeat.update(0, 0);
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stamina.current.reset(); sodaT.current = 0; S.resetInput?.();
      boundSlot = bs.slot; boundT = 0; boundAllT = 0; boundFade = CFG.BOUND_FADE_SECONDS; pos.yaw = bs.yaw; pos.pitch = 0.3;
      setDeadScreen(1, false); setDeadReady(false);
      if (!net) { struggleOn = true; struggleFill = CFG.STRUGGLE_START; struggleT = CFG.STRUGGLE_SECONDS; setStruggleUi(true); }
      force();
    };
    const gameOver = () => { if (S.status === 'over') return; struggleOn = false; setStruggleUi(false); S.status = 'over'; setStatus('over'); overT = 0; setDeadScreen(0, false); setDeadReady(false); };
    /** SOLO sukses: bebas, dipindah ke ujung tangga lantai 2; monster menjauh ~20 dtk, pemain kebal 10 dtk. */
    const freeSolo = () => {
      if (!world) return; struggleOn = false; setStruggleUi(false); boundSlot = -1; bindSlot = -1; boundFade = 0;
      world.leavePrison();
      mctl?.release({ id: monSelf, x: player.x, z: player.z, level: player.level, gait: 'idle', crouch: false, hidden: false, grace: 0 }, CFG.SOLO_FREE_MONSTER_AWAY, CFG.SOLO_FREE_GRACE);
      setDeadScreen(0, false); pos.pitch = 0; S.resetInput?.(); S.status = 'play'; setStatus('play'); force();
    };
    S.tap = () => { if (struggleOn) struggleFill = Math.min(1, struggleFill + CFG.STRUGGLE_TAP); };
    // ---- STAGE 3: penyelamatan korban 'bound' (online). Penyelamat menahan tombol tangan; HOST memegang sesi (1 per korban, 2 penyelamat = 2x) dan menyiarkan 'rs' (progres) / 'rok' (berhasil). ----
    const isHost = () => !!net && net.hostId === net.client.selfId;
    const rescueHost = new RescueHost(CFG.RESCUE_HOLD_SECONDS, CFG.RESCUE_MAX_MUL, CFG.RESCUE_TIMEOUT);
    let rescHold = false, rescVictim = '', rescKA = 0, rescProg = 0, rescShow = 0, rescN = 1, rescAt = 0, rescSyncT = 0, rokQ = 0, winOn = false;
    const rokSeen = new Set<number>(), rokPend: { t: number; v: string; q: number }[] = [];
    const nameOf = (id: string) => (id === monSelf ? net?.selfName : net?.client.roster().find((r) => r.id === id)?.name) || 'PLAYER';
    const sendW = (e: NetWorldEvent) => { if (!net || !wsync) return; const m = wsync.local(e); if (m) net.client.sendWorld(m); };
    /** Korban 'bound' terdekat di depan pemain (jarak + arah pandang, lantai sama). '' = tidak ada. */
    const rescueTarget = (): string => {
      if (!net || S.status !== 'play') return '';
      const fx = -Math.sin(pos.yaw), fz = -Math.cos(pos.yaw); let best = '', bd = CFG.RESCUE_REACH;
      for (const rv of net.client.sample()) {
        if (rv.stale || rv.state.bd === undefined || rv.state.es || rv.state.level !== player.level) continue;
        const dx = rv.state.x - player.x, dz = rv.state.z - player.z, d = Math.hypot(dx, dz);
        if (d > bd || (d > 0.4 && (dx * fx + dz * fz) / d < CFG.RESCUE_FACE_COS)) continue;
        best = rv.id; bd = d;
      }
      return best;
    };
    const startRescue = (v: string) => { rescHold = true; rescVictim = v; rescKA = 0; rescProg = rescShow = 0; rescN = 1; rescAt = performance.now(); S.run = false; setRun(false); setRescueUi(true); };
    const stopRescue = () => {
      if (!rescHold) return; rescHold = false;
      if (rescVictim) { if (isHost()) rescueHost.set(rescVictim, monSelf, false); else sendW({ k: 'rreq', v: rescVictim, o: 0 }); }
      rescVictim = ''; rescProg = rescShow = 0; setRescueUi(false);
    };
    /** Korban bebas (semua klien, sekali per nomor 'q'): toast, suara tali putus (posisional), kebal RESCUE_GRACE, monster (otoritas) menyelidiki; korban sendiri kembali 'play' di tempatnya (menggantung -> berdiri di slot). */
    const applyRescued = (v: string, q: number) => {
      if (rokSeen.has(q)) return; rokSeen.add(q);
      const rv = v === monSelf ? null : net?.client.sample().find((r) => r.id === v);
      const px = v === monSelf ? player.x : rv ? rv.state.x : NaN, pz_ = v === monSelf ? player.z : rv ? rv.state.z : NaN, pl = v === monSelf ? player.level : rv ? rv.state.level : player.level, py = v === monSelf ? player.y : rv ? rv.state.y : player.y;
      say(nameOf(v) + ' rescued', 2400);
      if (Number.isFinite(px + pz_)) {
        audio.play('chain_fall', { pos: { x: px, y: py + CFG.CAPTURE_AUDIO_Y + 0.6, z: pz_ }, vol: 1.3, rate: 1.35 }); audio.play('impact_slam', { pos: { x: px, y: py + CFG.CAPTURE_AUDIO_Y, z: pz_ }, vol: 1, rate: 1.2 });   // suara keras tali putus: klip yang sudah ada, 3D
        mctl?.noise(px, pz_, pl);
      }
      mctl?.noteRescue(v);
      if (rescHold && rescVictim === v) stopRescue();
      if (v === monSelf && boundSlot >= 0 && S.status === 'dead') {
        struggleOn = false; setStruggleUi(false); boundSlot = -1; bindSlot = -1; boundFade = 0; boundT = 0; boundAllT = 0;
        setDeadScreen(0, false); setDeadReady(false); pos.pitch = 0; S.resetInput?.(); S.status = 'play'; setStatus('play'); force();
      }
    };
    /** Pesan jaringan penyelamatan (sudah lolos sanitasi; rs/rok hanya dari host). */
    const rescueNet = (from: string, e: NetWorldEvent) => {
      if (e.k === 'rreq') { if (isHost()) rescueHost.set(e.v, from, e.o === 1); }
      else if (e.k === 'rs') { if (rescHold && e.v === rescVictim) { rescProg = e.p / 1000; rescN = Math.max(1, e.n); rescAt = performance.now(); } }
      else if (e.k === 'rok') applyRescued(e.v, e.q);
    };
    const rescueValid = (v: string, r: string): boolean => {
      const rem = (id: string) => net?.client.sample().find((x) => x.id === id);
      let vx: number, vz: number, vl: number;
      if (v === monSelf) { if (boundSlot < 0 || S.status !== 'dead') return false; vx = player.x; vz = player.z; vl = player.level; }
      else { const a = rem(v); if (!a || a.stale || a.state.bd === undefined || a.state.es) return false; vx = a.state.x; vz = a.state.z; vl = a.state.level; }
      if (r === monSelf) return S.status === 'play' && player.level === vl && Math.hypot(player.x - vx, player.z - vz) <= CFG.RESCUE_REACH + 0.6;
      const b = rem(r); return !!b && !b.stale && !b.state.cg && b.state.bd === undefined && !b.state.es && b.state.level === vl && Math.hypot(b.state.x - vx, b.state.z - vz) <= CFG.RESCUE_REACH + 1.0;   // toleransi jaringan
    };
    /** Per frame (online, tidak ikut pause lokal): validasi penahanan sendiri, keepalive ke host, dan (HOST) jalankan sesi + siarkan. */
    const rescueFrame = (dt: number) => {
      if (!net || !world) return;
      if (rescHold) {
        const rv = net.client.sample().find((r) => r.id === rescVictim);
        if (S.status !== 'play' || world.hiding || !rv || rv.stale || rv.state.bd === undefined || Math.hypot(rv.state.x - player.x, rv.state.z - player.z) > CFG.RESCUE_REACH + 0.5) stopRescue();   // lepas tombol: S.actUp; menjauh / tertangkap / korban hilang: batal di sini
        else if (isHost()) rescueHost.set(rescVictim, monSelf, true);
        else if ((rescKA -= dt) <= 0) { rescKA = CFG.RESCUE_KEEPALIVE; sendW({ k: 'rreq', v: rescVictim, o: 1 }); }
      }
      if (isHost()) {
        const ev = rescueHost.update(dt, rescueValid);
        if (rescHold && rescVictim) { rescProg = rescueHost.progress(rescVictim); rescN = 1; rescAt = performance.now(); }
        if ((rescSyncT -= dt) <= 0) { rescSyncT = 1 / CFG.RESCUE_SYNC_HZ; for (const g of ev.prog) sendW({ k: 'rs', v: g.v, p: Math.round(g.p * 1000), n: g.n }); }
        for (const v of ev.cancel) sendW({ k: 'rs', v, p: 0, n: 0 });
        for (const v of ev.done) { const q = ++rokQ; sendW({ k: 'rok', v, q }); rokPend.push({ t: 0.3, v, q }, { t: 0.8, v, q }); applyRescued(v, q); }
        for (let i = rokPend.length - 1; i >= 0; i--) if ((rokPend[i].t -= dt) <= 0) { sendW({ k: 'rok', v: rokPend[i].v, q: rokPend[i].q }); rokPend.splice(i, 1); }   // kirim ulang: paket hilang; penerima menyaring q yang sama
      }
      if (rescHold) {   // bar progres: prediksi halus di antara siaran host
        const tgt = Math.min(1, rescProg + ((performance.now() - rescAt) / 1000) * Math.min(rescN, CFG.RESCUE_MAX_MUL) / CFG.RESCUE_HOLD_SECONDS);
        rescShow += (tgt - rescShow) * Math.min(1, dt * 12); if (rescueBarRef.current) rescueBarRef.current.style.transform = 'scaleX(' + rescShow.toFixed(3) + ')';
      }
    };
    // ---- STAGE 4: kamera penonton (online, 'bound'): ikuti rekan berstatus 'play' (default orang ketiga di belakang rekan; L/R ganti; 3rd/1st = sudut pandang rekan). Tanpa input gerak; kamera dihaluskan + anti-tembus (raycast).
    // Chat/voice/mic tidak disentuh. Ping 1 titik / 20 dtk (penanda untuk rekan), teriak 30 dtk (berisik: otoritas monster menyelidiki). Diselamatkan / tidak ada rekan -> transisi singkat kembali ke kamera sendiri. ----
    const pings = net ? new PingMarkers(scene) : null;
    const pingCd = new Cooldown(CFG.PING_COOLDOWN), shoutCd = new Cooldown(CFG.SHOUT_COOLDOWN), nowS = () => performance.now() / 1000;
    const _so = new THREE.Vector3(), _sd = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _se = new THREE.Euler(0, 0, 0, 'YXZ');
    let specOn = false, specId = '', specMode: SpecMode = 'third', specOrder: string[] = [], specHeadP: SpecPose | null = null, specD = 0, specLast: SpecPose | null = null, specBack = 0, specKey = '', cdKey = '';
    const specSeen = new Map<string, number>();
    const dip = () => { const f = fadeRef.current; if (!f) return; f.style.transition = 'none'; f.style.opacity = '0.9'; requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity .35s ease-out'; f.style.opacity = '0'; })); };   // potong kamera jauh: dip hitam singkat
    S.specMove = (dir) => { if (!specOn) return; const id = specCycle(specOrder, specId, dir); if (id) specId = id; };
    S.specMode = () => { if (specOn) specMode = specMode === 'third' ? 'first' : 'third'; };
    /** Ping / teriak masuk (semua klien; pengirim sendiri dipanggil lokal). Penerima hanya menerima dari korban 'bound' dan membuang yang lebih rapat dari cooldown. */
    const specNet = (from: string, e: NetWorldEvent) => {
      if (e.k !== 'ping' && e.k !== 'shout') return;
      const t = nowS(), key = from + e.k, cd = e.k === 'ping' ? CFG.PING_COOLDOWN : CFG.SHOUT_COOLDOWN;
      if (from !== monSelf) {
        const rv = net?.client.sample().find((r) => r.id === from);
        if (!rv || rv.state.bd === undefined) return;
        if (t - (specSeen.get(key) ?? -1e9) < cd * 0.8) return;
      }
      specSeen.set(key, t);
      if (e.k === 'ping') { pings?.add(from, nameOf(from), e.x, e.y, e.z, CFG.PING_LIFE); audio.play('flash_click', { vol: 0.7, rate: 1.5 }); return; }
      audio.play('capture_scream', { pos: { x: e.x, y: CFG.LEVEL_Y[e.l] + CFG.CAPTURE_AUDIO_Y, z: e.z }, vol: 1, rate: 1.25 });
      mctl?.noise(e.x, e.z, e.l); say(nameOf(from) + ' berteriak', 1800);
    };
    S.ping = () => {
      if (!specOn || !world || !net) return;
      const n = nowS(); if (!pingCd.ready(n)) { say('Ping siap dalam ' + Math.ceil(pingCd.left(n)) + ' dtk', 1000); return; }
      const tv = net.client.sample().find((r) => r.id === specId); if (!tv) return;
      cam.getWorldPosition(_so); cam.getWorldDirection(_sd);
      const hit = world.ix.castOccluders(_so, _sd, CFG.PING_RANGE);
      if (!hit) { say('Arahkan ke suatu titik', 1000); return; }
      pingCd.fire(n);
      const e: NetWorldEvent = { k: 'ping', x: +hit.point.x.toFixed(2), y: +hit.point.y.toFixed(2), z: +hit.point.z.toFixed(2), l: tv.state.level >= 1 ? 1 : 0 };
      sendW(e); specNet(monSelf, e);
    };
    S.shout = () => {
      if (!specOn || !net) return;
      const n = nowS(); if (!shoutCd.ready(n)) { say('Teriak siap dalam ' + Math.ceil(shoutCd.left(n)) + ' dtk', 1000); return; }
      shoutCd.fire(n);
      const e: NetWorldEvent = { k: 'shout', x: +player.x.toFixed(2), z: +player.z.toFixed(2), l: player.level >= 1 ? 1 : 0 };
      sendW(e); specNet(monSelf, e);
    };
    /** Per frame, SESUDAH kamera sendiri dipasang: timpa dengan kamera penonton, atau (baru berhenti menonton) campur singkat dari pose penonton terakhir ke kamera sendiri. */
    const specFrame = (dt: number) => {
      if (!net || !remotes || !world) return;
      const bound = boundSlot >= 0 && S.status === 'dead' && boundFade <= 0;
      const views = net.client.sample(), ids = bound ? specIds(views) : [], nid = bound ? specPick(ids, specId, specOrder) : '';
      if (bound) specOrder = ids;
      const tv = nid ? views.find((r) => r.id === nid) : undefined;
      if (!tv) {
        if (specOn) { specOn = false; specBack = CFG.SPEC_BACK_SECONDS; }
        specId = ''; specHeadP = null; remotes.hideBody = ''; if (!bound) specMode = 'third';
      } else {
        specOn = true; specId = nid;
        const head = specHead(tv.state), jump = !specHeadP || poseDist(specHeadP, head) > CFG.SPEC_SNAP_DIST;   // loncatan jauh (ganti ke rekan di lantai lain / awal): potong + dip, bukan terbang menembus dinding
        if (jump) dip();
        specHeadP = jump ? head : smoothPose(specHeadP as SpecPose, head, dt, CFG.SPEC_LERP);
        const o = specDir(specHeadP, CFG.SPEC_DIST, CFG.SPEC_UP), want = specMode === 'third' ? o.len : 0;
        specD = jump ? want : specD + (want - specD) * (1 - Math.exp(-CFG.SPEC_LERP * dt));
        let d = specD;
        if (d > CFG.SPEC_MIN_DIST) {   // anti-tembus: raycast dari kepala rekan ke arah kamera; tarik maju seketika bila ada dinding/furniture (melebar kembali mulus lewat specD)
          _so.set(specHeadP.x, specHeadP.y, specHeadP.z); _sd.set(o.x, o.y, o.z);
          const hit = world.ix.castOccluders(_so, _sd, d + CFG.SPEC_CLIP_PAD);
          d = clipDist(d, hit ? hit.dist : null, CFG.SPEC_CLIP_PAD, CFG.SPEC_MIN_DIST);
        }
        const pose = specCamPose(specHeadP, d, CFG.SPEC_DIST, CFG.SPEC_UP);
        cam.position.set(pose.x, pose.y, pose.z); cam.rotation.set(pose.pitch, pose.yaw, 0);
        specLast = pose; remotes.hideBody = d < 0.8 ? nid : '';   // kamera di dalam kepala rekan: badannya tidak digambar
      }
      if (!specOn && specBack > 0 && specLast) {   // transisi kembali ke kamera sendiri
        specBack = Math.max(0, specBack - dt); const k0 = 1 - specBack / CFG.SPEC_BACK_SECONDS, k = k0 * k0 * (3 - 2 * k0);
        _q1.copy(cam.quaternion); _q0.setFromEuler(_se.set(specLast.pitch, specLast.yaw, 0)).slerp(_q1, k); cam.quaternion.copy(_q0);
        cam.position.set(specLast.x + (cam.position.x - specLast.x) * k, specLast.y + (cam.position.y - specLast.y) * k, specLast.z + (cam.position.z - specLast.z) * k);
        if (specBack <= 0) specLast = null;
      }
      const key = specOn ? specId + '|' + specMode + '|' + ids.length : '';
      if (key !== specKey) { specKey = key; setSpec(specOn ? { id: specId, name: nameOf(specId), mode: specMode, n: ids.length } : null); }
      if (specOn) { const n = nowS(), p = Math.ceil(pingCd.left(n)), sh = Math.ceil(shoutCd.left(n)), ck = p + '/' + sh; if (ck !== cdKey) { cdKey = ck; setSpecCd({ p, s: sh }); } }
      pings?.update(cam);
    };
    /** Menang / kalah online: semua pemain yang belum lolos 'bound' (dan minimal satu bound) -> game over; semua lolos lewat exit -> menang. 'bound' tidak dihitung lolos. */
    const outcomeFrame = (dt: number) => {
      if (!net || winOn || S.status === 'over' || S.status === 'loading' || S.status === 'error') return;
      const rs = net.client.sample().filter((r) => !r.stale), meEsc = S.status === 'escaped', meBd = boundSlot >= 0 && S.status === 'dead' && boundFade <= 0;
      if (meEsc && rs.every((r) => !!r.state.es)) { winOn = true; setWinUi(true); return; }
      const stuck = (meEsc || meBd) && rs.every((r) => !!r.state.es || r.state.bd !== undefined) && (meBd || rs.some((r) => r.state.bd !== undefined));
      boundAllT = stuck ? boundAllT + dt : 0; if (boundAllT >= CFG.BOUND_ALL_DELAY) gameOver();
    };
    /** Hold selesai: kontrol & state pemain dipulihkan, lalu bangun (WakeUp dari opening: fade-in, blur/vignette turun, suara jernih). Posisi tetap di ruangan tujuan. */
    const wakeFromCapture = () => {
      if (!world || S.status !== 'dead') { resetCapture(); return; }
      const bs = world.prisonOn ? world.bindPrison(bindSlot >= 0 ? bindSlot : 0) : null;   // STAGE 2: dipindah ke slot penjara (layar gelap) lalu digantung; penjara belum dimuat -> alur bangun lama
      if (bs) { enterBound(bs); return; }
      const w = world, pt = safeWakePoint((x, z) => w.cw.blocked(x, z, CFG.PLAYER_RADIUS, player.level), player.x, player.z, 3);   // furnitur bergeser saat gelap: jangan bangun di dalam benda
      if (pt) { player.x = pt.x; player.z = pt.z; }
      capSubHide(); capture = null; capOut = null; capBlack = -1; capMuffle = -1; faintBeat.update(0, 0); dragMode = 'none'; dragWait = 0; dragTrail.clear();
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stamina.current.reset(); sodaT.current = 0; pos.pitch = 0; S.resetInput?.();
      wake = new WakeUp({ duration: CFG.CAPTURE_WAKE_SECONDS, maxBlur: CFG.CAPTURE_WAKE_BLUR, reduced: jsReduced, seed: Math.floor(Math.random() * 1e6) }); capWake = true;
      applyWakeFx(wakeEl, wake.peek(), wakeLast);   // kanvas sudah hampir hitam SEBELUM overlay dilepas: tanpa kedip
      setDeadScreen(0, false); setDeadReady(false);
      S.status = 'play'; setStatus('play'); force();   // kebal CAPTURE_GRACE dihitung otoritas saat flag 'tertangkap' hilang (monsterctl.trackWake)
    };
    let monSeed = -1, monNavPrison = false;   // STAGE B: nav monster lantai atas harus mencakup koridor + penjara (tersambung fisik); bila penjara baru selesai dimuat sesudah monster dibuat, bangun ulang sekali
    const setupMonster = (seed: number) => {
      capAudio.clear(); mctl?.dispose(); mctl = null; js = null; jsFrame = null; respawnIn = 0; monStep = 0; dragMode = 'none'; dragWait = 0; dragTrail.clear(); mview?.endGrab(); jsFxHide(); if (jsMuffled && !wake) audio.setMuffle(0); jsMuffled = false; faintBeat.update(0, 0); setDeadScreen(0, false); setDeadReady(false);
      if (!CFG.MONSTER_ENABLED || !world || !mview || !mview.ready) return;
      const nav = world.buildMonsterNav(), top = world.stairTop(); if (!nav || !top) return;   // lantai atas tidak terjangkau: tanpa monster
      monSeed = seed; monNavPrison = world.prisonOn;
      const w = world;
      const lo = CFG.MONSTER_TWO_FLOORS ? w.buildMonsterNavLower() : null, st = w.stair;   // dua lantai: lantai bawah + tangga (null -> hanya lantai atas)
      const multi = lo && st ? { navLo: lo, stair: st } : undefined;
      mctl = new MonsterController(() => new MonsterSim(nav, w.cw, CFG.MONSTER_LEVEL, seed, w.monsterEnv, top, multi, w.dragEnv()), monIO, () => performance.now());
      mctl.onCatchSelf = (drag, slot) => startJumpscare(drag, slot);
      w.monsterPos = () => { const v = mctl?.view; return v && v.active && !v.stale && !v.onStairs ? v : null; }; // pintu berhenti sebelum menimpa monster di ambang
      mctl.onCatch = (ev) => { capAudio.accept(ev, monSelf, { x: player.x, z: player.z, level: player.level }); if (net) say(nameOf(ev.id) + ' captured', 2400); };   // posisi pendengar = pemain lokal saat kejadian diterima
    };
    /** Tertangkap: kontrol berhenti (status 'dead'), kamera -> monster, tangan menjangkau & menutupi, teriakan, lalu mati/respawn. Dipanggil sekali per tangkapan. */
    const startJumpscare = (drag = false, slot?: number) => {
      if (js || !mview || !mview.ready || !world || S.status !== 'play') return;
      bindSlot = slot !== undefined && slot >= 0 && slot < PRISON_SLOTS.length ? slot : Math.floor(Math.random() * PRISON_SLOTS.length);   // slot dipilih otoritas (pesan tangkapan)
      stopRescue(); js = new Jumpscare(jsReduced); jsFrame = null; mview.beginGrab(); respawnIn = 0;
      dragMode = drag ? 'wait' : 'none'; dragWait = 0; dragTrail.clear(); // drag: otoritas monster sudah memilih ruangan tujuan; alur lama (respawn) bila tidak ada
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stick.id = -1; stick.vx = stick.vy = 0; look.id = -1;
      S.status = 'dead'; setStatus('dead'); setBag(false); setNoteView(null);
      world.abortHide(); // tertangkap: slot loker (bila sedang bersembunyi) dibebaskan di server
    };
    const endJumpscare = () => {
      js = null; jsFrame = null; mview?.endGrab(); jsFxHide();
      if (dragMode !== 'none' && CFG.CAPTURE_POV_ENABLED) { dragWait = 0; beginCapture(); return; }   // TAHAP 3: tanpa teks; layar terbuka lalu perlahan gelap selama diseret
      setDeadScreen(1, true);
      if (dragMode !== 'none') { dragWait = 0; return; }   // akan diseret: tidak respawn; tetap tertangkap sampai transisi bangun (TAHAP 3)
      dragMode = 'wait'; dragWait = CFG.MONSTER_DRAG_WAIT;   // STAGE 2: tanpa respawn otomatis. Tidak ada seretan -> langsung dipindah & digantung (monsterFrame -> dragArrived)
    };
    /** Seretan selesai (atau tak pernah dimulai): pemain TETAP tertangkap di posisinya. TAHAP 3 menghubungkan transisi bangun di sini. Solo: tombol Main lagi tetap tersedia. */
    const dragArrived = () => { if (dragMode === 'held') return; dragMode = 'held'; dragTrail.clear(); if (!capture && CFG.CAPTURE_POV_ENABLED && S.status === 'dead') beginCapture(); if (capture) capture.arrive(); else if (!net) setDeadReady(true); };
    const respawnLocal = () => {
      if (!world) return; resetCapture(); clearBound(); dragMode = 'none'; const spawns = world.spawnPoints(roster.map((sl) => sl.offset)), pt = spawns[net ? net.slot : 0] || world.spawn;
      player.level = 0; player.y = 0; player.onStairs = false; player.x = pt.x; player.z = pt.z; pos.yaw = world.spawn.yaw; pos.pitch = 0;
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); stamina.current.reset(); sodaT.current = 0;
      S.status = 'play'; setStatus('play'); setDeadScreen(0, false); // kebal ~16 dtk dihitung otoritas (monsterctl.GRACE_AFTER_CATCH)
    };

    const beginRun = () => {
      if (!world) return;
      resetCapture(); clearBound(); winOn = false; setWinUi(false); rescueHost.clear(); scareFx.reset(); applyBlur(wakeEl, 0, wakeLast);
      const runInfo = world.startRun(net ? net.seed : undefined); // seed baru tiap mulai / restart (kecuali MAP_SEED diset); online: seed room supaya layout sama untuk semua pemain
      if (net && wsync) { wsync.reset(); world.missionHost = net.hostId === net.client.selfId; world.netSink = (e) => { const m = wsync.local(e); if (m) net.client.sendWorld(m); }; netLive = true; }
      const spawns = world.spawnPoints(roster.map((sl) => sl.offset)); // slot 0 = titik spawn asli (tidak berubah); slot lain di sekitarnya, bebas collision
      players.current.forEach((p, i) => {
        const pt = spawns[net ? net.slot : live.current[i].index] || world!.spawn;
        p.inventory.clear(); p.inventory.add('battery', CFG.START_BATTERIES); // battery awal di inventory
        p.level = 0; p.y = 0; p.onStairs = false; p.noteIdx = 0; p.x = pt.x; p.z = pt.z; p.yaw = world!.spawn.yaw; p.pitch = 0;
      });
      fl.current.reset(); stamina.current.reset(); sodaT.current = 0;
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); setFlOn(false); showPct(100); showStam(100); setTired(false);
      pos.yaw = world.spawn.yaw; pos.pitch = 0;
      if (CFG.OPENING_ENABLED && !opened) {
        opened = true;
        wake = new WakeUp({ duration: CFG.OPENING_SECONDS, maxBlur: CFG.OPENING_BLUR_PX, reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, seed: Math.floor(Math.random() * 1e6) });
        applyWakeFx(wakeEl, wake.peek(), wakeLast); // layar sudah hampir hitam sebelum game tampil
      }
      if (pz.current.hide()) syncMenu(); // restart tidak pernah mewarisi menu terbuka
      setupMonster(runInfo.seed); // monster lantai atas untuk run ini (kontroler baru, jumpscare/respawn direset)
      S.status = 'play'; setStatus('play'); setBag(false); setNoteView(null); force();
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
      if (net && !rescHold) { const rv = rescueTarget(); if (rv) { startRescue(rv); return; } }   // STAGE 3: korban 'bound' di depan: tahan tombol = melepaskan
      if (rescHold) return;
      world.ix.refresh(cam, ctx); // target terbaru tepat saat tombol ditekan
      if (world.interactBlocked(player)) { say('Tidak terjangkau', 900); return; } // tidak boleh menembus dinding
      if (!world.ix.activate(ctx)) say('Tidak ada yang bisa dilakukan', 1000);
    };

    S.actUp = () => stopRescue();
    // model monster OPSIONAL: bila unduhan macet >45 dtk -> lanjut tanpa monster (hasil yang datang terlambat langsung dibuang)
    const mvP: Promise<MonsterView | null> = CFG.MONSTER_ENABLED ? new Promise((res) => {
      let late = false; const t = setTimeout(() => { late = true; res(null); }, 45000);
      MonsterView.load(scene, CFG.MONSTER_URL).then((m) => { if (late) m?.dispose(); else { clearTimeout(t); res(m); } }, () => { clearTimeout(t); res(null); });
    }) : Promise.resolve(null); // model monster dimuat paralel dengan map; gagal -> game tanpa monster
    GameWorld.load(scene, () => { /* layar Loading hanya tampil sampai map selesai; tanpa persentase */ })
      .then(async (w) => {
        const mv = await mvP;
        if (cancelled) { w.dispose(); mv?.dispose(); return; }
        world = w; worldRef.current = w; w.audio = audio;
        w.onRoomChange = () => force();
        w.onKeypad = () => { if (S.status !== 'play') return; S.kp = true; setKp(true); setKpCode(''); S.resetInput(); };
        w.onTeleport = () => { pos.yaw = player.yaw; pos.pitch = 0; const f = fadeRef.current; if (f) { f.style.transition = 'none'; f.style.opacity = '1'; requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity .9s ease-out'; f.style.opacity = '0'; })); } }; w.onScare = () => { scareFx.trigger(); }; mview = mv;
        // Loker/lemari online: server memutuskan 1 pemain per loker (lib/net/lockers.ts). Single Player: gate null -> sembunyi lokal seperti sebelumnya.
        if (net) { const lk = net.lockers; w.lockerNet = { selfId: net.client.selfId, ownerOf: (k) => lk.ownerOf(k), keyOf: (u) => lk.keyOf(u), claim: (k) => lk.claim(k), release: (k) => lk.release(k), hold: (k, f) => lk.hold(k, f), stopHold: () => lk.stopHold(), alive: () => S.status === 'play' }; }
        void w.loadPrison().then(() => { if (!cancelled && world === w && monSeed >= 0 && !monNavPrison && w.prisonOn) setupMonster(monSeed); });   // penjara: async di latar belakang; nav monster dibangun ulang bila perlu
        beginRun();
      })
      .catch((e) => { console.error(e); if (!cancelled) { S.status = 'error'; setStatus('error'); } });

    const keys: Record<string, boolean> = {};
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return; // sedang mengetik chat
      if (!pz.current.frozen) audio.unlock(); // pause solo: audio tetap diam
      const key = e.key.toLowerCase();
      if (S.kp) { if (S.kpKey(e.key)) e.preventDefault(); return; } // keypad terbuka: hanya digit/hapus/enter/escape
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
      if (S.status === 'dead') { if (e.key === 'ArrowLeft') S.specMove(-1); else if (e.key === 'ArrowRight') S.specMove(1); else if (key === 'v') S.specMode(); else if (key === 'p') S.ping(); else if (key === 'g') S.shout(); }   // STAGE 4: penonton
      if (key === 't' || key === 'enter') { if (net) { e.preventDefault(); setChatOpen(true); setTimeout(() => chatIn.current?.focus(), 30); } }
      if (key >= '1' && key <= '9') useSlotRef.current(+key - 1);
    };
    const ku = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; if (e.key.toLowerCase() === 'e') S.actUp(); };
    const blur = () => { for (const k in keys) keys[k] = false; S.actUp(); };
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
      if (S.status === 'dead' && boundSlot < 0) return; // tertangkap: kontrol berhenti (menoleh pun terkunci); digantung (STAGE 2): boleh menoleh sedikit (dibatasi per frame)
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

    let raf = 0, last = performance.now(), eye = EYE, bobT = 0, bobAmp = 0, bobRate = 7.5, rollAmp = 0, mvK = 0, lastPrompt: string | null = null;
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
    const _hp = new THREE.Vector3(), _gp = new THREE.Vector3();
    /** Logika monster per frame: otoritas/replika, bahaya -> detak jantung + HUD + vignette, model 3D, langkah, jumpscare, respawn. */
    const monsterFrame = (dt: number, simulate: boolean) => {
      for (const c of capAudio.update(dt)) audio.play(c.name, { pos: c.pos, vol: c.vol, rate: c.rate });   // TAHAP 4 (berlapis: dengung + teriakan rendah->tinggi + benturan; rate = nada): teriakan/benturan tangkapan di lokasi kejadian (3D, falloff jarak)
      const he = heartRef.current;
      if (!world || !mctl || !mview || !mview.ready) { if (he && he.style.opacity !== '0') he.style.opacity = '0'; return; }
      const live = (S.status === 'play' && simulate) || S.status === 'dead' || (!!net && S.status === 'escaped');   // STAGE 3: pemain yang sudah lolos tetap menjalankan monster (otoritas) untuk yang masih di dalam   // pause solo membekukan monster; saat 'dead' otoritas tetap berjalan
      const v = mctl.view, lvY = world.monsterFloorY(v.level, v.onStairs, v.x);   // tinggi lantai di bawah monster (lantai 1/2 atau anak tangga)
      const selfObs: PlayerObs = { id: monSelf, x: player.x, z: player.z, level: player.level, gait: gaitName(netGait), crouch: S.crouch, hidden: !!world.hiding || world.inBunkerRoom || world.inPrisonRoom || S.status === 'escaped', grace: 0, stairs: player.onStairs, caught: S.status === 'dead', ...(boundSlot >= 0 ? { bound: boundSlot } : {}) };
      if (live) {
        const rem: PlayerObs[] = net ? net.client.sample().map((rv) => ({ id: rv.id, x: rv.state.x, z: rv.state.z, level: rv.state.level, gait: gaitName(rv.state.gait), crouch: !!rv.state.crouch, hidden: !!rv.state.hide || !!rv.state.es || inBunker(rv.state.x, rv.state.z) || inPrison(rv.state.x, rv.state.z), grace: 0, caught: !!rv.state.cg, ...(rv.state.bd !== undefined ? { bound: rv.state.bd } : {}), stairs: rv.state.y > CFG.LEVEL_Y[0] + 0.2 && rv.state.y < CFG.LEVEL_Y[1] - 0.2 })) : [];
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
            if (v.onStairs || v.level !== player.level) { player.level = v.level; player.onStairs = v.onStairs; player.x = v.x; player.z = v.z; dragTrail.seed(v.x, v.z); }   // STAGE 2: diseret lewat tangga: menempel di monster, lantai mengikuti
            dragTrail.push(v.x, v.z);
            const b = dragTrail.behind();
            // titik jejak = jalur yang pernah dilewati monster, jadi aman; tetap divalidasi (furnitur bisa bergeser) dengan cadangan: posisi monster
            if (b && !world.cw.blocked(b.x, b.z, CFG.PLAYER_RADIUS, player.level)) { player.x = b.x; player.z = b.z; }
            else if (!world.cw.blocked(v.x, v.z, CFG.PLAYER_RADIUS, player.level)) { player.x = v.x; player.z = v.z; }
            else { const f = world.cw.freePoint(v.x, v.z, CFG.PLAYER_RADIUS, player.level, 1.5); if (f) { player.x = f.x; player.z = f.z; } }   // jejak & monster terblokir (daun pintu/locker): tetap tidak menembus, dorong ke titik bebas terdekat
            pos.yaw = v.yaw + Math.PI; pos.pitch = 0;   // terlentang menatap ke arah monster (monster menghadap +Z lokal = arah jalan; kamera menghadap -Z saat yaw 0); badan korban menjulur ke belakang
          } else dragArrived();
        }
      }
      // ---- STAGE 2: digantung di slot penjara: kamera hampir terkunci, fade-in; solo = minigame berontak; online = semua 'bound' -> game over ----
      if (boundSlot >= 0 && S.status === 'dead') {
        const sl = PRISON_SLOTS[boundSlot]; boundT += dt; player.x = sl.x; player.z = sl.z;
        pos.yaw = sl.yaw + clampN(wrapA(pos.yaw - sl.yaw), -CFG.BOUND_LOOK_YAW, CFG.BOUND_LOOK_YAW); pos.pitch = clampN(pos.pitch, CFG.BOUND_LOOK_PITCH_MIN, CFG.BOUND_LOOK_PITCH_MAX);
        if (boundFade > 0) { boundFade = Math.max(0, boundFade - dt); setDeadScreen(boundFade / CFG.BOUND_FADE_SECONDS, false); }
        if (struggleOn) {
          if (simulate) { struggleT -= dt; struggleFill = Math.max(0, struggleFill - CFG.STRUGGLE_DRAIN * dt); }
          if (strBarRef.current) strBarRef.current.style.transform = 'scaleX(' + struggleFill.toFixed(3) + ')';
          if (strTimeRef.current) strTimeRef.current.textContent = Math.max(0, Math.ceil(struggleT)) + 's';
          if (struggleFill >= 1) freeSolo(); else if (struggleT <= 0) gameOver();
        }   // online: kalah/menang dihitung di outcomeFrame (STAGE 3)
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
      if (net && remotes && show && !js && v.state === 'drag' && v.targetId && v.targetId !== monSelf && mview.wristMid(_gp)) remotes.pin(v.targetId, _gp.x, _gp.y, _gp.z, v.yaw, lvY);   // korban remote: pergelangan kaki di tangan monster (klip walk, tanpa IK lengan)
      if (live && v.active && !v.stale && d < 30 && v.speed > 0.3) { // langkah berat monster (posisional, 1 sumber, mengikuti kecepatan)
        monStep += dt; const iv = v.anim === 'run' ? 0.36 : 0.8;
        if (monStep >= iv) { monStep = 0; audio.play('entity_steps', { pos: { x: v.x, y: lvY + 0.3, z: v.z }, vol: v.anim === 'run' ? 1 : 0.75, rate: v.anim === 'run' ? 1.12 : 0.92 }); }
      }
      // ---- jumpscare & respawn ----
      if (js) {
        const f = js.update(dt); jsFrame = f; jsFx(f);
        if (!CFG.CAPTURE_AUDIO_ENABLED) for (const c of f.cues) audio.play(c.name === 'scream' ? 'monster_scream' : 'impact_slam', { vol: c.name === 'scream' ? 1 : 0.7 });   // perilaku lama; bila aktif, suara datang dari capAudio (korban + pemain lain, spasial, sekali)
        if (f.faint > 0) {   // pingsan: suara teredam + detak jantung melambat (pemutaran lokal non-posisional; suara tangkapan spasial untuk pemain lain tidak berubah)
          const q = Math.round(faintMuffle(f.faint) * 20) / 20; if (q !== capMuffle || !jsMuffled) { capMuffle = q; jsMuffled = true; audio.setMuffle(q); }
          if (faintBeat.update(dt, f.faint)) { const h = faintHeartFx(f.faint); audio.play('heartbeat', { vol: h.volume, rate: h.rate }); }
        }
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
      cam.rotation.set(pitch + f.shakeY - 0.3 * f.faint, yaw + f.shakeX, f.roll + 0.5 * f.faint); cam.updateMatrixWorld(true);   // faint: pingsan (miring & menunduk)
      const tf = fov + f.fovAdd; if (Math.abs(cam.fov - tf) > 0.05) { cam.fov = tf; cam.updateProjectionMatrix(); }
      mview.placeForJumpscare(cam, yaw, player.y, f);
      if (f.faint > 0) { cam.position.y -= 0.9 * f.faint; cam.updateMatrixWorld(true); }   // pingsan: kamera turun SETELAH monster ditempatkan (monster tidak ikut turun)
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
        remotes.update(dt, net.client.sample(), (id) => world!.occupantVisible(id), (id) => (net.client.micOf(id) ? 1 + (voice.current?.levelOf(id) ?? 0) : 0)); // penghuni loker terlihat bila pintu lokernya terbuka
        const caught = S.status === 'dead';   // tertangkap/diseret: posisi tetap dikirim agar pemain lain melihat korban dibawa monster; cg = jangan ditangkap lagi
        const escd = S.status === 'escaped';   // STAGE 3: lolos lewat exit: terus dikirim (es) supaya pemain lain menghitung & menyembunyikan modelnya
        if (playing || caught || escd) net.client.setLocal({ x: player.x, y: player.y, z: player.z, yaw: pos.yaw, pitch: pos.pitch, gait: caught ? (dragMode === 'moving' ? 1 : 0) : netGait, crouch: S.crouch || (caught && boundSlot < 0), hide: !!world.hiding, ...(caught ? { cg: true } : {}), ...(boundSlot >= 0 ? { bd: boundSlot } : {}), ...(rescHold && playing ? { rc: true } : {}), ...(escd ? { es: true } : {}), level: player.level, model: 'default' });
        rescueFrame(dt); outcomeFrame(dt);   // STAGE 3: sesi penyelamatan (host) + menang/kalah; tidak bergantung pada menu lokal
      }
      if (S.status === 'over' && (overT += dt) >= CFG.GAMEOVER_RETURN_SECONDS) { overT = -1e9; exitRef.current(); }   // STAGE 2: layar kalah lalu kembali ke lobby
      if (S.status === 'play') audio.startMusic();   // musik latar: mulai sekali begitu gameplay berjalan (guard di AudioManager; berhenti saat audio.dispose() ketika kembali ke menu)
      if (paused !== gate.muteAudio) { paused = gate.muteAudio; if (S.status === 'play') { if (paused) audio.suspend(); else audio.unlock(); } } // audio diam hanya saat pause solo (freeze)
      // PAUSE SOLO: seluruh simulasi berhenti (world.update: musuh/SCP/event/timer/pintu/lampu, gerak, senter, stamina, opening/scare fx).
      // Hanya render ulang frame terakhir; `last` tetap diperbarui di atas sehingga tidak ada lonjakan dt saat RESUME.
      if (playing && !gate.simulate) { draw(t); return; }
      const inputOn = gate.input && !S.kp; // multiplayer overlay: simulasi jalan terus, tetapi input lokal mati
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
      if (playing && sodaT.current > 0) sodaT.current = Math.max(0, sodaT.current - dt);
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
      const speed = (S.crouch ? CFG.CROUCH_SPEED : running ? CFG.SPRINT_SPEED : CFG.WALK_SPEED) * (player.onStairs ? STAIR_SPEED_MUL : 1) * combineSpeed(wk ? wk.speed : 1, sf.speed) * (sodaT.current > 0 ? CFG.SODA_BUFF_MUL : 1);
      const ya = pos.yaw + (wk ? wk.drift : 0); // kaki belum stabil: arah jalan sedikit melenceng (bidik tidak berubah)
      const sp = speed * dt, s = Math.sin(ya), c = Math.cos(ya);
      const dx = (-s * fwd + c * str) * sp, dz = (-c * fwd - s * str) * sp;
      const R = S.crouch ? CFG.PLAYER_RADIUS_CROUCH : CFG.PLAYER_RADIUS; // jongkok = collider lebih kecil & rendah
      const ox = player.x, oz = player.z;
      if (!hiding) world.move(player, dx, dz, R); // collision dinding/furniture/pintu + tangga (naik/turun bertahap, tanpa teleport)
      if (!hiding) world.unstick(player, R, dt, playing && (fwd !== 0 || str !== 0), Math.hypot(player.x - ox, player.z - oz)); // anti-terjepit: dorong keluar dari collider
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
      // TAHAP 5: head-bob/sway HALUS. Dulu `moving ? ... : 0` = amplitudo/roll/sway melompat seketika saat mulai/berhenti/ganti jalan<->lari (kamera "pop").
      // Sekarang faktor gerak mvK, amplitudo, kecepatan ayun, dan roll semuanya ditanjak/diturunkan eksponensial (bebas frame rate); fase hanya maju seiring gerak.
      // Gerak diukur dari jarak NYATA (menabrak dinding/pintu = bob ikut berhenti, sama seperti langkah kaki).
      const kA = 1 - Math.exp(-8 * dt), actualV = hiding ? 0 : Math.hypot(player.x - ox, player.z - oz) / Math.max(dt, 1e-3);
      const mvT = moving && actualV > 0.15 ? 1 : 0;
      mvK += (mvT - mvK) * (1 - Math.exp(-(mvT > mvK ? 9 : 7) * dt));
      bobRate += ((running ? 11 : S.crouch ? 5 : 7.5) - bobRate) * kA;
      bobAmp += ((running ? 0.035 : 0.018) * (player.onStairs ? 1.6 : 1) - bobAmp) * kA;
      rollAmp += ((running ? 0.012 : 0.005) - rollAmp) * kA;
      bobT += dt * bobRate * mvK;
      const bob = Math.sin(bobT) * bobAmp * mvK;
      swayT += dt;
      const sway = (1 - mvK) * CFG.SWAY_IDLE; // napas pelan saat diam; saat jalan cukup head bob (tidak mengubah arah bidik berarti)
      const roll = Math.cos(bobT * 0.5) * rollAmp * mvK + Math.sin(swayT * 0.7) * CFG.SWAY_IDLE * (1 - mvK);
      const cp = capture && S.status === 'dead' ? capOut : null;   // goyang/terkulai saat diseret (visual saja)
      cam.position.set(player.x, player.y + eye + bob + (wk ? wk.dip : 0) + (cp ? cp.dip : 0), player.z);
      cam.rotation.set(pos.pitch + Math.sin(swayT * 1.1) * sway + (wk ? wk.pitch : 0) + (cp ? cp.pitch : 0), pos.yaw + (wk ? wk.yaw : 0), roll + (wk ? wk.roll : 0) + (cp ? cp.roll : 0)); // offset opening hanya visual
      if (boundSlot >= 0 && S.status === 'dead') {   // STAGE 2: tergantung: mata sedikit lebih rendah, ayun pelan (visual saja)
        cam.position.set(player.x + Math.sin(boundT * 0.9) * 0.05, player.y + 1.55 + Math.sin(boundT * 1.3) * 0.025, player.z + Math.cos(boundT * 0.7) * 0.03);
        cam.rotation.set(pos.pitch + Math.sin(boundT * 0.7) * 0.02, pos.yaw, Math.sin(boundT * 0.9) * 0.035);
      }
      specFrame(dt);   // STAGE 4: kamera penonton menimpa kamera sendiri saat 'bound' online
      cam.updateMatrixWorld(true);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, pos.yaw, dt);
      world.playerDragged = dragMode === 'moving' && S.status === 'dead';
      world.update(dt, t, player, cam, ctx, playing);
      monsterFrame(dt, gate.simulate);
      if (capture && S.status === 'dead' && !js) {   // TAHAP 3: overlay gelap + peredam audio ikut gelap; selesai hold -> bangun
        const o = capture.update(dt); capOut = o; setCaptureBlack(o.black); capSubUpdate(o);
        const mq = Math.round(o.muffle * 20) / 20; if (mq !== capMuffle) { capMuffle = mq; audio.setMuffle(mq); }
        if (faintBeat.update(dt, 1)) { const h = faintHeartFx(1); audio.play('heartbeat', { vol: h.volume, rate: h.rate }); }   // masih pingsan (diseret): detak tetap lambat sampai bangun
        if (o.wake || (capture && performance.now() - capStart > (CFG.MONSTER_DRAG_MAX_SECONDS + CFG.CAPTURE_WATCHDOG_SECONDS) * 1000)) wakeFromCapture();   // watchdog: capture > 7 dtk dipaksa bangun
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
      hemi.intensity = CFG.AMBIENT * (specOn ? CFG.SPEC_AMBIENT_MUL : 1) * (0.2 + 0.8 * world.lightMul) * (CFG.LFX_DARK_AMBIENT + (1 - CFG.LFX_DARK_AMBIENT) * world.lightDim); // lampu padam -> ambient ikut turun

      // prompt crosshair (state hanya berubah bila teks berubah)
      const p = inputOn ? (world.hiding ? world.hidePrompt() : world.ix.prompt(ctx) ?? ((rescHold || rescueTarget()) ? 'RESCUE' : null)) : null;   // STAGE 3: 'RESCUE' = tahan tombol tangan pada korban 'bound'
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
      offNet(); offWorld?.(); if (digestTimer) clearInterval(digestTimer); remotes?.dispose(); pings?.dispose(); mctl?.dispose(); mview?.dispose(); mctl = null; mview = null;
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

  const specUi = !!spec && status === 'dead';   // STAGE 4: penonton aktif (HUD chat/voice tetap, kontrol gerak tidak ada)
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
      <div ref={bloodRef} aria-hidden style={{ display: 'none', position: 'absolute', inset: 0, zIndex: 35, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 'var(--bl)', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 32%, rgba(120,0,10,.5) 66%, rgba(50,0,0,.92) 100%)' }} />
        {BLOOD_SPLATS.map(([l, t, s], i) => <i key={'s' + i} style={{ position: 'absolute', left: l + '%', top: t + '%', width: s, height: s, marginLeft: -s / 2, marginTop: -s / 2, borderRadius: '50%', background: 'radial-gradient(circle, rgba(140,0,12,.95) 0 30%, rgba(110,0,10,.75) 48%, rgba(80,0,8,0) 72%)', opacity: 'calc((var(--bl) - ' + (i * 0.07).toFixed(2) + ') * 2)', transform: 'scale(calc(.55 + .45 * var(--bs)))' }} />)}
        {BLOOD_DRIPS.map(([l, h], i) => <i key={'d' + i} style={{ position: 'absolute', left: l + '%', top: 0, width: 5, height: h, borderRadius: '0 0 6px 6px', background: 'linear-gradient(#7a0008, #4a0004)', opacity: 'var(--bl)', transformOrigin: 'top', transform: 'scaleY(var(--bs))' }} />)}
        <div style={{ position: 'absolute', inset: 0, opacity: 'var(--bl)', boxShadow: 'inset calc(var(--ca) * 1px) 0 calc(var(--ca) * 2.2px) rgba(255,20,40,.45), inset calc(var(--ca) * -1px) 0 calc(var(--ca) * 2.2px) rgba(30,90,255,.4)' }} />
      </div>
      <div ref={deadRef} className={'deadscreen' + (deadReady ? ' ready' : '')} aria-live="polite">
        <div className="deadtxt">KAMU TERTANGKAP</div>
        <div ref={subRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: '18%', padding: '0 24px', opacity: 0, textAlign: 'center', pointerEvents: 'none', color: '#d9d2c8' }}>
          <div ref={subTxtRef} style={{ minHeight: '1.4em', fontSize: 'clamp(15px,2.6dvh,22px)', letterSpacing: '.04em' }} />
          <span ref={subTimeRef} style={{ display: 'block', marginTop: 8, fontSize: 12, opacity: 0.6 }} />
          <div style={{ width: 'min(240px,60%)', height: 2, margin: '6px auto 0', background: 'rgba(255,255,255,.15)' }}>
            <div ref={subBarRef} style={{ height: '100%', background: '#a3151c', transformOrigin: 'left center' }} />
          </div>
        </div>
        {deadReady && !net && (
          <div className="row" style={{ maxWidth: 320 }}>
            <button className="gbtn" onClick={() => { setDeadReady(false); st.current.restart(); }}><RotateCcw size={16} /> Main lagi</button>
            <button className="gbtn" onClick={onExit}><LogOut size={16} /> Keluar</button>
          </div>
        )}
      </div>
      {status === 'play' && hfx && <div className={'hidefx ' + hfx.kind} style={{ opacity: hfx.a }} aria-hidden>{hfx.kind === 'locker' ? <><i /><b /><i /><b /><i /><b /><i /><b /><i /></> : <><i /><s /></>}</div>}
      {((status === 'play' && !hfx) || specUi) && <div className="crosshair" aria-hidden />}
      {status === 'play' && prompt && <div className="ixprompt">{prompt}</div>}
      <div className="playhud">
        {net
          ? <div className="slotinfo">{modeLabel(net.maxPlayers as PlayerMode)} · {1 + net.client.remoteCount}/{net.maxPlayers} online · {net.client.status === 'online' ? 'ROOM ' + net.code : net.client.status === 'reconnecting' ? 'MENYAMBUNG ULANG...' : net.client.status === 'connecting' ? 'MENYAMBUNG...' : 'TERPUTUS'}</div>
          : roster.length > 1 && <div className="slotinfo">{modeLabel(roster.length as PlayerMode)} · {live.current.length}/{roster.length} slot · offline</div>}
      </div>
      {(status === 'play' || specUi) && (
        <div className="hudpill" onContextMenu={(e) => e.preventDefault()}>
          {status === 'play' && <button className={menu.open ? 'on' : ''} onClick={toggleMenu} aria-label={menu.open ? 'Tutup menu' : 'Menu'} aria-haspopup="dialog" aria-expanded={menu.open}><Menu size={20} /></button>}
          {status === 'play' && <button className={bag ? 'on' : ''} onClick={() => setBag((b) => !b)} aria-label="Inventory"><Backpack size={20} /></button>}
          {net && <button className={chatOpen ? 'on' : ''} onClick={() => { setChatOpen((o) => !o); setTimeout(() => chatIn.current?.focus(), 30); }} aria-label="Chat"><MessageSquare size={20} /></button>}
          {net && (() => { const v = voice.current, ms = v?.state ?? 'off', dot = <span aria-hidden="true" style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: v?.connected ? '#7be08c' : '#8a8a8a' }} />; return <>
            <button className={'mic ' + (v?.listening ? 'on' : 'off')} style={{ position: 'relative' }} onClick={toggleAudio} aria-label={v?.listening ? 'Matikan audio voice' : 'Nyalakan audio voice'}>{v?.listening ? <Volume2 size={20} /> : <VolumeX size={20} />}{dot}</button>
            <button className={'mic ' + ms} style={{ position: 'relative' }} onClick={toggleMic} aria-label="Voice chat">{ms === 'on' ? <Mic size={20} /> : <MicOff size={20} />}{dot}</button></>; })()}
        </div>
      )}
      {noteView && (
        <div role="dialog" aria-label="Catatan" onClick={() => setNoteView(null)} style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(86vw, 340px)', padding: '26px 24px 18px', transform: 'rotate(-1.6deg)', color: '#1d2740', borderRadius: 3, boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            background: 'repeating-linear-gradient(#e9dfbd 0 29px, #cfc49c 29px 30px)', fontFamily: "'Segoe Print','Bradley Hand','Chalkboard SE','Marker Felt','Comic Sans MS',cursive", fontSize: 21, lineHeight: '30px', textShadow: '0 0 1px rgba(29,39,64,0.35)' }}>
            <div style={{ minHeight: 90, whiteSpace: 'pre-wrap' }}>{noteView.text}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 14, lineHeight: '20px', fontFamily: 'inherit' }}>
              <span style={{ opacity: 0.6 }}>{noteView.i + 1}/{noteView.n}</span>
              <span>
                {noteView.n > 1 && <button className="gbtn small" style={{ marginRight: 8 }} onClick={() => useItem('note')}>Berikutnya</button>}
                <button className="gbtn small" onClick={() => setNoteView(null)}>Tutup</button>
              </span>
            </div>
          </div>
        </div>
      )}
      {status === 'play' && worldRef.current && (() => {
        const ms = worldRef.current.missionState(), w = worldRef.current;
        const rows: [string, string, boolean][] = [['key', 'Kunci terkumpul', ms.key], ['switch', 'Puzzle saklar', ms.switch], ['code', 'Puzzle kode', ms.code]];
        const dbg = process.env.NODE_ENV !== 'production' || (typeof location !== 'undefined' && /[?&]debugmission=1/.test(location.search));
        return (
          <div className="missionhud" style={{ position: 'fixed', left: 12, top: 88, zIndex: 6, font: '12px/1.5 monospace', color: '#e8e2d0', textShadow: '0 1px 2px #000', pointerEvents: dbg ? 'auto' : 'none' }}>
            {w.bunkerOn && w.roomDigits().some((d) => d !== null) && !ms.code && <div style={{ color: '#9fe3b0' }}>Kode: {w.roomDigits().map((d) => (d === null ? '_' : d)).join(' ')}</div>}
            {rows.map(([id, label, done]) => (
              <div key={id} style={{ opacity: done ? 0.6 : 1 }}>
                <span aria-hidden>{done ? '[x]' : '[ ]'}</span> {label}
                {dbg && !done && <button style={{ marginLeft: 6, fontSize: 10, padding: '0 4px' }} onClick={() => (id === 'key' ? w.debugOpenLocks() : w.completeMission(id as 'switch' | 'code'))}>debug</button>}
              </div>
            ))}
          </div>
        );
      })()}
      <div ref={fadeRef} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 40, background: '#000', opacity: 0, pointerEvents: 'none' }} />
      {status === 'play' && kp && (
        <div role="dialog" aria-label="Panel kode" style={{ position: 'fixed', inset: 0, zIndex: 45, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)' }} onContextMenu={(e) => e.preventDefault()}>
          <div style={{ background: '#0c110e', border: '2px solid #5a6a5c', borderRadius: 8, padding: 16, width: 250, font: '16px monospace', color: '#cfe8d2', textAlign: 'center' }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>SUBSTASIUN 7 - MASUKKAN KODE</div>
            <div style={{ fontSize: 34, letterSpacing: 10, padding: '8px 0', background: '#050806', border: '1px solid #2e3b31', marginBottom: 10, color: '#47ff8a', minHeight: 56 }}>{(kpCode + '____').slice(0, 4).split('').join(' ')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Backspace', '0', 'Enter'].map((k) => (
                <button key={k} className="gbtn" style={{ padding: '12px 0', fontSize: 18 }} onClick={() => kpPress(k)}>{k === 'Backspace' ? '⌫' : k === 'Enter' ? 'OK' : k}</button>
              ))}
            </div>
            <button className="gbtn small" style={{ marginTop: 10 }} onClick={closeKp}>Tutup</button>
          </div>
        </div>
      )}
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
      {(status === 'play' || specUi) && net && (() => {
        const now = Date.now(), vis = chatOpen ? chatLog.slice(-8) : chatLog.filter((c) => now - c.at < 10000).slice(-5);
        if (!vis.length && !chatOpen) return null;
        return (
          <div className={'chatbox' + (chatOpen ? ' open' : '')} onContextMenu={(e) => e.preventDefault()}>
            <div className="chatlog">{vis.map((c, i) => <div key={c.at + '-' + i} className={'chatline' + (c.self ? ' me' : '')}><b>{c.name}</b> {c.text}</div>)}</div>
            {chatOpen && (
              <div className="chatin">
                <input ref={chatIn} maxLength={80} placeholder="Ketik pesan…" autoComplete="off" enterKeyHint="send"
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); sendChat(); } else if (e.key === 'Escape') { setChatOpen(false); (e.target as HTMLInputElement).blur(); } }} />
                <button onClick={sendChat} aria-label="Kirim"><Send size={18} /></button>
              </div>
            )}
          </div>
        );
      })()}
      {status === 'play' && (() => {
        const hs = hotSlots(), n = Math.max(6, hs.length), selI = sel < hs.length ? sel : -1;
        return (
          <div className="hotbar" onContextMenu={(e) => e.preventDefault()}>
            <div className={'stamrow' + (tired ? ' tired' : '')}>
              <svg className="stamico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="currentColor" /></svg>
              <div className={'stambar' + (tired ? ' tired' : '')} aria-label="Stamina"><i ref={stamFill} style={{ width: '100%' }} /></div>
            </div>
            <div className="hbslots">
              {Array.from({ length: n }, (_, i) => {
                const it = hs[i];
                if (!it) return <div key={'e' + i} className="hbslot empty"><em>{i + 1}</em></div>;
                const Icon = it.id === 'flash' ? Flashlight : it.key ? Key : it.id === 'battery' ? Battery : it.id === 'soda' ? Coffee : it.id === 'note' ? FileText : Plus;
                return (
                  <button key={it.id} className={'hbslot' + (selI === i ? ' sel' : '') + (it.id === 'flash' && flOn ? ' lit' : '') + (it.used ? ' used' : '') + (it.id === 'flash' && flLow ? ' low' : '')}
                    style={it.css ? { ['--c' as any]: it.css } : undefined} onPointerDown={(e) => { e.preventDefault(); useSlot(i); }} aria-label={it.label}>
                    <em>{i + 1}</em><Icon size={24} strokeWidth={2} />
                    {it.id === 'flash' ? <span ref={flTxt} className="hbq">100%</span> : it.used ? <span className="hbq">✓</span> : it.count > 1 ? <span className="hbq">{it.count}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
      {msg && <div className="playmsg">{msg}</div>}
      <LoadingScreen active={status === 'loading'} />
      {status === 'error' && <div className="playcover">Gagal memuat map.{onRetry && <button className="gbtn" onClick={onRetry}>Coba lagi</button>}<button className="gbtn" onClick={onExit}>Kembali</button></div>}
      {rescueUi && status === 'play' && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '24%', zIndex: 45, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', color: '#e6dccb' }}>
          <div style={{ fontSize: 'clamp(13px,2.2dvh,18px)', letterSpacing: '.18em', fontWeight: 700 }}>MELEPASKAN...</div>
          <div style={{ width: 'min(240px,60%)', height: 8, background: 'rgba(255,255,255,.16)', borderRadius: 4, overflow: 'hidden' }}>
            <div ref={rescueBarRef} style={{ height: '100%', background: '#d8b45a', transformOrigin: 'left center', transform: 'scaleX(0)' }} />
          </div>
        </div>
      )}
      {struggleUi && status === 'dead' && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '9%', zIndex: 45, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, pointerEvents: 'none', color: '#e6dccb' }}>
          <div style={{ fontSize: 'clamp(14px,2.4dvh,20px)', letterSpacing: '.18em', fontWeight: 700 }}>LEPASKAN DIRI!</div>
          <div style={{ width: 'min(260px,62%)', height: 8, background: 'rgba(255,255,255,.16)', borderRadius: 4, overflow: 'hidden' }}>
            <div ref={strBarRef} style={{ height: '100%', background: '#c0392b', transformOrigin: 'left center', transform: 'scaleX(0.2)' }} />
          </div>
          <span ref={strTimeRef} style={{ fontSize: 12, opacity: 0.7 }} />
          <button aria-label="Berontak" onPointerDown={(e) => { e.preventDefault(); st.current.tap(); }} style={{ pointerEvents: 'auto', width: 96, height: 96, borderRadius: '50%', border: '2px solid rgba(255,255,255,.55)', background: 'rgba(120,20,20,.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}><Hand size={44} /></button>
        </div>
      )}
      {status === 'over' && (
        <div className="playcover" style={{ zIndex: 50 }}>
          GAME OVER
          <div style={{ fontSize: 13, fontWeight: 400, letterSpacing: '.08em', opacity: 0.75 }}>{net ? 'Semua pemain tergantung di penjara' : 'Kamu tidak berhasil melepaskan diri'}</div>
          <div className="row" style={{ maxWidth: 320 }}>
            {!net && <button className="gbtn" onClick={() => st.current.restart()}><RotateCcw size={16} /> Main lagi</button>}
            <button className="gbtn" onClick={onExit}><LogOut size={16} /> Kembali ke lobby</button>
          </div>
        </div>
      )}
      {status === 'escaped' && (
        <div className="playcover">
          {winUi ? 'YOU WIN' : 'ESCAPED'}
          {net && !winUi && <div style={{ fontSize: 13, fontWeight: 400, letterSpacing: '.08em', opacity: 0.75 }}>Menunggu pemain lain</div>}
          <div className="row" style={{ maxWidth: 320 }}>
            <button className="gbtn" onClick={() => st.current.restart()}><RotateCcw size={16} /> Main lagi</button>
            <button className="gbtn" onClick={onExit}><LogOut size={16} /> Keluar</button>
          </div>
        </div>
      )}
      {specUi && spec && (
        <>
          <div className="speclabel" aria-live="polite">{spec.mode === 'third' ? <Camera size={14} aria-hidden /> : <Eye size={14} aria-hidden />}<span>{spec.name}</span></div>
          <div className="specbar" onContextMenu={(e) => e.preventDefault()}>
            <button className="fab" disabled={spec.n < 2} onPointerDown={(e) => { e.preventDefault(); st.current.specMove(-1); }} aria-label="Pemain sebelumnya"><ChevronLeft size={24} /></button>
            <button className="fab" onPointerDown={(e) => { e.preventDefault(); st.current.specMode(); }} aria-label={spec.mode === 'third' ? 'Pandangan rekan (orang pertama)' : 'Di belakang rekan (orang ketiga)'}>{spec.mode === 'third' ? <Eye size={24} /> : <Camera size={24} />}</button>
            <button className="fab" disabled={spec.n < 2} onPointerDown={(e) => { e.preventDefault(); st.current.specMove(1); }} aria-label="Pemain berikutnya"><ChevronRight size={24} /></button>
          </div>
          <div className="fabs" onContextMenu={(e) => e.preventDefault()}>
            <button className={'fab f-crouch' + (specCd.p > 0 ? ' tired' : '')} onPointerDown={(e) => { e.preventDefault(); st.current.ping(); }} aria-label="Ping titik">{specCd.p > 0 ? <b className="cdn">{specCd.p}</b> : <MapPin size={24} />}</button>
            <button className={'fab f-act' + (specCd.s > 0 ? ' tired' : '')} onPointerDown={(e) => { e.preventDefault(); st.current.shout(); }} aria-label="Teriak">{specCd.s > 0 ? <b className="cdn">{specCd.s}</b> : <Megaphone size={30} />}</button>
          </div>
        </>
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
          <button className="fab f-act" onPointerDown={(e) => { e.preventDefault(); interact(); }} onPointerUp={() => st.current.actUp()} onPointerCancel={() => st.current.actUp()} onPointerLeave={() => st.current.actUp()} aria-label="Interaksi"><Hand size={30} /></button>
        </div>
      )}
    </div>
  );
}
