// Generator path SVG jaring laba-laba untuk satu sudut (asal di (0,0), mengembang ke kanan-bawah). Deterministik per seed, ringan (2 path).
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const cache = new Map<number, { spokes: string; rings: string }>();

export function webPaths(seed = 1, size = 200, spokes = 7, rings = 9): { spokes: string; rings: string } {
  const hit = cache.get(seed); if (hit) return hit;
  const r = prng(seed);
  const ang: number[] = [], len: number[] = [];
  for (let i = 0; i < spokes; i++) {
    ang.push((i / (spokes - 1)) * (Math.PI / 2) + (i > 0 && i < spokes - 1 ? (r() - 0.5) * 0.14 : 0));
    len.push(size * (0.8 + r() * 0.2));
  }
  const f = (n: number) => n.toFixed(1);
  let sp = '';
  for (let i = 0; i < spokes; i++) sp += `M0 0L${f(Math.cos(ang[i]) * len[i])} ${f(Math.sin(ang[i]) * len[i])}`;
  let rg = '';
  for (let k = 1; k <= rings; k++) {
    const t = Math.pow(k / rings, 1.12);
    let pen = false;
    for (let i = 0; i < spokes; i++) {
      const rr = len[i] * t * (0.95 + r() * 0.07);
      const x = Math.cos(ang[i]) * rr, y = Math.sin(ang[i]) * rr;
      if (i === 0) { rg += `M${f(x)} ${f(y)}`; pen = true; continue; }
      const pr = len[i - 1] * t, px = Math.cos(ang[i - 1]) * pr, py = Math.sin(ang[i - 1]) * pr;
      if (r() < 0.09) { rg += `M${f(x)} ${f(y)}`; pen = true; continue; } // segmen putus (jaring sobek)
      const sag = 0.8 + r() * 0.07; // ditarik ke arah asal -> melengkung seperti benang menggantung
      if (!pen) rg += `M${f(px)} ${f(py)}`;
      rg += `Q${f(((px + x) / 2) * sag)} ${f(((py + y) / 2) * sag)} ${f(x)} ${f(y)}`;
      pen = true;
    }
  }
  const out = { spokes: sp, rings: rg };
  cache.set(seed, out);
  return out;
}
