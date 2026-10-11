// Penempatan item kecil di PERMUKAAN nyata furniture (meja, meja kerja, rak, dasar laci/lemari). Logika murni tanpa three.js:
// bekerja pada 'sup segitiga' ruang dunia (Float32Array/number[], 9 angka per segitiga) dan menembakkan sinar vertikal ke bawah.
// Tinggi permukaan diambil dari geometri sebenarnya, jadi item tidak melayang, tenggelam, atau menembus.
export interface SurfPoint { x: number; y: number; z: number }

interface Hit { y: number; up: boolean }

/** Semua titik potong sinar vertikal (x,z) dengan segitiga, urut dari atas ke bawah. up = muka menghadap ke atas. */
export function verticalHits(tris: ArrayLike<number>, x: number, z: number): Hit[] {
  const out: Hit[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2], bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5], cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
    // titik di dalam segitiga pada proyeksi XZ (tanda tiga determinan sama)
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    // normal bidang (e1 x e2); komponen Y menentukan arah muka dan tinggi di (x,z)
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (Math.abs(ny) < 1e-9) continue; // sisi tegak: tidak berpotongan dengan sinar vertikal
    const y = ay - (nx * (x - ax) + nz * (z - az)) / ny;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.push({ y, up: ny / len > 0.9 }); // 0.9 ~ kemiringan < 26 derajat dianggap datar
  }
  out.sort((a, b) => b.y - a.y);
  return out;
}

/** Permukaan datar menghadap atas pertama pada/di bawah yStart (untuk meletakkan item di dalam laci/lemari). null bila tidak ada dalam maxDrop. */
export function dropOnto(tris: ArrayLike<number>, x: number, z: number, yStart: number, maxDrop = 0.8): number | null {
  for (const h of verticalHits(tris, x, z)) {
    if (h.y > yStart) continue;
    if (yStart - h.y > maxDrop) return null;
    if (h.up) return h.y;
    return null; // permukaan pertama di bawah titik adalah muka bawah/tegak: tertutup, bukan tempat meletakkan
  }
  return null;
}

export interface SurfOpts {
  minY: number; maxY: number;  // rentang tinggi permukaan yang dipakai (mudah dijangkau & bukan atas lemari tinggi)
  step?: number;               // jarak grid (m); juga jarak aman minimum ke tepi permukaan
  clear?: number;              // ruang bebas di atas permukaan (m) untuk kaleng setinggi ~0,115 m
  flat?: number;               // toleransi kerataan terhadap tetangga grid (m)
}

/**
 * Titik-titik di permukaan datar furniture: tinggi dalam [minY,maxY], ada ruang bebas di atasnya, dan seluruh 4 tetangga grid
 * (step ke kiri/kanan/depan/belakang) berada pada permukaan yang sama (jadi minimal `step` dari tepi & tanpa tonjolan/lubang).
 */
export function sampleSurfaces(tris: ArrayLike<number>, o: SurfOpts): SurfPoint[] {
  const step = o.step ?? 0.1, clear = o.clear ?? 0.22, flat = o.flat ?? 0.012;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 2 < tris.length; i += 3) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); z0 = Math.min(z0, tris[i + 2]); z1 = Math.max(z1, tris[i + 2]); }
  if (!isFinite(x0)) return [];
  const nx = Math.floor((x1 - x0) / step) + 1, nz = Math.floor((z1 - z0) / step) + 1;
  // tinggi permukaan atas yang valid per sel: array level (bisa >1 untuk rak bertingkat)
  const cell: number[][] = new Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const hits = verticalHits(tris, x0 + i * step, z0 + j * step), ys: number[] = [];
    for (let h = 0; h < hits.length; h++) {
      const s = hits[h]; if (!s.up || s.y < o.minY || s.y > o.maxY) continue;
      const above = h > 0 ? hits[h - 1].y - s.y : Infinity; // jarak ke permukaan/bagian di atasnya
      if (above < clear) continue;
      ys.push(s.y);
    }
    cell[j * nx + i] = ys;
  }
  const has = (i: number, j: number, y: number) => i >= 0 && j >= 0 && i < nx && j < nz && cell[j * nx + i].some((v) => Math.abs(v - y) <= flat);
  const out: SurfPoint[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const y of cell[j * nx + i]) {
    if (has(i - 1, j, y) && has(i + 1, j, y) && has(i, j - 1, y) && has(i, j + 1, y)) out.push({ x: x0 + i * step, y, z: z0 + j * step });
  }
  return out;
}
