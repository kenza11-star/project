// Ruangan penjara (prison_room.glb) -- data murni, tanpa three.js (view: prison.ts).
//
// LOKASI TETAP (tidak acak): model ~14,4 x 16 m + antechamber tidak muat di mezz lantai 2 (mezz penuh 38,4 x 38,4 m oleh ruangan),
// maka ditaruh sebagai volume di LUAR bangunan, di timur-selatan (x 42..57, z 27..47), setinggi lantai 2 (LEVEL_Y[1], grid collision level 1).
// Tidak menabrak map (x <= 38,5) dan tidak bertumpuk dengan bunker (x 45..59, z 10..25, level 0). Terhubung dari ujung tangga lantai 2
// lewat PINTU JERUJI di dinding timur + koridor 6,7 m (jalur FISIK: tanpa teleport/fade; pemain & monster berjalan). Koordinat model GLB -> dunia = model + PRISON_OFFSET (tanpa rotasi).
import { LEVEL_Y } from './config';

export interface Box2 { minx: number; maxx: number; minz: number; maxz: number }
export interface PrisonSlot { x: number; y: number; z: number; yaw: number; hookY: number }

export const PRISON_LEVEL = 1;
const FLOOR_M = 0.28;     // tinggi lantai pada model GLB (floor1)
const CEIL_M = 9.55;      // sisi bawah plafon pada model GLB
/** Offset model -> dunia. y membuat lantai model tepat di LEVEL_Y[1] (lantai 2). */
export const PRISON_OFFSET = Object.freeze({ x: 46.5, y: LEVEL_Y[PRISON_LEVEL] - FLOOR_M, z: 32.5 });
const OX = PRISON_OFFSET.x, OZ = PRISON_OFFSET.z;
const bx = (minx: number, maxx: number, minz: number, maxz: number): Box2 => ({ minx: minx + OX, maxx: maxx + OX, minz: minz + OZ, maxz: maxz + OZ });

export const PRISON_FLOOR_Y = LEVEL_Y[PRISON_LEVEL];
export const PRISON_CEIL_Y = CEIL_M + PRISON_OFFSET.y;
/** Seluruh volume (sel + antechamber + dinding): menyembunyikan model saat pemain jauh & batas jalan collision saat di dalam. */
export const PRISON_AREA: Box2 = bx(-4.1, 10.52, -5.0, 14.49);
/** Koridor interior dari pintu jeruji (dinding timur bangunan) ke antechamber. */
export const PRISON_HALL: Box2 = Object.freeze({ minx: 38.5, maxx: 45.2, minz: 30.4, maxz: 31.9 });
export const PRISON_HALL_H = 2.8;
const inBox = (b: Box2, x: number, z: number, pad: number) => x >= b.minx - pad && x <= b.maxx + pad && z >= b.minz - pad && z <= b.maxz + pad;
export const inPrison = (x: number, z: number, pad = 0) => inBox(PRISON_AREA, x, z, pad) || inBox(PRISON_HALL, x, z, pad);
/** Metadata ruangan (bentuk sama dengan MapData.rooms) untuk pemetaan monster / seret (TAHAP 2). Tidak dimasukkan ke md.rooms agar tujuan seret lama tidak berubah. */
export const PRISON_ROOM = Object.freeze({ id: 'Room_Prison', type: 'prison', rect: bx(-3.8, 9.85, 0.06, 13.92), height: CEIL_M - FLOOR_M, level: PRISON_LEVEL });

