#!/usr/bin/env python3
"""Hasilkan lib/game/blooddata.ts: bercak darah gedung (statis, deterministik) yang DIVALIDASI terhadap mesh dinding F1/F2_Walls asli
(keempat sudut dekal wajib menempel pada permukaan dinding -> tidak melayang di bukaan pintu). Jalankan: python3 scripts/gen-blood.py"""
import json, struct, random, math, os
import numpy as np
ROOT = os.path.join(os.path.dirname(__file__), '..')
b = open(os.path.join(ROOT, 'public/models/backrooms_full.glb'), 'rb').read()
l = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + l]); BIN = b[20 + l + 8:]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    ct = {5126: 'f4', 5123: 'u2', 5125: 'u4'}[a['componentType']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(BIN, dtype=ct, count=a['count'] * n, offset=o).reshape(-1, n)
LEVEL_Y = [0.0, 3.4]
rooms = []
for n in J['nodes']:
    e = n.get('extras') or {}
    if e.get('type') == 'RoomVolume':
        c = n['translation']; s = e['size']
        rooms.append(dict(type=e['room'].lower(), level=0 if e['floor'] == 1 else 1, minx=c[0]-s[0]/2, maxx=c[0]+s[0]/2, minz=c[2]-s[2]/2, maxz=c[2]+s[2]/2))
# segitiga dinding vertikal per level: (face, plane, tri2d[3x2] di (sepanjang, y))
walls = {0: [], 1: []}
for lv, nm in ((0, 'F1_Walls'), (1, 'F2_Walls')):
    nd = next(x for x in J['nodes'] if x.get('name') == nm); pr = J['meshes'][nd['mesh']]['primitives'][0]
    P = acc(pr['attributes']['POSITION']); I = acc(pr['indices']).ravel().reshape(-1, 3); T = P[I]
    fn = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-9
    for t, f in zip(T, fn):
        if abs(f[1]) > 0.2: continue
        if f[0] > 0.98: walls[lv].append((1, t[0][0], t[:, [2, 1]]))
        elif f[0] < -0.98: walls[lv].append((2, t[0][0], t[:, [2, 1]]))
        elif f[2] > 0.98: walls[lv].append((3, t[0][2], t[:, [0, 1]]))
        elif f[2] < -0.98: walls[lv].append((4, t[0][2], t[:, [0, 1]]))
def inside(p, tri):
    a, b_, c = tri; v0, v1, v2 = c - a, b_ - a, p - a
    d00, d01, d02, d11, d12 = v0 @ v0, v0 @ v1, v0 @ v2, v1 @ v1, v1 @ v2; den = d00 * d11 - d01 * d01
    if abs(den) < 1e-12: return False
    u = (d11 * d02 - d01 * d12) / den; v = (d00 * d12 - d01 * d02) / den
    return u >= -1e-6 and v >= -1e-6 and u + v <= 1 + 1e-6
def plane_at(lv, face, edge, p2, lo, hi):
    """plane dinding (koordinat tegak lurus) yang menutupi titik p2=(sepanjang,y) dalam [edge+lo, edge+hi] (sudah sesuai arah muka); None bila tidak ada."""
    for f, pl, tri in walls[lv]:
        if f == face and edge + lo <= pl <= edge + hi and inside(p2, tri): return pl
    return None
def covered(lv, face, plane, p2):
    for f, pl, tri in walls[lv]:
        if f == face and abs(pl - plane) < 0.02 and inside(p2, tri): return True
    return False
# pintu (engsel = translation node Door_NN, daun 1,14 m) & ventilasi: dekal tidak boleh berada dalam jangkauan ayunan/bukaannya
BLOCK = []   # (x, z, level, radius)
for n in J['nodes']:
    e = n.get('extras') or {}; nm = n.get('name', '')
    if e.get('type') == 'door' and nm.startswith('Door_') and 'translation' in n and not e.get('furniture'):
        t = n['translation']; BLOCK.append((t[0], t[2], 0 if e.get('floor', 1) == 1 else 1, 1.9))
    elif e.get('type') in ('ventCover', 'Vent') and 'translation' in n:
        t = n['translation']; BLOCK.append((t[0], t[2], 0 if t[1] < 3.0 else 1, 1.3))
def blocked(x, z, lv, pad=0.0): return any(l == lv and math.hypot(x - bx, z - bz) < r + pad for bx, bz, l, r in BLOCK)
print('zona blok pintu/vent:', len(BLOCK))
CELL = dict(SPLAT_A=0, SPLAT_B=1, POOL=2, HAND=3, SMEAR=4, DRIPS=5, SPRAY=6, CLUSTER=7)
rnd = random.Random(20261026)
INTEREST = {'hub': (3, 3), 'svce': (1, 3), 'svcw': (1, 3), 'perpus': (1, 2), 'stair': (2, 3), 'tech': (1, 2), 'server': (1, 2), 'locker': (1, 2), 'lockerroom': (1, 2),
            'utilitas': (1, 2), 'kitchen': (1, 1), 'break': (1, 1), 'hidden1': (1, 2), 'hidden2': (1, 2), 'vault': (1, 2), 'docs': (1, 1), 'lab': (1, 1)}
out = []
STAIR = (30.8, 37.8, 29.6, 32.8)   # lubang/badan tangga: jangan taruh dekal lantai di sini
def wall_decal(r, lv):
    edge_id = rnd.choice(['minx', 'maxx', 'minz', 'maxz'])
    kind = rnd.choices(['SPLAT_A', 'SPLAT_B', 'HAND', 'DRIPS', 'CLUSTER'], [3, 3, 2, 3, 2])[0]
    w, h, y = {'SPLAT_A': (1.2, 1.2, rnd.uniform(1.2, 1.8)), 'SPLAT_B': (1.2, 1.2, rnd.uniform(1.1, 1.7)), 'HAND': (0.55, 0.55, rnd.uniform(1.0, 1.5)),
               'DRIPS': (0.85, 1.7, rnd.uniform(1.5, 1.8)), 'CLUSTER': (1.0, 1.0, rnd.uniform(0.7, 1.2))}[kind]
    if edge_id in ('minx', 'maxx'):
        along = rnd.uniform(r['minz'] + 0.9, r['maxz'] - 0.9); face = 1 if edge_id == 'minx' else 2; edge = r[edge_id]; lo, hi = (0.0, 0.3) if face == 1 else (-0.3, 0.0)
    else:
        along = rnd.uniform(r['minx'] + 0.9, r['maxx'] - 0.9); face = 3 if edge_id == 'minz' else 4; edge = r[edge_id]; lo, hi = (0.0, 0.3) if face == 3 else (-0.3, 0.0)
    base = LEVEL_Y[lv]; yy = base + y
    ox0, oz0 = (edge, along) if face in (1, 2) else (along, edge)
    if blocked(ox0, oz0, lv, w / 2): return None
    pl = plane_at(lv, face, edge, np.array([along, yy]), lo, hi)
    if pl is None: return None
    for sx in (-1, 1):
        for sy in (-1, 1):
            if not covered(lv, face, pl, np.array([along + sx * w / 2 * 0.98, yy + sy * h / 2 * 0.98])): return None
    rot = 0.0 if kind in ('DRIPS',) else rnd.uniform(-0.5, 0.5)
    ox, oz = (pl, along) if face in (1, 2) else (along, pl)
    return [CELL[kind], round(ox, 3), round(yy, 3), round(oz, 3), face, w, h, round(rot, 2)]
def floor_decal(r, lv):
    for _ in range(40):
        x = rnd.uniform(r['minx'] + 1.2, r['maxx'] - 1.2); z = rnd.uniform(r['minz'] + 1.2, r['maxz'] - 1.2)
        if blocked(x, z, lv, 0.4): continue
        if STAIR[0] < x < STAIR[1] and STAIR[2] < z < STAIR[3]: continue
        kind = rnd.choices(['POOL', 'SPRAY', 'SPLAT_B', 'SMEAR'], [3, 3, 2, 3])[0]
        w, h = {'POOL': (1.5, 1.5), 'SPRAY': (1.6, 1.2), 'SPLAT_B': (1.1, 1.1), 'SMEAR': (1.7, 0.6)}[kind]
        return [CELL[kind], round(x, 3), round(LEVEL_Y[lv] + 0.012, 3), round(z, 3), 0, w, h, round(rnd.uniform(0, 6.28), 2)]
    return None
for r in rooms:
    key = r['type'] if r['type'] != 'stair' else 'stair'
    if key not in INTEREST: continue
    nf, nw = INTEREST[key]
    got = 0
    for _ in range(nf):
        d = floor_decal(r, r['level'])
        if d: out.append(d)
    for _ in range(nw * 12):
        if got >= nw: break
        d = wall_decal(r, r['level'])
        if d: out.append(d); got += 1
# jejak di lantai 2 menuju pintu jeruji penjara (ujung tangga atas -> gerbang x 38,3)
out.append([CELL['SMEAR'], 37.75, round(3.4 + 0.012, 3), 31.15, 0, 1.4, 0.5, 0.0]); out.append([CELL['SPRAY'], 37.3, round(3.4 + 0.012, 3), 30.75, 0, 1.2, 0.9, 0.5])
lines = ['// DIHASILKAN oleh scripts/gen-blood.py (jangan diedit manual): bercak darah gedung, divalidasi menempel pada mesh dinding asli.', "import type { Decal } from './blood';", 'export const MAIN_BLOOD: readonly Decal[] = [']
for d in out: lines.append('  [%d, %s, %s, %s, %d, %s, %s, %s],' % tuple(d))
lines.append('];')
open(os.path.join(ROOT, 'lib/game/blooddata.ts'), 'w').write('\n'.join(lines) + '\n')
from collections import Counter
print('dekal gedung:', len(out), 'lantai', sum(1 for d in out if d[4] == 0), 'dinding', sum(1 for d in out if d[4] != 0))
