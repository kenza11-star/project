// Pencocokan model kursi custom (public/models/chair.glb) ke slot kursi bawaan map. Logika murni (tanpa three) agar bisa dites.
// Prinsip anti-tembus: model dipasang SELURUHNYA di dalam kotak collision kursi bawaan (footprint model <= kotak),
// jadi collision lama tetap benar dan tidak ada bagian kursi yang bisa dimasuki pemain.
export interface ChairSlot { w: number; d: number; h: number }          // lebar (x), kedalaman (z), tinggi (y) slot, meter
export interface ChairFit {
  yaw: number; scale: number; tx: number; ty: number; tz: number;       // p' = R_y(yaw) * (scale * p) + (tx,ty,tz), konvensi rotasi.y three.js
  hx: number; hz: number; h: number;                                    // setengah-footprint & tinggi hasil (ruang lokal node kursi)
}
/**
 * min/max = bounds model SETELAH transform node-nya (Y = atas). Model asli: sandaran di sisi +Z; slot map: depan = +Z lokal
 * dan sandaran di sisi -Z, jadi model diputar 180 derajat (yaw = PI). Skala seragam terbesar yang muat di slot (w x d x h),
 * footprint dipusatkan di (0,0) dan kaki menyentuh y = 0.
 */
export function fitChair(min: ArrayLike<number>, max: ArrayLike<number>, slot: ChairSlot, yaw = Math.PI): ChairFit {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const x of [min[0], max[0]]) for (const z of [min[2], max[2]]) {
    const rx = x * c + z * s, rz = -x * s + z * c;
    x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); z0 = Math.min(z0, rz); z1 = Math.max(z1, rz);
  }
  const W = x1 - x0, D = z1 - z0, H = max[1] - min[1];
  const scale = Math.min(slot.w / W, slot.d / D, slot.h / H);
  return { yaw, scale, tx: -((x0 + x1) / 2) * scale, ty: -min[1] * scale, tz: -((z0 + z1) / 2) * scale, hx: (W * scale) / 2, hz: (D * scale) / 2, h: H * scale };
}
/** Titik model -> ruang lokal node kursi. */
export function applyFit(f: ChairFit, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [(x * c + z * s) * f.scale + f.tx, y * f.scale + f.ty, (-x * s + z * c) * f.scale + f.tz];
}
