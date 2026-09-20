create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
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

-- Mirror the REAL platform's default table privileges, read from this
-- project's pg_default_acl (2026-09-19): a new table in `public` gives
-- anon/authenticated only TRUNCATE, REFERENCES, TRIGGER and MAINTAIN -- NOT
-- select/insert/update/delete. Data API access must be granted explicitly by
-- a migration (see 0003_grant_data_api_privileges.sql), and RLS policies then
-- narrow what those grants allow row by row.
--
-- The previous version of this harness granted authenticated full CRUD on
-- every table. That silently masked the fact that 0001/0002 granted nothing,
-- so every signed-in query on the live project failed with "permission
-- denied". Do not make this more permissive than the platform.
alter default privileges in schema public
  grant truncate, references, trigger, maintain on tables to anon, authenticated;

create publication supabase_realtime;
