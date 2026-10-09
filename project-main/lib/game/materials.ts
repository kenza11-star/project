// Upgrade material runtime (ringan, tanpa asset baru): detail kotor/lembap dari 3 texture procedural kecil yang dibagi semua material.
// UV map = meter (1 tile ~ 1 m), jadi noise dipakai pada beberapa skala berbeda agar tidak terlihat berulang.
import * as THREE from 'three';
import * as CFG from './config';

type Std = THREE.MeshStandardMaterial;
interface Prof { tint?: [number, number, number]; rough?: number; metal?: number; bump?: number; grime?: number; stain?: number; damp?: number; env?: number }

// Profil per nama material GLB. tint = pengali warna (kuning dipertahankan, dikotori); rough = pengali roughness; grime = kekuatan AO kotor; damp = gelap lembap dekat lantai.
const PROFILES: Record<string, Prof> = {
  wallpaper: { tint: [0.84, 0.8, 0.62], rough: 1.0, bump: 0.5, grime: 0.9, stain: 1, damp: 1 },
  concrete:  { tint: [0.78, 0.76, 0.68], rough: 1.0, bump: 0.7, grime: 0.8, stain: 1, damp: 1 },
  ceiling:   { tint: [0.8, 0.76, 0.62], rough: 1.0, bump: 0.3, grime: 0.9, stain: 1 },
  carpet:    { tint: [0.8, 0.74, 0.55], rough: 1.0, bump: 1.0, grime: 1.0, stain: 1 },
  wood_light:{ tint: [0.82, 0.74, 0.62], rough: 1.12, bump: 0.5, grime: 0.7 },
  wood_dark: { tint: [0.8, 0.72, 0.6], rough: 1.15, bump: 0.5, grime: 0.7 },
  door_wood: { tint: [0.82, 0.74, 0.6], rough: 1.15, bump: 0.5, grime: 0.7 },
  metal_grey:{ tint: [0.82, 0.82, 0.78], rough: 1.5, metal: 0.55, bump: 0.35, grime: 0.8 },
  metal_dark:{ tint: [0.85, 0.85, 0.82], rough: 1.5, metal: 0.55, bump: 0.35, grime: 0.8 },
  locker_metal:{ tint: [0.8, 0.84, 0.78], rough: 1.5, metal: 0.55, bump: 0.35, grime: 0.9 },
  vent_metal:{ tint: [0.8, 0.8, 0.78], rough: 1.5, metal: 0.6, grime: 0.8 },
  rail:      { rough: 1.5, metal: 0.6 },
  handle:    { rough: 1.6, metal: 0.7 },
  fridge_white:{ tint: [0.78, 0.76, 0.66], rough: 1.7, metal: 0.0, grime: 0.9 },
  fabric:    { rough: 1.0, bump: 0.8, grime: 0.8 },
  cardboard: { rough: 1.0, bump: 0.4, grime: 0.6 },
  generator: { tint: [0.8, 0.75, 0.6], rough: 1.4, metal: 0.5, grime: 0.9 },
  black:     { rough: 1.4, metal: 0.0 },
};

