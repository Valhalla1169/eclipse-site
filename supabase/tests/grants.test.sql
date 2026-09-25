-- Self-asserting privilege tests (ADR 0003, extended by 0004, 0005, 0011 and 0014).
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

-- The columns a role may write with the given privilege, sorted. A blanket
-- table-level grant would list every column, so exact equality also proves there
-- is no blanket grant.
create function pg_temp.cols(p_role text, p_table text, p_priv text) returns text[] language sql as $$
  select coalesce(array_agg(column_name::text order by column_name), '{}')
  from information_schema.columns
  where table_schema = 'public' and table_name = split_part(p_table, '.', 2)
    and has_column_privilege(p_role, p_table, column_name, p_priv);
$$;

-- ── tables: authenticated gets exactly what the app uses ─────────────────
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.profiles', 'select')
  and pg_temp.cols('authenticated', 'public.profiles', 'insert') = array['display_name','id']
  and pg_temp.cols('authenticated', 'public.profiles', 'update') = array['display_name']
  and not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'G1: profiles: write only id+display_name on insert, only display_name on update, never delete (0006)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaigns', 'select')
  and pg_temp.cols('authenticated', 'public.campaigns', 'insert') = array['dm_id','name']
  and pg_temp.cols('authenticated', 'public.campaigns', 'update') = array['name']
  and not has_table_privilege('authenticated', 'public.campaigns', 'delete'),
  'G2: campaigns: insert dm_id+name, update only name (so dm_id can never change), never delete (0004, 0006)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaign_players', 'select')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'insert')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'update')
  and not has_table_privilege('authenticated', 'public.campaign_players', 'delete'),
  'G3: authenticated can only READ campaign_players (writes go through RPCs)');
select pg_temp.expect(
  has_table_privilege('authenticated', 'public.characters', 'select')
  and pg_temp.cols('authenticated', 'public.characters', 'insert') = array['character_name','data','owner_id','schema_version']
  and pg_temp.cols('authenticated', 'public.characters', 'update') = array['character_name','data','owner_id','schema_version']
  and not has_table_privilege('authenticated', 'public.characters', 'delete'),
  'G4: characters: id, updated_at and deleted_at are never client-writable, and there is no delete (0004, 0006, 0009)');
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

select pg_temp.expect(
  has_table_privilege('authenticated', 'public.campaign_characters', 'select')
  and not has_table_privilege('authenticated', 'public.campaign_characters', 'insert')
  and not has_table_privilege('authenticated', 'public.campaign_characters', 'update')
  and not has_table_privilege('authenticated', 'public.campaign_characters', 'delete')
  and has_table_privilege('authenticated', 'public.departed_sheets', 'select')
  and not has_table_privilege('authenticated', 'public.departed_sheets', 'insert')
  and not has_table_privilege('authenticated', 'public.departed_sheets', 'update')
  and not has_table_privilege('authenticated', 'public.departed_sheets', 'delete'),
  'G6b: authenticated can only READ campaign_characters and departed_sheets (changes go through functions, 0009)');

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

-- site_admins and approved_emails: no client role touches them (0011). Supabase Auth
-- reads one column of approved_emails for the sign-up hook, and nothing else.
select pg_temp.expect(
  not exists (
    select 1 from unnest(array['public.site_admins','public.approved_emails']) as t(tbl)
    where pg_temp.cols('authenticated', t.tbl, 'select') <> '{}'
       or pg_temp.cols('authenticated', t.tbl, 'insert') <> '{}'
       or pg_temp.cols('authenticated', t.tbl, 'update') <> '{}'
       or has_table_privilege('authenticated', t.tbl, 'delete')),
  'G5b: authenticated cannot read or write site_admins or approved_emails, not even one column');
select pg_temp.expect(
  pg_temp.cols('supabase_auth_admin', 'public.approved_emails', 'select') = array['email','expires_at']
  and pg_temp.cols('supabase_auth_admin', 'public.approved_emails', 'insert') = '{}'
  and pg_temp.cols('supabase_auth_admin', 'public.approved_emails', 'update') = '{}'
  and not exists (
    select 1 from unnest(array['delete','truncate','references','trigger']) as p(priv)
    where has_table_privilege('supabase_auth_admin', 'public.approved_emails', p.priv)),
  'G5c: supabase_auth_admin reads only approved_emails.email and expires_at, and holds no other right on it');
