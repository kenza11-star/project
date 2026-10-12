\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create schema tt; grant all on schema tt to public;
create table tt._r(ok boolean, msg text); grant all on tt._r to public;
create function tt.t(c boolean, m text) returns void language plpgsql security definer as $$ begin insert into tt._r values (coalesce(c,false), m); end $$;
create function tt.throws(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema tt to public;

-- profil (dibuat server = service_role)
set role service_role;
insert into profiles(id,public_id,username,display_name) values ('uA','10001','alice','alice'),('uB','10002','bob','bob'),('uC','10003','carol','carol'),('uD','10004','dave','dave'),('uE','10005','erin','erin'),('uX','10006','mallory','mallory');
select tt.t(tt.throws($$insert into profiles values ('uY','10001','zed','zed')$$) like '%unique%', 'public_id unik');
select tt.t(tt.throws($$insert into profiles values ('uZ','10009','ALICE','alice2')$$) is not null, 'username check huruf kecil');
select tt.t(tt.throws($$insert into profiles values ('uQ','10010','alice','alice3')$$) like '%unique%', 'username unik');

-- buat room
create table tt.room as select (create_room('uA','ABC234',3,12345)->>'room_id')::uuid as id;
select tt.t((select count(*) from room_members where room_id=(select id from tt.room) and slot=0 and user_id='uA')=1, 'host = slot 0');
select tt.t(tt.throws($$select create_room('uA','ABC235',5,1)$$) = 'invalid', 'max 5 ditolak');
select tt.t(tt.throws($$select create_room('nobody','ABC236',2,1)$$) = 'not_member', 'tanpa profil ditolak');
select tt.t(tt.throws($$select create_room('uB','abc237',2,1)$$) like '%check%', 'kode room format salah ditolak');
select tt.t(tt.throws($$select join_room('uB','ZZZ999')$$) = 'room_not_found', 'room tak ada');

-- gabung & kapasitas (max 3)
select tt.t((join_room('uB','ABC234')->>'slot')::int = 1, 'B slot 1');
select tt.t((join_room('uC','ABC234')->>'slot')::int = 2, 'C slot 2');
select tt.t(tt.throws($$select join_room('uD','ABC234')$$) = 'room_full', 'pemain ke-4 di room 3 ditolak (room_full)');
select tt.t((join_room('uB','ABC234')->>'slot')::int = 1, 'reconnect idempoten: B tetap slot 1');
select tt.t((select count(*) from room_members where room_id=(select id from tt.room) and left_at is null)=3, 'tetap 3 anggota aktif');

-- keluar -> slot dilepas -> pemain lain masuk
select leave_room('uB',(select id from tt.room));
select tt.t((join_room('uD','ABC234')->>'slot')::int = 1, 'slot B dipakai D setelah B keluar');
select tt.t(tt.throws($$select join_room('uE','ABC234')$$) = 'room_full', 'penuh lagi');
-- anggota stale (tanpa heartbeat) tidak menahan slot
update room_members set last_seen = now() - interval '200 seconds' where user_id='uC';
select tt.t((join_room('uE','ABC234')->>'slot')::int = 2, 'anggota stale diganti pemain baru');
select tt.t((heartbeat_room('uC',(select id from tt.room))->>'active')::boolean = false, 'C stale -> heartbeat active=false (harus join ulang)');
select tt.t((heartbeat_room('uE',(select id from tt.room))->>'active')::boolean = true, 'heartbeat anggota aktif');

-- start: hanya host
select tt.t(tt.throws(format($$select start_room('uD','%s')$$, (select id from tt.room))) = 'not_host', 'non-host tidak bisa start');
select tt.t(start_room('uA',(select id from tt.room))->>'status' = 'playing', 'host start');
select tt.t((select status from rooms where id=(select id from tt.room))='playing', 'status playing tersimpan');

-- host keluar -> host pindah
select leave_room('uA',(select id from tt.room));
select tt.t((select host_id from rooms where id=(select id from tt.room)) in ('uD','uE'), 'host dipindah ke anggota aktif');
select tt.t(tt.throws($$select join_room('uA','ABC234')$$) is null, 'A bisa join ulang');
select leave_room('uA',(select id from tt.room));
select leave_room('uD',(select id from tt.room)); select leave_room('uE',(select id from tt.room));
select tt.t((select status from rooms where id=(select id from tt.room))='closed', 'room kosong -> closed');
select tt.t(tt.throws($$select join_room('uA','ABC234')$$) = 'room_closed', 'join room closed ditolak');

-- satu room aktif per pemain
create table tt.room2 as select (create_room('uA','DEF456',2,7)->>'room_id')::uuid as id;
create table tt.room3 as select (create_room('uA','GHJ789',2,8)->>'room_id')::uuid as id;
select tt.t((select count(*) from room_members where user_id='uA' and left_at is null)=1, 'pemain hanya aktif di 1 room');
grant select on tt.room, tt.room2, tt.room3 to public;

-- ===== RLS: sebagai browser (authenticated) =====
select join_room('uB','GHJ789');
reset role;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"uB","role":"authenticated"}', false);
select tt.t((select count(*) from rooms)=1, 'B hanya melihat room miliknya');
select tt.t((select count(*) from room_members)=2, 'B melihat anggota room miliknya');
select tt.t((select count(*) from profiles)=2, 'B melihat profil diri + teman satu room saja (bukan semua pengguna)');
select tt.t(tt.throws($$update profiles set display_name='hacked' where id='uA'$$) like '%permission denied%', 'B tidak bisa UPDATE profil orang lain');
select tt.t(tt.throws($$update profiles set display_name='hacked' where id='uB'$$) like '%permission denied%', 'B tidak bisa UPDATE profil sendiri langsung (lewat API server)');
select tt.t(tt.throws($$insert into room_members values ((select id from rooms limit 1),'uB',3)$$) like '%permission denied%', 'tidak bisa INSERT anggota dari browser');
select tt.t(tt.throws($$delete from room_members$$) like '%permission denied%', 'tidak bisa DELETE anggota dari browser');
select tt.t(tt.throws($$update rooms set seed = 1$$) like '%permission denied%', 'tidak bisa mengubah room dari browser');
select tt.t(tt.throws($$select join_room('uB','GHJ789')$$) like '%permission denied%', 'browser tidak bisa memanggil join_room langsung');
select tt.t(tt.throws($$select create_room('uB','KKK222',2,1)$$) like '%permission denied%', 'browser tidak bisa memanggil create_room langsung');

