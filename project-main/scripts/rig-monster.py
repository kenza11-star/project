#!/usr/bin/env python3
"""Memasang tulang (rig), skin weight, dan klip animasi pada model monster statis -> public/models/gaunt-creature.glb (butuh numpy + Pillow).
Sumber: "Gaunt Horror Creature - Free Creepy 3D Model" oleh PurplePoint (CC-BY-4.0, https://sketchfab.com/3d-models/gaunt-horror-creature-free-creepy-3d-model-22a418d047764a23b73b539686b988c6).
Model asli TIDAK punya tulang/animasi. Skrip ini: (1) membakar transform node, menaruh kaki di y=0 & skala 1,1x (tinggi ~2,2 m), menghadap +Z;
(2) membuat 17 tulang humanoid + skin weight dari jarak ke segmen tulang; (3) membuat klip idle/walk/run/grab (rotasi tulang, 24 fps);
(4) merampingkan untuk HP: buang TANGENT & UV ke-2..4, indeks 16-bit, tekstur diperkecil, buang ekstensi clearcoat.
Jalankan: python3 scripts/rig-monster.py <sumber.glb> [keluaran.glb] [--preview dir]"""
import json, struct, io, sys, os, math
import numpy as np
from PIL import Image
SCALE = 1.10
# ---- sendi (koordinat sumber: Y atas, menghadap +Z). (nama, induk, posisi)
JOINTS = [
  ('Hips', None, (0, 0.12, -0.12)), ('Spine', 'Hips', (0, 0.30, -0.20)), ('Chest', 'Spine', (0, 0.55, -0.14)), ('Neck', 'Chest', (0, 0.74, -0.02)), ('Head', 'Neck', (0, 0.86, 0.10)),
  ('UpperArm_L', 'Chest', (-0.20, 0.66, -0.14)), ('LowerArm_L', 'UpperArm_L', (-0.36, 0.12, -0.02)), ('Hand_L', 'LowerArm_L', (-0.35, -0.26, 0.20)),
  ('UpperArm_R', 'Chest', (0.20, 0.66, -0.14)), ('LowerArm_R', 'UpperArm_R', (0.36, 0.12, -0.02)), ('Hand_R', 'LowerArm_R', (0.33, -0.30, 0.20)),
  ('UpperLeg_L', 'Hips', (-0.25, 0.02, -0.06)), ('LowerLeg_L', 'UpperLeg_L', (-0.35, -0.48, 0.0)), ('Foot_L', 'LowerLeg_L', (-0.35, -0.93, 0.0)),
  ('UpperLeg_R', 'Hips', (0.25, 0.02, -0.06)), ('LowerLeg_R', 'UpperLeg_R', (0.33, -0.48, 0.0)), ('Foot_R', 'LowerLeg_R', (0.33, -0.93, 0.02))]
# ujung segmen terakhir tiap rantai (untuk kapsul bobot)
TIPS = {'Head': (0, 0.99, 0.12), 'Hand_L': (-0.34, -0.50, 0.30), 'Hand_R': (0.33, -0.58, 0.32), 'Foot_L': (-0.33, -0.97, 0.32), 'Foot_R': (0.33, -0.97, 0.34)}
SIGMA = {'Hips': 0.22, 'Spine': 0.22, 'Chest': 0.22, 'Neck': 0.11, 'Head': 0.13}  # lainnya 0.10
NAMES = [j[0] for j in JOINTS]; IDX = {n: i for i, n in enumerate(NAMES)}
def load(path):
    f = open(path, 'rb').read(); l = struct.unpack('<I', f[12:16])[0]; j = json.loads(f[20:20 + l]); return f, j, 20 + l + 8
def acc(f, j, off, ai):
    a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]; nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]; dt = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: 'u1'}[a['componentType']]
    cs = np.dtype(dt).itemsize; st = bv.get('byteStride') or nc * cs; o = off + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    if st == nc * cs: return np.frombuffer(f, dtype=dt, count=a['count'] * nc, offset=o).reshape(-1, nc)
    out = np.empty((a['count'], nc), dtype=dt)
    for i in range(a['count']): out[i] = np.frombuffer(f, dtype=dt, count=nc, offset=o + i * st)
    return out
def node_mat(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1]); x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t; return M
def seg_dist(P, a, b):
    a = np.array(a, float); b = np.array(b, float); ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
