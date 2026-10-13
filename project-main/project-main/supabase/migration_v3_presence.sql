-- =====================================================================================================
-- MIGRASI v3 PRESENCE  (jalankan SEKALI di Supabase Dashboard -> SQL Editor, SETELAH schema.sql / migration_v2)
-- Idempoten: aman dijalankan ulang. Isi yang sama juga ditambahkan di ujung schema.sql untuk proyek baru.
--
-- Masalah yang diperbaiki:
--   * Teman yang masih ada di room tampil "terputus" padahal aman. Penyebab: status ONLINE hanya berlaku 30 dtk sejak
--     heartbeat terakhir. Di HP, tab browser langsung dibekukan saat pemain pindah ke WhatsApp (menyalin / membagikan
--     kode room, membalas chat) -> heartbeat berhenti -> dalam 30 dtk dia dianggap putus dan avatar 3D-nya hilang.
--   * Undangan kedaluwarsa terlalu cepat (5 mnt) bila penerima sedang di aplikasi lain.
--
-- Perubahan (hanya untuk room berstatus 'waiting' / ruang tunggu; saat 'playing' angka lama tetap berlaku):
--   * ONLINE : 30 dtk -> 90 dtk
--   * kursi  : ditahan 120 dtk -> 300 dtk (anggota yang sebentar pindah aplikasi tidak kehilangan kursi / dikeluarkan)
--   * undangan berlaku 5 mnt -> 15 mnt
-- Saat pemain kembali ke game, klien langsung kirim heartbeat (lihat RoomModal) sehingga status ONLINE pulih seketika.
-- =====================================================================================================

create or replace function public.room_online_seconds(p_status text) returns int
language sql immutable as $$ select case when p_status = 'waiting' then 90 else 30 end $$;

create or replace function public.room_seat_seconds(p_status text) returns int
language sql immutable as $$ select case when p_status = 'waiting' then 300 else 120 end $$;

-- ---------- snapshot room ----------
create or replace function public.room_view(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'host_id', r.host_id, 'max_players', r.max_players, 'seed', r.seed,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.user_id, 'slot', m.slot, 'name', p.display_name, 'host', m.user_id = r.host_id,
               'online', m.last_seen > now() - make_interval(secs => public.room_online_seconds(r.status))) order by m.slot)
        from public.room_members m join public.profiles p on p.id = m.user_id
       where m.room_id = r.id and m.left_at is null
         and m.last_seen > now() - make_interval(secs => public.room_seat_seconds(r.status))), '[]'::jsonb))
  from public.rooms r where r.id = p_room;
$$;

