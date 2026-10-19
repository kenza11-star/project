import { handle, json, rateLimit, readJson, HttpError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { rpc, withFallback } from '@/lib/server/rooms';
import { lockerViaTables } from '@/lib/server/roomsFallback';
import { validRoomId } from '@/lib/net/roomrules';
import { isLockerAction, validLockerId, sanitizeLockers, type LockerReply } from '@/lib/net/lockers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// POST /api/rooms/locker {roomId, action: 'enter'|'exit'|'release', locker?}
// Validasi OTORITATIF sistem loker/lemari multiplayer: maks 1 pemain per loker, 1 loker per pemain. Identitas dari token (bukan dari isi pesan).
// Jalur utama = fungsi SQL locker_op (baris room dikunci -> klaim serentak diserialkan); cadangan = tabel dengan kunci unik (lib/net/lockersTables.ts).
// Balasan: {ok, reason: 'occupied'|null, owner, lockers: {lockerId: uid}, server_time}. `lockers` = klaim HIDUP (pemegang online, lease belum habis).
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  await rateLimit('room-locker:' + user.uid, 240, 60_000, false); // lapis memori saja: enter/exit/renew jarang, tapi jangan menulis DB untuk tiap cek
  const b = await readJson(req);
  if (!validRoomId(b.roomId) || !isLockerAction(b.action)) throw new HttpError(400, 'invalid');
  if (b.action !== 'release' && !validLockerId(b.locker)) throw new HttpError(400, 'invalid');
  const roomId = b.roomId, action = b.action, locker = b.action === 'release' ? null : (b.locker as string);
  const raw = await withFallback('locker',
    () => rpc<LockerReply>('locker_op', { p_uid: user.uid, p_room: roomId, p_locker: locker, p_action: action }),
    () => lockerViaTables(user.uid, roomId, locker, action));
  // Satu jam (jam server aplikasi) untuk SEMUA jalur (SQL / tabel) supaya klien bisa mengurutkan snapshot dari /sync dan dari endpoint ini.
  return json({ ok: raw.ok === true, reason: raw.ok === true ? null : 'occupied', owner: raw.ok === true ? null : (typeof raw.owner === 'string' ? raw.owner : null), lockers: sanitizeLockers(raw.lockers) ?? {}, server_time: new Date().toISOString() });
});
