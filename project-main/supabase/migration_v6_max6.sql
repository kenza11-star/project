-- v6: batas pemain per room naik dari 4 menjadi 6. Jalankan SEKALI di Supabase > SQL Editor (aman diulang).
alter table public.rooms drop constraint if exists rooms_max_players_check;
alter table public.rooms add constraint rooms_max_players_check check (max_players between 2 and 6);
alter table public.room_members drop constraint if exists room_members_slot_check;
alter table public.room_members add constraint room_members_slot_check check (slot between 0 and 5);

create or replace function public.create_room(p_uid text, p_code text, p_max int, p_seed bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if p_max not between 2 and 6 then raise exception 'invalid'; end if;
  perform 1 from public.profiles where id = p_uid;
  if not found then raise exception 'not_member'; end if;
  update public.room_members set left_at = now() where user_id = p_uid and left_at is null;
  insert into public.rooms(code, host_id, max_players, seed) values (p_code, p_uid, p_max, p_seed) returning * into r;
  insert into public.room_members(room_id, user_id, slot) values (r.id, p_uid, 0);
  return public.room_json(r, 0);
end $$;
