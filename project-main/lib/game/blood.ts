// Bercak darah: dekal statis (1 draw call per kelompok) dari atlas 4x2 yang digambar prosedural di canvas (tanpa aset, deterministik).
// Penempatan: blooddata.ts (gedung, dihasilkan & divalidasi terhadap mesh dinding oleh scripts/gen-blood.py) + prisonBlood() di bawah (penjara: jejak seret ke borgol).
import * as THREE from 'three';
import { PRISON_FLOOR_Y, PRISON_OFFSET, PRISON_SLOTS, PRISON_HALL } from './prisonroom';

/** [sel atlas, x, y, z, sisi, lebar, tinggi, rotasi]. sisi: 0 = lantai (normal +y), 1 = dinding menghadap +x, 2 = -x, 3 = +z, 4 = -z. Koordinat DUNIA. */
export type Decal = readonly [number, number, number, number, 0 | 1 | 2 | 3 | 4, number, number, number];
export const CELL = { SPLAT_A: 0, SPLAT_B: 1, POOL: 2, HAND: 3, SMEAR: 4, DRIPS: 5, SPRAY: 6, CLUSTER: 7 } as const;

// ---------------------------------------------------------------- atlas
const N = 256, COLS = 4, ROWS = 2, PAD = 6;
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
type G = CanvasRenderingContext2D;
type Rnd = () => number;
// Darah asli: tipis di tepi (merah transparan), tebal di tengah (hampir hitam), tepi tidak pernah bulat sempurna, ada cincin kering lebih gelap di bibir.
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const FILM: readonly [number, number, readonly [number, number, number]][] = [   // [skala, alfa, warna] dari lapisan tipis -> tebal
  [1.06, 0.12, [140, 16, 16]], [1.0, 0.72, [96, 9, 11]], [0.7, 0.34, [76, 7, 9]], [0.4, 0.32, [54, 4, 7]],
];

/** Jalur tertutup dengan tepi tak beraturan (jumlah gelombang sinus berbagai frekuensi), mulus lewat kurva kuadratik. */
function wobble(g: G, cx: number, cy: number, rad: number, r: Rnd, amp = 0.2, sx = 1, sy = 1, rot = 0, n = 40) {
  const ks = [2, 3, 4, 5, 7, 9], ph = ks.map(() => r() * 6.283), am = ks.map((k) => (amp / (k * 0.5)) * (0.5 + r()));
  const cr = Math.cos(rot), sr = Math.sin(rot), P: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 6.283; let f = 1; ks.forEach((k, j) => { f += am[j] * Math.sin(k * t + ph[j]); });
    const x = Math.cos(t) * rad * f * sx, y = Math.sin(t) * rad * f * sy; P.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  g.beginPath(); g.moveTo((P[n - 1][0] + P[0][0]) / 2, (P[n - 1][1] + P[0][1]) / 2);
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  g.closePath();
}
/** Selaput darah: lapisan film tipis -> tebal + cincin tepi gelap. */
function film(g: G, cx: number, cy: number, rad: number, r: Rnd, amp = 0.2, sx = 1, sy = 1, rot = 0, k = 1) {
  FILM.forEach(([s, a, c], i) => {
    wobble(g, cx + (i ? (r() - 0.5) * rad * 0.08 : 0), cy + (i ? (r() - 0.5) * rad * 0.08 : 0), rad * s, r, amp * (1 - i * 0.12), sx, sy, rot);
    g.fillStyle = rgba(c, a * k); g.fill();
  });
}
/** Tetesan bulat (jatuh tegak) atau lonjong ke arah `dir` (terlempar). */
function drop(g: G, x: number, y: number, rad: number, r: Rnd, dir: number | null = null, tail = 0.6) {
  film(g, x, y, rad, r, 0.1, dir === null ? 1 : 1 + tail, dir === null ? 1 : 1 - tail * 0.25, dir ?? 0);
}
/** Alur meruncing (cipratan melebar di pangkal, ujung berupa tetes). */
function ray(g: G, x: number, y: number, ang: number, len: number, w0: number, r: Rnd) {
  g.save(); g.translate(x, y); g.rotate(ang);
  for (const [k, a, c] of [[1, 0.8, [100, 10, 12]], [0.5, 0.5, [60, 5, 8]]] as const) {
    const w = w0 * k, j1 = 0.7 + r() * 0.6, j2 = 0.7 + r() * 0.6;
    g.beginPath(); g.moveTo(0, -w / 2); g.quadraticCurveTo(len * 0.5, -w * 0.28 * j1, len, -0.8); g.lineTo(len, 0.8); g.quadraticCurveTo(len * 0.5, w * 0.28 * j2, 0, w / 2); g.closePath();
    g.fillStyle = rgba(c, a); g.fill();
  }
  g.restore(); drop(g, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 2 + r() * 3.2, r, ang, 0.5);
}
/** Aliran menetes ke bawah: garis berkelok tipis-tebal dengan gelembung di ujung. */
function run(g: G, x: number, y0: number, y1: number, w: number, r: Rnd) {
  const pts: [number, number][] = []; let xx = x;
  for (let y = y0; y <= y1; y += 5) { xx += (r() - 0.5) * 0.9; pts.push([xx, y]); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [k, a, c] of [[1.3, 0.26, [150, 18, 18]], [1, 0.82, [98, 9, 12]], [0.42, 0.55, [46, 4, 7]]] as const) {
    g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.lineWidth = w * k; g.strokeStyle = rgba(c, a); g.stroke();
  }
  drop(g, pts[pts.length - 1][0], y1, w * 0.78, r);
}
/** Goresan kering: menghapus sebagian darah dengan garis tipis searah gerak (seperti kuas kering / telapak diseret). */
function dry(g: G, x0: number, y0: number, ang: number, len: number, count: number, spread: number, r: Rnd) {
  g.save(); g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round';
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  for (let i = 0; i < count; i++) {
    const o = (r() - 0.5) * spread, s = r() * len * 0.5, L = len * (0.3 + r() * 0.7);
    g.strokeStyle = `rgba(0,0,0,${0.15 + r() * 0.3})`; g.lineWidth = 0.5 + r() * 1.3;
    g.beginPath(); g.moveTo(x0 + nx * o + Math.cos(ang) * s, y0 + ny * o + Math.sin(ang) * s); g.lineTo(x0 + nx * o + Math.cos(ang) * (s + L), y0 + ny * o + Math.sin(ang) * (s + L)); g.stroke();
  }
  g.restore();
}

