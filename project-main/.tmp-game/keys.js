"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKeyId = exports.keyDef = exports.KEY_IDS = exports.KEY_DEFS = void 0;
exports.KEY_DEFS = [
    { id: 'key_yellow', label: 'Yellow Key', color: 0xf2c80f, css: '#f2c80f' },
    { id: 'key_red', label: 'Red Key', color: 0xd8261c, css: '#e8392e' },
    { id: 'key_green', label: 'Green Key', color: 0x2fbf4a, css: '#3fd35c' },
];
exports.KEY_IDS = exports.KEY_DEFS.map((k) => k.id);
const keyDef = (id) => exports.KEY_DEFS.find((k) => k.id === id);
exports.keyDef = keyDef;
const isKeyId = (id) => exports.KEY_IDS.includes(id);
exports.isKeyId = isKeyId;
