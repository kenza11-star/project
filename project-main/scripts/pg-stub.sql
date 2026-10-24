-- STUB minimal lingkungan Supabase untuk menguji supabase/schema.sql di Postgres biasa. BUKAN bagian dari produksi.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists realtime;
grant usage on schema auth, realtime, public to anon, authenticated, service_role;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
create table if not exists realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb);
grant select, insert on realtime.messages to authenticated;
grant usage on all sequences in schema realtime to authenticated;
grant all on schema public to service_role;
-- Supabase memberi hak default ke ketiga role pada objek baru di schema public; tiru agar `revoke` di schema.sql benar-benar teruji.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
