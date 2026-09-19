-- Self-asserting privilege tests for 0003 (explicit Data API grants).
--
-- rls_policies.test.sql and rls_hardening.test.sql prove what RLS allows GIVEN
-- a role may touch a table at all. This file proves the GRANT layer underneath
-- is exactly as wide as the policies need: no wider (least privilege,
-- DESIGN.md 5.5) and no narrower (0001 granted nothing, so every signed-in
-- query on the live project failed).
--
-- Order: local_auth_harness.sql (strict platform defaults), 0001, 0002, 0003,
-- then this file. Raises on failure, so `psql -v ON_ERROR_STOP=1 -f` gates CI.
\set ON_ERROR_STOP on
\pset tuples_only on

begin;

create function pg_temp.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
  raise notice 'ok   %', p_msg;
end $$;

-- ── tables: authenticated gets exactly what the app uses ─────────────────
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.profiles', 'select')
  and has_table_privilege('authenticated', 'public.profiles', 'insert')
  and has_table_privilege('authenticated', 'public.profiles', 'update')
  and not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'G1: authenticated can select/insert/update profiles, not delete');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaigns', 'select')
  and has_table_privilege('authenticated', 'public.campaigns', 'insert')
  and has_table_privilege('authenticated', 'public.campaigns', 'update')
  and has_table_privilege('authenticated', 'public.campaigns', 'delete'),
  'G2: authenticated has full CRUD on campaigns (RLS limits it to the DM)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaign_players', 'select')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'insert')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'update')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'delete'),
  'G3: authenticated can only READ campaign_players (writes go through RPCs)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.characters', 'select')
  and has_table_privilege('authenticated', 'public.characters', 'insert')
  and has_table_privilege('authenticated', 'public.characters', 'update')
  and has_table_privilege('authenticated', 'public.characters', 'delete'),
  'G4: authenticated has full CRUD on characters (RLS limits it to the owner)');

-- ── no client role holds the dangerous or unused privileges ──────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters']) as t(tbl),
         unnest(array['anon','authenticated']) as r(role),
         unnest(array['truncate','references','trigger']) as p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  'G5: neither anon nor authenticated holds TRUNCATE, REFERENCES or TRIGGER on any table');

-- ── anon can do nothing ─────────────────────────────────────────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters']) as t(tbl),
         unnest(array['select','insert','update','delete']) as p(priv)
    where has_table_privilege('anon', t.tbl, p.priv)),
  'G6: anon has no select/insert/update/delete on any table');

-- ── functions ───────────────────────────────────────────────────────────
select pg_temp.expect(
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')),
  'G7: anon can execute no function in public');
select pg_temp.expect(
  has_function_privilege('authenticated', 'public.join_campaign(text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_player(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_dm_of_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_player_of_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.generate_invite_code()', 'execute'),
  'G8: authenticated can execute the RPCs, the RLS helpers and the invite-code default');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute')
  and not has_function_privilege('authenticated', 'public.characters_lock_identity()', 'execute'),
  'G9: trigger functions are not executable by client roles');

\echo ALL GRANT TESTS PASSED
rollback;
