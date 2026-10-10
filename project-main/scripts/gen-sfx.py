#!/usr/bin/env python3
"""Generator SFX prosedural untuk Backrooms Lobby.
Semua suara disintesis dari nol (noise + osilator) -> tidak ada sample pihak ketiga, bebas lisensi (CC0 / milik project).
Jalankan: python3 scripts/gen-sfx.py  (butuh numpy + scipy). Output: public/sfx/*.wav (mono, 22.05 kHz, 16-bit).
"""
import os, wave
import numpy as np
from scipy import signal

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')
os.makedirs(OUT, exist_ok=True)
R = np.random.default_rng(1337)

class Pad(np.ndarray):
    def _sum(self, o):
        o = np.asarray(o)
        if o.ndim == 0: return np.asarray(self) + o
        n = max(len(self), len(o)); a = np.zeros(n); b = np.zeros(n); a[:len(self)] = self; b[:len(o)] = o
        return (a + b).view(Pad)
    __add__ = _add_ = _sum
    __radd__ = _sum
    def __iadd__(self, o): return self._sum(o)
def P(x): return np.asarray(x).view(Pad)
def t_(d): return np.arange(int(SR * d)) / SR
def noise(d): return P(R.standard_normal(int(SR * d)))
def bp(x, lo, hi, order=2):
    hi = min(hi, SR / 2 - 100)
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band'); return P(signal.lfilter(b, a, x))
def lp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), 'low'); return P(signal.lfilter(b, a, x))
def hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), 'high'); return P(signal.lfilter(b, a, x))
def env(n, a=0.005, d=0.1, k=6.0):
    t = np.arange(n) / SR
    e = np.exp(-t / d * k / 3) if d > 0 else np.ones(n)
    at = np.minimum(1, t / max(a, 1e-4)); return e * at
def sine(f, d, ph=0): return P(np.sin(2 * np.pi * f * t_(d) + ph))
def place(buf, x, at):
    x = np.asarray(x)
    i = int(at * SR); n = min(len(x), len(buf) - i)
    if n > 0: buf[i:i + n] += x[:n]
def norm(x, peak=0.9):
    m = np.max(np.abs(x)) + 1e-9; return x / m * peak
def fade(x, a=0.004, b=0.01):
    x = x.copy(); na, nb = int(a * SR), int(b * SR)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nb: x[-nb:] *= np.linspace(1, 0, nb)
    return x
def loopable(x, xf=0.25):
    n = int(xf * SR); y = x[:-n].copy()
    y[:n] = y[:n] * np.linspace(0, 1, n) + x[-n:] * np.linspace(1, 0, n); return y
def save(name, x, peak=0.9):
    x = np.clip(norm(x, peak), -1, 1)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes())

def thud(d, f0, f1, dec=0.08):
    t = t_(d); f = f0 + (f1 - f0) * np.minimum(1, t / d)
    return P(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec))
def click(d=0.03, lo=1500, hi=6000):
    return P(bp(noise(d), lo, hi) * np.exp(-t_(d) / (d / 5)))

# ---------- footsteps ----------
for i in range(1, 4):  # karpet: tumpul
    d = 0.24; x = lp(noise(d), 380 + i * 40) * env(int(SR * d), 0.01, 0.09, 6)
    x += 0.8 * thud(d, 90 + i * 8, 55, 0.07); save(f'step_carpet_{i}', fade(x), 0.8)
for i in range(1, 3):  # keramik: klik + gema pendek
    d = 0.2; x = bp(noise(d), 700, 3200) * env(int(SR * d), 0.001, 0.035, 7)
    x += 0.5 * thud(d, 180 + i * 20, 110, 0.04); save(f'step_tile_{i}', fade(x), 0.8)

