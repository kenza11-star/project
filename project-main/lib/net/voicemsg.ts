// Pesan sinyal voice (WebRTC). Hanya lewat Realtime; isi tidak dipercaya (divalidasi VoiceMesh).
export interface RtcMsg { t: 'rtc'; to: string; k: 'h' | 'o' | 'a' | 'i'; d?: unknown }
export const isRtcMsg = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'rtc' && typeof (raw as { to?: unknown }).to === 'string';
// Status mic pemain (broadcast kecil lewat Realtime). Isi tidak dipercaya: penerima hanya menerima `on` bertipe boolean.
export interface MicMsg { t: 'mic'; on: boolean }
export const isMicMsg = (raw: unknown): raw is MicMsg => !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'mic' && typeof (raw as { on?: unknown }).on === 'boolean';
