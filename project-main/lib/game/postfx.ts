// Post-processing ringan (1 fullscreen pass, tanpa dependency): tone mapping + color grading + kontras + vignette + chromatic tepi + film grain/dither.
// C3: pass yang SAMA juga menggambar glitch impact jumpscare (pecah RGB, robekan horizontal, blok merah/putih, scanline, noise, kilat kontras) lewat uniform uGl/uGl2.
// Semua uniform 0 = cabang glitch dilewati (tidak ada biaya tambahan di luar impact).
// Scene dirender ke RenderTarget (HalfFloat bila ada: gelap tanpa banding), lalu satu pass layar penuh melakukan tone mapping & output sRGB.
import * as THREE from 'three';
import * as CFG from './config';

const VERT = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Catatan: ShaderMaterial (non-raw) sudah mendapat tonemapping_pars & colorspace_pars dari three, jadi hanya memanggil *_fragment.
const FRAG = `
uniform sampler2D tScene; uniform float uTime; uniform float uGrain; uniform float uVig; uniform float uCA; uniform float uContrast; uniform float uDesat;
uniform vec4 uGl;    // x: pecah RGB, y: robekan horizontal, z: scanline, w: noise
uniform vec2 uGl2;   // x: kilat kontras tinggi, y: seed (berganti ~25 Hz)
varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 c = vUv - 0.5; float r2 = dot(c, c);
  vec2 off = c * r2 * uCA;                                   // chromatic aberration hanya di tepi (lensa tua)
  vec2 uv = vUv, sp = vec2(0.0); float blk = 0.0; vec3 blkCol = vec3(0.0);
  bool gl = (uGl.x + uGl.y + uGl.z + uGl.w + uGl2.x) > 0.001;
  if (gl) {                                                  // glitch impact (C3)
    float sd = uGl2.y;
    float b1 = floor(vUv.y * 36.0 + sd * 3.0);               // pita lebar bergeser (robekan VHS)
    float on1 = step(1.0 - uGl.y * 0.38, hash(vec2(b1, sd)));
    uv.x += (hash(vec2(b1 + 17.0, sd)) - 0.5) * 0.20 * uGl.y * on1;
    float b2 = floor(vUv.y * 150.0 + sd * 7.0);              // pita tipis bergeser jauh
    float on2 = step(1.0 - uGl.y * 0.12, hash(vec2(b2, sd + 5.0)));
    uv.x += (hash(vec2(b2 + 3.0, sd)) - 0.5) * 0.45 * uGl.y * on2;
    float bx = hash(vec2(b2, sd + 9.0)), bw = 0.06 + 0.28 * hash(vec2(b2, sd + 13.0));
    blk = on2 * step(bx, vUv.x) * step(vUv.x, bx + bw);      // potongan blok rusak merah / putih
    blkCol = hash(vec2(b2, sd + 21.0)) > 0.62 ? vec3(1.0, 0.9, 0.88) : vec3(0.85, 0.0, 0.03);
    float b3 = floor(vUv.y * 44.0 + sd * 5.0);               // blok tebal (merah/putih) seperti referensi, jarang
    float on3 = step(1.0 - uGl.y * 0.14, hash(vec2(b3, sd + 31.0)));
    float cx = hash(vec2(b3, sd + 37.0)), cw = 0.10 + 0.30 * hash(vec2(b3, sd + 41.0));
    float blk3 = on3 * step(cx, vUv.x) * step(vUv.x, cx + cw);
    if (blk3 > 0.5) { blk = 1.0; blkCol = hash(vec2(b3, sd + 47.0)) > 0.55 ? vec3(0.9, 0.0, 0.03) : vec3(1.0, 0.95, 0.92); }
    sp = vec2(uGl.x * (0.012 + 0.010 * on1 + 0.016 * on2), 0.0);   // pemisahan RGB, lebih besar di pita robek
  }
  vec3 col = vec3(texture2D(tScene, uv + off + sp).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off - sp).b);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  col = gl_FragColor.rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l), uDesat);                           // sedikit pudar: tua & lembap
  col *= mix(vec3(0.86, 1.0, 0.82), vec3(1.05, 1.0, 0.86), smoothstep(0.015, 0.45, l)); // bayangan dingin-kehijauan, highlight kuning hangus
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);  // S-curve: gelap makin gelap, terang tetap
  float v = smoothstep(0.22, 0.78, length(c) * 1.25);
  col *= 1.0 - uVig * v * v;                                 // vignette (kuadratik, lembut)
  float g = hash(gl_FragCoord.xy + fract(uTime * 0.37) * vec2(311.0, 173.0)) - 0.5;
  col += g * uGrain * (1.0 - 0.55 * l);                      // grain film + dithering anti-banding
  if (gl) {
    col = mix(col, blkCol, blk * 0.88 * min(1.0, uGl.y * 1.2));
    col *= 1.0 - uGl.z * 0.32 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.4));          // scanline
    col += (hash(gl_FragCoord.xy * 0.83 + uGl2.y * 53.0) - 0.5) * uGl.w * 0.2;    // noise/static (halus: wajah tetap terbaca)
    col = mix(col, clamp((col - 0.5) * 2.3 + 0.55, 0.0, 1.0), uGl2.x);            // kilat kontras tinggi (singkat)
    col.r += uGl.x * 0.05;                                                        // dorongan merah tipis ala referensi
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}`;

export class PostFx {
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;
  private size = new THREE.Vector2();

  constructor(r: THREE.WebGLRenderer) {
    const ext = r.extensions;
    const half = r.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    r.getDrawingBufferSize(this.size);
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, this.size.x), Math.max(2, this.size.y), {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: half ? CFG.POST_MSAA : 0,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: this.rt.texture }, uTime: { value: 0 }, uGrain: { value: CFG.GRAIN_OPACITY * 0.5 }, uVig: { value: CFG.POST_VIGNETTE }, uCA: { value: CFG.POST_CA }, uContrast: { value: CFG.POST_CONTRAST }, uDesat: { value: CFG.POST_DESAT }, uGl: { value: new THREE.Vector4() }, uGl2: { value: new THREE.Vector2() } },
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); // segitiga layar penuh
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.scene.add(this.mesh);
  }

  /** Glitch impact jumpscare (C3): ch pecah RGB, tr robekan, sc scanline, ns noise, fl kilat kontras (semua 0..1), seed bilangan bulat. Semua 0 = mati. */
  setGlitch(ch: number, tr: number, sc: number, ns: number, fl: number, seed: number) {
    (this.mat.uniforms.uGl.value as THREE.Vector4).set(ch, tr, sc, ns); (this.mat.uniforms.uGl2.value as THREE.Vector2).set(fl, seed % 97);
  }
  clearGlitch() { this.setGlitch(0, 0, 0, 0, 0, 0); }
  /** panggil setelah setSize/setPixelRatio */
  resize(r: THREE.WebGLRenderer) {
    r.getDrawingBufferSize(this.size);
    const w = Math.max(2, this.size.x), h = Math.max(2, this.size.y);
    if (w !== this.rt.width || h !== this.rt.height) this.rt.setSize(w, h);
  }

  render(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, timeSec: number) {
    r.setRenderTarget(this.rt); r.render(scene, cam); r.setRenderTarget(null);
    this.mat.uniforms.uTime.value = timeSec; r.render(this.scene, this.cam);
  }

  dispose() { this.rt.dispose(); this.mat.dispose(); this.mesh.geometry.dispose(); }
}