def weights(P, jpos):
    D = np.zeros((len(P), len(JOINTS)))
    for i, (n, par, pos) in enumerate(JOINTS):
        kids = [k for k, (n2, p2, _) in enumerate(JOINTS) if p2 == n and n2 not in ('UpperArm_L', 'UpperArm_R', 'UpperLeg_L', 'UpperLeg_R')]
        end = TIPS[n] if n in TIPS else jpos[kids[0]] if kids else pos
        D[:, i] = seg_dist(P, jpos[i], end)
    sig = np.array([SIGMA.get(n, 0.10) for n in NAMES])
    W = np.exp(-(D / sig) ** 2) + 1e-9
    top = np.argsort(-W, axis=1)[:, :4]; Wt = np.take_along_axis(W, top, axis=1); Wt /= Wt.sum(axis=1, keepdims=True)
    return top.astype(np.uint8), Wt.astype(np.float32)
# ---- animasi
def qe(rx=0, ry=0, rz=0):  # derajat -> kuaternion (urutan X lalu Y lalu Z, ruang lokal induk)
    def q(a, ax):
        h = math.radians(a) / 2; s = math.sin(h); return np.array([ax[0] * s, ax[1] * s, ax[2] * s, math.cos(h)])
    def mul(a, b): return np.array([a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]])
    r = mul(mul(q(rz, (0, 0, 1)), q(ry, (0, 1, 0))), q(rx, (1, 0, 0))); return r / np.linalg.norm(r)
FPS = 24
def sm(x): x = min(1, max(0, x)); return x * x * (3 - 2 * x)
def clip_idle(t, T):  # napas pelan + kepala bergoyang
    p = 2 * math.pi * t / T; r = {}
    r['Spine'] = (2.0 * math.sin(p), 0, 1.0 * math.sin(p * 0.5)); r['Chest'] = (2.5 * math.sin(p + 0.6), 0, 0); r['Head'] = (3 * math.sin(p * 0.5 + 1), 5 * math.sin(p), 2 * math.sin(p))
    r['UpperArm_L'] = (3 * math.sin(p + 1), 0, 0); r['UpperArm_R'] = (-3 * math.sin(p + 1), 0, 0); r['LowerArm_L'] = (4 * math.sin(p), 0, 0); r['LowerArm_R'] = (4 * math.sin(p + 2), 0, 0)
    return r, (0, 0.004 * math.sin(p), 0)
def clip_walk(t, T, big=1.0, lean=8, bob=0.03, armk=14, legk=26):
    p = 2 * math.pi * t / T; s, c = math.sin(p), math.cos(p); r = {}
    r['UpperLeg_L'] = (-legk * big * s, 0, 0); r['UpperLeg_R'] = (legk * big * s, 0, 0)
    r['LowerLeg_L'] = (max(0, 38 * big * math.sin(p + 1.6)) , 0, 0); r['LowerLeg_R'] = (max(0, 38 * big * math.sin(p + 1.6 + math.pi)), 0, 0)
    r['Foot_L'] = (-8 * big * c, 0, 0); r['Foot_R'] = (8 * big * c, 0, 0)
    r['UpperArm_L'] = (armk * big * s, 0, 0); r['UpperArm_R'] = (-armk * big * s, 0, 0)
    r['LowerArm_L'] = (-12 * big - 10 * big * s, 0, 0); r['LowerArm_R'] = (-12 * big + 10 * big * s, 0, 0)
    r['Hips'] = (0, 6 * big * s, 2 * c); r['Spine'] = (lean * 0.5, -5 * big * s, 0); r['Chest'] = (lean * 0.5, -4 * big * s, 1.5 * c)
    r['Neck'] = (-lean * 0.4, 5 * big * s, 0); r['Head'] = (-lean * 0.4 + 3 * math.sin(2 * p), 4 * big * s, 2 * c)
    return r, (0, bob * abs(math.cos(p)) - bob * 0.5, 0)
def clip_grab(t, T):  # jumpscare: tubuh condong, kedua lengan menjangkau ke depan wajah lalu mencengkeram, gemetar (sudut lengan dihitung numerik: ujung tangan ~1,25 m di depan, setinggi wajah)
    u = t / T; a = sm(u / 0.5); b = sm((u - 0.45) / 0.3); sh = math.sin(t * 38) * sm((u - 0.55) / 0.2); r = {}
    r['Hips'] = (8 * a, 0, 0); r['Spine'] = (16 * a, 0, 0); r['Chest'] = (14 * a, 0, 0); r['Neck'] = (-10 * a, 0, 0); r['Head'] = (-18 * a + 1.2 * sh, 3 * sh, 0)
    r['UpperArm_L'] = (-69.8 * a + 2 * sh, (14.8 + 8 * b) * a, 8.7 * a); r['LowerArm_L'] = (-34.1 * a - 14 * b + 3 * sh, 0, 0); r['Hand_L'] = (0.3 * a - 25 * b + 10 * sh, 0, 0)
    r['UpperArm_R'] = (-70.2 * a + 2 * sh, (-4.9 - 8 * b) * a, 17.8 * a); r['LowerArm_R'] = (-20.6 * a - 14 * b + 3 * sh, 0, 0); r['Hand_R'] = (-47.2 * a - 6 * b + 10 * sh, 0, 0)
    r['UpperLeg_L'] = (-10 * a, 0, 0); r['UpperLeg_R'] = (10 * a, 0, 0)
    return r, (0, -0.06 * a, 0.12 * a)
