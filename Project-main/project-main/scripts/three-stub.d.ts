// Tipe longgar untuk 'three' khusus tes logika (tidak memengaruhi build Next.js).
declare module 'three' {
  export type Object3D = any;
  export type Camera = any;
  export class Vector2 { constructor(x?: number, y?: number); [k: string]: any }
  export class Vector3 { constructor(x?: number, y?: number, z?: number); [k: string]: any }
  export class Quaternion { [k: string]: any }
  export class Raycaster { far: number; [k: string]: any }
}
