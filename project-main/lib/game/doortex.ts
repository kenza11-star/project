// Detail pintu kayu (murni, tanpa three.js: dites di scripts/test-doortex.js). Satu texture kecil (256x256 RGBA) DIBAGI semua pintu:
//   R = serat kayu terarah (rapat melintang lebar pintu, memanjang searah tinggi), G = goresan/gesekan tipis, B = noda/bercak skala besar.
// Semua tile mulus (lattice noise periodik, goresan membungkus). Arah: x texture = lebar pintu (U), y texture = tinggi pintu (V).
export const DOOR_TEX_SIZE = 256;

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** Value-noise periodik anisotropik: cx x cy sel; hasil 0..1. */
function pnoise(rnd: () => number, size: number, cx: number, cy: number): Float32Array {
  const lat = new Float32Array(cx * cy); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cx, fy = (y / size) * cy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), xa = x0 % cx, xb = (x0 + 1) % cx, ya = y0 % cy, yb = (y0 + 1) % cy;
    const a = lat[ya * cx + xa], b = lat[ya * cx + xb], c = lat[yb * cx + xa], e = lat[yb * cx + xb];
    out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy;
  }
  return out;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function makeDoorDetail(size = DOOR_TEX_SIZE, seed = 0xd00f): Uint8Array {
  const rnd = lcg(seed), n = size * size, d = new Uint8Array(n * 4);
  // R: serat. Sel sangat rapat di arah lebar (x) dan jarang di arah tinggi (y) => garis memanjang vertikal; cincin tahun memodulasi.
  const g1 = pnoise(rnd, size, 24, 2), g2 = pnoise(rnd, size, 48, 3), g3 = pnoise(rnd, size, 96, 5), pores = pnoise(rnd, size, 128, 64), warp = pnoise(rnd, size, 3, 2);
  // B: bercak/noda skala besar (isotropik)
  const b1 = pnoise(rnd, size, 3, 3), b2 = pnoise(rnd, size, 6, 6), b3 = pnoise(rnd, size, 12, 12);
  // G: goresan
  const sc = new Float32Array(n);
  const put = (x: number, y: number, v: number) => { const xi = ((Math.round(x) % size) + size) % size, yi = ((Math.round(y) % size) + size) % size; const k = yi * size + xi; sc[k] = Math.min(1, sc[k] + v); };
  for (let i = 0; i < 80; i++) {
    const vertical = rnd() < 0.72, len = vertical ? size * (0.1 + rnd() * 0.38) : size * (0.05 + rnd() * 0.18), ang = (rnd() - 0.5) * (vertical ? 0.42 : 0.3);
    const dx = vertical ? Math.sin(ang) : Math.cos(ang), dy = vertical ? Math.cos(ang) : Math.sin(ang), inten = 0.45 + rnd() * 0.55;
    let x = rnd() * size, y = rnd() * size;
    for (let s = 0; s < len; s += 0.5) { const f = Math.sin((s / len) * Math.PI); put(x, y, inten * f * 0.7); put(x + 1, y, inten * f * 0.25); x += dx * 0.5; y += dy * 0.5; }
  }
  // bercak dinormalkan (rata-rata 0,5, sebaran 0,2): lattice kasar (3x3) bisa condong ke gelap/terang tergantung seed
  const braw = new Float32Array(n); let bm = 0; for (let i = 0; i < n; i++) { braw[i] = b1[i] * 0.5 + b2[i] * 0.33 + b3[i] * 0.17; bm += braw[i]; } bm /= n;
  let bs = 0; for (let i = 0; i < n; i++) bs += (braw[i] - bm) * (braw[i] - bm); bs = Math.sqrt(bs / n) || 1;
  for (let i = 0; i < n; i++) {
    const x = i % size;
    const base = g1[i] * 0.5 + g2[i] * 0.3 + g3[i] * 0.2;
    const ring = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 14 + warp[i] * 7);
    const grain = clamp01((base * 0.55 + ring * 0.3 + pores[i] * 0.15 - 0.5) * 1.9 + 0.5);
    const blot = clamp01(0.5 + ((braw[i] - bm) / bs) * 0.2);
    d[i * 4] = Math.round(grain * 255); d[i * 4 + 1] = Math.round(sc[i] * 255); d[i * 4 + 2] = Math.round(blot * 255); d[i * 4 + 3] = 255;
  }
  return d;
}