CLIPS = [('idle', 2.4, clip_idle, True), ('walk', 1.2, lambda t, T: clip_walk(t, T, 1.0, 8, 0.03, 14, 26), True), ('run', 0.66, lambda t, T: clip_walk(t, T, 1.7, 24, 0.07, 26, 30), True), ('grab', 1.6, clip_grab, False)]
def sample_clip(fn, T, loop):
    n = int(round(T * FPS)) + (1 if True else 0); times = np.array([i / FPS for i in range(n)]); times[-1] = T if not loop else times[-1]
    if loop: times = np.array([i / FPS for i in range(int(round(T * FPS)) + 1)]); 
    qs = {nm: [] for nm in NAMES}; hip = []
    for t in times:
        tt = t % T if loop and t < T else min(t, T) if not loop else 0.0
        r, h = fn(T if (loop and t >= T) else tt, T) if not (loop and t >= T) else fn(0.0, T)
        for nm in NAMES: qs[nm].append(qe(*r.get(nm, (0, 0, 0))))
        hip.append(h)
    return times.astype(np.float32), {k: np.array(v, np.float32) for k, v in qs.items()}, np.array(hip, np.float32)
def build(src, out, preview=None):
    f, j, off = load(src); N = j['nodes']; par = {}
    for i, n in enumerate(N):
        for c in n.get('children', []): par[c] = i
    mi = [i for i, n in enumerate(N) if 'mesh' in n][0]; M = node_mat(N[mi]); k = mi
    while k in par: k = par[k]; M = node_mat(N[k]) @ M
    pr = j['meshes'][N[mi]['mesh']]['primitives'][0]
    P = acc(f, j, off, pr['attributes']['POSITION']).astype(float); NR = acc(f, j, off, pr['attributes']['NORMAL']).astype(float); UV = acc(f, j, off, pr['attributes']['TEXCOORD_0']).astype(np.float32); IDX_ = acc(f, j, off, pr['indices']).reshape(-1)
    P = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]; NR = NR @ M[:3, :3].T; NR /= np.linalg.norm(NR, axis=1, keepdims=True) + 1e-12
    ty = -P[:, 1].min(); tf = lambda a: (np.asarray(a, float) + np.array([0, ty, 0])) * SCALE
    Pw = tf(P); jpos = [tf(p) for (_, _, p) in JOINTS]
    TIPS_W = {k2: tf(v) for k2, v in TIPS.items()}
    globals()['TIPS'] = TIPS_W  # seg_dist memakai koordinat akhir
    jointsA, W = weights(Pw, jpos)
    # ---- biner
    chunks = []; bvs = []; accs = []
    def add(data, target=None, comp=None, typ=None, count=None, mn=None, mx=None):
        b = data.tobytes();
        while len(b) % 4: b += b'\0'
        bvs.append({'buffer': 0, 'byteOffset': sum(len(c) for c in chunks), 'byteLength': len(data.tobytes()), **({'target': target} if target else {})}); chunks.append(b)
        a = {'bufferView': len(bvs) - 1, 'componentType': comp, 'count': count, 'type': typ}
        if mn is not None: a['min'] = [float(x) for x in mn]; a['max'] = [float(x) for x in mx]
        accs.append(a); return len(accs) - 1
    a_pos = add(Pw.astype(np.float32), 34962, 5126, 'VEC3', len(Pw), Pw.min(0), Pw.max(0)); a_nor = add(NR.astype(np.float32), 34962, 5126, 'VEC3', len(NR)); a_uv = add(UV, 34962, 5126, 'VEC2', len(UV))
    a_jt = add(jointsA.astype(np.uint8), 34962, 5121, 'VEC4', len(jointsA)); a_wt = add(W, 34962, 5126, 'VEC4', len(W)); a_ix = add(IDX_.astype(np.uint16), 34963, 5123, 'SCALAR', len(IDX_))
    # nodes: 0 = mesh, 1.. = tulang
    nodes = [{'name': 'GauntCreature', 'mesh': 0, 'skin': 0}]; bone_node = {}
    for i, (nm, pr_, pos) in enumerate(JOINTS): bone_node[nm] = len(nodes); nodes.append({'name': nm})
    for i, (nm, pr_, pos) in enumerate(JOINTS):
        rel = jpos[i] - (jpos[IDX[pr_]] if pr_ else 0); nodes[bone_node[nm]]['translation'] = [float(x) for x in rel]
        if pr_: nodes[bone_node[pr_]].setdefault('children', []).append(bone_node[nm])
    ibm = np.zeros((len(JOINTS), 4, 4), np.float32)
    for i in range(len(JOINTS)): m = np.eye(4); m[:3, 3] = -jpos[i]; ibm[i] = m.T  # kolom-mayor
    a_ibm = add(ibm.reshape(-1, 16), None, 5126, 'MAT4', len(JOINTS))
    # ---- animasi
    samplers = []; channels = []; anim_json = []
    for name, T, fn, loop in CLIPS:
        times, qs, hip = sample_clip(fn, T, loop); a_t = add(times, None, 5126, 'SCALAR', len(times), [times.min()], [times.max()]); samplers = []; channels = []
        for nm in NAMES:
            a_q = add(qs[nm], None, 5126, 'VEC4', len(times)); samplers.append({'input': a_t, 'output': a_q, 'interpolation': 'LINEAR'}); channels.append({'sampler': len(samplers) - 1, 'target': {'node': bone_node[nm], 'path': 'rotation'}})
        hp = (hip + np.array(nodes[bone_node['Hips']]['translation'], np.float32)).astype(np.float32); a_h = add(hp, None, 5126, 'VEC3', len(times)); samplers.append({'input': a_t, 'output': a_h, 'interpolation': 'LINEAR'}); channels.append({'sampler': len(samplers) - 1, 'target': {'node': bone_node['Hips'], 'path': 'translation'}})
        anim_json.append({'name': name, 'samplers': samplers, 'channels': channels})
    # ---- tekstur (diperkecil)
    images = []; tex_sizes = [1024, 512, 512]
    for i, im in enumerate(j['images']):
        bv = j['bufferViews'][im['bufferView']]; d = f[off + bv.get('byteOffset', 0):off + bv.get('byteOffset', 0) + bv['byteLength']]
        img = Image.open(io.BytesIO(d)).convert('RGB').resize((tex_sizes[i], tex_sizes[i]), Image.LANCZOS); b = io.BytesIO()
        if i == 0: img.save(b, 'JPEG', quality=88)
        else: img.save(b, 'PNG', optimize=True)
        data = np.frombuffer(b.getvalue(), np.uint8); bvs.append({'buffer': 0, 'byteOffset': sum(len(c) for c in chunks), 'byteLength': len(data)}); pad = bytes(data) + b'\0' * ((4 - len(data) % 4) % 4); chunks.append(pad)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': 'image/jpeg' if i == 0 else 'image/png'})
    mat = {'name': 'creature_skin', 'doubleSided': True, 'normalTexture': {'index': 2}, 'pbrMetallicRoughness': {'baseColorFactor': j['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], 'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}}}
    blob = b''.join(chunks)
    g = {'asset': {'version': '2.0', 'generator': 'scripts/rig-monster.py', 'extras': {**j['asset'].get('extras', {}), 'note': 'dipasang tulang + animasi (idle/walk/run/grab), tekstur diperkecil'}},
         'scene': 0, 'scenes': [{'nodes': [0, bone_node['Hips']]}], 'nodes': nodes, 'skins': [{'joints': [bone_node[n] for n in NAMES], 'skeleton': bone_node['Hips'], 'inverseBindMatrices': a_ibm}],
         'meshes': [{'name': 'GauntCreature', 'primitives': [{'attributes': {'POSITION': a_pos, 'NORMAL': a_nor, 'TEXCOORD_0': a_uv, 'JOINTS_0': a_jt, 'WEIGHTS_0': a_wt}, 'indices': a_ix, 'material': 0}]}],
         'materials': [mat], 'textures': j['textures'], 'samplers': j.get('samplers', []), 'images': images, 'animations': anim_json, 'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    open(out, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(blob)) + b'BIN\0' + blob)
    print('ditulis', out, round(os.path.getsize(out) / 1024), 'KB | verts', len(Pw), 'tris', len(IDX_) // 3, '| tinggi', round(Pw[:, 1].max(), 2), 'm | bone', len(JOINTS), '| klip', [(c[0], c[1]) for c in CLIPS])
    return dict(P=Pw, J=jointsA, W=W, jpos=jpos)
if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; src = a[0]; out = a[1] if len(a) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'gaunt-creature.glb')
    build(src, out)
