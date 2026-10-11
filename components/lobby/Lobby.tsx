'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Shirt, Users, Play, Wrench, Pencil } from 'lucide-react';
import Stage, { type ModelReq } from './Stage';
import PlayScene from './PlayScene';
import { lockLandscape } from '@/lib/game/orientation';
import DemoMenu from './DemoMenu';
import ProfileCard from '../profile/ProfileCard';
import ProfileEditModal from '../profile/ProfileEditModal';
import CharacterModal from '../character/CharacterModal';
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

type Panel = null | 'char' | 'profile' | 'add' | 'multi' | 'demo' | { friend: string };
interface Meta { name: string; ext: string; size: number }

export default function Lobby() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [social, setSocial] = useState<S.Social>(() => ({ ...S.initialSocial, ...load('social', {}) }));
  const [meta, setMeta] = useState<Meta | null>(() => load<Meta | null>('model', null));
  const [req, setReq] = useState<ModelReq | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [hold, setHold] = useState<boolean>(() => !!load<Meta | null>('model', null)); // true selama karakter tersimpan sedang dipulihkan
  const [panel, setPanel] = useState<Panel>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loadP, setLoadP] = useState<number | null>(null);
  const [trans, setTrans] = useState(false);
  const [playing, setPlaying] = useState(false);
  const urls = useRef<{ av: string | null }>({ av: null });
  // Tombol Demo (simulasi teman mock) hanya untuk development; tidak tampil di rilis
  const showDemo = process.env.NODE_ENV !== 'production';
  const close = useCallback(() => setPanel(null), []);

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
        const [m, a] = await Promise.all([fileStore.get('model'), fileStore.get('avatar')]);
        if (a) applyAvatar(a);
        if (m && meta) setReq({ id: 1, blob: m, ext: meta.ext, persist: false, name: meta.name, size: meta.size });
        else if (meta) { save('model', null); setMeta(null); } // metadata ada tapi file hilang
      } catch { /* IndexedDB tidak tersedia: lanjut tanpa */ }
      finally { setHold(false); }
    })();
    return () => { if (urls.current.av) URL.revokeObjectURL(urls.current.av); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => save('profile', profile), [profile]);
  useEffect(() => save('social', social), [social]);

  // ---- karakter ----
  const onModelFile = (f: File) => {
    const err = validateModelFile(f);
    if (err) { toast(err, 'err'); return; }
    setLoadP(0.05);
    setReq({ id: Date.now(), blob: f, ext: extOf(f.name), persist: true, name: f.name, size: f.size });
  };
  const onResult = useCallback(async (r: ModelReq | null, ok: boolean, msg?: string) => {
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
  const apply = (fn: (s: S.Social) => S.R) => { const [n, m, ok] = fn(social); setSocial(n); toast(m, ok ? 'ok' : 'err'); };
  const duo = social.mode === 'duo';
  const partner = duo && social.party ? social.party : null;

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

  const onPlay = () => {
    if (duo && !partner) { toast('Mode DUO butuh 1 teman di party', 'err'); return; }
    void lockLandscape(true); // harus dipanggil di dalam gesture klik Play (syarat browser untuk fullscreen/orientation lock)
    setTrans(true); setTimeout(() => { setPlaying(true); setTrans(false); }, 900);
  };
  const names = partner ? [profile.name, S.userName(partner)] : [profile.name];

  if (playing) return <PlayScene names={names} onExit={() => setPlaying(false)} />;

  return (
    <>
    <div className="lobbyroot">
      <Stage req={req} hold={hold} duo={duo} partnerName={partner ? S.userName(partner) : null} selfName={profile.name}
        onProgress={(p) => setLoadP(p)} onResult={onResult} />
      <div className="hud">
        <div className="tl">
          <ProfileCard name={profile.name} uid={profile.uid} avatar={avatar} />
          <button className="gbtn" onClick={() => setPanel('char')}><Shirt size={18} /> Karakter</button>
          <button className="gbtn small" onClick={() => setPanel('profile')}><Pencil size={14} /> Edit profile</button>
        </div>
        <div className="tr"><FriendsPanel social={social} onAdd={() => setPanel('add')} onOpen={(uid) => setPanel({ friend: uid })} onInvite={(uid) => apply((s) => S.inviteFriend(s, uid))} /></div>
        <Notifications social={social}
          onReq={(uid, ok) => apply((s) => (ok ? S.acceptRequest(s, uid) : S.rejectRequest(s, uid)))}
          onInv={(uid, ok) => apply((s) => (ok ? S.acceptGameInvite(s, uid) : S.rejectGameInvite(s, uid)))} />
        <div className="br">
          <button className="gbtn big" onClick={() => setPanel('multi')}><Users size={22} /> Multiplayer</button>
          <button className="gbtn big" onClick={onPlay}><Play size={22} /> Play</button>
        </div>
        {duo && !partner && <div className="waiting">WAITING FOR PLAYER</div>}
        {showDemo && <button className="gbtn small demo" onClick={() => setPanel('demo')}><Wrench size={14} /> Demo</button>}
      </div>

      {panel === 'char' && <CharacterModal modelName={meta?.name || null} loading={loadP} onModel={onModelFile} onResetModel={resetModel} onClose={close} />}
      {panel === 'profile' && <ProfileEditModal profile={profile} onSave={(p) => { setProfile(p); toast('Profil disimpan'); }} onAvatar={onAvatarFile} onClose={close} />}
      {panel === 'add' && <AddFriendModal social={social} selfUid={profile.uid} onSend={(uid) => apply((s) => S.sendRequest(s, uid))} onClose={close} />}
      {panel === 'multi' && (
        <Modal title="MULTIPLAYER" onClose={close}>
          <button className="gbtn big" onClick={() => { setSocial(S.setMode(social, 'duo')); toast('Mode DUO (maks 2 pemain)'); close(); }}>Duo</button>
          {duo && <button className="gbtn" onClick={() => { setSocial(S.setMode(social, 'solo')); toast('Mode SOLO'); close(); }}>Solo</button>}
          <button className="gbtn" onClick={close}>Back</button>
        </Modal>
      )}
      {panel === 'demo' && <DemoMenu actions={demo} onClose={close} />}
      {panel && typeof panel === 'object' && 'friend' in panel && (
        <FriendOptionsModal uid={panel.friend} social={social} onClose={close}
          onInvite={() => apply((s) => S.inviteFriend(s, panel.friend))} onRemove={() => apply((s) => S.removeFriend(s, panel.friend))} />
      )}
      <Toasts items={toasts} />
      {loadP !== null && panel !== 'char' && <div className="loading">MEMUAT MODEL {Math.round(loadP * 100)}%</div>}
      {trans && <div className="trans">MEMASUKI THE BACKROOMS...</div>}
    </div>
    </>
  );
}
