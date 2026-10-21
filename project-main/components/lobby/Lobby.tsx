'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Shirt, Lock, Users, Play, Wrench, Pencil, LogIn, LogOut, Eye } from 'lucide-react';
import Stage, { type ModelReq } from './Stage';
import PlayScene from './PlayScene';
import { lockLandscape, unlockLandscape } from '@/lib/game/orientation';
import { setPlayMode } from '@/lib/ui/playmode';
import { CHARACTER_SELECTION_ENABLED } from '@/lib/character/config';
import DemoMenu from './DemoMenu';
import PlayerModeModal from './PlayerModeModal';
import Splash, { splashShown } from '../ui/Splash';
import AuthScreen from '../auth/AuthScreen';
import ProfileCard from '../profile/ProfileCard';
import ProfileEditModal from '../profile/ProfileEditModal';
import RoomModal from './RoomModal';
import CharacterModal from '../character/CharacterModal';
import ComingSoonModal from '../character/ComingSoonModal';
import FriendsPanel from '../friends/FriendsPanel';
import AddFriendModal from '../friends/AddFriendModal';
import FriendOptionsModal from '../friends/FriendOptionsModal';
import Notifications from '../friends/Notifications';
import Modal from '../ui/Modal';
import Toasts, { type ToastItem } from '../ui/Toasts';
import { fileStore } from '@/lib/storage/idb';
import { load, save } from '@/lib/storage/local';
import { resizeImage } from '@/lib/image';
import { validateModelFile, extOf } from '@/lib/3d/character';
import { loadProfile, type Profile } from '@/lib/profile';
import * as S from '@/lib/social/logic';
import { fetchSocial, requestFriend, acceptFriend, declineFriend, removeFriendRemote, mergeRemote, sendInvite, answerInvite } from '@/lib/social/remote';
import { buildSlots, openCount, modeLabel, normalizeMode, type PlayerMode } from '@/lib/game/players';
import { authProvider } from '@/lib/auth/provider';
import { loadSession, saveSession } from '@/lib/auth/session';
import type { AuthUser, Session } from '@/lib/auth/types';
import { loadHorrorFonts } from '@/lib/ui/fonts';
import { onlineConfigured } from '@/lib/config/env';
import { startNetSession } from '@/lib/net/roomsession';
import { saveDisplayName, createRoom, leaveRoom, RoomApiError, type RoomSession } from '@/lib/net/roomapi';
import { useRoomSync } from '@/lib/net/useRoomSync';
import { roomCounts } from '@/lib/net/roomcounts';
import type { NetSession } from '@/lib/net/session';
import { resetSupabase } from '@/lib/net/supabaseClient';

type Panel = null | 'room' | 'char' | 'soon' | 'profile' | 'add' | 'multi' | 'demo' | 'confirm' | { friend: string };
interface Meta { name: string; ext: string; size: number }

