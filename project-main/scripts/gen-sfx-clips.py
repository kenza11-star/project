#!/usr/bin/env python3
"""Membuat lib/game/sfxclips.ts dari file mp3 di public/sfx (butuh ffmpeg + numpy + scipy).
File audio ASLI tidak diubah/dihapus: skrip hanya MENGUKUR (waktu langkah, puncak benturan, level) lalu menulis daftar potongan
(offset, durasi, gain, fade, titik benturan). Potongan dibuat saat load oleh AudioManager (decode sekali, iris, simpan kecil di memori).
Jalankan: python3 scripts/gen-sfx-clips.py"""
import subprocess, numpy as np, os, sys, json
from scipy.signal import butter, sosfilt
D = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')
OUT = os.path.join(os.path.dirname(__file__), '..', 'lib', 'game', 'sfxclips.ts')
SR = 44100
TARGET_PEAK_DB = -2.0   # sama dengan SFX lama (peak -1,4..-1,9 dBFS) -> campuran suara game tetap seimbang
MAX_GAIN = 12.0
F = dict(
  walk='freeeverythingxx-walking-on-concrete-ver-2-268513.mp3', run='soumages-running-363346.mp3',
  stairs='freesound_community-footsteps-stairs-slow-106711.mp3', conc='freesound_community-concrete-footsteps-6752.mp3',
  heart='dragon-studio-heartbeat-sound-372448.mp3', breath='ribhavagrawal-heavy-breathing-sound-effect-type-02-294195.mp3',
  creak='freesound_community-door-creak-38423.mp3', dclose='dragon-studio-door-close-effect-382710.mp3',
  slam='freesound_community-door-slam-angrily-86963.mp3', impact='impact-slam-46.mp3', floor='dragon-studio-floorboard-creak-02-499644.mp3',
  dr_open='desk-drawer-open-02.mp3', dr_slide='desk-drawer-slide-01.mp3', dr_close='growth-84fc4bc4938dcf852562e065-part-1-v1.mp3',
  cb_close='door-close-47.mp3', cb_open='refrigerator-door-open-02.mp3', lk_open='metal-door-open-02.mp3', lk_creak='metal_locker_creak.mp3', lk_unlock='metal-door-unlock-02.mp3',
  # tambahan dari repo Sound (folder Tanggalantai & Lacidrawer)
  walk2='Tanggalantai_Walk.mp3', run2='Tanggalantai_Run.mp3', dr_slide2='desk-drawer-slide-02.mp3')
_cache = {}
def load(key):
    if key not in _cache:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(D, F[key]), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True).stdout
        st = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
        # meniru decodeAudioData di browser (sampel > 0 dBFS dipotong) + mixdown mono seperti AudioManager.slice()
        _cache[key] = np.clip(st, -1.0, 1.0).mean(axis=1).astype(np.float32)
    return _cache[key]
def peaks(key, hp=150, lp=None, mind=0.3, thr=0.25, hop=0.005):
    x = load(key); y = sosfilt(butter(4, hp / (SR / 2), 'high', output='sos'), x)
    if lp: y = sosfilt(butter(4, lp / (SR / 2), 'low', output='sos'), y)
    h = int(SR * hop); env = np.array([np.max(np.abs(y[i:i + h])) for i in range(0, len(y) - h, h)]); ref = np.percentile(env, 99); pk = []
    w = int(0.05 / hop)
    for i in range(len(env)):
        if env[i] > ref * thr and env[i] >= np.max(env[max(0, i - w):i + w + 1]):
            if not pk or (i - pk[-1]) * hop >= mind: pk.append(i)
            elif env[i] > env[pk[-1]]: pk[-1] = i
    return [p * hop for p in pk], [float(env[p] / ref) for p in pk]
def snap(key, t, before=0.04, after=0.10):  # puncak full-band terdekat dari onset terdeteksi -> pre-roll konsisten untuk tiap langkah
    x = load(key); a, b = int(max(0, t - before) * SR), int((t + after) * SR); return (a + int(np.argmax(np.abs(x[a:b])))) / SR
def refine(key, t, w=0.08):  # waktu puncak sebenarnya di sekitar perkiraan t
    x = load(key); a, b = int(max(0, t - w) * SR), int((t + w) * SR); return (a + int(np.argmax(np.abs(x[a:b])))) / SR
