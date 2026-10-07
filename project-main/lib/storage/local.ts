// Penyimpanan data kecil (JSON) di localStorage.
const P = 'bl:';
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(P + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); } catch { /* storage penuh */ }
}