select set_config('request.jwt.claims','{"sub":"uX","role":"authenticated"}', false);
select tt.t((select count(*) from rooms)=0 and (select count(*) from room_members)=0, 'orang luar (mallory) tidak melihat room apa pun');
select tt.t((select count(*) from profiles)=1, 'mallory hanya melihat profil sendiri');
reset role; set role anon;
select tt.t(tt.throws($$select * from profiles$$) like '%permission denied%', 'anon tidak bisa baca profiles');
reset role; set role authenticated;
select set_config('request.jwt.claims','{}', false);
select tt.t((select count(*) from rooms)=0, 'tanpa sub -> tidak melihat apa pun');

-- ===== Realtime authorization (kebijakan realtime.messages) =====
reset role; set role authenticated;
select set_config('request.jwt.claims','{"sub":"uB","role":"authenticated"}', false);
select set_config('realtime.topic', 'room:' || (select id from tt.room3) || ':u:uB', false);
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'broadcast','{}')$$) is null, 'B boleh menulis ke channel miliknya');
select set_config('realtime.topic', 'room:' || (select id from tt.room3) || ':u:uA', false);
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'broadcast','{}')$$) like '%row-level security%', 'B TIDAK boleh menulis ke channel milik A (anti-penyamaran)');
select set_config('realtime.topic', 'room:' || (select id from tt.room3) || ':ctl', false);
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'presence','{}')$$) is null, 'B boleh presence di channel ctl');
select set_config('realtime.topic', 'room:' || (select id from tt.room3) || ':x:foo', false);
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'broadcast','{}')$$) like '%row-level security%', 'topik asing ditolak');
select set_config('realtime.topic', 'room:' || (select id from tt.room3) || ':u:uA', false);
select tt.t((select count(*) from realtime.messages) >= 1, 'B (anggota) boleh membaca channel room');
select set_config('request.jwt.claims','{"sub":"uX","role":"authenticated"}', false);
select tt.t((select count(*) from realtime.messages)=0, 'orang luar tidak bisa membaca pesan room');
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'broadcast','{}')$$) like '%row-level security%', 'orang luar tidak bisa menulis ke room');
select set_config('realtime.topic', 'sampah', false);
select set_config('request.jwt.claims','{"sub":"uB","role":"authenticated"}', false);
select tt.t(tt.throws($$insert into realtime.messages(topic,extension,payload) values (current_setting('realtime.topic'),'broadcast','{}')$$) like '%row-level security%', 'topik rusak ditolak (tanpa error cast)');

reset role;
select case when ok then 'PASS ' else 'FAIL ' end || msg from tt._r order by ok, msg;
select 'HASIL: ' || count(*) filter (where ok) || ' lulus, ' || count(*) filter (where not ok) || ' gagal' from tt._r;
