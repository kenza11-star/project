"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomCounts = roomCounts;
function roomCounts(v, fallbackMax) {
    if (!v)
        return { online: 1, seated: 1, max: fallbackMax, ready: false };
    const members = Array.isArray(v.members) ? v.members : [];
    const online = typeof v.online_count === 'number' ? v.online_count : members.filter((m) => m.online).length;
    const seated = typeof v.member_count === 'number' ? v.member_count : members.length;
    const ready = typeof v.can_start === 'boolean' ? v.can_start : v.status === 'waiting' && online >= 2;
    return { online, seated, max: v.max_players || fallbackMax, ready };
}