/** Dinding padat (grid collision level 1). Bukaan pintu sel: x 0,25..3,33 (antara kusen batu). Dinding barat model tidak ada di GLB (diorama terbuka): ditambah di prison.ts. */
export const PRISON_WALLS: readonly Box2[] = Object.freeze([
  bx(-4.1, -3.8, -0.6, 14.49),     // barat (dibuat di view)
  bx(-3.9, -0.62, -0.6, -0.08),    // utara kiri
  bx(-0.62, 0.25, -0.81, 0.06),    // kusen kiri
  bx(3.33, 4.12, -0.81, 0.06),     // kusen kanan
  bx(4.12, 9.9, -0.6, -0.08),      // utara kanan
  bx(9.85, 10.52, -0.78, 14.49),   // timur (+ tiang pojok)
  bx(-3.9, 10.52, 13.92, 14.49),   // selatan
  bx(-1.3, -1.0, -5.0, -2.1),      // antechamber barat (bukaan koridor di z -2,1..-0,6 = dunia 30,4..31,9)
  Object.freeze({ minx: 38.5, maxx: 45.2, minz: 30.25, maxz: 30.4 }),   // koridor: dinding utara
  Object.freeze({ minx: 38.5, maxx: 45.2, minz: 31.9, maxz: 32.05 }),   // koridor: dinding selatan
  bx(4.7, 5.0, -5.0, -0.6),        // antechamber timur
  bx(-1.3, 5.0, -5.0, -4.7),       // antechamber utara (sisi pintu keluar)
]);

export interface PrisonObb { id: string; cx: number; cz: number; hx: number; hz: number; yaw: number }
const ob = (id: string, minx: number, maxx: number, minz: number, maxz: number): PrisonObb => ({ id: 'prison-' + id, cx: (minx + maxx) / 2 + OX, cz: (minz + maxz) / 2 + OZ, hx: (maxx - minx) / 2, hz: (maxz - minz) / 2, yaw: 0 });
/** Penghalang tetap di dalam sel: bangku batu (timur) dan ember. */
export const PRISON_PROPS: readonly PrisonObb[] = Object.freeze([ob('bench', 8.03, 9.41, -0.13, 4.56), ob('bucket', -1.33, -0.19, 9.25, 10.38)]);
/** Pintu jeruji sel: daun menutup bukaan; collider hanya aktif saat tertutup. Diawali 'prison-' agar ikut dibersihkan saat dispose. */
export const PRISON_DOOR = Object.freeze({
  obb: ob('door', 0.47, 4.23, -1.12, -0.70),
  hinge: { x: 0.46 + OX, z: -0.91 + OZ },   // engsel (sumbu putar); daun membuka ke dalam sel (rotasi -90 deg)
  cx: 1.8 + OX, cz: -0.91 + OZ,             // pusat bukaan (dipakai monster/pemain untuk jarak)
  reach: 3.2,                                // jarak maksimum interaksi / monster membuka
  open: -Math.PI / 2,
});

/** Yaw pemain (forward = (-sin, -cos)) menghadap titik (tx,tz) dari (x,z). */
export const yawToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
const DOOR_FACE = { x: 1.8 + OX, z: -0.1 + OZ };
const SLOT_HOOK_Y = CEIL_M - 0.06 + PRISON_OFFSET.y;
/** 6 titik ikat: kait rantai di plafon, 2 baris x 3 kolom (jarak 4,4 x 4 m) di tengah sel; yaw menghadap pintu. (x,z,y) = titik lantai tempat korban berdiri. */
export const PRISON_SLOTS: readonly PrisonSlot[] = Object.freeze(
  [5.0, 9.0].flatMap((mz) => [-2.2, 2.2, 6.6].map((mx) => {
    const x = mx + OX, z = mz + OZ;
    return Object.freeze({ x, y: PRISON_FLOOR_Y, z, yaw: yawToward(x, z, DOOR_FACE.x, DOOR_FACE.z), hookY: SLOT_HOOK_Y });
  })),
);
/** Rantai berakhir (borgol) setinggi ini di atas lantai. */
export const SLOT_CUFF_H = 2.35;

