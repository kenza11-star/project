'use client';
import { useEffect, useRef, useState } from 'react';
import LoadArt from './LoadArt';

// Urutan startup (SATU kali per pemuatan halaman, tidak pernah berulang):
//   1) intro: animasi judul NIGHTROUND (public/intro/nightround-intro.html) ~5,6 dtk, bisa dilewati
//   2) muat: foto lorong + bar progres NYATA (font + foto + karakter James), tertahan di < 100% sampai semuanya siap
//   3) keluar: memudar -> selesai (komponen tidak menggambar apa pun lagi)
// Pengaman anti-macet: bila belum siap setelah MAX_LOAD_MS, bar dipaksa selesai supaya pemain tidak terjebak di loading.
const INTRO_MS = 5600;
const MAX_LOAD_MS = 15000;
const HOLD_MS = 450;
const FADE_MS = 750;
const BAR_SPEED = 0.8; // maks. 80%/dtk -> bar terlihat jalan walau semuanya sudah siap duluan

let shown = false; // modul-level: Lobby yang dipasang ulang tidak memutar splash lagi
export const splashShown = () => shown;

type Phase = 'intro' | 'load' | 'out' | 'done';
interface Props { progress: number; ready: boolean; onDone: () => void }

export default function Splash({ progress, ready, onDone }: Props) {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [phase, setPhase] = useState<Phase>(() => (shown ? 'done' : reduce ? 'load' : 'intro'));
  const [val, setVal] = useState(0);
  const [imgOk, setImgOk] = useState(false);
  const [introGone, setIntroGone] = useState(false);
  const live = useRef({ progress, ready, imgOk, onDone });
  live.current = { progress, ready, imgOk, onDone };

  // foto latar dimuat sungguhan (berhasil atau gagal sama-sama dianggap selesai agar tidak menggantung)
  useEffect(() => {
    if (shown) return;
    const im = new Image();
    const fin = () => setImgOk(true);
    im.onload = fin; im.onerror = fin;
    im.src = '/intro/loading-bg.webp';
    return () => { im.onload = null; im.onerror = null; };
  }, []);

  // intro -> muat
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setPhase('load'), INTRO_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // iframe intro dilepas setelah foto menutupinya penuh
  useEffect(() => {
    if (phase === 'intro') return;
    const t = setTimeout(() => setIntroGone(true), 1000);
    return () => clearTimeout(t);
  }, [phase]);

  // muat: bar mengikuti progres nyata
  useEffect(() => {
    if (phase !== 'load') return;
    let raf = 0, last = performance.now(), d = 0, holdT: ReturnType<typeof setTimeout> | null = null, finished = false;
    let forced = false;
    const wd = setTimeout(() => { forced = true; }, MAX_LOAD_MS);
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const L = live.current;
      const allReady = L.ready && L.imgOk;
      const target = forced || allReady ? 1 : Math.min(0.97, (L.imgOk ? 0.1 : 0) + 0.9 * Math.min(1, Math.max(0, L.progress)));
      d = Math.min(target, d + BAR_SPEED * dt);
      setVal(d);
      if (d >= 1 && !finished) {
        finished = true;
        holdT = setTimeout(() => setPhase('out'), HOLD_MS);
        return; // berhenti menggambar frame; tidak ada loop lagi
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(wd); if (holdT) clearTimeout(holdT); };
  }, [phase]);

  // keluar: tandai selesai SEKARANG (menu login mulai muncul saat splash memudar), lalu lepas dari DOM
  useEffect(() => {
    if (phase !== 'out') return;
    shown = true;
    live.current.onDone();
    const t = setTimeout(() => setPhase('done'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'done') return null;
  return (
    <div className={'spl' + (phase === 'out' ? ' out' : '')} role="status" aria-label="Memuat NIGHTROUND">
      {!introGone && (
        <iframe className="spl-intro" src="/intro/nightround-intro.html#auto" title="NIGHTROUND" tabIndex={-1} aria-hidden />
      )}
      {phase === 'intro' && <button type="button" className="spl-skip" onClick={() => setPhase('load')}>LEWATI</button>}
      {phase !== 'intro' && <div className="spl-load"><LoadArt value={val} /></div>}
    </div>
  );
}