select pg_temp.expect(
  pg_temp.cols('supabase_auth_admin', 'public.site_admins', 'select') = '{}'
  and pg_temp.cols('supabase_auth_admin', 'public.site_admins', 'insert') = '{}'
  and pg_temp.cols('supabase_auth_admin', 'public.site_admins', 'update') = '{}'
  and pg_temp.cols('supabase_auth_admin', 'public.site_admins', 'references') = '{}'
  and not exists (
    select 1 from unnest(array['delete','truncate','references','trigger']) as p(priv)
    where has_table_privilege('supabase_auth_admin', 'public.site_admins', p.priv)),
  'G5e: supabase_auth_admin holds no right at all on site_admins');
select pg_temp.expect(
  (select relrowsecurity from pg_class where oid = 'public.site_admins'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.approved_emails'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_admins')
  and (select array_agg(roles::text) from pg_policies where schemaname = 'public' and tablename = 'approved_emails') = array['{supabase_auth_admin}'],
  'G5d: RLS is on for both; site_admins has no policy, and approved_emails has one, for supabase_auth_admin only');

-- ── no client role holds the dangerous or unused privileges ──────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters',
                      'public.campaign_creators','public.campaign_invites','public.character_history',
                      'public.campaign_characters','public.departed_sheets','public.site_admins','public.approved_emails']) as t(tbl),
         unnest(array['anon','authenticated']) as r(role),
         unnest(array['truncate','references','trigger']) as p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  'G10: neither anon nor authenticated holds TRUNCATE, REFERENCES or TRIGGER on any table');

-- ── anon can do nothing ─────────────────────────────────────────────────
select pg_temp.expect(
  not exists (
    select 1
    from unnest(array['public.profiles','public.campaigns','public.campaign_players','public.characters',
                      'public.campaign_creators','public.campaign_invites','public.character_history',
                      'public.campaign_characters','public.departed_sheets','public.site_admins','public.approved_emails']) as t(tbl),
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
  and has_function_privilege('authenticated', 'public.shares_campaign_with(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.restore_character_version(bigint,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.choose_character(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_character(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.undelete_character(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.dm_sees_character(uuid,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.preview_invite(text)', 'execute')
  and has_function_privilege('authenticated', 'public.replace_invite(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_site_admin()', 'execute')
  and has_function_privilege('authenticated', 'public.approve_email(text)', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_approval(text)', 'execute')
  and has_function_privilege('authenticated', 'public.list_accounts()', 'execute')
  and has_function_privilege('authenticated', 'public.list_pending_approvals()', 'execute'),
  'G13: authenticated can execute the RPCs and the RLS helper functions');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute')
  and not has_function_privilege('authenticated', 'public.characters_lock_identity()', 'execute')
  and not has_function_privilege('authenticated', 'public.snapshot_character()', 'execute')
  and not has_function_privilege('authenticated', 'public.characters_enforce_limits()', 'execute')
  and not has_function_privilege('authenticated', 'public.freeze_sheet(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_invite_room(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'public.derive_display_name(jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.generate_invite_code()', 'execute')
  and not has_function_privilege('authenticated', 'public.email_has_account(text)', 'execute'),
  'G14: trigger functions and the invite-code generator are not executable by clients');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'public.characters_guard_schema_version()', 'execute'),
  'G15: the schema_version guard trigger function is not executable by clients (0006)');

select pg_temp.expect(
  has_function_privilege('supabase_auth_admin', 'public.hook_require_approved_email(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.hook_require_approved_email(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.hook_require_approved_email(jsonb)', 'execute')
  and not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname <> 'hook_require_approved_email'
      and has_function_privilege('supabase_auth_admin', p.oid, 'execute')),
  'G16: only Supabase Auth can execute the sign-up hook, and it can execute nothing else in public (0011)');
select pg_temp.expect(
  not (select prosecdef from pg_proc where oid = 'public.hook_require_approved_email(jsonb)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.hook_require_approved_email(jsonb)'::regprocedure) = array['search_path=""'],
  'G17: the sign-up hook runs with the rights of Supabase Auth, not its owner, and with an empty search_path');

\echo ALL GRANT TESTS PASSED
rollback;
