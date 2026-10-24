// Ruangan penjara (prison_room.glb) -- data murni, tanpa three.js (view: prison.ts).
//
// LOKASI TETAP (tidak acak): model ~14,4 x 16 m + antechamber tidak muat di mezz lantai 2 (mezz penuh 38,4 x 38,4 m oleh ruangan),
// maka ditaruh sebagai volume di LUAR bangunan, di timur-selatan (x 42..57, z 27..47), setinggi lantai 2 (LEVEL_Y[1], grid collision level 1).
// Tidak menabrak map (x <= 38,5) dan tidak bertumpuk dengan bunker (x 45..59, z 10..25, level 0). Terhubung dari ujung tangga lantai 2
// lewat pintu baja di dinding timur (fade singkat). Koordinat model GLB -> dunia = model + PRISON_OFFSET (tanpa rotasi).
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
export const inPrison = (x: number, z: number, pad = 0) => x >= PRISON_AREA.minx - pad && x <= PRISON_AREA.maxx + pad && z >= PRISON_AREA.minz - pad && z <= PRISON_AREA.maxz + pad;
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
  bx(-1.3, -1.0, -5.0, -0.6),      // antechamber barat
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
  { x: 2.0 + OX, y: PRISON_FLOOR_Y + 3.2, z: 7.0 + OZ, c: 0xffc25a, i: 6, r: 12, flicker: false },    // tengah sel
  { x: 1.85 + OX, y: PRISON_FLOOR_Y + 3.2, z: -2.7 + OZ, c: 0xffb040, i: 4.5, r: 8, flicker: true },    // antechamber
]);

/** Pintu baja penghubung di dinding timur ujung tangga lantai 2 (menghadap barat) + tempat muncul sesudah keluar. */
export const PRISON_GATE = Object.freeze({
  x: 38.3, z: 31.2, nx: -1, nz: 0, w: 1.1, h: 2.3,
  arrive: { x: 37.9, z: 31.2, yaw: yawToward(37.9, 31.2, 30, 31.2) },
});
/** Tempat muncul di antechamber (menghadap pintu sel) + pintu keluar di dinding utara antechamber (menghadap selatan). */
export const PRISON_ENTRY = Object.freeze({
  arrive: { x: 1.85 + OX, z: -2.4 + OZ, yaw: yawToward(1.85 + OX, -2.4 + OZ, DOOR_FACE.x, DOOR_FACE.z) },
  exit: { x: 1.85 + OX, z: -4.68 + OZ, nx: 0, nz: 1, w: 1.1, h: 2.3 },
});
/** Titik awal flood-fill nav monster di antechamber. */
export const PRISON_NAV_SEED = Object.freeze({ x: 1.85 + OX, z: -2.4 + OZ });
