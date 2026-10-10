// Upgrade material runtime (ringan, tanpa asset baru): detail kotor/lembap dari 3 texture procedural kecil yang dibagi semua material.
// UV map = meter (1 tile ~ 1 m), jadi noise dipakai pada beberapa skala berbeda agar tidak terlihat berulang.
import * as THREE from 'three';
import * as CFG from './config';

type Std = THREE.MeshStandardMaterial;
let ENV: THREE.Texture | null = null;
export function setMaterialEnv(t: THREE.Texture | null) { ENV = t; }
interface Prof { tint?: [number, number, number]; rough?: number; rmin?: number; streak?: number; wet?: number; peel?: number; rust?: number; scratch?: number; metal?: number; bump?: number; grime?: number; stain?: number; damp?: number; env?: number }

// Profil per nama material GLB. tint = pengali warna (kuning dipertahankan, dikotori); rough = pengali roughness; grime = kekuatan AO kotor; damp = gelap lembap dekat lantai.
const PROFILES: Record<string, Prof> = {
  wallpaper: { tint: [0.84, 0.8, 0.62], rough: 1.0, bump: 0.6, grime: 1.0, stain: 1, damp: 1, streak: 1, peel: 1 },
  concrete:  { tint: [0.78, 0.76, 0.68], rough: 1.0, bump: 0.8, grime: 0.9, stain: 1, damp: 1, streak: 0.8, wet: 0.7, env: 0.5 },
  ceiling:   { tint: [0.8, 0.76, 0.62], rough: 1.0, bump: 0.3, grime: 1.0, stain: 1, damp: 0.6, streak: 1 },
  carpet:    { tint: [0.8, 0.74, 0.55], rough: 1.0, bump: 1.2, grime: 1.1, stain: 1, wet: 1, env: 0.55 },
  wood_light:{ tint: [0.82, 0.74, 0.62], rough: 1.0, rmin: 0.5, metal: 0, bump: 0.6, grime: 0.8, env: 0.35, scratch: 0.6 },
  wood_dark: { tint: [0.8, 0.72, 0.6], rough: 1.0, rmin: 0.5, metal: 0, bump: 0.6, grime: 0.8, env: 0.35, scratch: 0.6 },
  door_wood: { tint: [0.82, 0.74, 0.6], rough: 1.0, rmin: 0.5, metal: 0, bump: 0.6, grime: 0.8, env: 0.35, scratch: 0.6 },
  metal_grey:{ tint: [0.82, 0.82, 0.78], rough: 1.35, rmin: 0.42, metal: 0.75, bump: 0.4, grime: 0.9, env: 0.9, rust: 0.5, scratch: 0.8 },
  metal_dark:{ tint: [0.85, 0.85, 0.82], rough: 1.35, rmin: 0.42, metal: 0.75, bump: 0.4, grime: 0.9, env: 0.9, rust: 0.5, scratch: 0.8 },
  locker_metal:{ tint: [0.8, 0.84, 0.78], rough: 1.35, rmin: 0.45, metal: 0.7, bump: 0.4, grime: 1.0, env: 0.9, rust: 0.8, scratch: 1 },
  vent_metal:{ tint: [0.8, 0.8, 0.78], rough: 1.35, rmin: 0.4, metal: 0.8, grime: 0.9, env: 0.9, rust: 0.6, scratch: 0.6 },
  rail:      { rough: 1.0, rmin: 0.38, metal: 0.8, env: 0.9 },
  handle:    { rough: 1.0, rmin: 0.3, metal: 0.85, env: 1.0 },
  fridge_white:{ tint: [0.78, 0.76, 0.66], rough: 1.5, rmin: 0.4, metal: 0.0, grime: 1.0, env: 0.5, rust: 0.25, scratch: 0.5 },
  fabric:    { rough: 1.0, bump: 0.9, grime: 0.9 },
  cardboard: { rough: 1.0, bump: 0.4, grime: 0.7 },
  generator: { tint: [0.8, 0.75, 0.6], rough: 1.35, rmin: 0.45, metal: 0.7, grime: 1.0, env: 0.8, rust: 0.6, scratch: 0.7 },
  black:     { rough: 1.0, rmin: 0.5, metal: 0.0 },
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
    sm.roughness = Math.min(1, Math.max(p.rmin ?? 0, sm.roughness * (p.rough ?? 1)));
    if (p.metal !== undefined) sm.metalness = p.metal; // GLB sering metalness 0/1 ekstrem: dipaksa ke nilai yang masuk akal per profil
    if (p.env && ENV) { sm.envMap = ENV; sm.envMapIntensity = p.env; } // pantulan panel lampu: logam & kayu tidak lagi hitam/plastik
    if (p.bump) { sm.bumpMap = this.tx(this.fine, 1.7, 0.4); sm.bumpScale = 0.9 * p.bump * CFG.MATERIAL_BUMP; }
    if (sm.roughness < 0.99 && !p.env) sm.roughnessMap = this.tx(this.rough, 0.6, 1.1); // roughnessMap mengalikan: variasi kilap, tidak menambah glossy
    this.dirt(sm, { grime: (p.grime ?? 0) * CFG.MATERIAL_GRIME, damp: p.damp ?? 0, streak: p.streak ?? 0, wet: p.wet ?? 0, peel: p.peel ?? 0, rust: p.rust ?? 0, scratch: p.scratch ?? 0 });
    sm.needsUpdate = true;
  }

  /** Aging procedural berbasis posisi dunia (tanpa UV tambahan, tanpa stretching). Cabang berbasis uniform: fitur yang tidak dipakai material = tidak ada texture tap. */
  private dirt(m: Std, u: { grime: number; damp: number; streak: number; wet: number; peel: number; rust: number; scratch: number }) {
    if (u.grime <= 0 && u.damp <= 0 && u.wet <= 0 && u.rust <= 0 && u.scratch <= 0) return;
    const stain = this.stain;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tStain = { value: stain };
      for (const k of Object.keys(u)) sh.uniforms['u_' + k] = { value: (u as any)[k] };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = abs(normalize(mat3(modelMatrix) * objectNormal));');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWp; varying vec3 vWn; uniform sampler2D tStain;
        uniform float u_grime; uniform float u_damp; uniform float u_streak; uniform float u_wet; uniform float u_peel; uniform float u_rust; uniform float u_scratch;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        float gWet = 0.0, gDamp = 0.0, gRust = 0.0, gScr = 0.0;
        {
          bool horiz = vWn.y > 0.7;
          vec2 g = horiz ? vWp.xz : vec2(vWp.x + vWp.z, vWp.y);
          float hh = mod(vWp.y, 3.4);
          float n = texture2D(tStain, g * 0.17).r * 0.65 + texture2D(tStain, g * 0.53 + 0.37).r * 0.35;
          float dt = texture2D(tStain, g * 1.9 + 0.11).r;                         // detail frekuensi tinggi: memecah texture 256px yang blur/flat
          diffuseColor.rgb *= (0.84 + 0.32 * dt) * (1.0 - u_grime * 0.62 * smoothstep(0.32, 0.82, n) - u_grime * 0.14 * n);
          if (u_streak > 0.0 && !horiz) {                                         // rembesan air: noda vertikal memanjang dari plafon
            float sk = texture2D(tStain, vec2(g.x * 0.9, g.y * 0.07) + 0.5).r;
            float st = smoothstep(0.52, 0.86, sk) * smoothstep(0.35, 3.2, hh) * u_streak;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.48, 0.3), st * 0.7);
          }
          if (u_peel > 0.0 && !horiz) {                                           // wallpaper mengelupas: area plester gelap + tepi terangkat
            float pk = texture2D(tStain, vec2(g.x * 0.23, g.y * 0.11) + 0.21).r;
            float pe = smoothstep(0.78, 0.81, pk) * smoothstep(0.3, 1.6, hh);
            float rim = (smoothstep(0.755, 0.78, pk) - smoothstep(0.78, 0.805, pk)) * smoothstep(0.3, 1.6, hh);
            vec3 plaster = vec3(0.34, 0.31, 0.24) * (0.7 + 0.5 * dt);
            diffuseColor.rgb = mix(diffuseColor.rgb, plaster, pe * u_peel * 0.9);
            diffuseColor.rgb *= 1.0 + rim * 0.35 * u_peel;
          }
          if (u_damp > 0.0) {
            float low = (1.0 - smoothstep(0.0, 0.9, hh)) * u_damp * (0.6 + 0.4 * n);
            float top = smoothstep(2.4, 3.3, hh) * u_damp;
            diffuseColor.rgb *= 1.0 - 0.38 * low - 0.18 * top;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.92, 0.66), low * 0.62); // jamur/lembap kehijauan di bawah
          }
          if (u_wet > 0.0 && horiz && hh < 0.12) {                                // lantai: area lembap + genangan tipis acak (hanya di sini permukaan memantul)
            float wn = texture2D(tStain, g * 0.071 + 0.6).r * 0.7 + texture2D(tStain, g * 0.19 + 0.2).r * 0.3;
            float damp = smoothstep(0.50, 0.66, wn), pud = smoothstep(0.68, 0.74, wn);
            diffuseColor.rgb *= 1.0 - 0.28 * damp * u_wet - 0.32 * pud * u_wet;   // basah = lebih gelap
            gDamp = damp * u_wet; gWet = pud * u_wet;
          }
          if (u_rust > 0.0) {                                                     // karat ringan di logam
            float rn = texture2D(tStain, g * 0.31 + 0.13).r * 0.6 + texture2D(tStain, g * 0.9).r * 0.4;
            gRust = smoothstep(0.58, 0.8, rn) * u_rust;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.2, 0.09) * (0.6 + 0.8 * dt), gRust * 0.75);
          }
          if (u_scratch > 0.0) {                                                  // goresan tipis memanjang
            float sc = texture2D(tStain, vec2(vWp.x * 3.1 + vWp.z * 2.3, vWp.y * 0.18)).r;
            gScr = smoothstep(0.80, 0.84, sc) * u_scratch;
            diffuseColor.rgb *= 1.0 + gScr * 0.45;
          }
        }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, gDamp * 0.55);
        roughnessFactor = mix(roughnessFactor, 0.07, gWet);                      // genangan: hampir cermin (hanya area basah)
        roughnessFactor = mix(roughnessFactor, 0.88, gRust);                     // karat: kusam
        roughnessFactor = mix(roughnessFactor, 0.25, gScr * 0.5);`);
    };
    m.customProgramCacheKey = () => 'dirt2';
  }

  dispose() { for (const t of this.tex) t.dispose(); this.tex = []; }
}