clips = {}
groups = {}
def add(name, key, start, dur, fi=0.004, fo=None, hit=None, group=None):
    x = load(key); start = max(0.0, start); dur = min(dur, len(x) / SR - start); fo = fo if fo is not None else min(0.06, dur * 0.3)
    seg = x[int(start * SR):int((start + dur) * SR)].copy(); n = len(seg)
    env = np.ones(n); nfi, nfo = max(1, int(fi * SR)), max(1, int(fo * SR)); env[:nfi] *= np.linspace(0, 1, nfi); env[-nfo:] *= np.linspace(1, 0, nfo)
    pk = float(np.max(np.abs(seg * env))) + 1e-9; g = min(10 ** (TARGET_PEAK_DB / 20) / pk, MAX_GAIN)   # normalisasi puncak SETELAH fade
    if group and g >= MAX_GAIN - 1e-6: print(f'  dilewati {name}: terlalu pelan untuk dinormalkan (gain > {MAX_GAIN})', file=sys.stderr); return   # varian yang jauh lebih pelan dari lainnya tidak dipakai
    if group in ('WALK', 'RUN', 'STAIRS', 'HEART') and np.argmax(np.abs(seg)) > 0.6 * n: print(f'  PERINGATAN {name}: puncak jatuh di ujung potongan', file=sys.stderr)
    clips[name] = dict(file=F[key], off=round(start, 3), dur=round(dur, 3), gain=round(g, 3), fi=fi, fo=round(fo, 3), peak_db=round(20 * np.log10(pk), 1), raw_peak=round(float(np.max(np.abs(seg))), 3), **({'hit': round(hit - start, 3)} if hit is not None else {}))
    if group: groups.setdefault(group, []).append(name)

# ---- langkah: potong per langkah (onset terdeteksi), dipilih acak per langkah di game (tanpa pengulangan berturut-turut)
t, a = peaks('walk', hp=120, mind=0.45, thr=0.2); t = [snap('walk', v) for v in t]
for i, (tt, aa) in enumerate(zip(t, a)):
    if aa >= 0.9 and tt + 0.4 < len(load('walk')) / SR: add(f'walk_{i+1}', 'walk', tt - 0.04, 0.46, fo=0.12, group='WALK')
t, a = peaks('run', hp=120, mind=0.2, thr=0.2); t = [snap('run', v, 0.03, 0.06) for v in t]
for i, tt in enumerate(t):
    nxt = t[i + 1] if i + 1 < len(t) else tt + 0.3
    add(f'run_{i+1}', 'run', tt - 0.03, min(0.27, nxt - tt + 0.01), fo=0.06, group='RUN')
t, a = peaks('stairs', hp=300, mind=0.35, thr=0.3); t = [snap('stairs', v) for v in t]
for i, tt in enumerate(t): add(f'stairs_{i+1}', 'stairs', tt - 0.05, 0.62, fo=0.15, group='STAIRS')
t, a = peaks('conc', hp=150, mind=0.28, thr=0.25)   # 60 dtk langkah beton: ambil 12 langkah yang bersih & terpisah, tersebar di seluruh file
LEN = len(load('conc')) / SR; xc = load('conc'); t = [snap('conc', v) for v in t]
amp = [float(np.max(np.abs(xc[int(v * SR):int((v + 0.05) * SR)]))) for v in t]   # amplitudo full-band langkah itu sendiri
good = [(tt, aa) for k, (tt, aa) in enumerate(zip(t, amp)) if aa >= 0.3 and tt < LEN - 0.6 and (k == 0 or tt - t[k - 1] >= 0.38) and (k + 1 >= len(t) or t[k + 1] - tt >= 0.38)]
assert len(good) >= 12, f'langkah beton bersih kurang dari 12 ({len(good)})'
pick = [good[int(i * (len(good) - 1) / 11)] for i in range(12)]
for i, (tt, aa) in enumerate(pick): add(f'stairs_c{i+1}', 'conc', tt - 0.04, 0.36, fo=0.1, group='STAIRS')
# ---- repo Sound / Tanggalantai: Walk.mp3 (24 dtk jalan stabil) & Run.mp3 (9 dtk lari: percepatan -> lari penuh -> melambat) jadi varian tambahan
t, a = peaks('walk2', hp=120, mind=0.35, thr=0.25); t = [snap('walk2', v) for v in t]; xw = load('walk2')
loud_w = [v for v in t if v < len(xw) / SR - 0.5 and float(np.max(np.abs(xw[int(v * SR):int((v + 0.05) * SR)]))) >= 0.12]   # buang langkah yang terlalu pelan (gain > ~6x)
pickw = [loud_w[int(i * (len(loud_w) - 1) / 15)] for i in range(min(16, len(loud_w)))]
for i, tt in enumerate(pickw): add(f'walk2_{i+1}', 'walk2', tt - 0.04, 0.46, fo=0.12, group='WALK')
t, a = peaks('run2', hp=120, mind=0.2, thr=0.2); t = [snap('run2', v, 0.03, 0.06) for v in t]
runs = [(tt, aa) for tt, aa in zip(t, a) if aa >= 1.0 and 2.5 <= tt <= 6.3]   # hanya fase lari penuh (langkah awal & melambat terlalu pelan/tidak konsisten)
for i, (tt, aa) in enumerate(runs):
    nxt = runs[i + 1][0] if i + 1 < len(runs) else tt + 0.3
    add(f'run2_{i+1}', 'run2', tt - 0.03, min(0.27, nxt - tt + 0.01), fo=0.06, group='RUN')
