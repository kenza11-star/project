-- =====================================================================================================
-- MIGRASI v4 ROOM CONSISTENCY  (OPSIONAL tapi disarankan; jalankan SEKALI di Supabase Dashboard -> SQL Editor, SETELAH v2 & v3)
-- Idempoten: aman dijalankan ulang.
--
-- Masalah: send_invite menjawab 'already_in_room' bila anggota masih memegang kursi (< 300 dtk), padahal tampilan room menganggap
-- anggota ONLINE hanya bila heartbeat < 90 dtk. Akibatnya host bisa dibilang "sudah ada di room" untuk pemain yang sebenarnya
-- tampil offline di layar host. Sekarang jawabannya menyertakan `online` (true/false) memakai aturan online yang SAMA dengan room_view.
-- Klien lama tetap jalan (field baru diabaikan).
-- =====================================================================================================
create or replace function public.send_invite(p_uid text, p_to_public_id text, p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_to text; r public.rooms; v_active int; inv_id uuid; v_seat interval := make_interval(secs => public.room_seat_seconds('waiting')); v_last timestamptz;
begin
  select id into v_to from public.profiles where public_id = p_to_public_id;
  if v_to is null then raise exception 'room_not_found'; end if;
  if v_to = p_uid then raise exception 'invalid'; end if;
  if not exists (select 1 from public.friendships where a = least(p_uid, v_to) and b = greatest(p_uid, v_to) and status = 'accepted') then
    raise exception 'not_friend';
  end if;
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.status = 'closed' then raise exception 'room_closed'; end if;
  if r.status = 'playing' then raise exception 'room_started'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = p_uid and left_at is null) then raise exception 'not_member'; end if;
  select last_seen into v_last from public.room_members where room_id = p_room and user_id = v_to and left_at is null and last_seen > now() - v_seat;
  if found then
    return jsonb_build_object('status', 'already_in_room', 'online', v_last > now() - make_interval(secs => public.room_online_seconds('waiting')));
  end if;
  select count(*) into v_active from public.room_members where room_id = p_room and left_at is null and last_seen > now() - v_seat;
  if v_active >= r.max_players then raise exception 'room_full'; end if;
  update public.game_invites set status = 'expired' where from_id = p_uid and to_id = v_to and status = 'pending';
  insert into public.game_invites(from_id, to_id, room_id) values (p_uid, v_to, p_room) returning id into inv_id;
  return jsonb_build_object('status', 'pending', 'id', inv_id);
end $$;

revoke all on function public.send_invite(text, text, uuid) from public, anon, authenticated;
grant execute on function public.send_invite(text, text, uuid) to service_role;
