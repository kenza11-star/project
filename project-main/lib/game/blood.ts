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

/** Gambar atlas ke canvas 2D (tanpa three) -> bisa dites di browser/Node-canvas. Merah tua basah, tepi lembut, alfa = bentuk. */
export function drawBloodAtlas(g: CanvasRenderingContext2D) {
  g.clearRect(0, 0, N * COLS, N * ROWS);
  const col = (a: number, k = 0) => `rgba(${Math.round(112 + 34 * k)},${Math.round(5 + 8 * k)},${Math.round(8 + 6 * k)},${a})`;
  const blob = (x: number, y: number, r: number, a = 0.96) => {   // lingkaran dengan tepi lembut
    const gr = g.createRadialGradient(x, y, r * 0.55, x, y, r); gr.addColorStop(0, col(a, 0.1)); gr.addColorStop(1, col(0, 0.6));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  const streak = (x: number, y: number, ang: number, len: number, w: number, a = 0.95) => {   // elips memanjang (cipratan/seretan)
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col(a, 0.2); g.beginPath(); g.ellipse(len / 2, 0, len / 2, w / 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const cell = (c: number, fn: (cx: number, cy: number, r: () => number) => void) => {
    const cx = (c % COLS) * N + N / 2, cy = Math.floor(c / COLS) * N + N / 2;
    g.save(); g.beginPath(); g.rect(cx - N / 2 + PAD, cy - N / 2 + PAD, N - 2 * PAD, N - 2 * PAD); g.clip(); fn(cx, cy, rng(1000 + c * 77)); g.restore();
  };
  const splat = (cx: number, cy: number, r: () => number, spikes: number, core: number, reach: number) => {
    blob(cx, cy, core, 0.97);
    for (let i = 0; i < spikes; i++) {
      const a = r() * Math.PI * 2, L = reach * (0.35 + r() * 0.65), w = 5 + r() * 12;
      streak(cx + Math.cos(a) * core * 0.4, cy + Math.sin(a) * core * 0.4, a, L, w, 0.93);
      blob(cx + Math.cos(a) * (core * 0.4 + L), cy + Math.sin(a) * (core * 0.4 + L), 3 + r() * 6, 0.95);   // tetesan di ujung
    }
    for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2, d = core + r() * reach * 0.95; blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5 + r() * 4.5, 0.9); }
  };
  cell(CELL.SPLAT_A, (cx, cy, r) => splat(cx, cy, r, 13, 34, 72));
  cell(CELL.SPLAT_B, (cx, cy, r) => { blob(cx - 10, cy + 6, 26); blob(cx + 14, cy - 8, 22); splat(cx, cy, r, 9, 24, 80); });
  cell(CELL.POOL, (cx, cy, r) => {   // genangan tak beraturan + kilap tipis
    for (let i = 0; i < 12; i++) { const a = r() * Math.PI * 2, d = r() * 42; blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 30 + r() * 30, 0.96); }
    for (let i = 0; i < 5; i++) { const a = r() * Math.PI * 2; streak(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40, a, 40 + r() * 40, 7 + r() * 8, 0.95); }
    for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = 78 + r() * 30; blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + r() * 4, 0.9); }
  });
  cell(CELL.HAND, (cx, cy, r) => {   // telapak tangan basah menempel & menyeret ke bawah: telapak lebar, 4 jari rapat, jempol, rembesan
    g.save(); g.translate(cx, cy + 22); if ('filter' in g) (g as any).filter = 'blur(1.1px)';
    g.fillStyle = col(0.95, 0.12); g.beginPath(); g.ellipse(0, 0, 40, 36, 0, 0, Math.PI * 2); g.fill();
    for (const [ang, len, w, ox, oy] of [[-0.22, 50, 19, -26, -22], [-0.06, 60, 19, -9, -30], [0.08, 58, 19, 9, -30], [0.24, 46, 17, 26, -22]] as const) {
      g.save(); g.translate(ox, oy); g.rotate(ang - Math.PI / 2); g.beginPath(); g.ellipse(len / 2, 0, len / 2, w / 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.save(); g.translate(-32, 6); g.rotate(-2.45); g.beginPath(); g.ellipse(24, 0, 28, 14, 0, 0, Math.PI * 2); g.fill(); g.restore();
    for (let i = 0; i < 5; i++) { const x = -30 + i * 15 + r() * 5; g.fillStyle = col(0.9, 0.2); g.beginPath(); g.ellipse(x, 44 + r() * 14, 4 + r() * 3, 24 + r() * 26, 0, 0, Math.PI * 2); g.fill(); }   // rembesan ke bawah
    g.restore();
  });
  cell(CELL.SMEAR, (cx, cy, r) => {   // jejak seret: menebal di awal, menipis ke ujung, dengan goresan kering
    for (let i = 0; i <= 40; i++) { const t = i / 40, x = cx - 104 + t * 222, w = 62 * (1 - t * 0.7) * (0.8 + r() * 0.35); blob(x, cy + Math.sin(t * 5) * 6, w / 2, 0.9); }
    for (let i = 0; i < 9; i++) { const y = cy + (r() - 0.5) * 36, x0 = cx - 100 + r() * 60; streak(x0, y, (r() - 0.5) * 0.06, 90 + r() * 110, 2 + r() * 3.5, 0.9); }
  });
  cell(CELL.DRIPS, (cx, cy, r) => {   // rembesan vertikal dari atas
    for (let i = 0; i < 9; i++) blob(cx - 92 + i * 23 + r() * 8, cy - 108 + r() * 8, 20 + r() * 12, 0.95); blob(cx, cy - 104, 58, 0.9);
    for (let i = 0; i < 9; i++) {
      const x = cx - 92 + i * 23 + r() * 10, L = 50 + r() * 160, w = 6 + r() * 7;
      g.fillStyle = col(0.95, 0.15); g.beginPath(); g.ellipse(x, cy - 106 + L / 2, w / 2, L / 2, 0, 0, Math.PI * 2); g.fill(); blob(x, cy - 106 + L, w * 0.8, 0.96);
    }
  });
  cell(CELL.SPRAY, (cx, cy, r) => { for (let i = 0; i < 90; i++) { const a = (r() - 0.5) * 2.4, d = 10 + r() * 105 * (0.4 + r()); blob(cx - 90 + Math.cos(a) * d + d * 0.2, cy + Math.sin(a) * d, 1.2 + r() * (1 + (1 - d / 120) * 7), 0.92); } });
  cell(CELL.CLUSTER, (cx, cy, r) => {
    for (const [dx, dy, rr] of [[-48, -20, 34], [30, 26, 30], [34, -44, 20]] as const) splat(cx + dx, cy + dy, r, 7, rr * 0.6, rr * 1.3);
  });
}

// ---------------------------------------------------------------- tekstur bersama (hitung acuan)
let TEX: THREE.CanvasTexture | null = null, REFS = 0;
export function acquireBloodTex(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (!TEX) {
    const c = document.createElement('canvas'); c.width = N * COLS; c.height = N * ROWS; const g = c.getContext('2d'); if (!g) return null;
    drawBloodAtlas(g);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; TEX = t;
  }
  REFS++; return TEX;
}
export function releaseBloodTex() { if (REFS > 0 && --REFS === 0 && TEX) { TEX.dispose(); TEX = null; } }

// ---------------------------------------------------------------- mesh dekal
const NRM: Record<number, [number, number, number]> = { 0: [0, 1, 0], 1: [1, 0, 0], 2: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] };
/** Satu mesh dari semua dekal (posisi dikurangi `off`). Dipanggil ulang oleh pemilik; geometri & material dilepas lewat disposeBlood(). */
export function buildBloodMesh(decals: readonly Decal[], off: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): THREE.Mesh | null {
  const tex = acquireBloodTex(); if (!tex || !decals.length) { if (tex) releaseBloodTex(); return null; }
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
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.32, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
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
