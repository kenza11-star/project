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

-- ===== rate limit terdistribusi =====
reset role; set role service_role;
select tt.t(rate_hit('k1',3,60000) and rate_hit('k1',3,60000) and rate_hit('k1',3,60000), '3 hit pertama lolos');
select tt.t(not rate_hit('k1',3,60000), 'hit ke-4 ditolak');
select tt.t(rate_hit('k2',3,60000), 'kunci lain terpisah');
update rate_limits set window_start = now() - interval '2 minutes' where key='k1';
select tt.t(rate_hit('k1',3,60000), 'jendela baru mereset hitungan');
reset role; set role authenticated;
select tt.t(tt.throws($$select rate_hit('x',1,1000)$$) like '%permission denied%', 'klien tidak bisa memanggil rate_hit');
select tt.t(tt.throws($$select * from rate_limits$$) like '%permission denied%', 'klien tidak bisa membaca rate_limits');

-- ===== cleanup_rooms =====
reset role; set role service_role;
create table tt.cr as select (create_room('uD','CMN234',2,1)->>'room_id')::uuid as id;
select join_room('uE','CMN234');
update room_members set last_seen = now() - interval '10 minutes' where room_id=(select id from tt.cr) and user_id='uD';   -- host basi
select cleanup_rooms();
select tt.t((select host_id from rooms where id=(select id from tt.cr))='uE', 'host basi diganti anggota aktif');
select tt.t((select left_at is not null from room_members where room_id=(select id from tt.cr) and user_id='uD'), 'anggota basi ditandai keluar');
update room_members set last_seen = now() - interval '10 minutes' where room_id=(select id from tt.cr);
select cleanup_rooms();
select tt.t((select status from rooms where id=(select id from tt.cr))='closed', 'room tanpa anggota aktif ditutup');
update rooms set created_at = now() - interval '2 days' where id=(select id from tt.cr);
select cleanup_rooms();
select tt.t((select count(*) from rooms where id=(select id from tt.cr))=0, 'room tertutup > 1 hari dihapus');
select tt.t((select count(*) from room_members where room_id=(select id from tt.cr))=0, 'anggota ikut terhapus (cascade)');
create table tt.cw as select (create_room('uD','QRS234',2,1)->>'room_id')::uuid as id;
update rooms set created_at = now() - interval '4 hours' where id=(select id from tt.cw);
select cleanup_rooms();
select tt.t((select status from rooms where id=(select id from tt.cw))='closed', 'room waiting > 3 jam ditutup');
reset role; set role authenticated;
select tt.t(tt.throws($$select cleanup_rooms()$$) like '%permission denied%', 'klien tidak bisa memanggil cleanup_rooms');

-- ===== teman =====
reset role; set role service_role;
select tt.t(request_friend('uA','10002')->>'status'='pending', 'A -> B pending');
select tt.t(request_friend('uA','10002')->>'status'='pending', 'request ulang idempoten');
select tt.t(tt.throws($$select request_friend('uA','10001')$$)='invalid', 'tidak bisa berteman dengan diri sendiri');
select tt.t(tt.throws($$select request_friend('uA','99999')$$)='room_not_found', 'UID tak ada');
select tt.t(tt.throws($$select respond_friend('uA','10002',true)$$)='not_member', 'pengirim tidak bisa menerima requestnya sendiri');
select tt.t(tt.throws($$select respond_friend('uC','10002',true)$$)='not_member', 'pihak ketiga tidak bisa menjawab');
select tt.t((list_friends('uB')->0->>'incoming')::boolean, 'B melihat request masuk dari alice');
select tt.t((list_friends('uB')->0->>'uid')='10001' and (list_friends('uB')->0->>'status')='pending', 'daftar B: alice pending');
select tt.t(respond_friend('uB','10001',true)->>'status'='accepted', 'B menerima');
select tt.t((list_friends('uA')->0->>'status')='accepted', 'A melihat B sebagai teman');
select tt.t(request_friend('uC','10001')->>'status'='pending' and request_friend('uA','10003')->>'status'='accepted', 'request silang otomatis diterima');
select tt.t(remove_friend('uA','10003')->>'removed'='true' and jsonb_array_length(list_friends('uC'))=0, 'hapus teman');
select request_friend('uD','10001');
select tt.t(respond_friend('uA','10004',false)->>'status'='declined' and jsonb_array_length(list_friends('uD'))=0, 'tolak menghapus request');
-- RLS: klien hanya melihat barisnya sendiri
reset role; set role authenticated;
select set_config('request.jwt.claims','{"sub":"uA","role":"authenticated"}', false);
select tt.t((select count(*) from friendships)=1, 'A hanya melihat pertemanannya (1 baris)');
select set_config('request.jwt.claims','{"sub":"uX","role":"authenticated"}', false);
select tt.t((select count(*) from friendships)=0, 'orang luar tidak melihat friendships');
select tt.t(tt.throws($$insert into friendships values ('uA','uX','accepted','uA')$$) like '%permission denied%', 'klien tidak bisa menulis friendships langsung');
select tt.t(tt.throws($$select request_friend('uX','10001')$$) like '%permission denied%', 'klien tidak bisa memanggil request_friend');