function makeNoise(size: number, seed: number, octaves: number, contrast: number, lo = 0, hi = 1): THREE.DataTexture {
  // value-noise yang bisa di-tile (lattice wrap), 1 kanal -> disimpan di R,G,B sama agar bisa dipakai bump/ao/roughness
  const d = new Uint8Array(size * size * 4);
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const field = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o, lat = new Float32Array(cells * cells); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = lat[(y0 % cells) * cells + (x0 % cells)], b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lat[(((y0 + 1) % cells)) * cells + (x0 % cells)], e = lat[(((y0 + 1) % cells)) * cells + ((x0 + 1) % cells)];
      field[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy);
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < field.length; i++) {
    const v = lo + (hi - lo) * Math.min(1, Math.max(0, ((field[i] / tot) - 0.5) * contrast + 0.5)), b = Math.round(v * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export class MaterialUpgrade {
  private tex: THREE.Texture[] = [];
  private fine!: THREE.Texture; private stain!: THREE.Texture; private rough!: THREE.Texture;
  private done = new Set<THREE.Material>();

  constructor() {
    this.fine = makeNoise(128, 7, 4, 1.6);     // detail halus: bump
    this.stain = makeNoise(128, 91, 4, 2.4);   // noda besar: AO kotor (di-tile jarang)
    this.rough = makeNoise(64, 33, 3, 1.4, 0.72, 1);    // variasi roughness
    this.tex = [this.fine, this.stain, this.rough];
  }

  private tx(base: THREE.Texture, rep: number, rot = 0): THREE.Texture {
    const t = base.clone(); t.needsUpdate = true; t.repeat.set(rep, rep); t.rotation = rot; t.center.set(0.5, 0.5); this.tex.push(t); return t; // clone berbagi data GPU image yang sama? tidak: clone texture berbagi source -> upload sekali
  }

  apply(m: THREE.Material) {
    if (!CFG.MATERIAL_UPGRADE || this.done.has(m)) return; this.done.add(m);
    const sm = m as Std; if (!sm.isMeshStandardMaterial || !sm.name) return;
    const p = PROFILES[sm.name]; if (!p) return;
    if (p.tint && sm.color) sm.color.multiply(new THREE.Color(p.tint[0], p.tint[1], p.tint[2]));
    sm.roughness = Math.min(1, sm.roughness * (p.rough ?? 1));
    if (p.metal !== undefined) sm.metalness = Math.min(sm.metalness, p.metal);
    if (sm.metalness > 0.01) sm.envMapIntensity = 0.4; // tanpa env map: tidak berpengaruh, aman
    if (p.bump) { sm.bumpMap = this.tx(this.fine, 1.7, 0.4); sm.bumpScale = 0.9 * p.bump * CFG.MATERIAL_BUMP; }
    if (sm.roughness < 0.99) sm.roughnessMap = this.tx(this.rough, 0.6, 1.1); // roughnessMap mengalikan: variasi kilap, tidak menambah glossy
    this.dirt(sm, (p.grime ?? 0) * CFG.MATERIAL_GRIME, p.damp ?? 0);
    sm.needsUpdate = true;
  }

  /** Noda kotor + lembap berbasis posisi dunia (tanpa UV tambahan, tanpa stretching): noda besar dari 2 skala noise, gelap/kehijauan tipis dekat lantai, sedikit gelap di bawah plafon. */
  private dirt(m: Std, grime: number, damp: number) {
    if (grime <= 0 && damp <= 0) return;
    const stain = this.stain;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tStain = { value: stain }; sh.uniforms.uGrime = { value: grime }; sh.uniforms.uDamp = { value: damp };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = abs(normalize(mat3(modelMatrix) * objectNormal));');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform sampler2D tStain; uniform float uGrime; uniform float uDamp;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 g = vWn.y > 0.7 ? vWp.xz : vec2(vWp.x + vWp.z, vWp.y);
          float n = texture2D(tStain, g * 0.17).r * 0.65 + texture2D(tStain, g * 0.53 + 0.37).r * 0.35;
          diffuseColor.rgb *= 1.0 - uGrime * 0.5 * smoothstep(0.35, 0.85, n) - uGrime * 0.12 * n;
          float h = mod(vWp.y, 3.4);
          float low = (1.0 - smoothstep(0.0, 0.9, h)) * uDamp * (0.6 + 0.4 * n);
          float top = smoothstep(2.4, 3.3, h) * uDamp;
          diffuseColor.rgb *= 1.0 - 0.38 * low - 0.18 * top;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.95, 0.78), low * 0.5);
        }`);
    };
    m.customProgramCacheKey = () => 'dirt1';
  }

  dispose() { for (const t of this.tex) t.dispose(); this.tex = []; }
}