# ---------- ambience & buzz (loop) ----------
d = 10; t = t_(d)
amb = 0.5 * np.sin(2 * np.pi * 50 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.1 * t))
amb += 0.35 * np.sin(2 * np.pi * 73 * t + 1) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * t + 2))
amb += 0.5 * lp(noise(d), 260) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t + 0.5))
amb += 0.12 * bp(noise(d), 900, 2400) * (0.3 + 0.7 * np.maximum(0, np.sin(2 * np.pi * 0.05 * t + 4)))
save('ambient_loop', loopable(amb, 1.0), 0.8)
d = 2.0; t = t_(d)
b = sum(a * np.sin(2 * np.pi * 120 * k * t + k) for k, a in [(1, 1), (2, 0.55), (3, 0.4), (4, 0.2), (6, 0.15)])
b *= 0.85 + 0.15 * np.sin(2 * np.pi * 2 * t); b += 0.08 * bp(noise(d), 3000, 8000)
save('buzz_loop', loopable(b, 0.2), 0.8)

# ---------- suara jauh ----------
d = 2.2; x = np.zeros(int(SR * d))
for at, a in [(0.1, 1), (0.55, 0.8), (1.05, 0.9)]: place(x, (thud(0.3, 140, 70, 0.08) + 0.4 * lp(noise(0.3), 500) * env(int(SR * 0.3), 0.001, 0.05)) * a, at)
save('distant_1', fade(lp(x, 1200) * 1.0), 0.8)
d = 3.0; x = np.zeros(int(SR * d))
tt = t_(2.6)
clang = sum(a * np.sin(2 * np.pi * f * tt) * np.exp(-tt / dec) for f, a, dec in [(310, 1, .5), (467, .7, .4), (733, .5, .3), (1210, .3, .2), (1830, .2, .12)])
x[:len(clang)] += clang; save('distant_2', fade(lp(x, 2500) * 0.9, 0.002, 0.2), 0.8)
d = 3.4; t = t_(d); f = 70 + 25 * np.sin(2 * np.pi * 0.35 * t) + 15 * t
x = lp(noise(d), 600) * (0.3 + 0.7 * np.abs(np.sin(2 * np.pi * 1.7 * t))) + 0.7 * np.sin(2 * np.pi * np.cumsum(f) / SR)
x *= np.sin(np.pi * t / d) ** 1.5; save('distant_3', x, 0.8)

# ---------- pintu ----------
d = 1.3; t = t_(d); sweep = 180 + 220 * np.sin(np.pi * t / d)
creak = bp(noise(d), 300, 1400, 3) * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(sweep) / SR * 0.12))
creak = creak * np.sin(np.pi * t / d) ** 0.7 * 0.9 + 0.3 * np.sin(2 * np.pi * np.cumsum(sweep * 1.5) / SR) * np.sin(np.pi * t / d) ** 2 * 0.25
x = np.zeros(int(SR * d)); x += creak; place(x, click(0.04, 800, 3500) * 0.9, 0.0); place(x, 0.6 * thud(0.15, 120, 70, 0.04), d - 0.15)
save('door_open', fade(x, 0.003, 0.05), 0.85)
d = 0.7; x = np.zeros(int(SR * d)); place(x, 1.0 * thud(0.35, 110, 45, 0.09) + 0.5 * lp(noise(0.35), 700) * env(int(SR * 0.35), 0.001, 0.06), 0.0)
place(x, click(0.05, 700, 3000) * 0.9, 0.04); place(x, 0.3 * bp(noise(0.3), 200, 900) * env(int(SR * 0.3), 0.01, 0.12), 0.1)
save('door_close', fade(x), 0.9)
d = 0.8; x = np.zeros(int(SR * d))
for at in [0.0, 0.11, 0.25, 0.33, 0.5]: place(x, click(0.06, 900, 4500) * R.uniform(0.6, 1) + 0.3 * thud(0.06, 220, 140, 0.02), at)
save('door_locked', fade(x), 0.8)

# ---------- key / lock / item ----------
d = 0.9; t = t_(d); x = np.zeros(int(SR * d))
for at, f in [(0.0, 2640), (0.07, 3322), (0.15, 2093), (0.24, 3951)]:
    tt = t_(0.5); place(x, (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt)) * np.exp(-tt / 0.13) * 0.5, at)
