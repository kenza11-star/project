// Post-processing ringan (1 fullscreen pass, tanpa dependency): tone mapping + color grading + kontras + vignette + chromatic tepi + film grain/dither.
// Scene dirender ke RenderTarget (HalfFloat bila ada: gelap tanpa banding), lalu satu pass layar penuh melakukan tone mapping & output sRGB.
import * as THREE from 'three';
import * as CFG from './config';

const VERT = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Catatan: ShaderMaterial (non-raw) sudah mendapat tonemapping_pars & colorspace_pars dari three, jadi hanya memanggil *_fragment.
const FRAG = `
uniform sampler2D tScene; uniform float uTime; uniform float uGrain; uniform float uVig; uniform float uCA; uniform float uContrast; uniform float uDesat;
varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 c = vUv - 0.5; float r2 = dot(c, c);
  vec2 off = c * r2 * uCA;                                   // chromatic aberration hanya di tepi (lensa tua)
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
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
      uniforms: { tScene: { value: this.rt.texture }, uTime: { value: 0 }, uGrain: { value: CFG.GRAIN_OPACITY * 0.5 }, uVig: { value: CFG.POST_VIGNETTE }, uCA: { value: CFG.POST_CA }, uContrast: { value: CFG.POST_CONTRAST }, uDesat: { value: CFG.POST_DESAT } },
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); // segitiga layar penuh
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.scene.add(this.mesh);
  }

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
