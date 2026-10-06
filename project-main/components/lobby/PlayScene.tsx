'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { LogOut, Hand, Backpack, RotateCcw, Flashlight, X } from 'lucide-react';
import { GameWorld, levelY, type GameCtx } from '@/lib/game/world';
import { createPlayer, type PlayerState } from '@/lib/game/inventory';
import { KEY_DEFS } from '@/lib/game/keys';
import { Flashlight as FlashState } from '@/lib/game/flashlight';
import { Stamina } from '@/lib/game/stamina';
import { AudioManager } from '@/lib/game/audio';
import * as CFG from '@/lib/game/config';
import { lockLandscape } from '@/lib/game/orientation';
import { usePortrait } from '@/lib/game/usePortrait';
import { RotateGate } from '../ui/LandscapeGate';

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
  const [run, setRun] = useState(false);
  const { portrait, portraitRef } = usePortrait(); // true landscape: bila HP portrait, tampil overlay putar-perangkat & game dijeda
  const [crouch, setCrouch] = useState(false);
  const [msg, setMsg] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'play' | 'escaped' | 'error'>('loading');
  const [loadPct, setLoadPct] = useState(0);
  const [bag, setBag] = useState(false);
  const [flOn, setFlOn] = useState(false);
  const [flLow, setFlLow] = useState(false);
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
    act: () => {}, restart: () => {}, canStand: (): boolean => true,
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

    void lockLandscape(false); // cadangan: Lobby sudah mencoba lock + fullscreen saat klik Play; di sini tanpa fullscreen
    const audio = new AudioManager(); audioRef.current = audio; audio.init();
    const player = me;
    const ctx: GameCtx = { player, say, changed: () => force() };
    let world: GameWorld | null = null;
    let cancelled = false;
    const pos = { yaw: 0, pitch: 0 };

    const beginRun = () => {
      if (!world) return;
      world.startRun(); // seed baru tiap mulai / restart (kecuali MAP_SEED diset)
      players.current.forEach((p) => {
        p.inventory.clear(); p.inventory.add('battery', CFG.START_BATTERIES); // battery awal di inventory
        p.level = 0; p.noteIdx = 0; p.x = world!.spawn.x; p.z = world!.spawn.z;
      });
      fl.current.reset(); stamina.current.reset();
      S.run = false; S.crouch = false; setRun(false); setCrouch(false); setFlOn(false); showPct(100); showStam(100); setTired(false);
      pos.yaw = world.spawn.yaw; pos.pitch = 0;
      S.status = 'play'; setStatus('play'); setBag(false); force();
    };
    S.restart = beginRun;
    S.canStand = () => !world || !world.cw.blocked(player.x, player.z, CFG.PLAYER_RADIUS, player.level);
    S.act = () => {
      if (S.status !== 'play' || !world) return;
      world.ix.refresh(cam, ctx); // target terbaru tepat saat tombol ditekan
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
    const pt = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
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
        pos.yaw -= (p.x - look.x) * 0.006;
        pos.pitch = Math.max(-1.2, Math.min(1.2, pos.pitch - (p.y - look.y) * 0.006));
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
    let stride = 1.05, idleT = 0, stepAcc = 0, flickT = 0, flickR = 1, lastFl = 100, lastStam = 100, lastTired = false;
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
      const playing = S.status === 'play' && !portraitRef.current; // dijeda selama HP portrait
      let fwd = playing ? -stick.vy + (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0) : 0;
      let str = playing ? stick.vx + (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0) : 0;
      const mag = Math.hypot(fwd, str);
      if (mag > 1) { fwd /= mag; str /= mag; }
      const moving = mag > 0.05;

      // ---- sprint & stamina ----
      if (S.run && !moving && (idleT += dt) > 0.35) { S.run = false; setRun(false); } else if (moving) idleT = 0; // sprint otomatis lepas saat berhenti
      const wantRun = (S.run || keys['shift']) && !S.crouch && fwd > 0.1 && moving;
      const running = playing && wantRun && stamina.current.canSprint();
      if (playing) {
        if (stamina.current.update(dt, running) === 'exhausted') { S.run = false; setRun(false); audio.play('breath'); }
        const sp100 = Math.round(stamina.current.pct / 2) * 2;
        if (sp100 !== lastStam) { lastStam = sp100; showStam(sp100); }
        if (stamina.current.exhausted !== lastTired) { lastTired = stamina.current.exhausted; setTired(lastTired); }
      }
      const speed = S.crouch ? CFG.CROUCH_SPEED : running ? CFG.SPRINT_SPEED : CFG.WALK_SPEED;
      const sp = speed * dt, s = Math.sin(pos.yaw), c = Math.cos(pos.yaw);
      const dx = (-s * fwd + c * str) * sp, dz = (-c * fwd - s * str) * sp;
      const cw = world.cw, R = S.crouch ? CFG.PLAYER_RADIUS_CROUCH : CFG.PLAYER_RADIUS; // jongkok = collider lebih kecil & rendah
      const ox = player.x, oz = player.z;
      if (!cw.blocked(player.x + dx, player.z, R, player.level)) player.x += dx;
      if (!cw.blocked(player.x, player.z + dz, R, player.level)) player.z += dz;
      player.yaw = pos.yaw; player.pitch = pos.pitch;

      // ---- langkah kaki (pelan; berdasar jarak tempuh nyata, bukan tiap frame) ----
      if (playing) {
        stepAcc += Math.hypot(player.x - ox, player.z - oz);
        if (stepAcc >= stride) {
          stepAcc = 0; stride = (S.crouch ? 0.75 : running ? 1.4 : 1.05) * (0.92 + Math.random() * 0.16); // variasi kecil antar langkah
          // jalan: normal; lari: lebih keras & cepat (nada tinggi); jongkok: sangat pelan & dalam
          audio.play(world.stepSound(player), { vol: CFG.FOOTSTEP_VOLUME * (S.crouch ? 0.35 : running ? 1.5 : 1), rate: S.crouch ? 0.88 : running ? 1.1 : 1 });
        }
      }

      eye += ((S.crouch ? EYE_CROUCH : EYE) - eye) * Math.min(1, dt * 9);
      fov += ((running && moving ? baseFov + FOV_SPRINT : baseFov) - fov) * Math.min(1, dt * 6);
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
      if (moving) bobT += dt * (running ? 11 : S.crouch ? 5 : 7.5);
      const bob = moving ? Math.sin(bobT) * (running ? 0.035 : 0.018) : 0;
      cam.position.set(player.x, levelY(player.level) + eye + bob, player.z); cam.rotation.set(pos.pitch, pos.yaw, 0);
      cam.updateMatrixWorld(true);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, pos.yaw, dt);
      world.update(dt, t, player, cam, ctx, playing);

      // ---- senter: battery hanya berkurang saat ON ----
      const f = fl.current;
      if (playing && f.update(dt) === 'died') { audio.play('flash_die'); setFlOn(false); say('Battery habis. Pakai battery dari inventory.', 2600); }
      if ((flickT -= dt) <= 0) { flickT = 0.07; flickR = Math.random(); }
      spot.intensity = CFG.FLASH_INTENSITY * f.factor(flickR);
      const pc = f.pct; if (pc !== lastFl) { lastFl = pc; showPct(pc); }
      hemi.intensity = CFG.AMBIENT * (0.2 + 0.8 * world.lightMul); // lampu padam -> ambient ikut turun

      // prompt crosshair (state hanya berubah bila teks berubah)
      const p = playing ? world.ix.prompt(ctx) : null;
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
      {portrait && <RotateGate />}
      <div ref={baseRef} className="joybase"><div ref={knobRef} className="joyknob" /></div>
      {status === 'play' && <div className="crosshair" aria-hidden />}
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
          <button className="fab f-act" onPointerDown={(e) => { e.preventDefault(); interact(); }} aria-label="Interaksi"><Hand size={30} /></button>
        </div>
      )}
    </div>
  );
}
