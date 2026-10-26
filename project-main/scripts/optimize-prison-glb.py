#!/usr/bin/env python3
"""Skrip SEKALI PAKAI: perkecil dp3_hw9_prison_room.glb -> public/models/prison_room.glb (PIL saja, tanpa dependensi project).

  python3 scripts/optimize-prison-glb.py [input.glb] [output.glb]

- Tekstur: maks 1024 px; JPEG q80 (PNG hanya bila alpha benar-benar dipakai). Bila hasil > TARGET_MB, tekstur terbesar diturunkan bertahap (tetap <= 1024 px).
- Node tak terpakai dibuang: lampu kosong (directionalLight*, pointLight*). Geometri TIDAK diubah (poly tetap).
- Accessor/bufferView/material/tekstur/gambar yang tak lagi dirujuk ikut dibuang. Tanpa KTX/meshopt/draco (loader project tidak memasangnya).
"""
import io, json, struct, sys, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'dp3_hw9_prison_room.glb')
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'models', 'prison_room.glb')
MAX_PX, QUALITY, TARGET_MB = 1024, 80, 3.0
DROP_NAMES = ('directionallight', 'pointlight', 'spotlight', 'ambientlight')   # node lampu kosong dari FBX/Sketchfab


def read_glb(p):
    b = open(p, 'rb').read()
    assert b[:4] == b'glTF', 'bukan GLB'
    off, js, bn = 12, None, b''
    while off < len(b):
        ln, tp = struct.unpack('<II', b[off:off + 8]); ch = b[off + 8:off + 8 + ln]; off += 8 + ln
        if tp == 0x4E4F534A: js = json.loads(ch)
        elif tp == 0x004E4942: bn = ch
    return js, bn


def write_glb(p, js, bn):
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    bn += b'\0' * ((4 - len(bn) % 4) % 4)
    total = 12 + 8 + len(j) + 8 + len(bn)
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total)); f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(bn), 0x004E4942)); f.write(bn)
    return total


def prune_nodes(js):
    """Buang node lampu (beserta subtree-nya) dari semua anak & scene; node tak terjangkau dibuang dan indeks dipetakan ulang."""
    nodes = js['nodes']
    drop = {i for i, n in enumerate(nodes) if str(n.get('name', '')).lower().startswith(DROP_NAMES) and 'mesh' not in n}
    def sub(i, out):
        out.add(i)
        for c in nodes[i].get('children', []): sub(c, out)
    dead = set()
    for i in drop: sub(i, dead)
    keep = [i for i in range(len(nodes)) if i not in dead]
    remap = {o: n for n, o in enumerate(keep)}
    new = []
    for i in keep:
        n = dict(nodes[i])
        if 'children' in n:
            ch = [remap[c] for c in n['children'] if c in remap]
            if ch: n['children'] = ch
            else: del n['children']
        new.append(n)
    js['nodes'] = new
    for s in js['scenes']: s['nodes'] = [remap[i] for i in s['nodes'] if i in remap]
    return len(dead)


