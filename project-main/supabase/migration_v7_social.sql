-- =====================================================================================================
-- MIGRASI v7 SOCIAL  (jalankan SEKALI di Supabase Dashboard -> SQL Editor, SETELAH v2-v6; aman diulang)
-- Isi: foto profil tersinkron (profiles.avatar), presence (profiles.last_seen / in_game), status + versi avatar di list_friends,
--      friend_avatars (ambil foto teman hanya bila berubah), dan cooldown undangan 5 dtk per teman di server (send_invite_cd).
-- =====================================================================================================
alter table public.profiles add column if not exists avatar    text;                 -- data-URL JPEG (maks ~40 KB, divalidasi di /api/profile)
alter table public.profiles add column if not exists avatar_at timestamptz;          -- penanda versi avatar: klien hanya mengambil ulang bila berubah
alter table public.profiles add column if not exists last_seen timestamptz;          -- heartbeat klien tiap 20 dtk
alter table public.profiles add column if not exists in_game   boolean not null default false;

-- Daftar teman + status. 'presence': online (last_seen < 40 dtk) | ingame (online dan in_game) | offline. 'av' = versi avatar (ms epoch) atau null; data avatar TIDAK ikut (berat, dipolling tiap 3 dtk).
create or replace function public.list_friends(p_uid text) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'uid', p.public_id, 'name', p.display_name, 'status', f.status,
      'incoming', (f.status = 'pending' and f.requested_by <> p_uid),
      'presence', case when p.last_seen is not null and p.last_seen > now() - interval '40 seconds'
                       then (case when p.in_game then 'ingame' else 'online' end) else 'offline' end,
      'av', case when p.avatar_at is null or p.avatar is null then null else (extract(epoch from p.avatar_at) * 1000)::bigint end
    ) order by p.display_name), '[]'::jsonb)
  from public.friendships f
  join public.profiles p on p.id = case when f.a = p_uid then f.b else f.a end
  where f.a = p_uid or f.b = p_uid;
$$;

-- Foto teman (hanya teman yang sudah diterima), per daftar UID 5 digit. Dipanggil klien hanya untuk teman yang versi avatarnya berubah.
create or replace function public.friend_avatars(p_uid text, p_ids text[]) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.public_id, p.avatar), '{}'::jsonb)
  from public.friendships f
  join public.profiles p on p.id = case when f.a = p_uid then f.b else f.a end
  where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted' and p.avatar is not null and p.public_id = any(p_ids);
$$;

-- Cooldown undangan 5 dtk per (pengirim, penerima), dijaga di server (tidak bisa dilewati lewat klien). Kunci advisory mencegah dua request bersamaan lolos.
create or replace function public.send_invite_cd(p_uid text, p_to_public_id text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_to text;
begin
  select id into v_to from public.profiles where public_id = p_to_public_id;
  if v_to is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_uid || ':' || v_to, 0));
    if exists (select 1 from public.game_invites where from_id = p_uid and to_id = v_to and created_at > now() - interval '5 seconds') then
      raise exception 'rate_limited';
    end if;
  end if;
  return public.send_invite(p_uid, p_to_public_id, p_room);
end $$;

revoke all on function public.list_friends(text), public.friend_avatars(text, text[]), public.send_invite_cd(text, text, uuid) from public, anon, authenticated;
grant execute on function public.list_friends(text), public.friend_avatars(text, text[]), public.send_invite_cd(text, text, uuid) to service_role;
