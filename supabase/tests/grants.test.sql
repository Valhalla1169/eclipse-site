-- Self-asserting privilege tests (ADR 0003, extended by 0004 and 0005).
--
-- rls_policies / rls_hardening / access_model / history prove what RLS allows
-- GIVEN a role may touch a table at all. This file proves the GRANT layer
-- underneath is exactly as wide as the policies need: no wider (least
-- privilege, DESIGN.md 5.5) and no narrower (0001 granted nothing, so every
-- signed-in query on the live project failed).
--
-- Order: local_auth_harness.sql (strict platform defaults), 0001 to 0005, then
-- this file. Raises on failure, so `psql -v ON_ERROR_STOP=1 -f` gates CI.
--
-- A new table needs its row in every list below in the same change.
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
  and not has_table_privilege('authenticated', 'public.campaigns', 'delete'),
  'G2: authenticated can select/insert/update campaigns, NEVER delete (0004)');
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
  and not has_table_privilege('authenticated', 'public.characters', 'delete'),
  'G4: authenticated can select/insert/update characters, NEVER delete (0004)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaign_creators', 'select')
  and not has_table_privilege('authenticated', 'public.campaign_creators', 'insert')
  and not has_table_privilege('authenticated', 'public.campaign_creators', 'update')
  and not has_table_privilege('authenticated', 'public.campaign_creators', 'delete'),
  'G5: authenticated can only READ the creator allowlist, never change it (0005)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.character_history', 'select')
  and not has_table_privilege('authenticated', 'public.character_history', 'insert')
  and not has_table_privilege('authenticated', 'public.character_history', 'update')
  and not has_table_privilege('authenticated', 'public.character_history', 'delete'),
  'G6: authenticated can only READ character_history (0004)');

-- campaign_invites: column-level. The DM reads metadata, never the hash.
select pg_temp.expect(
  not has_table_privilege('authenticated', 'public.campaign_invites', 'select')
  and not has_table_privilege('authenticated', 'public.campaign_invites', 'insert')
  and not has_table_privilege('authenticated', 'public.campaign_invites', 'update')
  and not has_table_privilege('authenticated', 'public.campaign_invites', 'delete'),
  'G7: authenticated has no table-wide privilege on campaign_invites (0005)');
select pg_temp.expect(
  (select bool_and(has_column_privilege('authenticated', 'public.campaign_invites', c, 'select'))
   from unnest(array['id','campaign_id','label','created_at','expires_at','max_uses','use_count','revoked_at']) c),
  'G8: authenticated can read the invite metadata columns');
select pg_temp.expect(
  not has_column_privilege('authenticated', 'public.campaign_invites', 'code_hash', 'select')
  and not has_column_privilege('authenticated', 'public.campaign_invites', 'created_by', 'select'),
  'G9: authenticated cannot read code_hash or created_by');

-- ── no client role holds the dangerous or unused privileges ──────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters',
                      'public.campaign_creators','public.campaign_invites','public.character_history']) as t(tbl),
         unnest(array['anon','authenticated']) as r(role),
         unnest(array['truncate','references','trigger']) as p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  'G10: neither anon nor authenticated holds TRUNCATE, REFERENCES or TRIGGER on any table');

-- ── anon can do nothing ─────────────────────────────────────────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters',
                      'public.campaign_creators','public.campaign_invites','public.character_history']) as t(tbl),
         unnest(array['select','insert','update','delete']) as p(priv)
    where has_table_privilege('anon', t.tbl, p.priv)),
  'G11: anon has no select/insert/update/delete on any table');
select pg_temp.expect(
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')),
  'G12: anon can execute no function in public');

-- ── functions ───────────────────────────────────────────────────────────
select pg_temp.expect(
  has_function_privilege('authenticated', 'public.join_campaign(text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_player(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_invite(uuid,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_invite(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_dm_of_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_player_of_campaign(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_campaign_creator()', 'execute')
  and has_function_privilege('authenticated', 'public.shares_campaign_with(uuid)', 'execute'),
  'G13: authenticated can execute the RPCs and the RLS helper functions');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute')
  and not has_function_privilege('authenticated', 'public.characters_lock_identity()', 'execute')
  and not has_function_privilege('authenticated', 'public.snapshot_character()', 'execute')
  and not has_function_privilege('authenticated', 'public.generate_invite_code()', 'execute'),
  'G14: trigger functions and the invite-code generator are not executable by clients');

\echo ALL GRANT TESTS PASSED
rollback;