def prune_unused(js, bn):
    """Pertahankan hanya mesh/accessor/material/tekstur/gambar yang dirujuk node; kembalikan (json, bin geometri, daftar gambar mentah)."""
    meshes_used = sorted({n['mesh'] for n in js['nodes'] if 'mesh' in n})
    mrem = {o: n for n, o in enumerate(meshes_used)}
    for n in js['nodes']:
        if 'mesh' in n: n['mesh'] = mrem[n['mesh']]
    meshes = [js['meshes'][i] for i in meshes_used]
    mats_used = sorted({p['material'] for m in meshes for p in m['primitives'] if 'material' in p})
    matrem = {o: n for n, o in enumerate(mats_used)}
    acc_used = set()
    for m in meshes:
        for p in m['primitives']:
            if 'material' in p: p['material'] = matrem[p['material']]
            acc_used.update(p['attributes'].values())
            if 'indices' in p: acc_used.add(p['indices'])
            for t in p.get('targets', []): acc_used.update(t.values())
    mats = [js['materials'][i] for i in mats_used]
    tex_used = set()
    def scan(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'index' and isinstance(v, int) and isinstance(o, dict) and ('texCoord' in o or True): tex_used.add(v)
                else: scan(v)
        elif isinstance(o, list):
            for v in o: scan(v)
    for m in mats: scan(m)
    tex_used = sorted(tex_used); trem = {o: n for n, o in enumerate(tex_used)}
    def remap_tex(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == 'index' and isinstance(v, int): o[k] = trem[v]
                else: remap_tex(v)
        elif isinstance(o, list):
            for v in o: remap_tex(v)
    for m in mats: remap_tex(m)
    textures = [js['textures'][i] for i in tex_used]
    img_used = sorted({t['source'] for t in textures}); irem = {o: n for n, o in enumerate(img_used)}
    for t in textures: t['source'] = irem[t['source']]
    # gambar mentah
    raws = []
    for i in img_used:
        bv = js['bufferViews'][js['images'][i]['bufferView']]
        raws.append((js['images'][i].get('mimeType', 'image/png'), bn[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))
    # geometri: salin hanya bufferView yang dipakai accessor, rapat & rata 4 byte
    accs = sorted(acc_used); arem = {o: n for n, o in enumerate(accs)}
    for m in meshes:
        for p in m['primitives']:
            p['attributes'] = {k: arem[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = arem[p['indices']]
    new_acc, new_bv, geo, bvmap = [], [], bytearray(), {}
    for a in accs:
        acc = dict(js['accessors'][a])
        assert 'sparse' not in acc, 'accessor sparse tidak didukung'
        if 'bufferView' in acc:
            ob = acc['bufferView']
            if ob not in bvmap:
                v = js['bufferViews'][ob]; s = v.get('byteOffset', 0)
                while len(geo) % 4: geo.append(0)
                nv = {'buffer': 0, 'byteOffset': len(geo), 'byteLength': v['byteLength']}
                if 'byteStride' in v: nv['byteStride'] = v['byteStride']
                if 'target' in v: nv['target'] = v['target']
                geo += bn[s:s + v['byteLength']]; bvmap[ob] = len(new_bv); new_bv.append(nv)
            acc['bufferView'] = bvmap[ob]
        new_acc.append(acc)
    for k in ('animations', 'skins', 'cameras', 'extensionsUsed', 'extensionsRequired'): js.pop(k, None)
    js['meshes'], js['materials'], js['textures'], js['accessors'] = meshes, mats, textures, new_acc
    js['bufferViews'] = new_bv
    js['images'] = [{} for _ in raws]
    return js, bytes(geo), raws


def has_alpha(im):
    if im.mode in ('RGBA', 'LA'): return im.getchannel('A').getextrema()[0] < 250
    if im.mode == 'P' and 'transparency' in im.info: return True
    return False


def encode(raw, px, q, force_jpeg=False):
    im = Image.open(io.BytesIO(raw)); im.load()
    alpha = has_alpha(im)
    s = min(1.0, px / max(im.size))
    if s < 1.0: im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = io.BytesIO()
    if alpha and not force_jpeg:
        im.convert('RGBA').save(out, 'PNG', optimize=True)
        if out.tell() > 120 * 1024:    # dekal/noda: palet 256 warna + alpha jauh lebih kecil, tampilan tetap sama
            out = io.BytesIO(); im.convert('RGBA').quantize(256, method=Image.FASTOCTREE).save(out, 'PNG', optimize=True)
        return 'image/png', out.getvalue(), im.size, True
    im.convert('RGB').save(out, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=2)
    return 'image/jpeg', out.getvalue(), im.size, False


def build(js0, geo, raws, sizes, q):
    js = json.loads(json.dumps(js0)); bn = bytearray(geo); enc = []
    for i, (mt, raw) in enumerate(raws):
        mt2, data, size, alpha = encode(raw, sizes[i], q)
        while len(bn) % 4: bn.append(0)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': len(bn), 'byteLength': len(data)})
        js['images'][i] = {'bufferView': len(js['bufferViews']) - 1, 'mimeType': mt2}
        bn += data; enc.append((mt2, len(data), size, alpha))
    js['buffers'] = [{'byteLength': len(bn)}]
    return js, bytes(bn), enc


def main():
    js, bn = read_glb(SRC)
    before = os.path.getsize(SRC)
    dropped = prune_nodes(js)
    js, geo, raws = prune_unused(js, bn)
    sizes = [MAX_PX] * len(raws)
    for step in range(8):
        out_js, out_bn, enc = build(js, geo, raws, sizes, QUALITY)
        total = 12 + 8 + len(json.dumps(out_js, separators=(',', ':'))) + 8 + len(out_bn)
        if total <= TARGET_MB * 1024 * 1024: break
        big = max(range(len(enc)), key=lambda i: enc[i][1])     # turunkan tekstur terbesar satu tingkat (tetap <= 1024 px)
        sizes[big] = max(256, int(sizes[big] * 0.75))
    n = write_glb(DST, out_js, out_bn)
    print(f'node dibuang: {dropped} | {before / 1048576:.2f} MB -> {n / 1048576:.2f} MB | {DST}')
    for i, (mt, ln, size, alpha) in enumerate(enc): print(f'  img{i}: {mt} {size[0]}x{size[1]} {ln / 1024:.0f} KB' + (' (alpha)' if alpha else ''))
    if n > TARGET_MB * 1048576: print('PERINGATAN: masih di atas target', TARGET_MB, 'MB'); sys.exit(1)


if __name__ == '__main__':
    main()
