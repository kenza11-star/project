-- =====================================================================================================
-- MIGRASI v5 LOCKERS  (jalankan SEKALI di Supabase Dashboard -> SQL Editor, SETELAH schema.sql / migration_v2, v3, v4)
-- Idempoten: aman dijalankan ulang. Isi yang sama juga ditambahkan di ujung schema.sql untuk proyek baru.
--
-- Menambahkan: tabel room_lockers, fungsi room_lockers_view() dan locker_op() (validasi otoritatif + anti-balapan),
-- dan menimpa relay_sync() agar balasannya membawa snapshot `lockers`. Tidak ada environment variable baru.
-- Tanpa migrasi ini sistem loker multiplayer MENOLAK sembunyi (gagal-aman: tidak pernah dua pemain di satu loker);
-- Single Player tidak terpengaruh. Cek di GET /api/status: table:room_lockers dan fn:locker_op harus "ok".
-- =====================================================================================================

-- ---------- v5: sistem loker/lemari multiplayer (maks 1 pemain per loker, diputuskan di SERVER) ----------
-- Satu baris = satu pemain sedang bersembunyi di satu loker. Dua kunci unik menegakkan aturan di tingkat database:
--   PRIMARY KEY (room_id, locker_id) -> satu loker tidak bisa dipegang dua pemain (balapan dua klaim serentak: salah satu PASTI ditolak)
--   UNIQUE (room_id, user_id)        -> satu pemain tidak bisa memegang dua loker
-- Klaim HIDUP = pemegang masih anggota room dan ONLINE (keluar / disconnect = lepas otomatis) DAN renewed_at < 40 dtk
-- (klien memperbarui tiap 10 dtk selama bersembunyi; jaring pengaman bila permintaan `exit` hilang). Angka 40 dtk harus sama dengan
-- LOCKER_LEASE_S di lib/net/lockers.ts dan blitz-relay/server.js.
create table if not exists public.room_lockers (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  locker_id  text not null check (locker_id ~ '^[A-Za-z0-9_.:@-]{1,64}$'),
  user_id    text not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  renewed_at timestamptz not null default now(),
  primary key (room_id, locker_id),
  unique (room_id, user_id)
);
alter table public.room_lockers enable row level security;                         -- tanpa policy: hanya service_role (lewat API server)
revoke all on public.room_lockers from public, anon, authenticated;

-- Snapshot klaim hidup { locker_id: user_id } (dipakai locker_op dan relay_sync; SATU definisi "hidup" untuk semua).
create or replace function public.room_lockers_view(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(l.locker_id, l.user_id), '{}'::jsonb)
    from public.room_lockers l
    join public.rooms r on r.id = l.room_id
    join public.room_members m on m.room_id = l.room_id and m.user_id = l.user_id
   where l.room_id = p_room
     and m.left_at is null
     and m.last_seen > now() - make_interval(secs => public.room_online_seconds(r.status))
     and l.renewed_at > now() - interval '40 seconds';
$$;

