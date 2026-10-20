#!/usr/bin/env python3
"""Membuat public/sfx/monster_scream.wav: teriakan monster SINTETIS (dibuat sepenuhnya dari kode ini: harmonik + derau + filter formant + distorsi),
jadi bebas hak cipta / legal dipakai. Ganti file ini dengan rekaman teriakan lain bila mau (nama & format wav sama: mono 16-bit).
Jalankan: python3 scripts/gen-monster-sfx.py   (butuh numpy + scipy)"""
import numpy as np, wave, os
from scipy.signal import butter, sosfilt
SR = 44100; DUR = 2.7; n = int(SR * DUR); t = np.arange(n) / SR
rng = np.random.default_rng(106)
# nada dasar: naik cepat (jeritan) lalu bergetar & turun pelan
f0 = 330 + 560 * (1 - np.exp(-t / 0.16)) - 240 * np.clip((t - 1.2) / 1.5, 0, 1) ** 1.3
vib = 1 + 0.045 * np.sin(2 * np.pi * 6.3 * t) * np.clip(t / 0.4, 0, 1) + 0.012 * np.sin(2 * np.pi * 17 * t + 1.3)
ph = 2 * np.pi * np.cumsum(f0 * vib) / SR
src = sum(np.sin(h * ph) / (h ** 0.85) for h in range(1, 26))            # harmonik kaya (suara serak)
src += 0.55 * rng.standard_normal(n) * (0.35 + 0.25 * np.sin(2 * np.pi * 9 * t) ** 2)   # napas/derau serak
def band(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
form = band(src, 650, 950) * 1.0 + band(src, 1150, 1500) * 0.8 + band(src, 2300, 3100) * 0.6 + band(src, 3300, 4500) * 0.25 + 0.2 * src
form = np.tanh(2.6 * form / (np.std(form) + 1e-9))                         # distorsi: jeritan terdengar kasar
sub = np.sin(2 * np.pi * np.cumsum(70 + 18 * np.sin(2 * np.pi * 3 * t)) / SR) * np.clip(t / 0.3, 0, 1) * np.exp(-t / 1.6)   # geraman rendah
env = np.clip(t / 0.045, 0, 1) * np.where(t < 1.9, 1.0, np.exp(-(t - 1.9) / 0.28)) * (1 + 0.14 * np.sin(2 * np.pi * 11.5 * t))
y = (form * 0.85 + sub * 0.35) * env
y = sosfilt(butter(2, 120, 'high', fs=SR, output='sos'), y)                # buang dengung terlalu rendah
y = np.tanh(1.3 * y); y *= 10 ** (-4.0 / 20) / np.max(np.abs(y))             # puncak -4 dBFS (jeritan sangat padat: dibuat lebih rendah dari SFX lain)
y[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx', 'monster_scream.wav')
with wave.open(out, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((y * 32767).astype('<i2').tobytes())
print('ditulis', out, round(os.path.getsize(out) / 1024), 'KB', round(DUR, 2), 'dtk, puncak', round(20 * np.log10(np.max(np.abs(y))), 1), 'dBFS')