place(x, click(0.02, 3000, 9000) * 0.6, 0.0); save('key_pickup', fade(x), 0.8)
d = 0.35; x = bp(noise(d), 600, 2800) * env(int(SR * d), 0.002, 0.05, 6) + 0.4 * sine(900, d) * env(int(SR * d), 0.001, 0.03); save('item_pickup', fade(x), 0.7)
d = 1.0; x = np.zeros(int(SR * d)); place(x, click(0.05, 1200, 5000) * 1.0 + 0.7 * thud(0.1, 400, 200, 0.03), 0.0); place(x, click(0.06, 600, 3500) * 1.0, 0.09)
for i, at in enumerate([0.2, 0.28, 0.37, 0.5, 0.66]):
    tt = t_(0.25); place(x, np.sin(2 * np.pi * (3200 + i * 410) * tt) * np.exp(-tt / 0.05) * (0.4 - 0.05 * i), at)
save('lock_unlock', fade(x), 0.85)
d = 1.6; x = np.zeros(int(SR * d)); at = 0.0; g = 1.0
while at < 1.3:
    tt = t_(0.2); f = R.uniform(2200, 4200); place(x, (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.3 * tt)) * np.exp(-tt / 0.04) * 0.5 * g, at)
    place(x, click(0.02, 2000, 8000) * 0.5 * g, at); at += R.uniform(0.04, 0.14) * (1 + at); g *= 0.88
place(x, 0.5 * lp(noise(0.25), 500) * env(int(SR * 0.25), 0.001, 0.08), 0.0); save('chain_fall', fade(x), 0.8)

# ---------- container ----------
d = 0.7; t = t_(d); slide = bp(noise(d), 200, 1200, 3) * np.sin(np.pi * t / d) ** 0.6; x = slide * 0.7
place(x, 0.6 * thud(0.12, 150, 80, 0.04), 0.58); place(x, click(0.03, 600, 2500) * 0.6, 0.0)  # (tidak disimpan: diganti SFX per jenis furniture)
d = 1.1; x = np.zeros(int(SR * d))
for at in [0.0, 0.18, 0.34, 0.6, 0.75]:
    n = R.uniform(0.1, 0.2); place(x, bp(noise(n), 1500, 6000) * env(int(SR * n), 0.01, n * 0.7, 6) * R.uniform(0.5, 1), at)
save('search', fade(x), 0.7)

# ---------- flashlight / battery ----------
d = 0.08; x = click(d, 1000, 5000) + 0.6 * thud(d, 350, 250, 0.02); save('flash_click', fade(x, 0.001, 0.01), 0.8)
d = 0.7; x = np.zeros(int(SR * d)); place(x, click(0.04, 800, 3500) + 0.6 * thud(0.1, 300, 180, 0.03), 0.0)
place(x, click(0.05, 600, 3000) + 0.5 * thud(0.1, 250, 150, 0.03), 0.16)
tt = t_(0.35); place(x, 0.35 * np.sin(2 * np.pi * np.cumsum(500 + 1600 * (tt / 0.35) ** 1.5) / SR) * np.sin(np.pi * tt / 0.35), 0.3)
save('battery_use', fade(x), 0.8)
d = 0.6; t = t_(d); f = 900 * np.exp(-t * 4.5) + 60
x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18) * 0.7 + 0.2 * hp(noise(d), 2000) * np.exp(-t / 0.05)
place(x, click(0.03, 800, 4000) * 0.8, 0.0); save('flash_die', fade(x), 0.8)

