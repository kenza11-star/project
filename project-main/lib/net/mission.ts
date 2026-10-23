// Misi keluar (logika murni, tanpa three/react; dites di scripts/test-net.js): pintu exit hanya terbuka bila SEMUA terpenuhi.
// Tahap 1: kerangka saja. "key" diturunkan dari gembok (semua gembok terbuka); "switch" dan "code" diselesaikan puzzle (sementara tombol debug).
export type MissionId = 'switch' | 'code';
export interface MissionState { key: boolean; switch: boolean; code: boolean }
export const MISSION_IDS: readonly MissionId[] = ['switch', 'code'];
export const isMissionId = (x: unknown): x is MissionId => x === 'switch' || x === 'code';
export const missionAll = (m: MissionState): boolean => m.key && m.switch && m.code;
export const missionCount = (m: MissionState): number => (m.key ? 1 : 0) + (m.switch ? 1 : 0) + (m.code ? 1 : 0);