-- ===== v5: sistem loker/lemari (locker_op, room_lockers_view, relay_sync membawa `lockers`) =====
-- CATATAN: blok ini ditulis untuk scripts/test-sql.sh (Postgres lokal + pg-stub.sql). Pada saat ditulis TIDAK ada Postgres di lingkungan kerja, jadi blok ini BELUM pernah dijalankan.
reset role; set role service_role;
create table tt.lroom as select (create_room('uB','LCK234',3,777)->>'room_id')::uuid as id;
select join_room('uC','LCK234'); select join_room('uD','LCK234');
select start_room('uB',(select id from tt.lroom));
select tt.t((locker_op('uB',(select id from tt.lroom),'Locker_01','enter')->>'ok')::boolean, 'loker KOSONG: B masuk');
select tt.t((locker_op('uC',(select id from tt.lroom),'Locker_01','enter')->>'ok')::boolean = false
        and locker_op('uC',(select id from tt.lroom),'Locker_01','enter')->>'owner' = 'uB'
        and locker_op('uC',(select id from tt.lroom),'Locker_01','enter')->>'reason' = 'occupied', 'loker TERISI: C ditolak, penghuni = B');
select tt.t((locker_op('uC',(select id from tt.lroom),'Locker_02','enter')->>'ok')::boolean
        and (room_lockers_view((select id from tt.lroom)))->>'Locker_01' = 'uB' and (room_lockers_view((select id from tt.lroom)))->>'Locker_02' = 'uC', 'C cari loker lain: berhasil; snapshot memuat keduanya');
select tt.t(tt.throws($$select locker_op('uX',(select id from tt.lroom),'Locker_01','enter')$$) = 'not_member', 'bukan anggota ditolak');
select tt.t(tt.throws($$select locker_op('uB',(select id from tt.lroom),'bad id','enter')$$) = 'invalid', 'id loker tidak sah ditolak');
select tt.t(tt.throws($$select locker_op('uB',(select id from tt.lroom),'Locker_01','bogus')$$) = 'invalid', 'aksi tidak sah ditolak');
select tt.t(tt.throws($$insert into room_lockers(room_id,locker_id,user_id) values ((select id from tt.lroom),'Locker_01','uD')$$) like '%unique%' or tt.throws($$insert into room_lockers(room_id,locker_id,user_id) values ((select id from tt.lroom),'Locker_01','uD')$$) like '%duplicate%', 'kunci unik (room, loker): dua pemegang satu loker DITOLAK DATABASE');
select tt.t(tt.throws($$insert into room_lockers(room_id,locker_id,user_id) values ((select id from tt.lroom),'Locker_77','uB')$$) like '%unique%' or tt.throws($$insert into room_lockers(room_id,locker_id,user_id) values ((select id from tt.lroom),'Locker_77','uB')$$) like '%duplicate%', 'kunci unik (room, pemain): satu pemain dua loker DITOLAK DATABASE');
select tt.t((locker_op('uB',(select id from tt.lroom),'Locker_03','enter')->'lockers') ? 'Locker_03' and not ((locker_op('uB',(select id from tt.lroom),'Locker_03','enter')->'lockers') ? 'Locker_01'), '1 pemain = 1 loker: B pindah ke Locker_03, Locker_01 bebas');
select tt.t((locker_op('uD',(select id from tt.lroom),'Locker_01','enter')->>'ok')::boolean, 'Locker_01 yang dilepas langsung bisa diambil D');
select tt.t((locker_op('uD',(select id from tt.lroom),'Locker_01','exit')->>'ok')::boolean and not (room_lockers_view((select id from tt.lroom)) ? 'Locker_01'), 'KELUAR: slot dibebaskan');
select tt.t(not (locker_op('uC',(select id from tt.lroom),null,'release')->'lockers' ? 'Locker_02'), 'TERTANGKAP (release): loker C dilepas');
select locker_op('uC',(select id from tt.lroom),'Locker_04','enter');
update room_members set last_seen = now() - interval '45 seconds' where user_id = 'uC' and room_id = (select id from tt.lroom);
select tt.t(not (room_lockers_view((select id from tt.lroom)) ? 'Locker_04'), 'DISCONNECT: pemegang tak online > 30 dtk -> klaim tidak tampil di snapshot');
select tt.t((locker_op('uD',(select id from tt.lroom),'Locker_04','enter')->>'ok')::boolean, 'DISCONNECT: pemain lain bisa mengambil loker yang ditinggal');
update room_lockers set renewed_at = now() - interval '45 seconds' where user_id = 'uD' and room_id = (select id from tt.lroom);
select tt.t(not (room_lockers_view((select id from tt.lroom)) ? 'Locker_04'), 'LEASE habis (45 dtk) walau pemegang online -> klaim tidak hidup');
select locker_op('uB',(select id from tt.lroom),'Locker_05','enter');
select tt.t(relay_sync('uD',(select id from tt.lroom),null,null,-1,false)->'lockers' ? 'Locker_05', 'relay_sync membawa snapshot lockers');
select leave_room('uB',(select id from tt.lroom));
select tt.t(not (relay_sync('uD',(select id from tt.lroom),null,null,-1,false)->'lockers' ? 'Locker_05'), 'pemain KELUAR room: klaimnya hilang dari snapshot');
reset role; set role authenticated;
select set_config('request.jwt.claims','{"sub":"uC","role":"authenticated"}', false);
select tt.t(tt.throws($$select * from room_lockers$$) like '%permission denied%', 'klien tidak bisa membaca room_lockers langsung');
select tt.t(tt.throws($$select locker_op('uC',(select id from tt.lroom),'Locker_01','enter')$$) like '%permission denied%', 'klien tidak bisa memanggil locker_op langsung (hanya lewat API server)');

reset role;
select case when ok then 'PASS ' else 'FAIL ' end || msg from tt._r order by ok, msg;
select 'HASIL: ' || count(*) filter (where ok) || ' lulus, ' || count(*) filter (where not ok) || ' gagal' from tt._r;
