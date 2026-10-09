'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { LogOut, Hand, Backpack, RotateCcw, Flashlight, X, EyeOff } from 'lucide-react';
import { GameWorld, type GameCtx } from '@/lib/game/world';
import { createPlayer, type PlayerState } from '@/lib/game/inventory';
import { KEY_DEFS } from '@/lib/game/keys';
import { Flashlight as FlashState } from '@/lib/game/flashlight';
import { Stamina } from '@/lib/game/stamina';
import { AudioManager } from '@/lib/game/audio';
import * as CFG from '@/lib/game/config';
import { lockLandscape } from '@/lib/game/orientation';
import { STAIR_SPEED_MUL } from '@/lib/game/stairs';
import { WakeUp, applyWakeFx, clearWakeFx, newWakeLast, type WakeFx } from '@/lib/game/opening';

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
export default function PlayScene({ names, onExit }: { names: string[]; onExit: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const vigRef = useRef<HTMLDivElement>(null); // vignette yang sudah ada; opening hanya mengubah variabel CSS-nya
  const [run, setRun] = useState(false);
  const [crouch, setCrouch] = useState(false);
  const [msg, setMsg] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'play' | 'escaped' | 'error'>('loading');
  const [loadPct, setLoadPct] = useState(0);
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
  // Satu PlayerState per pemain; inventory tiap pemain terpisah. Yang dikontrol di perangkat ini = players[0].
  const players = useRef<PlayerState[]>([]);
  if (!players.current.length) players.current = names.map((n, i) => createPlayer('p' + (i + 1), n));
  const worldRef = useRef<GameWorld | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const exitRef = useRef(onExit); exitRef.current = onExit;
  const fl = useRef(new FlashState());
  const stamina = useRef(new Stamina());
  const st = useRef({
    run: false, crouch: false, status: 'loading' as string,
    act: () => {}, hide: () => {}, restart: () => {}, canStand: (): boolean => true,
  });

  const say = (t: string, ms = 1800) => {
    setMsg(t);
    if (msgT.current) clearTimeout(msgT.current);
    msgT.current = setTimeout(() => setMsg(''), ms);
  };
  const toggleRun = () => {
    if (!st.current.run && !stamina.current.canSprint()) return; // stamina habis: tidak bisa sprint
    const v = !st.current.run; st.current.run = v; setRun(v);
    if (v && st.current.crouch) { st.current.crouch = false; setCrouch(false); }
  };
  const toggleCrouch = () => {
    if (st.current.status !== 'play') return;
    const v = !st.current.crouch;
    if (!v && !st.current.canStand()) return; // tidak bisa berdiri bila ruang di sekitar terlalu sempit
    st.current.crouch = v; setCrouch(v);
    if (v && st.current.run) { st.current.run = false; setRun(false); }
  };
  const interact = () => st.current.act();
  const me = players.current[0];

  const toggleFlash = () => {
    if (st.current.status !== 'play') return;
    const f = fl.current;
    const was = f.on;
    f.toggle();
    if (!was && !f.on) { say('Battery habis. Pakai battery dari inventory.', 2200); return; }
    audioRef.current?.play('flash_click');
    setFlOn(f.on);
  };

  const useItem = (id: string) => {
    const inv = me.inventory;
    if (id === 'almond_water') { if (inv.remove(id)) say('Minum Almond Water... segar.'); }
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
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0803); scene.fog = new THREE.FogExp2(0x0a0803, CFG.FOG_DENSITY);
    const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 45); cam.rotation.order = 'YXZ'; scene.add(cam);
    // ambient kecil: area tanpa lampu benar-benar gelap, area berlampu terang dari lampu map (bukan dari cahaya palsu di kamera)
    const hemi = new THREE.HemisphereLight(0xffeeb0, 0x221a08, CFG.AMBIENT); scene.add(hemi);
    // senter: satu SpotLight mengikuti POV (tanpa shadow, ringan untuk HP). Intensitas 0 saat OFF (tidak menambah/menghapus light -> tanpa recompile shader)
    const spot = new THREE.SpotLight(0xfff2cf, 0, CFG.FLASH_DISTANCE, CFG.FLASH_ANGLE, 0.55, 2);
    spot.position.set(0.1, -0.08, 0); cam.add(spot);
    const aim = new THREE.Object3D(); aim.position.set(0, 0, -6); cam.add(aim); spot.target = aim;

    // debu melayang: satu Points kecil di sekitar kamera (1 draw call), tanpa asset
    const dN = CFG.DUST_COUNT, dPos = new Float32Array(dN * 3), dVel = new Float32Array(dN * 3);
    for (let i = 0; i < dN; i++) { dPos[i * 3] = (Math.random() - 0.5) * 7; dPos[i * 3 + 1] = (Math.random() - 0.5) * 3; dPos[i * 3 + 2] = -Math.random() * 6; dVel[i * 3] = (Math.random() - 0.5) * 0.05; dVel[i * 3 + 1] = -0.01 - Math.random() * 0.03; dVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05; }
    const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    const dMat = new THREE.PointsMaterial({ color: 0xe8d8a0, size: 0.025, transparent: true, opacity: 0.28, depthWrite: false, sizeAttenuation: true });
    const dust = new THREE.Points(dGeo, dMat); dust.frustumCulled = false; cam.add(dust);

    void lockLandscape(false); // cadangan: Lobby sudah mencoba lock + fullscreen saat klik Play; di sini tanpa fullscreen
    const audio = new AudioManager(); audioRef.current = audio; audio.init();
    const player = me;
    const ctx: GameCtx = { player, say, changed: () => force() };
    let world: GameWorld | null = null;
    let cancelled = false;
    const pos = { yaw: 0, pitch: 0 };
    // ---- opening bangun setelah pingsan: sekali saat pertama masuk game (bukan saat 'Main lagi') ----
    let wake: WakeUp | null = null, opened = false, wakeLook = 1;
    const wakeEl = { canvas: canvas as HTMLElement, get vignette(): HTMLElement | null { return vigRef.current; } };
    const wakeLast = newWakeLast();

    const beginRun = () => {
      if (!world) return;
      world.startRun(); // seed baru tiap mulai / restart (kecuali MAP_SEED diset)
      players.current.forEach((p) => {
        p.inventory.clear(); p.inventory.add('battery', CFG.START_BATTERIES); // battery awal di inventory
        p.level = 0; p.y = 0; p.onStairs = false; p.noteIdx = 0; p.x = world!.spawn.x; p.z = world!.spawn.z;
      });
      fl.current.reset(); stamina.current.reset();
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); setFlOn(false); showPct(100); showStam(100); setTired(false);
      pos.yaw = world.spawn.yaw; pos.pitch = 0;
      if (CFG.OPENING_ENABLED && !opened) {
        opened = true;
        wake = new WakeUp({ duration: CFG.OPENING_SECONDS, maxBlur: CFG.OPENING_BLUR_PX, reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, seed: Math.floor(Math.random() * 1e6) });
        applyWakeFx(wakeEl, wake.peek(), wakeLast); // layar sudah hampir hitam sebelum game tampil
      }
      S.status = 'play'; setStatus('play'); setBag(false); force();
    };
    S.restart = beginRun;
    S.canStand = () => !world || world.canStand(player);
    S.hide = () => {
      if (S.status !== 'play' || !world) return;
      if (!world.hiding) { world.ix.refresh(cam, ctx); if (world.interactBlocked(player)) { say('Tidak terjangkau', 900); return; } }
      if (!world.tryHide(player, say)) say('Tidak ada tempat sembunyi', 1000);
    };
    S.act = () => {
      if (S.status !== 'play' || !world) return;
      if (world.hiding) { world.tryHide(player, say); return; } // saat bersembunyi, tombol interaksi = keluar
      world.ix.refresh(cam, ctx); // target terbaru tepat saat tombol ditekan
      if (world.interactBlocked(player)) { say('Tidak terjangkau', 900); return; } // tidak boleh menembus dinding
      if (!world.ix.activate(ctx)) say('Tidak ada yang bisa dilakukan', 1000);
    };

    GameWorld.load(scene, (p) => setLoadPct(Math.round(p * 100)))
      .then((w) => {
        if (cancelled) { w.dispose(); return; }
        world = w; worldRef.current = w; w.audio = audio;
        beginRun();
      })
      .catch((e) => { console.error(e); if (!cancelled) { S.status = 'error'; setStatus('error'); } });

    const keys: Record<string, boolean> = {};
    const kd = (e: KeyboardEvent) => {
      audio.unlock();
      const key = e.key.toLowerCase(); keys[key] = true;
      if (e.key === 'Escape') exitRef.current();
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
    const vis = () => { if (document.hidden) { blur(); audio.suspend(); } else audio.unlock(); }; // app/tab di background: audio diam, tombol tidak 'nyangkut'
    document.addEventListener('visibilitychange', vis);
    const view = { w: 1, h: 1 }; let fov = FOV, baseFov = FOV;
    const stick = { id: -1, x: 0, y: 0, vx: 0, vy: 0 }; const look = { id: -1, x: 0, y: 0 };
    // Fallback landscape (.rotfix = UI diputar 90deg lewat CSS): petakan koordinat layar -> koordinat lokal yang sudah diputar
    const pt = (e: PointerEvent) => document.documentElement.classList.contains('rotfix')
      ? { x: e.clientY, y: document.documentElement.clientWidth - e.clientX }
      : { x: e.clientX, y: e.clientY };
    const pd = (e: PointerEvent) => {
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
      const p = pt(e);
      if (e.pointerId === stick.id) {
        const R = 50;
        let dx = p.x - stick.x, dy = p.y - stick.y;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        stick.vx = dx / R; stick.vy = dy / R;
        knobRef.current!.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (e.pointerId === look.id) {
        pos.yaw -= (p.x - look.x) * 0.006 * wakeLook;
        pos.pitch = Math.max(-1.2, Math.min(1.2, pos.pitch - (p.y - look.y) * 0.006 * wakeLook));
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
      r.setSize(w, h, false);
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
    let pr = Math.min(window.devicePixelRatio || 1, 1.25), fpsT = 0, fpsN = 0; // resolusi adaptif: turun otomatis bila FPS rendah
    let wasHiding = false, hideFlash = false, lastHide: null | 'in' | 'out' = null, lastFxA = 0, lastFxK: 'locker' | 'bed' | null = null, hbT = 0, panT = 0, swayT = 0, paused = false, stride = 1.05, idleT = 0, stepAcc = 0, flickT = 0, flickR = 1, lastFl = 100, lastStam = 100, lastTired = false;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      fpsT += dt; fpsN++;
      if (fpsT >= 2) {
        const avg = fpsT / fpsN; fpsT = 0; fpsN = 0;
        if (avg > 0.025 && pr > 0.7) { pr = Math.max(0.7, pr - 0.15); r.setPixelRatio(pr); r.setSize(view.w, view.h, false); }
        else if (avg < 0.0185 && pr < Math.min(window.devicePixelRatio || 1, 1.25)) { pr = Math.min(Math.min(window.devicePixelRatio || 1, 1.25), pr + 0.1); r.setPixelRatio(pr); r.setSize(view.w, view.h, false); }
      }
      if (!world || S.status === 'loading' || S.status === 'error') { r.render(scene, cam); return; }
      const playing = S.status === 'play';
      if (paused !== !playing) { paused = !playing; if (S.status === 'play') { if (paused) audio.suspend(); else audio.unlock(); } } // audio ikut diam saat dijeda
      // opening: waktu hanya maju saat game berjalan (dijeda = ikut berhenti)
      let wk: WakeFx | null = null;
      if (wake && playing) {
        const o = wake.update(dt);
        applyWakeFx(wakeEl, o, wakeLast);
        audio.setMuffle(o.muffle);
        for (const q of o.cues) audio.play(q.name, { vol: q.vol, rate: q.rate }); // napas/detak jantung pelan lewat sfx yang sudah ada
        if (o.done) { wake = null; wakeLook = 1; clearWakeFx(wakeEl, wakeLast); audio.setMuffle(0); } else { wk = o; wakeLook = o.look; }
      }
      let fwd = playing ? -stick.vy + (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0) : 0;
      let str = playing ? stick.vx + (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0) : 0;
      const hiding = playing && world.hiding;
      if (hiding) { fwd = 0; str = 0; if (S.run) { S.run = false; setRun(false); } }
      const mag = Math.hypot(fwd, str);
      if (mag > 1) { fwd /= mag; str /= mag; }
      const moving = mag > 0.05;

      // ---- sprint & stamina ----
      if (S.run && !moving && (idleT += dt) > 0.35) { S.run = false; setRun(false); } else if (moving) idleT = 0; // sprint otomatis lepas saat berhenti
      const wantRun = (S.run || keys['shift']) && !S.crouch && fwd > 0.1 && moving;
      const running = playing && wantRun && stamina.current.canSprint();
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
      const speed = (S.crouch ? CFG.CROUCH_SPEED : running ? CFG.SPRINT_SPEED : CFG.WALK_SPEED) * (player.onStairs ? STAIR_SPEED_MUL : 1) * (wk ? wk.speed : 1);
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
          stepAcc = 0; stride = (player.onStairs ? 0.62 : S.crouch ? 0.75 : running ? 1.4 : 1.05) * (0.92 + Math.random() * 0.16); // variasi kecil antar langkah
          // jalan: normal; lari: lebih keras & cepat (nada tinggi); jongkok: sangat pelan & dalam
          audio.play(world.stepSound(player), { vol: CFG.FOOTSTEP_VOLUME * (S.crouch ? 0.35 : running ? 1.5 : 1), rate: player.onStairs ? 0.9 : S.crouch ? 0.88 : running ? 1.1 : 1 });
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
      cam.position.set(player.x, player.y + eye + bob + (wk ? wk.dip : 0), player.z);
      cam.rotation.set(pos.pitch + Math.sin(swayT * 1.1) * sway + (wk ? wk.pitch : 0), pos.yaw + (wk ? wk.yaw : 0), roll + (wk ? wk.roll : 0)); // offset opening hanya visual
      cam.updateMatrixWorld(true);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, pos.yaw, dt);
      world.update(dt, t, player, cam, ctx, playing);
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
        if (!wasHiding && fl.current.on) { hideFlash = true; toggleFlash(); }
      } else if (wasHiding && hideFlash) { hideFlash = false; if (!fl.current.on) toggleFlash(); }
      wasHiding = !!hv;
      const hb: null | 'in' | 'out' = !playing ? null : world.hiding ? (world.hidePrompt() ? 'out' : null) : world.hideTarget() ? 'in' : null;
      if (hb !== lastHide) { lastHide = hb; setHideBtn(hb); }
      const fxA = hv ? Math.round(hv.alpha * 10) / 10 : 0, fxK = hv ? hv.kind : null;
      if (fxA !== lastFxA || fxK !== lastFxK) { lastFxA = fxA; lastFxK = fxK; setHfx(fxK && fxA > 0 ? { kind: fxK, a: fxA } : null); }

      // ---- senter: battery hanya berkurang saat ON ----
      const f = fl.current;
      if (playing && f.update(dt) === 'died') { audio.play('flash_die'); setFlOn(false); say('Battery habis. Pakai battery dari inventory.', 2600); }
      if ((flickT -= dt) <= 0) { flickT = 0.07; flickR = Math.random(); }
      spot.intensity = CFG.FLASH_INTENSITY * f.factor(flickR);
      const pc = f.pct; if (pc !== lastFl) { lastFl = pc; showPct(pc); }
      hemi.intensity = CFG.AMBIENT * (0.2 + 0.8 * world.lightMul); // lampu padam -> ambient ikut turun

      // prompt crosshair (state hanya berubah bila teks berubah)
      const p = playing ? (world.hiding ? world.hidePrompt() : world.ix.prompt(ctx)) : null;
      if (p !== lastPrompt) { lastPrompt = p; setPrompt(p); }
      if (playing && world.escaped(player)) { S.status = 'escaped'; setStatus('escaped'); }
      r.render(scene, cam);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('orientationchange', onOrient); window.visualViewport?.removeEventListener('resize', resize);
      screen.orientation?.removeEventListener?.('change', onOrient); ro?.disconnect(); orientTimers.forEach(clearTimeout);
      world?.dispose(); worldRef.current = null;
      audio.dispose(); audioRef.current = null;
      canvas.removeEventListener('pointerdown', pd); canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu); canvas.removeEventListener('pointercancel', pu);
      cam.remove(dust); dGeo.dispose(); dMat.dispose();
      scene.remove(cam); cam.remove(spot); cam.remove(aim);
      r.dispose(); r.forceContextLoss();
      if (msgT.current) { clearTimeout(msgT.current); msgT.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockState = worldRef.current?.lockState() ?? {};
  const inv = me.inventory;
  const keyIds = new Set(KEY_DEFS.map((k) => k.id as string));
  const items = inv.list().filter((i) => !keyIds.has(i.id));

  return (
    <div className="play" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={cv} />
      <div ref={baseRef} className="joybase"><div ref={knobRef} className="joyknob" /></div>
      {status === 'play' && <div ref={vigRef} className="vignette" aria-hidden />}
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
      </div>
      <button className="gico exit" onClick={onExit} aria-label="Keluar"><X size={20} /></button>
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
      {status === 'loading' && <div className="playcover">Memuat map… {loadPct > 0 ? loadPct + '%' : ''}</div>}
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
      {status === 'play' && (
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
