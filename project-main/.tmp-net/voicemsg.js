"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRtcMsg = void 0;
const isRtcMsg = (raw) => !!raw && typeof raw === 'object' && raw.t === 'rtc' && typeof raw.to === 'string';
exports.isRtcMsg = isRtcMsg;
