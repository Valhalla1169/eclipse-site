create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Real Supabase projects grant table-level privileges to anon/authenticated
-- by default (ALTER DEFAULT PRIVILEGES, set up by Supabase's own bootstrap)
-- -- RLS policies then further restrict what those privileges actually let
-- a given row-level operation see/touch. This harness isn't a real Supabase
-- project, so it has to grant that baseline itself to test honestly.
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create publication supabase_realtime;
