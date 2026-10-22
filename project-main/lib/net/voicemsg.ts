// Pesan sinyal voice (WebRTC). Hanya lewat Realtime; isi tidak dipercaya (divalidasi VoiceMesh).
export interface RtcMsg { t: 'rtc'; to: string; k: 'h' | 'o' | 'a' | 'i'; d?: unknown }
export const isRtcMsg = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'rtc' && typeof (raw as { to?: unknown }).to === 'string';
