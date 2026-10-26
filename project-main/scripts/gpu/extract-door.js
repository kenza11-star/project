// Menyiapkan data harness GPU: geometri Door_01 + texture kayu dari GLB, GLSL & texture detail dari build tes (tsc -p scripts/tsconfig.test.json dulu).
const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, '.tmp-gpu');
fs.mkdirSync(OUT, { recursive: true });
const b = fs.readFileSync(path.join(ROOT, 'public/models/backrooms_full.glb')), len = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + len).toString()), bin = b.slice(20 + len + 8);
const dn = j.nodes.find((n) => n.name === 'Door_01'), p = j.meshes[dn.mesh].primitives[0];
const rd = (ai, T) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type]), o = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0); return Array.from(new T(bin.buffer.slice(o, o + n * T.BYTES_PER_ELEMENT))); };
const geo = { pos: rd(p.attributes.POSITION, Float32Array), nrm: rd(p.attributes.NORMAL, Float32Array), uv: rd(p.attributes.TEXCOORD_0, Float32Array), idx: rd(p.indices, j.accessors[p.indices].componentType === 5123 ? Uint16Array : Uint32Array) };
const m = j.materials.find((q) => q.name === 'door_wood'), t = j.textures[m.pbrMetallicRoughness.baseColorTexture.index], bv = j.bufferViews[j.images[t.source].bufferView];
fs.writeFileSync(path.join(OUT, 'wood.png'), bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
const D = require(path.join(ROOT, '.tmp-game/doortex.js'));
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ geo, glsl: D.DOOR_GLSL, size: D.DOOR_TEX_SIZE, tex: Buffer.from(D.makeDoorDetail()).toString('base64'), factor: m.pbrMetallicRoughness.baseColorFactor, rough: m.pbrMetallicRoughness.roughnessFactor }));
console.log('data harness GPU siap di', OUT);
