// Penanda pesan monster di transport room (mandiri, tanpa impor dari lib/game supaya lib/net tetap terkompilasi sendiri).
// Isi & validasi pesan ada di lib/game/monstersync.ts; transport hanya perlu mengenali jenisnya.
export const isMonsterMsg = (raw: unknown): boolean => { const t = (raw as { t?: unknown } | null)?.t; return t === 'm' || t === 'mc'; };
