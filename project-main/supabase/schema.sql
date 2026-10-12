-- =====================================================================================================
-- Skema Supabase untuk multiplayer (profil, room, anggota room) + RLS + Realtime Authorization.
-- Jalankan SEKALI di Supabase Dashboard -> SQL Editor (atau `supabase db push`). Idempoten sebagian besar (create if not exists / or replace).
--
-- Identitas: Firebase Auth lewat Supabase "Third-Party Auth". Di semua kebijakan, id pemain = klaim JWT `sub` = Firebase UID:
--     (select auth.jwt() ->> 'sub')
-- JWT Firebase HARUS berklaim role=authenticated; klaim ini dipasang oleh POST /api/auth/session (server, Firebase Admin).
--
-- Model akses:
--   * Browser (role authenticated, kunci anon + ID token) : HANYA BACA data room yang diikutinya. Tidak ada INSERT/UPDATE/DELETE dari browser.
--   * Server (service_role, hanya di Vercel server)       : semua tulis (buat/gabung/keluar/mulai room, buat profil) lewat fungsi SQL di bawah,
--                                                           setelah ID token diverifikasi Firebase Admin.
--   * Realtime (broadcast + presence, channel private)   : hanya anggota room yang boleh membaca; tiap pemain hanya boleh MENULIS ke channel
--                                                           miliknya sendiri (room:<id>:u:<uid>) sehingga tidak bisa menyamar sebagai pemain lain.
-- =====================================================================================================

-- ---------- tabel ----------
create table if not exists public.profiles (
  id           text primary key,                                               -- Firebase UID
  public_id    text not null unique check (public_id ~ '^[0-9]{5}$'),         -- "UID" 5 digit yang tampil di lobby
  username     text not null check (username ~ '^[a-z0-9_.-]{3,16}$'),
  display_name text not null check (char_length(display_name) between 3 and 16),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  host_id     text not null references public.profiles(id) on delete cascade,
  max_players smallint not null check (max_players between 2 and 4),
  seed        bigint not null check (seed between 0 and 4294967295),
  status      text not null default 'waiting' check (status in ('waiting','playing','closed')),
  created_at  timestamptz not null default now(),
  started_at  timestamptz
);

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   text not null references public.profiles(id) on delete cascade,
  slot      smallint not null check (slot between 0 and 3),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at   timestamptz,
  primary key (room_id, user_id),
  unique (room_id, slot)
);
create index if not exists room_members_user on public.room_members (user_id) where left_at is null;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ---------- helper (SECURITY DEFINER agar kebijakan tidak rekursif) ----------
create or replace function public.is_room_member(p_room uuid, p_uid text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_room is not null and p_uid is not null and exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = p_uid and m.left_at is null);
$$;
create or replace function public.shares_room(p_a text, p_b text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_a = p_b or exists (
    select 1 from public.room_members a join public.room_members b on a.room_id = b.room_id
    where a.user_id = p_a and b.user_id = p_b and a.left_at is null and b.left_at is null);
$$;
-- "room:<uuid>[:...]" -> uuid; null bila bentuk topik salah (kebijakan Realtime lalu menolak).
create or replace function public.rt_topic_room(p_topic text) returns uuid
language sql immutable as $$
  select case when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:.*)?$' then substr(p_topic, 6, 36)::uuid end;
$$;
revoke all on function public.is_room_member(uuid, text), public.shares_room(text, text) from public, anon;
grant execute on function public.is_room_member(uuid, text), public.shares_room(text, text), public.rt_topic_room(text) to authenticated;

-- ---------- RLS ----------
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_room((select auth.jwt() ->> 'sub'), id));       -- diri sendiri + anggota room yang sama; bukan seluruh pengguna
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(id, (select auth.jwt() ->> 'sub')));
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members for select to authenticated
  using (public.is_room_member(room_id, (select auth.jwt() ->> 'sub')));
-- Sengaja TIDAK ada policy insert/update/delete: browser tidak bisa mengubah profil/room/anggota (termasuk milik orang lain).
revoke insert, update, delete, truncate on public.profiles, public.rooms, public.room_members from anon, authenticated;
revoke all on public.profiles, public.rooms, public.room_members from anon;

-- ---------- fungsi tulis (hanya service_role, dipanggil dari API Vercel setelah token diverifikasi) ----------
create or replace function public.room_json(r public.rooms, p_slot int) returns jsonb language sql immutable as $$
  select jsonb_build_object('room_id', r.id, 'code', r.code, 'seed', r.seed, 'max_players', r.max_players, 'status', r.status, 'slot', p_slot, 'host_id', r.host_id);
$$;

