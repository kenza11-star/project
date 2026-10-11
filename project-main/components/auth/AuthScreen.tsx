'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import HorrorBackdrop from '../ui/HorrorBackdrop';
import { useExit } from '../ui/useExit';
import { authProvider } from '@/lib/auth/provider';
import { validateLogin, validateRegister, hasErrors, USERNAME_MAX } from '@/lib/auth/validate';
import type { AuthResult, AuthUser } from '@/lib/auth/types';

type Tab = 'login' | 'register';
type F = { identifier: string; username: string; email: string; password: string; confirm: string };
const EMPTY: F = { identifier: '', username: '', email: '', password: '', confirm: '' };

function Field({ id, label, type = 'text', value, onChange, error, auto, mode, max, reveal }: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void; error?: string;
  auto: string; mode?: 'text' | 'email'; max?: number; reveal?: { shown: boolean; toggle: () => void };
}) {
  return (
    <div className="afield">
      <label htmlFor={id}>{label}</label>
      <div className="ainwrap">
        <input id={id} name={id} className={'ainput' + (error ? ' bad' : '')} type={reveal ? (reveal.shown ? 'text' : 'password') : type} value={value}
          onChange={(e) => onChange(e.target.value)} autoComplete={auto} inputMode={mode} maxLength={max}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? id + '-e' : undefined} />
        {reveal && (
          <button type="button" className="aeye" onClick={reveal.toggle} aria-label={reveal.shown ? 'Sembunyikan password' : 'Tampilkan password'}>
            {reveal.shown ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && <div className="aerr" id={id + '-e'}>{error}</div>}
    </div>
  );
}

// Menu login / register. Hanya validasi bentuk di klien lalu memanggil `authProvider` (lib/auth/provider.ts = titik integrasi backend).
// Tidak ada akun/password yang disimpan di perangkat. "Main sebagai Tamu" = jalur offline yang benar-benar berjalan.
export default function AuthScreen({ open, onGuest, onAuthed }: { open: boolean; onGuest: () => void; onAuthed: (u: AuthUser) => void }) {
  const { mounted, closing } = useExit(open, 750);
  const [tab, setTab] = useState<Tab>('login');
  const [f, setF] = useState<F>(EMPTY);
  const [errs, setErrs] = useState<Partial<Record<keyof F, string>>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (open) { setF(EMPTY); setErrs({}); setFormErr(null); setBusy(false); setShow(false); } }, [open]);

  if (!mounted) return null;
  const set = (k: keyof F) => (v: string) => { setF((s) => ({ ...s, [k]: v })); if (errs[k]) setErrs((e) => ({ ...e, [k]: undefined })); if (formErr) setFormErr(null); };
  const switchTab = (t: Tab) => { if (busy || t === tab) return; setTab(t); setErrs({}); setFormErr(null); setF((s) => ({ ...EMPTY, identifier: s.identifier, username: s.username, email: s.email })); };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e = tab === 'login' ? validateLogin(f) : validateRegister(f);
    if (hasErrors(e)) {
      setErrs(e as any);
      const first = Object.keys(e)[0];
      requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('#' + first)?.focus());
      return;
    }
    setBusy(true); setFormErr(null);
    try {
      const res = tab === 'login'
        ? await authProvider.login({ identifier: f.identifier.trim(), password: f.password })
        : await authProvider.register({ username: f.username.trim(), email: f.email.trim(), password: f.password });
      if (!alive.current) return;
      if (res.ok) { setF(EMPTY); onAuthed(res.user); return; }
      const bad = res as Extract<AuthResult, { ok: false }>; // tsconfig strict:false tidak mempersempit union boolean, jadi di-cast eksplisit
      setFormErr(bad.message);
      if (bad.field && bad.field in EMPTY) setErrs({ [bad.field]: bad.message } as any);
    } catch {
      if (alive.current) setFormErr('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      if (alive.current) { setBusy(false); setF((s) => ({ ...s, password: '', confirm: '' })); } // password tidak dipertahankan di memori form setelah dikirim
    }
  };

  return (
    <div ref={root} className={'auth' + (closing ? ' out' : '')} role="dialog" aria-modal="true" aria-label="Masuk atau daftar">
      <HorrorBackdrop />
      <div className="auth-scroll">
        <div className="auth-card">
          <header className="auth-head">
            <h1 className="auth-title">BACKROOMS</h1>
            <p className="auth-sub">// akses terbatas &mdash; identifikasi dirimu</p>
          </header>
          <div className="auth-body">
            <div className="auth-tabs" role="tablist" aria-label="Pilih menu">
              <button type="button" role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'on' : ''} onClick={() => switchTab('login')}>Masuk</button>
              <button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : ''} onClick={() => switchTab('register')}>Daftar</button>
            </div>
            {!authProvider.available && (
              <p className="auth-note">Server akun belum tersambung. Login &amp; daftar belum bisa diproses; kamu tetap bisa bermain sebagai Tamu.</p>
            )}
            <form key={tab} className="auth-form" onSubmit={submit} noValidate>
              {tab === 'login' ? (
                <>
                  <Field id="identifier" label="Username atau email" value={f.identifier} onChange={set('identifier')} error={errs.identifier} auto="username" max={254} />
                  <Field id="password" label="Password" value={f.password} onChange={set('password')} error={errs.password} auto="current-password" max={128} reveal={{ shown: show, toggle: () => setShow((s) => !s) }} />
                </>
              ) : (
                <>
                  <Field id="username" label="Username" value={f.username} onChange={set('username')} error={errs.username} auto="username" max={USERNAME_MAX} />
                  <Field id="email" label="Email" type="email" mode="email" value={f.email} onChange={set('email')} error={errs.email} auto="email" max={254} />
                  <Field id="password" label="Password" value={f.password} onChange={set('password')} error={errs.password} auto="new-password" max={128} reveal={{ shown: show, toggle: () => setShow((s) => !s) }} />
                  <Field id="confirm" label="Ulangi password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} auto="new-password" max={128} reveal={{ shown: show, toggle: () => setShow((s) => !s) }} />
                </>
              )}
              {formErr && <div className="aform-err" role="alert">{formErr}</div>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? '...' : tab === 'login' ? 'MASUK' : 'DAFTAR'}</button>
            </form>
            <div className="auth-or"><span>atau</span></div>
            <button type="button" className="auth-guest" onClick={onGuest}>Main sebagai Tamu</button>
            <p className="auth-fine">Progres tamu hanya tersimpan di perangkat ini.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