/** Gambar atlas ke canvas 2D (tanpa three) -> bisa dites di browser/Node-canvas. Alfa = bentuk; RGB = merah tua basah berlapis. */
export function drawBloodAtlas(g: G) {
  g.clearRect(0, 0, N * COLS, N * ROWS);
  const cell = (c: number, fn: (cx: number, cy: number, r: Rnd) => void) => {
    const cx = (c % COLS) * N + N / 2, cy = Math.floor(c / COLS) * N + N / 2;
    g.save(); g.beginPath(); g.rect(cx - N / 2 + PAD, cy - N / 2 + PAD, N - 2 * PAD, N - 2 * PAD); g.clip(); if ('filter' in g) (g as any).filter = 'blur(0.7px)'; fn(cx, cy, rng(1000 + c * 77)); g.restore();
  };
  const splat = (cx: number, cy: number, r: Rnd, spikes: number, core: number, reach: number) => {
    film(g, cx, cy, core, r, 0.28);
    for (let i = 0; i < spikes; i++) { const a = r() * 6.283, L = reach * (0.25 + r() * 0.55); ray(g, cx + Math.cos(a) * core * 0.5, cy + Math.sin(a) * core * 0.5, a, L, 4 + r() * 10, r); }
    for (let i = 0; i < 30; i++) {
      const a = r() * 6.283, d = core * 1.1 + Math.pow(r(), 1.5) * reach * 1.15, s = Math.max(1.1, (4.2 - (d / (reach + core)) * 3.2) * (0.6 + r() * 0.9));
      drop(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, r, a, 0.7);
    }
  };
  cell(CELL.SPLAT_A, (cx, cy, r) => splat(cx, cy, r, 11, 26, 70));
  cell(CELL.SPLAT_B, (cx, cy, r) => { film(g, cx - 12, cy + 8, 20, r, 0.3); film(g, cx + 16, cy - 8, 16, r, 0.3); splat(cx, cy, r, 8, 18, 78); });
  cell(CELL.POOL, (cx, cy, r) => {   // genangan: lobus tak beraturan + riak tepi + tetes kecil di sekitarnya
    film(g, cx, cy, 66, r, 0.3, 1, 0.82, r() * 3);
    for (let i = 0; i < 4; i++) { const a = r() * 6.283; film(g, cx + Math.cos(a) * 56, cy + Math.sin(a) * 46, 18 + r() * 16, r, 0.3, 1, 1, 0, 0.45); }
    for (let i = 0; i < 14; i++) { const a = r() * 6.283, d = 88 + r() * 26; drop(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, 1.2 + r() * 3.2, r, a, 0.5); }
  });
  cell(CELL.HAND, (cx, cy, r) => {   // telapak basah menempel lalu turun: telapak, 4 jari, jempol; guratan kulit = goresan kering; rembesan di bawah
    film(g, cx, cy + 22, 36, r, 0.07, 1.08, 0.98, 0, 0.9);
    for (const [ang, len, w, ox, oy] of [[-0.22, 50, 19, -26, -22], [-0.06, 60, 19, -9, -30], [0.08, 58, 19, 9, -30], [0.24, 46, 17, 26, -22]] as const)
      film(g, cx + ox + Math.sin(-ang) * len * 0.5, cy + 22 + oy - Math.cos(ang) * len * 0.5, w * 0.5, r, 0.05, 1, len / w, ang, 0.9);
    film(g, cx - 40, cy + 14, 13, r, 0.06, 2.0, 1, -0.7, 0.9);
    dry(g, cx, cy - 50, Math.PI / 2, 110, 14, 70, r);
    for (let i = 0; i < 5; i++) run(g, cx - 28 + i * 14 + r() * 5, cy + 50, cy + 66 + r() * 34, 3.4 + r() * 2.6, r);
  });
  cell(CELL.SMEAR, (cx, cy, r) => {   // jejak seret: tebal di awal, menipis, berserabut, lalu putus-putus
    for (let i = 0; i <= 30; i++) { const t = i / 30, w = 30 * (1 - t * 0.72) * (0.8 + r() * 0.4); film(g, cx - 104 + t * 218, cy + Math.sin(t * 5) * 6, w, r, 0.16, 1.5, 0.95, 0, 0.55); }
    dry(g, cx - 108, cy, 0, 230, 16, 46, r);
    for (let i = 0; i < 7; i++) drop(g, cx + 70 + r() * 44, cy + (r() - 0.5) * 34, 1.5 + r() * 3.2, r, 0, 0.9);
  });
  cell(CELL.DRIPS, (cx, cy, r) => {   // rembesan dari atas: genangan tipis di bibir + aliran berbeda panjang
    film(g, cx, cy - 108, 70, r, 0.12, 1.4, 0.2, 0, 0.8);
    for (let i = 0; i < 8; i++) run(g, cx - 88 + i * 25 + r() * 9, cy - 108, cy - 106 + 36 + r() * 150, 3.8 + r() * 5.2, r);
  });
  cell(CELL.SPRAY, (cx, cy, r) => { for (let i = 0; i < 80; i++) { const a = (r() - 0.5) * 2.2, d = 8 + r() * 112 * (0.35 + r() * 0.7), s = 0.9 + r() * (0.8 + (1 - d / 120) * 5.5); drop(g, cx - 90 + Math.cos(a) * d + d * 0.2, cy + Math.sin(a) * d, s, r, a, 0.75); } });
  cell(CELL.CLUSTER, (cx, cy, r) => {
    for (const [dx, dy, rr] of [[-46, -20, 30], [30, 26, 26], [34, -44, 18]] as const) splat(cx + dx, cy + dy, r, 6, rr * 0.5, rr * 1.2);
  });
}