# ---------- listrik ----------
d = 1.2; t = t_(d); x = np.zeros(int(SR * d))
place(x, 1.0 * hp(noise(0.12), 2500) * env(int(SR * 0.12), 0.001, 0.03, 8), 0.0)
place(x, sum(np.sin(2 * np.pi * 120 * k * t_(0.5) + k) / k for k in (1, 2, 3, 5)) * np.exp(-t_(0.5) / 0.12) * 0.7, 0.0)
place(x, 0.9 * thud(0.35, 90, 40, 0.1), 0.1); place(x, 0.25 * bp(noise(0.8), 2000, 7000) * env(int(SR * 0.8), 0.01, 0.2, 6), 0.05)
save('lights_off', fade(x), 0.9)
d = 1.5; t = t_(d); x = np.zeros(int(SR * d)); gate = np.zeros(len(t))
for s, e_ in [(0.0, 0.05), (0.12, 0.17), (0.3, 0.34), (0.45, 0.6), (0.7, 1.5)]: gate[int(s * SR):int(e_ * SR)] = 1
hum = sum(np.sin(2 * np.pi * 120 * k * t + k) / k for k in (1, 2, 3, 4)) * (0.4 + 0.6 * np.minimum(1, t / 1.0))
x = hum * gate * 0.7 + 0.15 * bp(noise(d), 3000, 8000) * gate
place(x, 0.8 * thud(0.1, 180, 100, 0.03), 0.0); place(x, click(0.03, 1500, 6000) * 0.8, 0.45); save('lights_on', fade(x, 0.002, 0.15), 0.85)

# ---------- furniture ----------
d = 1.8; t = t_(d); stutter = (0.45 + 0.55 * np.maximum(0, np.sin(2 * np.pi * 5.5 * t + np.sin(2 * np.pi * 1.3 * t) * 2))) 
x = bp(noise(d), 120, 900, 3) * stutter * np.sin(np.pi * t / d) ** 0.5
x += 0.35 * bp(noise(d), 900, 3000) * stutter * np.sin(np.pi * t / d); place(x, 0.5 * thud(0.1, 100, 60, 0.03), d - 0.12)
save('furniture_scrape', fade(x, 0.02, 0.1), 0.85)

# ---------- entity ----------
d = 2.4; t = t_(d); src = noise(d)
x = sum(a * bp(src, f * 0.9, f * 1.15, 2) for f, a in [(500, 1.0), (1500, 0.6), (2500, 0.35)])
x *= (0.2 + 0.8 * np.abs(np.sin(2 * np.pi * 3.1 * t + np.sin(2 * np.pi * 0.7 * t) * 3))) * np.sin(np.pi * t / d) ** 1.2
x += 0.25 * bp(noise(d), 4500, 8500) * np.sin(np.pi * t / d) ** 2 * (0.5 + 0.5 * np.sin(2 * np.pi * 7 * t))
save('entity_whisper', x, 0.7)
d = 1.5; x = np.zeros(int(SR * d))
for i, at in enumerate([0.0, 0.24, 0.47, 0.68, 0.88, 1.06]):
    place(x, (lp(noise(0.16), 900) * env(int(SR * 0.16), 0.003, 0.05, 6) + 0.8 * thud(0.14, 130, 70, 0.04)) * (0.6 + 0.4 * (i % 2)) * (1 - i * 0.05), at)
save('entity_steps', fade(x), 0.8)

# ---------- furniture buka/tutup per jenis (laci, lemari, locker, peti/kotak) ----------
def _sl(d, lo, hi, amp=0.7):  # gesekan geser
    t = t_(d); return bp(noise(d), lo, hi, 3) * np.sin(np.pi * t / d) ** 0.6 * amp
