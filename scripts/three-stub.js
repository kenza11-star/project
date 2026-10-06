// Stub three.js minimal untuk menguji InteractionSystem tanpa browser/three (hanya dipakai oleh scripts/test-game.js).
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  distanceToSquared(o) { return (this.x - o.x) ** 2 + (this.y - o.y) ** 2 + (this.z - o.z) ** 2; } copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } }
class Quaternion { angleTo() { return 0; } copy() { return this; } }
class Raycaster {
  constructor() { this.far = Infinity; }
  setFromCamera() {}
  intersectObjects(objs) { return (globalThis.__hits || []).filter((h) => objs.includes(h.object) && h.distance <= this.far).sort((a, b) => a.distance - b.distance); }
}
module.exports = { Vector2, Vector3, Quaternion, Raycaster };
