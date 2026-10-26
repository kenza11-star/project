'use client';
import { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';
import { GFX, SENS_MAX, SENS_MIN, type Gfx, type Settings } from '@/lib/game/settings';
import { playerRows, type PauseMode, type PausePanel } from '@/lib/game/pause';
import type { Slot } from '@/lib/game/players';

// Menu pause / overlay. Murni tampilan: logika pause ada di lib/game/pause.ts, loop game di PlayScene.
// Semua event pointer/klik berhenti di overlay ini (tidak menembus ke canvas / tombol gameplay di bawahnya).
interface Props {
  mode: PauseMode;
  panel: PausePanel;
  settings: Settings;
  roster: Slot[];
  online?: boolean;
  onPanel: (p: PausePanel) => void;
  onBack: () => void;
  onResume: () => void;
  onLeave: () => void;
  onSettings: (patch: Partial<Settings>) => void;
}

const STOP = { onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(), onPointerUp: (e: React.SyntheticEvent) => e.stopPropagation(), onPointerMove: (e: React.SyntheticEvent) => e.stopPropagation(), onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(), onWheel: (e: React.SyntheticEvent) => e.stopPropagation() };

export default function PauseMenu({ mode, panel, settings, roster, online, onPanel, onBack, onResume, onLeave, onSettings }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  const freeze = mode === 'freeze';
  // fokus ke tombol utama di tiap panel (keyboard PC: Tab/Enter jalan tanpa mouse)
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, [panel]);

  const title = panel === 'main' ? (freeze ? 'PAUSED' : 'MENU') : panel === 'options' ? 'OPTIONS' : panel === 'players' ? 'PLAYERS' : panel === 'howto' ? 'HOW TO PLAY' : 'LEAVE GAME?';
  const sub = panel === 'main'
    ? (freeze ? 'The darkness waits.' : 'You are still in there.')
    : null;

  return (
    <div className={'pz' + (freeze ? ' freeze' : ' overlay')} role="dialog" aria-modal="true" aria-label={title} {...STOP} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="pz-card" key={panel}>
        <header className="pz-head">
          <h2 className="pz-title">{title}</h2>
          {sub && <p className="pz-sub">{sub}</p>}
          {panel === 'main' && !freeze && <p className="pz-warn">THE WORLD KEEPS MOVING</p>}
        </header>

        <div className="pz-body">
          {panel === 'main' && (
            <nav className="pz-list">
              <button ref={first} className="pz-btn primary" onClick={onResume}>RESUME</button>
              <button className="pz-btn" onClick={() => onPanel('options')}>OPTIONS</button>
              <button className="pz-btn" onClick={() => onPanel('players')}>PLAYERS</button>
              <button className="pz-btn" onClick={() => onPanel('howto')}>HOW TO PLAY</button>
              <button className="pz-btn leave" onClick={() => onPanel('confirm')}>LEAVE GAME</button>
            </nav>
          )}

          {panel === 'options' && (
            <div className="pz-opts">
              <div className="pz-row">
                <span className="pz-lab">GRAPHICS</span>
                <div className="pz-seg" role="radiogroup" aria-label="Graphics">
                  {(Object.keys(GFX) as Gfx[]).map((g, i) => (
                    <button key={g} ref={i === 0 ? first : undefined} role="radio" aria-checked={settings.gfx === g} className={settings.gfx === g ? 'on' : ''} onClick={() => onSettings({ gfx: g })}>{GFX[g].label}</button>
                  ))}
                </div>
              </div>
              <label className="pz-row">
                <span className="pz-lab">SENSITIVITY <b>{settings.sens.toFixed(1)}x</b></span>
                <input type="range" min={SENS_MIN} max={SENS_MAX} step={0.1} value={settings.sens} onChange={(e) => onSettings({ sens: parseFloat(e.target.value) })} />
              </label>
              <label className="pz-row">
                <span className="pz-lab">VOLUME <b>{Math.round(settings.volume * 100)}%</b></span>
                <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => onSettings({ volume: parseFloat(e.target.value) })} />
              </label>
              <div className="pz-row">
                <span className="pz-lab">INVERT LOOK (Y)</span>
                <button className={'pz-switch' + (settings.invertY ? ' on' : '')} role="switch" aria-checked={settings.invertY} onClick={() => onSettings({ invertY: !settings.invertY })}><i /><span>{settings.invertY ? 'ON' : 'OFF'}</span></button>
              </div>
              <p className="pz-note">Pengaturan disimpan di perangkat ini dan tidak mengubah jalannya permainan.</p>
              <button className="pz-btn back" onClick={onBack}>BACK</button>
            </div>
          )}

          {panel === 'players' && (
            <div className="pz-players">
              <ul>
                {playerRows(roster).map((p, i) => (
                  <li key={p.id} className={p.tag.toLowerCase()}>
                    <span className="pz-dot" aria-hidden />
                    <span className="pz-pn">{p.name}</span>
                    {roster[i]?.mic && <Mic size={14} color="#3ddc6a" strokeWidth={2.4} aria-label="Mic aktif" style={{ marginLeft: 6, flex: 'none' }} />}
                    <em>{p.tag === 'YOU' ? 'YOU' : p.tag === 'PARTY' ? 'PARTY' : ''}</em>
                    <span className="pz-conn">{p.connection}</span>
                  </li>
                ))}
              </ul>
              <p className="pz-note">{online ? 'Menu ini hanya overlay lokal: pemain lain, musuh, dan timer tetap berjalan, dan posisimu tetap terlihat oleh mereka.' : 'Koneksi online belum tersedia di versi ini; hanya pemain lokal yang aktif.'}</p>
              <button ref={first} className="pz-btn back" onClick={onBack}>BACK</button>
            </div>
          )}

          {panel === 'howto' && (
            <div className="pz-how">
              <section>
                <h3>MOBILE</h3>
                <ul>
                  <li><b>Stick kiri</b> jalan</li>
                  <li><b>Geser layar kanan</b> melihat sekeliling</li>
                  <li><b>Tangan</b> interaksi: buka laci/pintu, ambil item (bidik dengan +)</li>
                  <li><b>Senter</b> nyala/mati, <b>Lari</b> memakai stamina, <b>Jongkok</b></li>
                  <li><b>Mata</b> muncul saat membidik locker/lemari/kasur: sembunyi</li>
                  <li><b>Ransel</b> inventory, <b>☰</b> menu ini</li>
                </ul>
              </section>
              <section>
                <h3>PC</h3>
                <ul>
                  <li><b>WASD / Panah</b> jalan, <b>drag mouse</b> melihat</li>
                  <li><b>Shift</b> lari, <b>C</b> jongkok</li>
                  <li><b>E</b> interaksi, <b>F</b> senter, <b>H</b> sembunyi</li>
                  <li><b>I</b> inventory, <b>Esc</b> buka/tutup menu</li>
                </ul>
              </section>
              <section className="wide">
                <h3>TUJUAN</h3>
                <ul><li>Temukan 3 key (Yellow, Red, Green) di dalam furniture, buka 3 gembok pintu exit, lalu kabur. Jaga baterai senter dan stamina; sembunyi bila ada yang mendekat.</li></ul>
              </section>
              <button ref={first} className="pz-btn back" onClick={onBack}>BACK</button>
            </div>
          )}

          {panel === 'confirm' && (
            <div className="pz-confirm">
              <p>{freeze
                ? 'Keluar ke lobby? Progres permainan ini akan hilang.'
                : 'Keluar ke lobby? Kamu meninggalkan permainan ini. Pemain lain tidak terpengaruh.'}</p>
              <div className="pz-two">
                <button ref={first} className="pz-btn primary" onClick={onBack}>STAY</button>
                <button className="pz-btn leave" onClick={onLeave}>LEAVE</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