/** Lampu redup kuning (masuk pool lampu world: tanpa PointLight baru, tanpa shadow). y dalam jangkauan pool (+-2,6 m dari mata). */
export const PRISON_LIGHTS = Object.freeze([
  { x: 2.0 + OX, y: PRISON_FLOOR_Y + 3.2, z: 7.0 + OZ, c: 0xffc25a, i: 11, r: 14, flicker: false },    // tengah sel
  { x: 1.85 + OX, y: PRISON_FLOOR_Y + 3.2, z: -2.7 + OZ, c: 0xffb040, i: 8, r: 9, flicker: true },    // antechamber
]);

/** Pintu baja penghubung di dinding timur ujung tangga lantai 2 (menghadap barat) + tempat muncul sesudah keluar. */
/** PINTU JERUJI penghubung di dinding timur bangunan (ujung tangga lantai 2). Daun berengsel di sisi utara, membuka ke dalam koridor (+x). */
export const PRISON_GATE = Object.freeze({
  x: 38.3, z: 31.15, nx: -1, nz: 0, w: 1.5, h: 2.35,
  hinge: { x: 38.3, z: 30.4 }, open: Math.PI / 2, reach: 3.0,
  obb: { id: 'prison-gate', cx: 38.3, cz: 31.15, hx: 0.05, hz: 0.75, yaw: 0 },     // collider daun (aktif saat tertutup)
  approach: { x: 37.4, z: 31.15 },                                                 // tempat berdiri di depan pintu (sisi bangunan)
  arrive: { x: 37.9, z: 31.15, yaw: yawToward(37.9, 31.15, 30, 31.15) },
});
/** Lubang di dinding timur bangunan (mesh F2_Walls dipotong lewat shader, grid collision dikosongkan) selebar koridor. */
export const PRISON_GATE_CUT = Object.freeze({ minx: 38.0, maxx: 38.6, minz: PRISON_HALL.minz, maxz: PRISON_HALL.maxz, y0: PRISON_FLOOR_Y, y1: PRISON_FLOOR_Y + PRISON_GATE.h });
/** Persegi jalan tambahan level 1 (digabung dengan mezz): koridor (menjorok ke lubang dinding) + seluruh area penjara. */
export const PRISON_WALK: readonly Box2[] = Object.freeze([
  Object.freeze({ minx: 37.5, maxx: 45.5, minz: PRISON_HALL.minz, maxz: PRISON_HALL.maxz }),   // minx 37,5: lingkaran badan di ambang dinding (x 38,0..38,6) harus muat di satu persegi
  Object.freeze({ minx: PRISON_AREA.minx - 0.3, maxx: PRISON_AREA.maxx + 0.3, minz: PRISON_AREA.minz - 0.3, maxz: PRISON_AREA.maxz + 0.3 }),
]);
/** Tempat muncul di antechamber (menghadap pintu sel) + pintu keluar di dinding utara antechamber (menghadap selatan). */
export const PRISON_ENTRY = Object.freeze({
  arrive: { x: 1.85 + OX, z: -2.4 + OZ, yaw: yawToward(1.85 + OX, -2.4 + OZ, DOOR_FACE.x, DOOR_FACE.z) },
  exit: { x: 1.85 + OX, z: -4.68 + OZ, nx: 0, nz: 1, w: 1.1, h: 2.3 },
});
/** Titik awal flood-fill nav monster di antechamber. */
export const PRISON_NAV_SEED = Object.freeze({ x: 1.85 + OX, z: -2.4 + OZ });

/** Titik berdiri monster saat menyeret ke slot i: 1,2 m dari titik ikat menuju pintu sel (korban mengikuti 1,4 m di belakang => berakhir di sekitar slot). */
export function slotStand(i: number): { x: number; z: number } {
  const n = PRISON_SLOTS.length, s = PRISON_SLOTS[((Math.floor(i) % n) + n) % n], dx = DOOR_FACE.x - s.x, dz = DOOR_FACE.z - s.z, d = Math.hypot(dx, dz) || 1;
  return { x: s.x + (dx / d) * 1.2, z: s.z + (dz / d) * 1.2 };
}