/** Atlas data (untuk bumpMap & roughnessMap): R = tinggi (tebal di tengah, landai di tepi -> bibir meniskus), G = kekasaran (tebal licin, tipis kusam). */
export function drawBloodData(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const w = src.width, h = src.height, tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const gt = tmp.getContext('2d', { willReadFrequently: true }); if (!gt) return null;
  const blurred = (px: number) => { gt.clearRect(0, 0, w, h); if ('filter' in gt) (gt as any).filter = `blur(${px}px)`; gt.drawImage(src, 0, 0); (gt as any).filter = 'none'; return gt.getImageData(0, 0, w, h).data; };
  const a1 = blurred(1.6), a2 = blurred(8);
  const out = document.createElement('canvas'); out.width = w; out.height = h; const go = out.getContext('2d'); if (!go) return null;
  const im = go.createImageData(w, h), d = im.data;
  for (let i = 0; i < w * h; i++) {
    const A = a1[i * 4 + 3] / 255, B = a2[i * 4 + 3] / 255;
    d[i * 4] = 255 * A * (0.5 + 0.5 * B); d[i * 4 + 1] = 255 * (0.8 - 0.55 * B * A); d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
  }
  go.putImageData(im, 0, 0); return out;
}

// ---------------------------------------------------------------- tekstur bersama (hitung acuan)
let TEX: THREE.CanvasTexture | null = null, DATA: THREE.CanvasTexture | null = null, REFS = 0;
function mkTex(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
export function acquireBloodTex(): { map: THREE.CanvasTexture; data: THREE.CanvasTexture | null } | null {
  if (typeof document === 'undefined') return null;
  if (!TEX) {
    const c = document.createElement('canvas'); c.width = N * COLS; c.height = N * ROWS; const g = c.getContext('2d'); if (!g) return null;
    drawBloodAtlas(g); TEX = mkTex(c, true);
    const dc = drawBloodData(c); DATA = dc ? mkTex(dc, false) : null;
  }
  REFS++; return { map: TEX, data: DATA };
}
export function releaseBloodTex() { if (REFS > 0 && --REFS === 0) { TEX?.dispose(); DATA?.dispose(); TEX = null; DATA = null; } }

// ---------------------------------------------------------------- mesh dekal
const NRM: Record<number, [number, number, number]> = { 0: [0, 1, 0], 1: [1, 0, 0], 2: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] };
/** Satu mesh dari semua dekal (posisi dikurangi `off`). Dipanggil ulang oleh pemilik; geometri & material dilepas lewat disposeBlood(). */
export function buildBloodMesh(decals: readonly Decal[], off: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): THREE.Mesh | null {
  const tx = acquireBloodTex(); if (!tx || !decals.length) { if (tx) releaseBloodTex(); return null; }
  const P = new Float32Array(decals.length * 12), No = new Float32Array(decals.length * 12), U = new Float32Array(decals.length * 8), I = new Uint16Array(decals.length * 6);
  decals.forEach((d, i) => {
    const [cell, x, y, z, face, w, h, rot] = d, n = NRM[face], cr = Math.cos(rot), sr = Math.sin(rot);
    let ux: number, uy: number, uz: number, vx: number, vy: number, vz: number;
    if (face === 0) { ux = cr; uy = 0; uz = sr; vx = -sr; vy = 0; vz = cr; }
    else { const hx = n[2], hz = -n[0]; ux = hx * cr; uy = sr; uz = hz * cr; vx = -hx * sr; vy = cr; vz = -hz * sr; }
    const px = x + n[0] * 0.012 - off.x, py = y + n[1] * 0.012 - off.y, pz = z + n[2] * 0.012 - off.z;
    const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let q = 0; q < 4; q++) {
      const a = k[q][0] * w / 2, b = k[q][1] * h / 2;
      P.set([px + ux * a + vx * b, py + uy * a + vy * b, pz + uz * a + vz * b], (i * 4 + q) * 3); No.set(n, (i * 4 + q) * 3);
    }
    const c0 = (cell % COLS) / COLS, r0 = 1 - (Math.floor(cell / COLS) + 1) / ROWS, du = (N - 2 * PAD) / (N * COLS), dv = (N - 2 * PAD) / (N * ROWS);
    const u0 = c0 + PAD / (N * COLS), v0 = r0 + PAD / (N * ROWS);
    U.set([u0, v0, u0 + du, v0, u0 + du, v0 + dv, u0, v0 + dv], i * 8);
    // arah putar sisi depan = searah normal
    const ex = P[(i * 4 + 1) * 3] - P[i * 12], ey = P[(i * 4 + 1) * 3 + 1] - P[i * 12 + 1], ez = P[(i * 4 + 1) * 3 + 2] - P[i * 12 + 2];
    const fx = P[(i * 4 + 2) * 3] - P[i * 12], fy = P[(i * 4 + 2) * 3 + 1] - P[i * 12 + 1], fz = P[(i * 4 + 2) * 3 + 2] - P[i * 12 + 2];
    const dot = (ey * fz - ez * fy) * n[0] + (ez * fx - ex * fz) * n[1] + (ex * fy - ey * fx) * n[2], b = i * 4;
    I.set(dot >= 0 ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2], i * 6);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(No, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(new THREE.BufferAttribute(I, 1));
  const m = new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.data, bumpScale: 1.6, roughnessMap: tx.data, roughness: 1, envMapIntensity: 0.5, transparent: true, depthWrite: false, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'Blood'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  return mesh;
}
export function disposeBlood(m: THREE.Mesh | null) { if (!m) return; m.geometry.dispose(); (m.material as THREE.Material).dispose(); releaseBloodTex(); }

// ---------------------------------------------------------------- penjara (koordinat dunia)
const OX = PRISON_OFFSET.x, OZ = PRISON_OFFSET.z, FY = PRISON_FLOOR_Y + 0.004;
const W = (x: number, z: number) => [x + OX, z + OZ] as const;
/**
 * Jejak seret dari pintu jeruji penghubung -> koridor -> antechamber -> pintu sel -> titik ikat, genangan di bawah tiap kait, cipratan & telapak tangan di dinding.
 * Mengembalikan { hall } (koordinat dunia, di luar volume sel: dipasang di grup props yang selalu ada) dan { cell } (di dalam sel/antechamber: ikut grup penjara).
 */
export function prisonBlood(): { hall: Decal[]; cell: Decal[] } {
  const hall: Decal[] = [], cell: Decal[] = [], hy = PRISON_FLOOR_Y + 0.004;
  const hx0 = PRISON_HALL.minx + 0.1, hx1 = PRISON_HALL.maxx, hz = (PRISON_HALL.minz + PRISON_HALL.maxz) / 2;
  // koridor: seretan menerus (6 segmen) + cipratan di lantai
  for (let i = 0; i < 6; i++) hall.push([CELL.SMEAR, hx0 + 0.9 + i * 1.05, hy, hz + (i % 2 ? 0.12 : -0.1), 0, 1.5, 0.52, (i % 3 - 1) * 0.06]);
  hall.push([CELL.SPRAY, hx0 + 2.4, hy, hz - 0.35, 0, 1.4, 1.0, 0.4], [CELL.SPLAT_B, hx0 + 5.1, hy, hz + 0.3, 0, 0.9, 0.9, 1.9]);
  // koridor: dinding utara (muka +z di z=30,4) & selatan (muka -z di z=31,9)
  hall.push([CELL.HAND, hx0 + 3.1, 1.15 + PRISON_FLOOR_Y, PRISON_HALL.minz, 3, 0.55, 0.55, 0.15], [CELL.DRIPS, hx0 + 4.6, 1.55 + PRISON_FLOOR_Y, PRISON_HALL.minz, 3, 0.7, 1.4, 0],
    [CELL.SPLAT_A, hx0 + 1.8, 1.05 + PRISON_FLOOR_Y, PRISON_HALL.maxz, 4, 0.9, 0.9, 0.5], [CELL.HAND, hx0 + 5.4, 1.0 + PRISON_FLOOR_Y, PRISON_HALL.maxz, 4, 0.5, 0.5, -0.2]);
  // antechamber (dunia): seretan dari mulut koridor (x 45,5) ke pintu sel (48,3 ; 31,6)
  const [ax, az] = W(1.85, -2.7), [mx, mz] = W(-1.0, -1.35), [dx, dz] = W(1.8, -0.9);
  for (let i = 0; i < 4; i++) { const t = i / 3; cell.push([CELL.SMEAR, mx + (dx - mx) * t + 0.3, FY, mz + (dz - mz) * t, 0, 1.5, 0.55, Math.atan2(dz - mz, dx - mx) * 0.9]); }
  cell.push([CELL.POOL, ax, FY, az + 0.5, 0, 1.4, 1.4, 0.7], [CELL.SPRAY, ax - 1.0, FY, az - 0.6, 0, 1.5, 1.1, 2.6]);
  const [aex] = W(4.7, 0), [anx, anz] = W(0, -4.7), [awx] = W(-1.0, 0);
  cell.push([CELL.SPLAT_A, aex, 1.25 + PRISON_FLOOR_Y, W(0, -3.0)[1], 2, 1.1, 1.1, 0.3], [CELL.HAND, anx + 3.6, 1.2 + PRISON_FLOOR_Y, anz, 3, 0.55, 0.55, 0.1], [CELL.DRIPS, anx - 1.6, 1.7 + PRISON_FLOOR_Y, anz, 3, 0.8, 1.5, 0], [CELL.SMEAR, awx, 0.75 + PRISON_FLOOR_Y, W(0, -3.4)[1], 1, 1.2, 0.5, 1.57]);
  // sel: pintu (x 1,8) -> tiap titik ikat; genangan di bawah kait
  const [cx, cz] = W(1.8, 0.6);
  PRISON_SLOTS.forEach((s, i) => {
    const sx = s.x, sz = s.z, d = Math.hypot(sx - cx, sz - cz), ang = Math.atan2(sz - cz, sx - cx), rr = (i * 2.399) % (Math.PI * 2);
    cell.push([CELL.POOL, sx, FY, sz, 0, 1.7 + 0.25 * (i % 3), 1.7 + 0.25 * (i % 3), rr], [CELL.SPRAY, sx + Math.cos(rr) * 0.7, FY, sz + Math.sin(rr) * 0.7, 0, 1.3, 0.9, rr + 2.4]);
    if (i % 2 === 0 || i === 3) for (let k = 0; k < Math.floor(d / 1.5); k++) { const t = (k + 0.6) / Math.max(1, d / 1.5); cell.push([CELL.SMEAR, cx + Math.cos(ang) * d * t, FY, cz + Math.sin(ang) * d * t, 0, 1.5, 0.5, ang]); }
  });
  // dinding sel (muka dalam): timur x=9,89 (-x), selatan z=13,92 (-z), barat x=-3,8 (+x), utara z=-0,08 (+z; di kiri/kanan pintu)
  const fy = PRISON_FLOOR_Y;
  const [exw] = W(9.89, 0), [, szw] = W(0, 13.92), [wxw] = W(-3.8, 0), [, nzw] = W(0, -0.08);
  cell.push(
    [CELL.HAND, exw, fy + 1.3, W(0, 3.2)[1], 2, 0.6, 0.6, 0.1], [CELL.HAND, exw, fy + 1.1, W(0, 3.7)[1], 2, 0.55, 0.55, -0.25], [CELL.DRIPS, exw, fy + 1.6, W(0, 6.4)[1], 2, 0.9, 1.9, 0], [CELL.SPLAT_B, exw, fy + 1.4, W(0, 9.6)[1], 2, 1.3, 1.3, 0.8], [CELL.CLUSTER, exw, fy + 0.9, W(0, 12.0)[1], 2, 1.1, 1.1, 0],
    [CELL.SPLAT_A, W(0.0, 0)[0], fy + 1.5, szw, 4, 1.3, 1.3, 0.2], [CELL.DRIPS, W(4.0, 0)[0], fy + 1.7, szw, 4, 0.9, 1.9, 0], [CELL.HAND, W(7.2, 0)[0], fy + 1.2, szw, 4, 0.6, 0.6, 0.2], [CELL.SMEAR, W(-2.2, 0)[0], fy + 0.55, szw, 4, 1.4, 0.55, 0],
    [CELL.SPLAT_B, wxw, fy + 1.3, W(0, 4.2)[1], 1, 1.2, 1.2, 0.4], [CELL.HAND, wxw, fy + 1.0, W(0, 7.5)[1], 1, 0.55, 0.55, 0.3], [CELL.DRIPS, wxw, fy + 1.7, W(0, 10.6)[1], 1, 0.9, 1.8, 0],
    [CELL.SPLAT_A, W(-2.6, 0)[0], fy + 1.4, nzw, 3, 1.2, 1.2, 0.5], [CELL.HAND, W(5.4, 0)[0], fy + 1.2, nzw, 3, 0.55, 0.55, -0.1], [CELL.CLUSTER, W(7.8, 0)[0], fy + 0.8, nzw, 3, 1.0, 1.0, 0],
  );
  return { hall, cell };
}