-- Operasi loker. p_action: 'enter' (klaim / perbarui lease), 'exit' (lepas loker ini), 'release' (lepas semua milik pemanggil: tertangkap / restart).
-- Mengembalikan {ok, reason, owner, lockers, server_time}. ok=false + reason='occupied' = loker dipegang pemain lain (owner).
-- Balapan: baris room dikunci (FOR UPDATE) sehingga semua operasi loker satu room berjalan BERURUTAN; kunci unik di tabel adalah lapis kedua.
create or replace function public.locker_op(p_uid text, p_room uuid, p_locker text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_owner text; v_ok boolean := true;
begin
  if p_action is null or p_action not in ('enter', 'exit', 'release') then raise exception 'invalid'; end if;
  if p_action in ('enter', 'exit') and (p_locker is null or p_locker !~ '^[A-Za-z0-9_.:@-]{1,64}$') then raise exception 'invalid'; end if;
  select * into r from public.rooms where id = p_room for update;                  -- serialkan operasi loker per room
  if not found then raise exception 'room_not_found'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  perform 1 from public.room_members where room_id = p_room and user_id = p_uid and left_at is null;
  if not found then raise exception 'not_member'; end if;
  update public.room_members set last_seen = now() where room_id = p_room and user_id = p_uid and left_at is null;   -- permintaan ini = bukti pemain hidup

  -- buang klaim basi: pemegang sudah keluar / disconnect (tidak online) atau lease habis
  delete from public.room_lockers l
   where l.room_id = p_room
     and (l.renewed_at <= now() - interval '40 seconds'
          or not exists (select 1 from public.room_members m
                          where m.room_id = l.room_id and m.user_id = l.user_id and m.left_at is null
                            and m.last_seen > now() - make_interval(secs => public.room_online_seconds(r.status))));

  if p_action = 'enter' then
    select user_id into v_owner from public.room_lockers where room_id = p_room and locker_id = p_locker;
    if v_owner is not null and v_owner <> p_uid then
      v_ok := false;                                                               -- terisi pemain lain: tidak boleh masuk
    else
      v_owner := null;
      delete from public.room_lockers where room_id = p_room and user_id = p_uid and locker_id <> p_locker;   -- satu pemain = satu loker
      insert into public.room_lockers(room_id, locker_id, user_id) values (p_room, p_locker, p_uid)
      on conflict (room_id, locker_id) do update set renewed_at = now() where public.room_lockers.user_id = p_uid;
    end if;
  elsif p_action = 'exit' then
    delete from public.room_lockers where room_id = p_room and locker_id = p_locker and user_id = p_uid;
  else
    delete from public.room_lockers where room_id = p_room and user_id = p_uid;
  end if;

  return jsonb_build_object('ok', v_ok, 'reason', case when v_ok then null else 'occupied' end, 'owner', v_owner,
                            'lockers', public.room_lockers_view(p_room), 'server_time', now());
end $$;

-- relay_sync sama dengan v2, ditambah `lockers` (snapshot klaim hidup) di balasan: semua pemain melihat status loker yang SAMA dari server.
create or replace function public.relay_sync(p_uid text, p_room uuid, p_state jsonb, p_world jsonb, p_since bigint, p_need boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; v_states jsonb; v_world jsonb; v_cursor bigint; v_max bigint; v_need boolean; w jsonb; v_since bigint := coalesce(p_since, -1);
begin
  update public.room_members
     set last_seen = now(), relay_until = case when p_need then now() + interval '6 seconds' else null end
   where room_id = p_room and user_id = p_uid and left_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_member'; end if;

  if p_state is not null and jsonb_typeof(p_state) = 'object' then
    insert into public.room_pos(room_id, user_id, state, updated_at) values (p_room, p_uid, p_state, now())
    on conflict (room_id, user_id) do update set state = excluded.state, updated_at = now();
  end if;
  if p_world is not null and jsonb_typeof(p_world) = 'array' then
    for w in select * from jsonb_array_elements(p_world) limit 12 loop
      insert into public.room_world(room_id, user_id, msg) values (p_room, p_uid, w);
    end loop;
  end if;

  select coalesce(max(id), 0) into v_max from public.room_world where room_id = p_room;
  if v_since < 0 then v_since := greatest(0, v_max - 60); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'from', x.user_id, 'msg', x.msg) order by x.id), '[]'::jsonb), coalesce(max(x.id), v_since)
    into v_world, v_cursor
    from (select id, user_id, msg from public.room_world
           where room_id = p_room and id > v_since and user_id <> p_uid order by id limit 100) x;
  if jsonb_array_length(v_world) = 0 then v_cursor := greatest(v_since, v_max); end if;

  select coalesce(jsonb_object_agg(user_id, state), '{}'::jsonb) into v_states
    from public.room_pos where room_id = p_room and user_id <> p_uid and updated_at > now() - interval '15 seconds';
  select exists (select 1 from public.room_members where room_id = p_room and user_id <> p_uid and left_at is null and relay_until > now()) into v_need;

  if random() < 0.03 then delete from public.room_world where room_id = p_room and created_at < now() - interval '3 minutes'; end if;
  return public.room_view(p_room) || jsonb_build_object('active', true, 'states', v_states, 'world', v_world, 'cursor', v_cursor, 'need_relay', v_need, 'lockers', public.room_lockers_view(p_room));
end $$;

-- ---------- hak eksekusi ----------
revoke all on function public.room_lockers_view(uuid), public.locker_op(text, uuid, text, text),
  public.relay_sync(text, uuid, jsonb, jsonb, bigint, boolean) from public, anon, authenticated;
grant execute on function public.room_lockers_view(uuid), public.locker_op(text, uuid, text, text),
  public.relay_sync(text, uuid, jsonb, jsonb, bigint, boolean) to service_role;
