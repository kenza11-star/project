// Key berwarna & gembok exit. ID dipakai sebagai id item di inventory sekaligus id gembok (dicek per warna, bukan jumlah).
export type KeyId = 'key_yellow' | 'key_red' | 'key_green';

export interface KeyDef { id: KeyId; label: string; color: number; css: string }
export const KEY_DEFS: KeyDef[] = [
  { id: 'key_yellow', label: 'Yellow Key', color: 0xf2c80f, css: '#f2c80f' },
  { id: 'key_red', label: 'Red Key', color: 0xd8261c, css: '#e8392e' },
  { id: 'key_green', label: 'Green Key', color: 0x2fbf4a, css: '#3fd35c' },
];
export const KEY_IDS: KeyId[] = KEY_DEFS.map((k) => k.id);
export const keyDef = (id: string): KeyDef | undefined => KEY_DEFS.find((k) => k.id === id);
export const isKeyId = (id: string): id is KeyId => KEY_IDS.includes(id as KeyId);