# ---- detak jantung: satu 'lub-dub' per potongan
t, a = peaks('heart', hp=40, lp=250, mind=0.12, thr=0.3); pairs = []
for k in range(len(t) - 1):
    if 0.25 <= t[k + 1] - t[k] <= 0.36 and (k == 0 or t[k] - t[k - 1] > 0.5) and (k + 2 >= len(t) or t[k + 2] - t[k + 1] > 0.5): pairs.append((t[k], t[k + 1]))
for i, (l, d) in enumerate(pairs[:8]): add(f'heart_{i+1}', 'heart', l - 0.08, (d - l) + 0.5, fi=0.01, fo=0.18, group='HEART')
# ---- napas berat: satu siklus tarik-hembus per potongan (puncak hembusan terdeteksi)
t, a = peaks('breath', hp=100, mind=0.8, thr=0.5)
for i, tt in enumerate(t): add(f'breath_{i+1}', 'breath', tt - 1.0, 1.55, fi=0.08, fo=0.25, group='BREATH')
# ---- pintu
add('door_creak', 'creak', 0.10, 2.70, fi=0.05, fo=0.45)               # buka: lambat (animasi pintu diperlambat mengikuti ini)
add('door_close_hit', 'dclose', 0.04, 0.50, fo=0.08, hit=refine('dclose', 0.21))
add('door_slam', 'slam', 0.20, 1.96, fo=0.3, hit=refine('slam', 1.35))   # event horor
add('impact_slam', 'impact', 0.00, 2.00, fo=0.3, hit=refine('impact', 1.4))  # event horor
add('floor_creak', 'floor', 0.18, 0.60, fi=0.02, fo=0.15)
# ---- furniture: 'hit' = momen benturan/kunci; potongan dipangkas supaya hit jatuh sekitar pre detik setelah mulai (selaras animasi 0,5 dtk)
def furn(name, key, est, pre, post, fo=0.12, **kw):
    h = refine(key, est); add(name, key, h - pre, pre + post, fo=fo, hit=h, **kw)
furn('drawer_open_a', 'dr_open', 1.77, 0.50, 0.40)
furn('drawer_open_b', 'dr_slide2', 1.77, 0.50, 0.40)  # desk-drawer-slide-02: meluncur lalu berhenti dengan ketukan lembut (seperti open-02) -> varian BUKA
furn('drawer_close_b', 'dr_slide', 1.90, 0.50, 0.60)  # desk-drawer-slide-01: meluncur lalu benturan keras 2x di ujung -> varian TUTUP (benturan keras = laci menabrak badan meja)
furn('drawer_close_a', 'dr_close', 1.62, 0.50, 0.40)
furn('cabinet_open_a', 'cb_open', 1.67, 0.25, 0.40)
furn('cabinet_close_a', 'cb_close', 0.20, 0.20, 0.50)
furn('locker_open_a', 'lk_open', 0.40, 0.40, 0.70)
furn('locker_close_a', 'lk_creak', 2.03, 0.50, 0.35)  # metal locker creak: berderit lalu 'klang' saat menutup
furn('unlock_metal', 'lk_unlock', 0.08, 0.08, 0.75)

def ts_obj(c): return '{ ' + ', '.join(f"{k}: {json.dumps(v)}" for k, v in c.items() if k not in ('peak_db', 'raw_peak')) + ' }'
lines = ['// DIHASILKAN oleh scripts/gen-sfx-clips.py — jangan diedit manual (jalankan ulang skripnya).',
         '// Potongan (clip) dari file audio di public/sfx: off/dur (detik pada file sumber), gain (normalisasi puncak ke -2 dBFS), fi/fo (fade),',
         '// hit (detik dari awal potongan sampai momen benturan/kunci; dipakai untuk menyelaraskan suara dengan animasi).',
         "export interface SfxClip { file: string; off: number; dur: number; gain: number; fi: number; fo: number; hit?: number }",
         'export const CLIPS: Record<string, SfxClip> = {']
for n, c in clips.items(): lines.append(f"  {n}: {ts_obj(c)},")
lines.append('};'); lines.append('')
lines.append('// durasi tiap file sumber (detik): dipakai test untuk memastikan semua potongan berada di dalam file')
lines.append('export const SRC_DUR: Record<string, number> = ' + json.dumps({F[k]: round(len(load(k)) / SR, 3) for k in F}) + ';')
lines.append('')
for g, names in groups.items(): lines.append(f"export const {g}_CLIPS: string[] = {json.dumps(names)};")
open(OUT, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print(f"{len(clips)} potongan ditulis ke lib/game/sfxclips.ts")
for g, names in groups.items(): print(f"  {g}: {len(names)} potongan")
for n, c in clips.items():
    if n.split('_')[0] not in ('walk', 'run', 'stairs', 'heart', 'breath') or n.startswith('breath_1') or n.startswith('stairs_c1'):
        print(f"  {n:16} off {c['off']:6.2f} dur {c['dur']:5.2f} gain x{c['gain']:5.2f} (peak asli {c['peak_db']:6.1f} dB){'  hit '+str(c['hit']) if 'hit' in c else ''}")
