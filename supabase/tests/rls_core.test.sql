-- Self-asserting core isolation tests: who can read and write whose data.
-- Replaces the original print-only rls_policies.test.sql (14 checks a human had to
-- compare by eye); every check here raises on failure, so it can gate CI.
--
-- Order: local_auth_harness.sql, all migrations, then this file. Seeds its own
-- data and rolls everything back.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm f1...01 runs C; alice f1...02 and bob f1...03 will join; eve f1...04 never does.
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'dm@c.test'),
  ('f1000000-0000-0000-0000-000000000002', 'alice@c.test'),
  ('f1000000-0000-0000-0000-000000000003', 'bob@c.test'),
  ('f1000000-0000-0000-0000-000000000004', 'eve@c.test');
insert into public.campaigns (id, dm_id, name) values
  ('f2000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-000000000001', 'Age of Eclipse');
insert into public.campaign_invites (campaign_id, code_hash, created_by, expires_at, max_uses) values
  ('f2000000-0000-0000-0000-0000000000c1', encode(sha256(convert_to('TABLE1', 'UTF8')), 'hex'),
   'f1000000-0000-0000-0000-000000000001', now() + interval '30 days', 10);

-- ═══ Joining ═════════════════════════════════════════════════════════════
select t.act_as('f1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select * from public.join_campaign('TABLE1')$q$, 1, 'C1: alice joins with a valid invite');
select t.act_as('f1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select * from public.join_campaign('TABLE1')$q$, 1, 'C2: bob joins with a valid invite');
select t.act_as('f1000000-0000-0000-0000-000000000004');
select t.expect_denied($q$select * from public.join_campaign('NOTREAL')$q$, 'C3: eve''s wrong code is refused');

-- alice and bob each create their character, as themselves
select t.act_as('f1000000-0000-0000-0000-000000000002');
select t.expect_affects($q$insert into public.characters (owner_id, campaign_id, character_name, data) values ('f1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-0000000000c1', 'Dana Voss', '{"hp":10}')$q$, 1, 'C4: alice creates her character');
select t.act_as('f1000000-0000-0000-0000-000000000003');
select t.expect_affects($q$insert into public.characters (owner_id, campaign_id, character_name, data) values ('f1000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-0000000000c1', 'Grix', '{"hp":8}')$q$, 1, 'C5: bob creates his character');

-- ═══ Reading ═════════════════════════════════════════════════════════════
select t.act_as('f1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.characters where owner_id = 'f1000000-0000-0000-0000-000000000002'$q$, 1, 'C6: alice reads her own character');
select t.expect_count($q$select 1 from public.characters where owner_id = 'f1000000-0000-0000-0000-000000000003'$q$, 0, 'C7: alice cannot read bob''s character, even by naming its owner');
select t.expect_count($q$select 1 from public.characters$q$, 1, 'C7b: an unfiltered read shows alice only her own');
select t.act_as('f1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.characters where campaign_id = 'f2000000-0000-0000-0000-0000000000c1'$q$, 2, 'C8: the DM reads every character in their campaign');
select t.act_as('f1000000-0000-0000-0000-000000000004');
select t.expect_count($q$select 1 from public.characters$q$, 0, 'C9: eve, who never joined, reads none');
select t.expect_count($q$select 1 from public.campaigns where id = 'f2000000-0000-0000-0000-0000000000c1'$q$, 0, 'C10: eve cannot read the campaign even by guessing its id');

-- ═══ Writing ═════════════════════════════════════════════════════════════
select t.act_as('f1000000-0000-0000-0000-000000000001');
select t.expect_affects($q$update public.characters set character_name = 'HACKED BY DM' where owner_id = 'f1000000-0000-0000-0000-000000000002'$q$, 0, 'C11: the DM cannot edit a player''s character (0 rows)');
select t.act_as('f1000000-0000-0000-0000-000000000003');
select t.expect_affects($q$update public.characters set character_name = 'HACKED BY BOB' where owner_id = 'f1000000-0000-0000-0000-000000000002'$q$, 0, 'C12: bob cannot edit alice''s character (0 rows)');
select t.act_as_superuser();
-- now() is frozen inside a transaction, so plant an old updated_at (triggers bypassed) to see it advance.
set local session_replication_role = replica;
update public.characters set updated_at = '2000-01-01' where owner_id = 'f1000000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
select t.act_as('f1000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set data = '{"hp":9}' where owner_id = 'f1000000-0000-0000-0000-000000000002'$q$, 1, 'C13: alice edits her own character');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.characters where owner_id = 'f1000000-0000-0000-0000-000000000002' and data = '{"hp":9}' and character_name = 'Dana Voss' and updated_at > '2000-01-02'$q$, 1,
  'C13b: the edit landed, nothing else changed, and the server advanced updated_at');
select t.act_as('f1000000-0000-0000-0000-000000000004');
select t.expect_denied($q$insert into public.campaign_players (campaign_id, player_id) values ('f2000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-000000000004')$q$, 'C14: a stranger cannot insert themselves into a campaign directly');

-- ═══ Removal ═════════════════════════════════════════════════════════════
select t.act_as('f1000000-0000-0000-0000-000000000001');
select t.expect_affects($q$select public.remove_player('f2000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-000000000003')$q$, 1, 'C15: the DM removes bob');
select t.expect_count($q$select 1 from public.characters where campaign_id = 'f2000000-0000-0000-0000-0000000000c1'$q$, 2, 'C16: the DM can still read bob''s sheet (needed for Restore)');
select t.expect_count($q$select 1 from public.campaign_players where campaign_id = 'f2000000-0000-0000-0000-0000000000c1'$q$, 1, 'C17: the active roster now shows only alice');
select t.act_as('f1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.characters where owner_id = 'f1000000-0000-0000-0000-000000000003'$q$, 1, 'C18: bob''s sheet still exists for him (removed, not deleted)');
select t.expect_count($q$select 1 from public.campaigns where id = 'f2000000-0000-0000-0000-0000000000c1'$q$, 0, 'C19: a removed player can no longer read the campaign itself');

\echo ALL CORE TESTS PASSED
rollback;