// ---- GLSL (dipasang lewat onBeforeCompile pada material door_wood). Koordinat = OBJEK (bukan dunia): pola ikut daun saat pintu berayun. ----
export const DOOR_GLSL = {
  vertDecl: 'varying vec3 vLp; varying vec3 vLn; varying vec3 vOrg; varying float vW; attribute float aDoorW;',
  vertMain: 'vLp = transformed; vLn = abs(normalize(objectNormal)); vOrg = modelMatrix[3].xyz; vW = aDoorW > 0.5 ? aDoorW : 1.14;',
  fragDecl: `varying vec3 vLp; varying vec3 vLn; varying vec3 vOrg; varying float vW;
    uniform sampler2D tDoor; uniform float u_dbump;
    vec3 doorPerturb(vec3 sp, vec3 sn, vec2 dh, float fd) {
      vec3 sx = normalize(dFdx(sp)); vec3 sy = normalize(dFdy(sp));
      vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
      float det = dot(sx, r1) * fd;
      vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
      return normalize(abs(det) * sn - g);
    }`,
  color: `
    float gW = 0.0, gS = 0.0, gH = 0.0, gGr = 0.0, gR = 0.5;
    {
      float W = vW;
      float h1 = fract(sin(dot(vOrg.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float h2 = fract(sin(dot(vOrg.xz, vec2(39.3468, 11.1357))) * 24634.6345);
      bool face = vLn.x > 0.7; bool eY = vLn.y > 0.7;
      float side = face ? step(0.0, vLp.x) : 0.0;
      vec2 pc = face ? vec2(vLp.z, vLp.y) : (eY ? vec2(vLp.z, vLp.x * 6.0) : vec2(vLp.x * 6.0, vLp.y));
      float mx = h1 > 0.5 ? -1.0 : 1.0;
      vec2 q = vec2(pc.x * mx + h1 * 7.0 + side * 3.1, pc.y + h2 * 5.0 + side * 1.7);
      vec4 t1 = texture2D(tDoor, vec2(q.x * 0.85, q.y * 0.42));
      vec4 t2 = texture2D(tDoor, vec2(q.x * 2.3 + 0.3, q.y * 0.95 + 0.17));
      vec4 t3 = texture2D(tDoor, vec2(q.x * 1.3 + 0.5, q.y * 0.7 + 0.5));
      float drp = texture2D(tDoor, vec2(q.x * 4.5 + 0.4, q.y * 0.1 + 0.6)).r;
      float grain = t1.r * 0.6 + t2.r * 0.4; gR = grain;
      float dEnd = max(W - vLp.z, 0.0), dHg = vLp.z * 1.6, dTop = max(2.12 - vLp.y, 0.0), dBot = max(vLp.y - 0.02, 0.0) * 1.2;
      float dEdge = min(min(dEnd, dHg), min(dTop, dBot));
      float edgeW = (1.0 - smoothstep(0.0, 0.10, dEdge)) * (0.45 + 0.95 * t2.b);          // tepi sering tersentuh: aus
      float hz = 1.0 - smoothstep(0.0, 0.3, length(vec2(vLp.z - (W - 0.1), (vLp.y - 1.0) * 0.8))); // sekitar gagang
      float kick = 1.0 - smoothstep(0.1, 0.6, vLp.y);                                       // bagian bawah: tendangan & kotoran
      float drip = smoothstep(0.55, 0.9, drp) * (1.0 - smoothstep(0.5, 1.9, dTop));         // rembesan dari atas
      gS = smoothstep(0.35, 0.8, t3.g);
      gW = clamp(edgeW + hz * (0.55 + 0.5 * t2.r) + kick * 0.4 * (0.3 + t2.b) + smoothstep(0.74, 0.95, t1.b) * 0.45, 0.0, 1.0);
      gGr = clamp(kick * (0.45 + 0.7 * t1.b) + edgeW * 0.5 + hz * (0.35 + 0.45 * t2.b) + drip * 0.35, 0.0, 1.0);
      vec3 base = diffuseColor.rgb;
      base *= 0.74 + 0.5 * grain;                                                           // serat terarah
      base = mix(base, base * vec3(0.84, 0.8, 0.74), t1.b * 0.6);                           // bercak kusam
      vec3 raw = base * vec3(1.25, 1.12, 0.92) + 0.03;                                      // kayu terbuka (lapisan pelindung aus)
      base = mix(base, raw, gW * 0.45);
      base = mix(base, raw * 1.05, gS * 0.5);                                               // goresan
      base *= 1.0 - 0.5 * gGr;                                                              // kotoran pekat
      diffuseColor.rgb = base;
      gH = (grain - 0.5) * 0.9 - gS * 0.9 + (t2.r - 0.5) * gW * 0.6 - gGr * 0.15;
    }`,
  rough: 'roughnessFactor = clamp(mix(0.5 + 0.14 * gR, 0.94, clamp(gW * 0.85 + gGr * 0.45, 0.0, 1.0)) + gS * 0.12, 0.5, 0.95);',
  normal: 'normal = doorPerturb(-vViewPosition, normal, vec2(dFdx(gH), dFdy(gH)) * u_dbump, faceDirection);',
};