create or replace function public.create_room(p_uid text, p_code text, p_max int, p_seed bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if p_max not between 2 and 4 then raise exception 'invalid'; end if;
  perform 1 from public.profiles where id = p_uid;
  if not found then raise exception 'not_member'; end if;
  update public.room_members set left_at = now() where user_id = p_uid and left_at is null;   -- satu room aktif per pemain
  insert into public.rooms(code, host_id, max_players, seed) values (p_code, p_uid, p_max, p_seed) returning * into r;
  insert into public.room_members(room_id, user_id, slot) values (r.id, p_uid, 0);
  return public.room_json(r, 0);
end $$;

create or replace function public.join_room(p_uid text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_slot int; v_active int;
begin
  perform 1 from public.profiles where id = p_uid;
  if not found then raise exception 'not_member'; end if;
  select * into r from public.rooms where code = p_code for update;          -- kunci baris room: pendaftaran paralel diserialkan
  if not found then raise exception 'room_not_found'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  -- lepas slot anggota yang sudah keluar / tidak ada heartbeat > 120 dtk (kecuali pemanggil sendiri)
  delete from public.room_members
   where room_id = r.id and user_id <> p_uid and (left_at is not null or last_seen < now() - interval '120 seconds');
  select slot into v_slot from public.room_members where room_id = r.id and user_id = p_uid;
  if found then                                                                -- reconnect / gabung ulang: slot yang sama
    update public.room_members set left_at = null, last_seen = now() where room_id = r.id and user_id = p_uid;
  else
    select count(*) into v_active from public.room_members where room_id = r.id;
    if v_active >= r.max_players then raise exception 'room_full'; end if;
    select min(s) into v_slot from generate_series(0, r.max_players - 1) s
     where s not in (select slot from public.room_members where room_id = r.id);
    update public.room_members set left_at = now() where user_id = p_uid and left_at is null and room_id <> r.id;
    insert into public.room_members(room_id, user_id, slot) values (r.id, p_uid, v_slot);
  end if;
  update public.room_members set left_at = now() where user_id = p_uid and left_at is null and room_id <> r.id;
  return public.room_json(r, v_slot);
end $$;

create or replace function public.leave_room(p_uid text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_next text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then return jsonb_build_object('left', false); end if;
  update public.room_members set left_at = now() where room_id = p_room and user_id = p_uid and left_at is null;
  if r.host_id = p_uid then                                                    -- host pergi: pindahkan ke anggota aktif slot terendah, atau tutup room
    select user_id into v_next from public.room_members where room_id = p_room and left_at is null order by slot limit 1;
    if v_next is null then update public.rooms set status = 'closed' where id = p_room;
    else update public.rooms set host_id = v_next where id = p_room; end if;
  elsif not exists (select 1 from public.room_members where room_id = p_room and left_at is null) then
    update public.rooms set status = 'closed' where id = p_room;
  end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.heartbeat_room(p_uid text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.room_members set last_seen = now() where room_id = p_room and user_id = p_uid and left_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('active', n > 0);                                  -- false -> klien harus gabung ulang
end $$;

create or replace function public.start_room(p_uid text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host_id <> p_uid then raise exception 'not_host'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  update public.rooms set status = 'playing', started_at = coalesce(started_at, now()) where id = p_room;
  return jsonb_build_object('status', 'playing');
end $$;

revoke all on function public.create_room(text, text, int, bigint), public.join_room(text, text), public.leave_room(text, uuid),
  public.heartbeat_room(text, uuid), public.start_room(text, uuid), public.room_json(public.rooms, int) from public, anon, authenticated;
grant execute on function public.create_room(text, text, int, bigint), public.join_room(text, text), public.leave_room(text, uuid),
  public.heartbeat_room(text, uuid), public.start_room(text, uuid), public.room_json(public.rooms, int) to service_role;

-- ---------- Realtime Authorization (channel PRIVATE: broadcast + presence) ----------
-- Topik: room:<roomId>:ctl (presence)  dan  room:<roomId>:u:<uid> (posisi milik <uid>).
alter table realtime.messages enable row level security;
drop policy if exists rt_room_read on realtime.messages;
create policy rt_room_read on realtime.messages for select to authenticated
  using (public.is_room_member(public.rt_topic_room((select realtime.topic())), (select auth.jwt() ->> 'sub')));
drop policy if exists rt_room_write on realtime.messages;
create policy rt_room_write on realtime.messages for insert to authenticated
  with check (
    public.is_room_member(public.rt_topic_room((select realtime.topic())), (select auth.jwt() ->> 'sub'))
    and (select realtime.topic()) in (
      'room:' || public.rt_topic_room((select realtime.topic()))::text || ':ctl',
      'room:' || public.rt_topic_room((select realtime.topic()))::text || ':u:' || (select auth.jwt() ->> 'sub'))
  );

-- ---------- Rate limit terdistribusi (berlaku lintas instance serverless) ----------
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table public.rate_limits enable row level security;         -- tanpa policy: hanya service_role (bypass RLS) yang bisa menyentuh
revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.rate_hit(p_key text, p_limit int, p_window_ms int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.rate_limits as t(key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when t.window_start < now() - make_interval(secs => p_window_ms / 1000.0) then 1 else t.hits + 1 end,
    window_start = case when t.window_start < now() - make_interval(secs => p_window_ms / 1000.0) then now() else t.window_start end
  returning hits into n;
  return n <= p_limit;                                              -- false = lewati batas
end $$;

-- ---------- Pembersihan room (dipanggil cron, lihat vercel.json + /api/cron/cleanup) ----------
create or replace function public.cleanup_rooms() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_closed int; v_deleted int; v_rates int;
begin
  -- anggota tanpa heartbeat > 5 menit dianggap pergi; room tanpa anggota aktif ditutup
  update public.room_members set left_at = now() where left_at is null and last_seen < now() - interval '5 minutes';
  update public.rooms r set status = 'closed'
   where status <> 'closed' and not exists (select 1 from public.room_members m where m.room_id = r.id and m.left_at is null);
  get diagnostics v_closed = row_count;
  -- host yang sudah pergi: pindahkan ke anggota aktif slot terendah
  update public.rooms r set host_id = (select m.user_id from public.room_members m where m.room_id = r.id and m.left_at is null order by m.slot limit 1)
   where status <> 'closed' and not exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = r.host_id and m.left_at is null);
  -- room 'waiting' yang menggantung > 3 jam ditutup; room tertutup > 1 hari dihapus (anggota ikut terhapus lewat cascade)
  update public.rooms set status = 'closed' where status = 'waiting' and created_at < now() - interval '3 hours';
  delete from public.rooms where status = 'closed' and created_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rates = row_count;
  return jsonb_build_object('closed', v_closed, 'deleted', v_deleted, 'rate_rows_purged', v_rates);
end $$;

-- ---------- Teman (nyata, menggantikan data contoh) ----------
-- Satu baris per pasangan; (a,b) selalu terurut a<b. requested_by = siapa yang mengirim permintaan.
create table if not exists public.friendships (
  a text not null references public.profiles(id) on delete cascade,
  b text not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  requested_by text not null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index if not exists friendships_b on public.friendships (b);
alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon, authenticated;   -- Supabase memberi hak default ke authenticated; cabut dulu baru beri SELECT saja
grant select on public.friendships to authenticated;
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.jwt() ->> 'sub') in (a, b));

create or replace function public.request_friend(p_uid text, p_public_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_other text; v_a text; v_b text; f public.friendships;
begin
  select id into v_other from public.profiles where public_id = p_public_id;
  if v_other is null then raise exception 'room_not_found'; end if;           -- dipetakan ke "tidak ditemukan"
  if v_other = p_uid then raise exception 'invalid'; end if;
  v_a := least(p_uid, v_other); v_b := greatest(p_uid, v_other);
  select * into f from public.friendships where a = v_a and b = v_b for update;
  if found then
    if f.status = 'pending' and f.requested_by <> p_uid then                   -- dia sudah meminta kita: otomatis diterima
      update public.friendships set status = 'accepted' where a = v_a and b = v_b;
      return jsonb_build_object('status', 'accepted');
    end if;
    return jsonb_build_object('status', f.status);
  end if;
  if (select count(*) from public.friendships where (a = p_uid or b = p_uid)) >= 100 then raise exception 'room_full'; end if;  -- batas 100 teman/permintaan
  insert into public.friendships(a, b, requested_by) values (v_a, v_b, p_uid);
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.respond_friend(p_uid text, p_other_public_id text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_other text; v_a text; v_b text; f public.friendships;
begin
  select id into v_other from public.profiles where public_id = p_other_public_id;
  if v_other is null then raise exception 'room_not_found'; end if;
  v_a := least(p_uid, v_other); v_b := greatest(p_uid, v_other);
  select * into f from public.friendships where a = v_a and b = v_b for update;
  if not found or f.status <> 'pending' or f.requested_by = p_uid then raise exception 'not_member'; end if;   -- hanya penerima yang boleh menjawab
  if p_accept then update public.friendships set status = 'accepted' where a = v_a and b = v_b;
  else delete from public.friendships where a = v_a and b = v_b; end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

create or replace function public.remove_friend(p_uid text, p_other_public_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_other text;
begin
  select id into v_other from public.profiles where public_id = p_other_public_id;
  if v_other is null then return jsonb_build_object('removed', false); end if;
  delete from public.friendships where a = least(p_uid, v_other) and b = greatest(p_uid, v_other);
  return jsonb_build_object('removed', true);
end $$;

-- Daftar teman + nama/UID mereka (join di server; tidak membuka tabel profiles ke klien).
create or replace function public.list_friends(p_uid text) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'uid', p.public_id, 'name', p.display_name, 'status', f.status,
      'incoming', (f.status = 'pending' and f.requested_by <> p_uid)) order by p.display_name), '[]'::jsonb)
  from public.friendships f
  join public.profiles p on p.id = case when f.a = p_uid then f.b else f.a end
  where f.a = p_uid or f.b = p_uid;
$$;

revoke all on function public.rate_hit(text, int, int), public.cleanup_rooms(), public.request_friend(text, text),
  public.respond_friend(text, text, boolean), public.remove_friend(text, text), public.list_friends(text) from public, anon, authenticated;
grant execute on function public.rate_hit(text, int, int), public.cleanup_rooms(), public.request_friend(text, text),
  public.respond_friend(text, text, boolean), public.remove_friend(text, text), public.list_friends(text) to service_role;