export default function Lobby() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [social, setSocial] = useState<S.Social>(() => ({ ...S.initialSocial, ...load('social', {}) }));
  // Sistem karakter terkunci (lib/character/config.ts): model tersimpan diabaikan, semua pemain memakai model default yang sama.
  const charSel = CHARACTER_SELECTION_ENABLED;
  const [meta, setMeta] = useState<Meta | null>(() => (charSel ? load<Meta | null>('model', null) : null));
  const [req, setReq] = useState<ModelReq | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [hold, setHold] = useState<boolean>(() => charSel && !!load<Meta | null>('model', null)); // true selama karakter tersimpan sedang dipulihkan
  const [panel, setPanel] = useState<Panel>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loadP, setLoadP] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [net, setNet] = useState<NetSession | null>(null); // sesi room online aktif (null = Single Player / offline)
  // Room yang sedang menunggu (host/anggota). Tetap ada walau panel room DISEMBUNYIKAN (tombol X) -- hanya "Keluar room" yang melepasnya.
  // Polling server (daftar pemain + heartbeat) dipegang hook useRoomSync di bawah, bukan oleh panel, jadi tidak ikut mati saat panel ditutup.
  const [lobbyRoom, setLobbyRoom] = useState<RoomSession | null>(null);
  const inviteToastAt = useRef(0);                                         // anti-spam pesan "sudah ada di room" (tap + berulang)
  const handedOver = useRef(false);                                        // cegah masuk game dua kali (host menekan Mulai + polling melihat 'playing')
  const inviteIds = useRef<Record<string, string>>({});                   // uid pengundang -> id undangan (untuk Terima/Tolak)
  const outSeen = useRef<Record<string, string>>({});                     // id undangan keluar -> status terakhir yang sudah diberitahukan
  const pollFails = useRef({ n: 0, warnedAt: 0 });                          // gagal polling berturut-turut + kapan terakhir memberi tahu pemain (jangan diam-diam)
  // Mode pemain (1-4): tersimpan di perangkat. Data lama (sebelum fitur ini) yang masih bermode 'duo' dimigrasi ke 2 Players.
  const [savedMode, setMode] = useState<PlayerMode>(() => {
    const saved = load<number | null>('playerMode', null);
    if (saved != null) return normalizeMode(saved);
    return load<{ mode?: string }>('social', {}).mode === 'duo' ? 2 : 1;
  });
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [stageReady, setStageReady] = useState(false); // karakter lobby pertama selesai dimuat (berhasil atau gagal)
  const [fontsReady, setFontsReady] = useState(false);
  const [booted, setBooted] = useState<boolean>(() => splashShown()); // splash startup selesai (menu login baru dipasang sesudahnya)
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-aspect-ratio: 1/1)');
    const f = () => setPortrait(mq.matches); f();
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, []);
  const account = session?.kind === 'account' ? session.user : null; // guest = null (tanpa ID)
  const guest = !account;
  const online = onlineConfigured() && !!account?.uid; // multiplayer online: butuh konfigurasi publik terisi + login lewat backend (punya Firebase UID)
  const mode: PlayerMode = account ? savedMode : 1; // guest hanya Single Player (pilihan tersimpan tidak diubah)
  const urls = useRef<{ av: string | null }>({ av: null });
  // Tombol Demo (simulasi teman mock) hanya untuk development; tidak tampil di rilis
  const showDemo = process.env.NODE_ENV !== 'production';
  const close = useCallback(() => { setPanel(null); }, []);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const applyAvatar = (b: Blob | null) => {
    if (urls.current.av) URL.revokeObjectURL(urls.current.av);
    urls.current.av = b ? URL.createObjectURL(b) : null;
    setAvatar(urls.current.av);
  };

  // Pulihkan file dari IndexedDB setelah refresh. Tanpa karakter tersimpan -> Stage memuat karakter default (James).
  useEffect(() => {
    (async () => {
      try {
        fileStore.del('bg').catch(() => {}); // sisa background lama (fitur sudah dihapus)
        const [m, a] = await Promise.all([charSel ? fileStore.get('model') : Promise.resolve(undefined), fileStore.get('avatar')]);
        if (a) applyAvatar(a);
        if (!charSel) { /* terkunci: model tersimpan tidak dipakai (juga tidak dihapus, supaya kembali bila fitur diaktifkan) */ }
        else if (m && meta) setReq({ id: 1, blob: m, ext: meta.ext, persist: false, name: meta.name, size: meta.size });
        else if (meta) { save('model', null); setMeta(null); } // metadata ada tapi file hilang
      } catch { /* IndexedDB tidak tersedia: lanjut tanpa */ }
      finally { setHold(false); }
    })();
    return () => { if (urls.current.av) URL.revokeObjectURL(urls.current.av); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => save('profile', profile), [profile]);
  useEffect(() => save('social', social), [social]);
  useEffect(() => save('playerMode', savedMode), [savedMode]);
  // Catatan: fullscreen + kunci landscape TIDAK diminta di lobby (lobby punya layout portrait sendiri); hanya saat menekan Play (begin).
  useEffect(() => { let on = true; loadHorrorFonts().then(() => { if (on) setFontsReady(true); }); return () => { on = false; }; }, []);
  // Sesi akun (bila nanti ada backend) harus diverifikasi server; sesi yang tidak bisa dipulihkan dibuang.
  useEffect(() => {
    if (session?.kind !== 'account') return;
    let on = true;
    authProvider.restore().then((u) => { if (on && !u) { saveSession(null); setSession(null); } }).catch(() => {});
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- karakter ----
  const onModelFile = (f: File) => {
    if (!charSel) return; // terkunci
    const err = validateModelFile(f);
    if (err) { toast(err, 'err'); return; }
    setLoadP(0.05);
    setReq({ id: Date.now(), blob: f, ext: extOf(f.name), persist: true, name: f.name, size: f.size });
  };
  const onResult = useCallback(async (r: ModelReq | null, ok: boolean, msg?: string) => {
    setStageReady(true);
    setLoadP(null);
    if (!ok) {
      toast(msg || 'Model gagal dimuat', 'err');
      if (r && !r.persist) { fileStore.del('model').catch(() => {}); save('model', null); setMeta(null); }
      return;
    }
    if (r && r.persist && r.blob) {
      try { await fileStore.put('model', r.blob); } catch { toast('Karakter tampil, tapi gagal disimpan (storage penuh)', 'err'); }
      const m = { name: r.name, ext: r.ext, size: r.size };
      save('model', m); setMeta(m); toast('Karakter dimuat');
    }
  }, [toast]);
  const resetModel = () => {
    if (!charSel) return; // terkunci
    fileStore.del('model').catch(() => {}); save('model', null); setMeta(null);
    setReq({ id: Date.now(), blob: null, ext: '', persist: false, name: '', size: 0 });
    toast('Kembali ke karakter default');
  };

  // ---- avatar ----
  const onAvatarFile = async (f: File) => {
    try { const b = await resizeImage(f, 256); applyAvatar(b); await fileStore.put('avatar', b); toast('Foto profil diganti'); }
    catch (er: any) { toast(er?.message || 'Gagal memuat foto', 'err'); }
  };

  // ---- sosial ----
  const needLogin = () => toast('Login dulu untuk memakai fitur multiplayer & teman', 'err');
  const apply = (fn: (s: S.Social) => S.R) => { if (guest) { needLogin(); return; } const [n, m, ok] = fn(social); setSocial(n); if (n.mode === 'duo' && mode < 2) setMode(2); toast(m, ok ? 'ok' : 'err'); };
  // Teman + undangan NYATA (online): satu panggilan /api/social tiap 3 dtk (dijeda saat bermain / tab tersembunyi) + segera saat tab aktif kembali.
  // Request teman dan undangan main yang dikirim orang lain muncul di sini; status undangan keluar (diterima/ditolak) juga diberitahukan ke pengirim.
  // Galat polling TIDAK lagi ditelan diam-diam: bila gagal 4x berturut-turut (~12 dtk) atau server melapor undangan tidak bisa dimuat, pemain diberi tahu
  // (maks 1x per menit) -- sebelumnya undangan "tidak masuk" tanpa petunjuk apa pun.
  const warnPoll = useCallback((msg: string) => {
    const now = Date.now();
    if (now - pollFails.current.warnedAt < 60_000) return;
    pollFails.current.warnedAt = now; toast(msg, 'err');
  }, [toast]);
  const refreshFriends = useCallback(async () => {
    try {
      const { friends, invites, invitesFailed } = await fetchSocial();
      pollFails.current.n = 0;
      if (invitesFailed) warnPoll('Server gagal memuat undangan. Jalankan supabase/migration_v3_presence.sql (dan v2) di Supabase SQL Editor.');
      inviteIds.current = Object.fromEntries(invites.incoming.map((i) => [i.uid, i.id]));
      for (const o of invites.outgoing) {
        const prev = outSeen.current[o.id];
        if (prev === undefined) { outSeen.current[o.id] = o.status; if (o.status === 'pending') continue; }
        if (prev !== o.status && o.status !== 'pending') { outSeen.current[o.id] = o.status; toast(o.status === 'accepted' ? `${S.userName(o.uid)} bergabung ke room` : `${S.userName(o.uid)} menolak undangan`, o.status === 'accepted' ? 'ok' : 'err'); }
      }
      setSocial((s) => mergeRemote(s, friends, invites));
    } catch (e) {
      if (++pollFails.current.n >= 4) warnPoll(e instanceof Error && e.message ? 'Undangan tidak bisa dimuat: ' + e.message : 'Undangan tidak bisa dimuat. Periksa koneksi.');
    }
  }, [toast, warnPoll]);
  useEffect(() => {
    if (!online || playing) return;
    void refreshFriends();
    const t = setInterval(() => { if (!document.hidden) void refreshFriends(); }, 3000);
    const vis = () => { if (!document.hidden) void refreshFriends(); };
    document.addEventListener('visibilitychange', vis); window.addEventListener('focus', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); };
  }, [online, playing, refreshFriends]);
  const remote = async (run: () => Promise<{ status?: string }>, ok: (st?: string) => string) => {
    try { const r = await run(); toast(ok(r.status)); await refreshFriends(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Gagal menghubungi server', 'err'); }
  };
  const onSendReq = (uid: string) => remote(() => requestFriend(uid), (st) => st === 'accepted' ? 'Kalian sekarang berteman' : st === 'pending' ? 'Request dikirim' : 'Sudah ada request');
  const onReqAnswer = (uid: string, okk: boolean) => remote(() => (okk ? acceptFriend(uid) : declineFriend(uid)), () => (okk ? `${S.userName(uid)} sekarang temanmu` : 'Request ditolak'));
  const onRemoveFriend = (uid: string) => { setPanel(null); return remote(() => removeFriendRemote(uid), () => `${S.userName(uid)} dihapus dari teman`); };
  // Masuk ke room (hasil buat / gabung / terima undangan): jadi room aktif lobby. Bila room sudah berjalan (reconnect anggota lama), langsung masuk game.
  const enterRoom = (r: RoomSession) => { handedOver.current = false; setLobbyRoom(r); if (r.status === 'playing') void onRoomReady(r); };
  // Undangan main NYATA: dikirim ke backend (tersimpan di database) dan muncul di akun teman. Perlu room yang menunggu: dibuat otomatis bila belum ada.
  const inviteOnline = async (uid: string) => {
    try {
      const open = async () => { const n = Math.max(2, mode); if (mode < 2) setMode(2); const r = await createRoom(n); enterRoom(r); setPanel('room'); return r; };
      let room = lobbyRoom, fresh = false;
      if (!room) { room = await open(); fresh = true; } // room baru: buka panelnya supaya kode room terlihat. Room lama yang disembunyikan tidak dibuka paksa (tidak mengganggu layar).
      let r: { status: string };
      try { r = await sendInvite(uid, room.roomId); }
      catch (e) {
        // Room lama di memori sudah tidak berlaku di server (ditutup / kursi terlepas): sebelumnya SEMUA undangan berikutnya gagal terus sampai halaman di-refresh.
        // Sekarang buat room baru sekali lalu kirim ulang.
        if (!fresh && e instanceof RoomApiError && ['room_closed', 'not_member', 'room_not_found', 'room_started'].includes(e.code)) {
          room = await open();
          r = await sendInvite(uid, room.roomId);
        } else throw e;
      }
      if (r.status === 'already_in_room') {
        // Server mencatat dia sudah di room. Bila layar ini belum menampilkannya online, segarkan snapshot SEKARANG (bukan hanya mengulang pesan yang sama).
        const sameAgain = Date.now() - inviteToastAt.current < 6000;
        inviteToastAt.current = Date.now();
        if (!sameAgain) toast(`${S.userName(uid)} sudah ada di room`);
        refreshRoom();
      } else toast(`Undangan dikirim ke ${S.userName(uid)}`);
      await refreshFriends();
    } catch (e) { toast(e instanceof Error ? e.message : 'Gagal mengirim undangan', 'err'); }
  };
  const onInvAnswer = async (uid: string, okk: boolean) => {
    const id = inviteIds.current[uid];
    if (!id) { toast('Undangan sudah tidak berlaku.', 'err'); await refreshFriends(); return; }
    try {
      const r = await answerInvite(id, okk);
      if (okk && r.status === 'accepted' && r.room) { enterRoom(r.room); setPanel('room'); toast(`Bergabung ke room ${S.userName(uid)}`); }
      else if (okk) toast('Undangan sudah tidak berlaku.', 'err');
      else toast('Undangan ditolak');
    } catch (e) { toast(e instanceof RoomApiError || e instanceof Error ? e.message : 'Gagal menjawab undangan', 'err'); }
    await refreshFriends();
  };
  // Polling server untuk room aktif. Dipanggil di level Lobby (selalu aktif selama ada room, apa pun panel yang terbuka). Handler dipanggil belakangan, setelah render.
  const { view: roomView, syncErr, refresh: refreshRoom } = useRoomSync(online ? lobbyRoom : null, account?.uid ?? '', { onPlaying: (r) => { void onRoomReady(r); }, onGone: (m) => onRoomGone(m) });
  const duo = mode > 1;
  const partner = duo && social.party ? social.party : null;
  // Karakter 3D di lobby = pemain room yang benar-benar ONLINE (dari server), pemain lokal di depan. null = pakai tampilan lama (Single/mock).
  const crew: string[] | null = online && lobbyRoom && roomView
    ? [...roomView.members].filter((m) => m.online).sort((a, b) => (a.id === account?.uid ? -1 : b.id === account?.uid ? 1 : a.slot - b.slot)).map((m) => (m.id === account?.uid ? profile.name : m.name))
    : null;

  const demo = [
    { label: 'Teman mengikuti kamu', run: () => {
      const u = Object.keys(S.MOCK_USERS).find((x) => !social.friends.includes(x) && !social.incoming.includes(x));
      u ? apply((s) => S.demoIncomingRequest(s, u)) : toast('Semua user demo sudah jadi teman / mengikutimu', 'err'); setPanel(null); } },
    { label: 'Teman terima requestmu', run: () => { const u = social.sent[0]; u ? apply((s) => S.demoFriendAccepts(s, u)) : toast('Belum ada request terkirim', 'err'); setPanel(null); } },
    { label: 'Teman mengundang kamu', run: () => {
      const u = social.friends.find((x) => !social.gameInvites.includes(x) && social.party !== x);
      u ? apply((s) => S.demoIncomingInvite(s, u)) : toast('Butuh teman yang belum di party', 'err'); setPanel(null); } },
    { label: 'Teman terima undanganmu', run: () => { const u = social.invited[0]; u ? apply((s) => S.demoPartnerJoins(s, u)) : toast('Belum ada undangan terkirim', 'err'); setPanel(null); } },
    { label: 'Reset data teman', run: () => { setSocial(S.initialSocial); toast('Data teman direset'); setPanel(null); } },
  ];

  // Slot pemain sesuai mode: slot 0 = pemain lokal, slot berikutnya diisi anggota party (mock) bila ada, sisanya kosong.
  const roster = net ? buildSlots(net.maxPlayers as PlayerMode, [profile.name]) : buildSlots(mode, partner ? [profile.name, S.userName(partner)] : [profile.name]);
  const empty = openCount(roster);
  // Label "WAITING FOR PLAYER": di room online hitung dari pemain yang benar-benar online di server (bukan dari mode lokal yang selalu 1/N).
  const roomLive = online && lobbyRoom && roomView ? (() => { const c = roomCounts(roomView, lobbyRoom.maxPlayers); return { have: c.online, need: c.max }; })() : null;
  const waitHave = roomLive ? roomLive.have : mode - empty, waitNeed = roomLive ? roomLive.need : mode;
  const showWaiting = roomLive ? roomLive.have < roomLive.need : empty > 0;
  const begin = () => {
    void lockLandscape(true); // harus dipanggil di dalam gesture klik (syarat browser untuk fullscreen/orientation lock)
    setPlayMode(true);        // fallback putar-landscape (.rotfix) hanya aktif selama bermain
    setPlaying(true);         // layar Loading tampil langsung dan hilang tepat saat map selesai dimuat (tanpa jeda buatan)
  };
  const onPlay = () => { if (online && mode > 1) setPanel('room'); else if (empty > 0) setPanel('confirm'); else begin(); };
  // Room siap (host menekan Mulai / status room 'playing'): sambungkan transport Realtime lalu masuk game.
  const onRoomReady = async (room: RoomSession) => {
    if (handedOver.current) return; handedOver.current = true;
    try {
      const ns = await startNetSession(room, account!.uid!, profile.name);
      setNet(ns); setLobbyRoom(null); close(); begin();
    } catch { toast('Gagal tersambung ke server multiplayer.', 'err'); handedOver.current = false; setLobbyRoom(null); close(); }
  };
  const onRoomGone = (msg: string) => { toast(msg, 'err'); setLobbyRoom(null); };
  const leaveRoomNow = () => { const r = lobbyRoom; if (r) void leaveRoom(r.roomId).catch(() => {}); setLobbyRoom(null); close(); };
  const pickMode = (m: PlayerMode) => {
    if (guest && m > 1) { needLogin(); return; }
    setMode(m); setSocial(S.setMode(social, m > 1 ? 'duo' : 'solo'));
    toast('Mode: ' + modeLabel(m)); close();
  };
  const onGuest = () => { const s: Session = { kind: 'guest' }; saveSession(s); setSession(s); };
  const onAuthed = (u: AuthUser) => {
    const s: Session = { kind: 'account', user: u }; saveSession(s); setSession(s);
    const n = u.name.trim().slice(0, 16);
    const dn = (u.displayName || n).trim().slice(0, 16);
    if (dn.length >= 3) setProfile((p) => (p.name === 'PLAYER' ? { ...p, name: dn } : p)); // display name pilihan pemain tidak ditimpa
  };
  const signOut = () => { if (lobbyRoom) void leaveRoom(lobbyRoom.roomId).catch(() => {}); setLobbyRoom(null); authProvider.logout().catch(() => {}); void resetSupabase(); saveSession(null); setSession(null); };

  const leaveGame = () => { setPlayMode(false); unlockLandscape(); setPlaying(false); const n = net; setNet(null); void n?.leave(); }; // kembali ke lobby: orientasi dibebaskan, layout portrait dipulihkan
  if (playing) return <PlayScene roster={roster} net={net} onExit={leaveGame} />;

  return (
    <>
    <div className="lobbyroot">
      <Stage req={req} hold={hold} duo={duo} partnerName={partner ? S.userName(partner) : null} selfName={profile.name} crew={crew}
        shiftX={!session && !portrait ? 0.2 : 0} shiftY={!session && portrait ? 0.16 : 0}
        onProgress={(p) => setLoadP(p)} onResult={onResult} />
      <div className={'hud' + (!session ? ' hudoff' : '')}>
        <div className="tl">
          <ProfileCard name={profile.name} id={account?.id ?? null} avatar={avatar} />
          <button className="gbtn" onClick={() => setPanel(charSel ? 'char' : 'soon')}>{charSel ? <Shirt size={18} /> : <Lock size={18} />} Karakter</button>
          <button className="gbtn small" onClick={() => setPanel('profile')}><Pencil size={14} /> Edit profile</button>
          {session?.kind === 'account'
            ? <button className="gbtn small" onClick={signOut}><LogOut size={14} /> Keluar akun</button>
            : <button className="gbtn small" onClick={signOut}><LogIn size={14} /> Masuk / Daftar</button>}
        </div>
        <div className="tr"><FriendsPanel locked={guest} social={social} onAdd={() => (guest ? needLogin() : setPanel('add'))} onOpen={(uid) => (guest ? needLogin() : setPanel({ friend: uid }))} onInvite={(uid) => (online ? void inviteOnline(uid) : apply((s) => S.inviteFriend(s, uid)))} /></div>
        <div className="br">
          <button className="gbtn big" onClick={() => setPanel('multi')}><Users size={22} /> {modeLabel(mode)}</button>
          <button className="gbtn big" onClick={onPlay}><Play size={22} /> Play</button>
        </div>
        {online && lobbyRoom && panel !== 'room' && (
          <button className="gbtn small roomchip" onClick={() => setPanel('room')} aria-label="Tampilkan room">
            <Eye size={14} /> ROOM {lobbyRoom.code} · {roomLive ? roomLive.have : 1}/{roomLive ? roomLive.need : lobbyRoom.maxPlayers}{syncErr ? ' ⚠' : ''}
          </button>
        )}
        {showWaiting && <div className="waiting">WAITING FOR PLAYER ({waitHave}/{waitNeed})</div>}
        {showDemo && <button className="gbtn small demo" onClick={() => setPanel('demo')}><Wrench size={14} /> Demo</button>}
      </div>
      {/* Di luar .hud (stacking context sendiri) supaya undangan/permintaan teman tampil DI ATAS modal; sebelumnya tertutup modal yang sedang terbuka. */}
      <Notifications social={guest ? S.initialSocial : social}
        onReq={(uid, ok) => (online ? void onReqAnswer(uid, ok) : apply((s) => (ok ? S.acceptRequest(s, uid) : S.rejectRequest(s, uid))))}
        onInv={(uid, ok) => (online ? void onInvAnswer(uid, ok) : apply((s) => (ok ? S.acceptGameInvite(s, uid) : S.rejectGameInvite(s, uid))))} />

      {panel === 'soon' && <ComingSoonModal onClose={close} />}
      {panel === 'char' && charSel && <CharacterModal modelName={meta?.name || null} loading={loadP} onModel={onModelFile} onResetModel={resetModel} onClose={close} />}
      {panel === 'profile' && <ProfileEditModal profile={profile} account={account} onSave={(p) => { setProfile(p); toast('Profil disimpan'); if (online) saveDisplayName(p.name).catch(() => toast('Nama belum tersinkron ke server', 'err')); }} onAvatar={onAvatarFile} onClose={close} />}
      {panel === 'add' && !guest && <AddFriendModal social={social} selfUid={account?.id ?? ''} onSend={(uid) => (online ? void onSendReq(uid) : apply((s) => S.sendRequest(s, uid)))} remote={online} onClose={close} />}
      {panel === 'multi' && <PlayerModeModal mode={mode} guest={guest} onPick={pickMode} onLogin={() => { close(); signOut(); }} onClose={close} onOnline={online ? () => setPanel('room') : undefined} />}
      {panel === 'room' && online && <RoomModal mode={mode} selfId={account!.uid!} room={lobbyRoom} view={roomView} syncErr={syncErr} onEnter={enterRoom} onStarted={(r) => { void onRoomReady(r); }} onLeave={leaveRoomNow} onHide={close} toast={toast} />}
      {panel === 'confirm' && (
        <Modal title="MULAI TANPA PEMAIN LAIN?" onClose={close}>
          <div className="note">{onlineConfigured() ? 'Masuk dengan akun untuk memakai room online.' : 'Server multiplayer belum dikonfigurasi (Firebase/Supabase).'} Game dimulai di mode {modeLabel(mode)} dengan {mode - empty} dari {mode} slot terisi; hanya kamu yang bisa dimainkan, slot lain tetap kosong.</div>
          <div className="row"><button className="gbtn" onClick={close}>Batal</button><button className="gbtn" onClick={() => { close(); begin(); }}><Play size={16} /> Mulai</button></div>
        </Modal>
      )}
      {panel === 'demo' && <DemoMenu actions={demo} onClose={close} />}
      {!guest && panel && typeof panel === 'object' && 'friend' in panel && (
        <FriendOptionsModal uid={panel.friend} social={social} onClose={close}
          onInvite={() => (online ? void inviteOnline(panel.friend) : apply((s) => S.inviteFriend(s, panel.friend)))} onRemove={() => (online ? void onRemoveFriend(panel.friend) : apply((s) => S.removeFriend(s, panel.friend)))} />
      )}
      <Toasts items={toasts} />
      {loadP !== null && panel !== 'char' && <div className="loading">Loading...</div>}
      <AuthScreen open={!session && booted} onGuest={onGuest} onAuthed={onAuthed} />
      <Splash ready={stageReady && fontsReady} progress={(fontsReady ? 0.1 : 0) + 0.9 * (stageReady ? 1 : (loadP ?? 0))} onDone={() => setBooted(true)} />
    </div>
    </>
  );
}