-- ---------- join ----------
create or replace function public.join_room(p_uid text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_slot int; v_active int;
begin
  perform 1 from public.profiles where id = p_uid;
  if not found then raise exception 'not_member'; end if;
  select * into r from public.rooms where code = p_code for update;          -- kunci baris room: pendaftaran paralel diserialkan
  if not found then raise exception 'room_not_found'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  -- Saat MENUNGGU: lepas kursi yang sudah keluar / tak ada heartbeat > 300 dtk. Saat BERJALAN kursi tidak pernah dilepas (reconnect aman).
  if r.status = 'waiting' then
    delete from public.room_members
     where room_id = r.id and user_id <> p_uid
       and (left_at is not null or last_seen < now() - make_interval(secs => public.room_seat_seconds('waiting')));
  end if;
  select slot into v_slot from public.room_members where room_id = r.id and user_id = p_uid;
  if found then                                                                -- reconnect / gabung ulang: slot yang sama
    update public.room_members set left_at = null, last_seen = now() where room_id = r.id and user_id = p_uid;
  else
    if r.status = 'playing' then raise exception 'room_started'; end if;       -- pemain BARU tidak boleh masuk ke game yang sudah berjalan
    select count(*) into v_active from public.room_members where room_id = r.id;
    if v_active >= r.max_players then raise exception 'room_full'; end if;
    select min(s) into v_slot from generate_series(0, r.max_players - 1) s
     where s not in (select slot from public.room_members where room_id = r.id);
    insert into public.room_members(room_id, user_id, slot) values (r.id, p_uid, v_slot);
  end if;
  -- satu room aktif per pemain: keluar dari room lain (dan tutup bila kosong)
  update public.room_members set left_at = now() where user_id = p_uid and left_at is null and room_id <> r.id;
  return public.room_json(r, v_slot);
end $$;

-- ---------- start ----------
create or replace function public.start_room(p_uid text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_active int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host_id <> p_uid then raise exception 'not_host'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  if r.status = 'playing' then                                                 -- idempoten (tekan dua kali / retry jaringan)
    return jsonb_build_object('status', 'playing', 'players', (select count(*) from public.room_members where room_id = p_room and left_at is null));
  end if;
  update public.room_members set last_seen = now() where room_id = p_room and user_id = p_uid and left_at is null;
  select count(*) into v_active from public.room_members
   where room_id = p_room and left_at is null
     and last_seen > now() - make_interval(secs => public.room_online_seconds('waiting'));
  if v_active < 2 then raise exception 'not_ready'; end if;                    -- validasi di SERVER: minimal 2 pemain benar-benar aktif
  update public.rooms set status = 'playing', started_at = now() where id = p_room;
  return jsonb_build_object('status', 'playing', 'players', v_active);
end $$;

-- ---------- undangan ----------
create or replace function public.send_invite(p_uid text, p_to_public_id text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_to text; r public.rooms; v_active int; inv_id uuid; v_seat interval := make_interval(secs => public.room_seat_seconds('waiting'));
begin
  select id into v_to from public.profiles where public_id = p_to_public_id;
  if v_to is null then raise exception 'room_not_found'; end if;                -- dipetakan di API: "UID tidak ditemukan"
  if v_to = p_uid then raise exception 'invalid'; end if;
  if not exists (select 1 from public.friendships where a = least(p_uid, v_to) and b = greatest(p_uid, v_to) and status = 'accepted') then
    raise exception 'not_friend';
  end if;
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  if r.status = 'playing' then raise exception 'room_started'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = p_uid and left_at is null) then raise exception 'not_member'; end if;
  if exists (select 1 from public.room_members where room_id = p_room and user_id = v_to and left_at is null and last_seen > now() - v_seat) then
    return jsonb_build_object('status', 'already_in_room');
  end if;
  select count(*) into v_active from public.room_members where room_id = p_room and left_at is null and last_seen > now() - v_seat;
  if v_active >= r.max_players then raise exception 'room_full'; end if;
  update public.game_invites set status = 'expired' where from_id = p_uid and to_id = v_to and status = 'pending';
  insert into public.game_invites(from_id, to_id, room_id) values (p_uid, v_to, p_room) returning id into inv_id;
  return jsonb_build_object('status', 'pending', 'id', inv_id);
end $$;

create or replace function public.list_invites(p_uid text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'uid', p.public_id, 'name', p.display_name, 'created_at', i.created_at) order by i.created_at desc)
        from public.game_invites i join public.profiles p on p.id = i.from_id join public.rooms r on r.id = i.room_id
       where i.to_id = p_uid and i.status = 'pending' and i.created_at > now() - interval '15 minutes' and r.status = 'waiting'), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'uid', p.public_id, 'status', i.status))
        from public.game_invites i join public.profiles p on p.id = i.to_id join public.rooms r on r.id = i.room_id
       where i.from_id = p_uid and i.status <> 'expired' and i.created_at > now() - interval '15 minutes' and r.status <> 'closed'), '[]'::jsonb));
$$;

create or replace function public.respond_invite(p_uid text, p_invite uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.game_invites; r public.rooms; v_room jsonb;
begin
  select * into i from public.game_invites where id = p_invite and to_id = p_uid for update;
  if not found or i.status <> 'pending' then raise exception 'invite_gone'; end if;
  select * into r from public.rooms where id = i.room_id;
  if not found or r.status <> 'waiting' or i.created_at < now() - interval '15 minutes' then
    update public.game_invites set status = 'expired', responded_at = now() where id = p_invite;
    return jsonb_build_object('status', 'expired');                              -- tidak raise: perubahan 'expired' harus tersimpan
  end if;
  if p_accept then
    v_room := public.join_room(p_uid, r.code);
    update public.game_invites set status = 'accepted', responded_at = now() where id = p_invite;
    return jsonb_build_object('status', 'accepted', 'room', v_room);
  end if;
  update public.game_invites set status = 'declined', responded_at = now() where id = p_invite;
  return jsonb_build_object('status', 'declined');
end $$;

-- ---------- hak eksekusi ----------
revoke all on function public.room_online_seconds(text), public.room_seat_seconds(text),
  public.room_view(uuid), public.join_room(text, text), public.start_room(text, uuid),
  public.send_invite(text, text, uuid), public.list_invites(text), public.respond_invite(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.room_online_seconds(text), public.room_seat_seconds(text),
  public.room_view(uuid), public.join_room(text, text), public.start_room(text, uuid),
  public.send_invite(text, text, uuid), public.list_invites(text), public.respond_invite(text, uuid, boolean) to service_role;
