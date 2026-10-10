# Membuat SFX tubuh prosedural (tanpa dependency selain numpy): detak jantung lub-dub, napas terengah (kelelahan), gesekan kain (merangkak ke kolong).
# Jalankan: python3 scripts/gen-body-sfx.py  -> public/sfx/{heartbeat,pant,rustle}.wav (44.1 kHz mono 16-bit)
import numpy as np, wave, os
SR = 44100
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')

def save(name, x, peak=0.85):
    x = x / (np.max(np.abs(x)) or 1) * peak
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())

def bandpass(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((f - lo) / (lo * 0.35 + 1), 0, 1) * np.clip((hi - f) / (hi * 0.35 + 1), 0, 1)
    return np.fft.irfft(X * m, len(x))

def lowpass(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / fc) ** 4), len(x))

# ---- detak jantung: "lub" (dalam, berat) + "dub" (lebih ringan), dada berdentum + ekor ruang pendek ----
def thump(dur, f0, f1, dec, noise=0.25):
    n = int(SR * dur); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) + 0.35 * np.sin(2 * ph)
    env = (1 - np.exp(-t / 0.004)) * np.exp(-t / dec)
    click = lowpass(rng.standard_normal(n), 300) * np.exp(-t / 0.012) * noise * 4
    return (body * env + click)
total = int(SR * 0.95); hb = np.zeros(total)
lub = thump(0.30, 78, 44, 0.075); dub = thump(0.26, 92, 52, 0.06)
hb[:len(lub)] += lub; s = int(SR * 0.30); hb[s:s + len(dub)] += dub * 0.62
tail = rng.standard_normal(int(SR * 0.25)) * np.exp(-np.arange(int(SR * 0.25)) / (SR * 0.06)); tail = lowpass(tail, 900)
hb = hb + 0.25 * np.convolve(hb, tail / np.sum(np.abs(tail)), 'full')[:total]
hb *= np.clip(np.arange(total) / (SR * 0.002), 0, 1) * np.clip((total - np.arange(total)) / (SR * 0.05), 0, 1)
save('heartbeat', hb, 0.9)

# ---- napas terengah: tarik (naik, lebih desis) lalu hembus (lebih berat), dua siklus ----
def breath(dur, lo, hi, peak_at, voiced):
    n = int(SR * dur); t = np.arange(n) / SR
    env = np.where(t < dur * peak_at, (t / (dur * peak_at)) ** 1.6, ((dur - t) / (dur * (1 - peak_at))) ** 1.3)
    env = np.clip(env, 0, 1) * (1 + 0.12 * np.sin(2 * np.pi * 9 * t))
    nz = rng.standard_normal(n)
    air = bandpass(nz, lo, hi)
    form = bandpass(nz, 600, 900) * 0.8 + bandpass(nz, 1700, 2300) * 0.5   # formant "haa"
    return (air * 0.7 + form * voiced) * env
out = np.zeros(int(SR * 2.6)); pos = 0
for k, (d_in, d_out) in enumerate(((0.38, 0.55), (0.34, 0.50))):
    i = breath(d_in, 900, 6500, 0.75, 0.25); o = breath(d_out, 500, 4200, 0.25, 0.7)
    seg = np.concatenate([i * 0.8, np.zeros(int(SR * 0.04)), o]); out[pos:pos + len(seg)] += seg; pos += len(seg) + int(SR * 0.28)
save('pant', out[:int(SR * 2.6)] * np.clip((len(out) - np.arange(len(out))) / (SR * 0.1), 0, 1), 0.8)

# ---- gesekan kain/karpet saat merangkak ----
n = int(SR * 0.9); t = np.arange(n) / SR
r = bandpass(rng.standard_normal(n), 250, 2500) * (np.abs(np.sin(2 * np.pi * 3.2 * t)) ** 1.5) * np.exp(-t / 0.55)
save('rustle', r * np.clip(t / 0.03, 0, 1), 0.6)
print('ok')