# laci kayu: geser + ketukan ujung
d = 0.6; x = _sl(d, 180, 1100); place(x, 0.5 * thud(0.1, 140, 80, 0.035), d - 0.1); place(x, click(0.03, 500, 2200) * 0.5, 0.0)
save('drawer_open', fade(x), 0.8)
d = 0.5; x = _sl(d, 200, 1200, 0.55); place(x, 0.9 * thud(0.16, 130, 55, 0.05) + 0.4 * lp(noise(0.14), 800) * env(int(SR * 0.14), 0.001, 0.04), d - 0.17)
save('drawer_close', fade(x), 0.85)
# lemari: engsel berderit
d = 0.9; t = t_(d); sw = 260 + 320 * np.sin(np.pi * t / d)
x = bp(noise(d), 250, 1500, 3) * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(sw) / SR * 0.1)) * np.sin(np.pi * t / d) ** 0.7 * 0.8
x += 0.12 * np.sin(2 * np.pi * np.cumsum(sw * 2.1) / SR) * np.sin(np.pi * t / d) ** 2; place(x, click(0.03, 700, 3000) * 0.6, 0.0)
save('cabinet_open', fade(x, 0.003, 0.05), 0.8)
d = 0.55; x = np.zeros(int(SR * d)); place(x, 1.0 * thud(0.3, 150, 60, 0.07) + 0.5 * lp(noise(0.25), 900) * env(int(SR * 0.25), 0.001, 0.05), 0.12)
place(x, click(0.04, 600, 2600) * 0.7, 0.14); place(x, 0.25 * bp(noise(0.2), 300, 1000) * env(int(SR * 0.2), 0.01, 0.1), 0.0)
save('cabinet_close', fade(x), 0.85)
# locker logam: klik gerendel + dentang
d = 0.8; x = np.zeros(int(SR * d)); place(x, click(0.04, 1500, 6000) + 0.5 * thud(0.08, 420, 260, 0.02), 0.0)
tt = t_(0.7); place(x, sum(a * np.sin(2 * np.pi * f * tt) * np.exp(-tt / dec) for f, a, dec in [(420, 0.5, .25), (880, 0.3, .18), (1530, 0.15, .1)]), 0.05)
place(x, 0.5 * bp(noise(0.5), 600, 2800) * np.sin(np.pi * t_(0.5) / 0.5) ** 0.8, 0.12)
save('locker_open', fade(x, 0.002, 0.08), 0.8)
d = 0.7; x = np.zeros(int(SR * d)); tt = t_(0.6)
place(x, sum(a * np.sin(2 * np.pi * f * tt) * np.exp(-tt / dec) for f, a, dec in [(330, 1, .22), (690, 0.6, .16), (1210, 0.35, .1), (1890, 0.2, .06)]) + 0.6 * thud(0.12, 200, 90, 0.03), 0.0)
place(x, click(0.03, 1500, 6000) * 0.8, 0.0); place(x, click(0.03, 1200, 4500) * 0.6, 0.3)
save('locker_close', fade(x), 0.85)
# peti/kotak: tutup kayu terangkat
d = 0.7; t = t_(d); x = bp(noise(d), 250, 1800, 3) * np.sin(np.pi * t / d) ** 1.2 * 0.5
place(x, click(0.04, 500, 2500) * 0.9 + 0.6 * thud(0.1, 190, 110, 0.03), 0.0); place(x, 0.4 * thud(0.12, 120, 70, 0.04), d - 0.14)
save('lid_open', fade(x), 0.8)
d = 0.5; x = np.zeros(int(SR * d)); place(x, 1.0 * thud(0.25, 170, 70, 0.06) + 0.7 * bp(noise(0.12), 700, 3000) * env(int(SR * 0.12), 0.001, 0.025), 0.0)
place(x, 0.3 * lp(noise(0.25), 500) * env(int(SR * 0.25), 0.01, 0.1), 0.02)
save('lid_close', fade(x), 0.85)

# ---------- napas (stamina habis) ----------
d = 1.0; x = np.zeros(int(SR * d))
for at, n in [(0.0, 0.38), (0.45, 0.4)]:
    tt = t_(n); place(x, bp(noise(n), 500, 3500) * np.sin(np.pi * tt / n) ** 1.3 * 0.8 + 0.2 * bp(noise(n), 200, 600) * np.sin(np.pi * tt / n), at)
save('breath', fade(x, 0.02, 0.05), 0.55)

print('ok ->', len(os.listdir(OUT)), 'file')
