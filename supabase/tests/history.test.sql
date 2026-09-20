-- Self-asserting tests for 0004: no client deletes, and snapshot history
-- (docs/adr/0004). Order: local_auth_harness.sql, 0001 to 0005, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- Age every 'edit' snapshot of a character so the 10-minute throttle lets the
-- next edit snapshot again.
create function t.age_history(p_character uuid) returns void language sql as $$
  update public.character_history set saved_at = saved_at - interval '11 minutes' where character_id = p_character;
$$;

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm e...01 runs C1; pl e...02 is a player; other e...03 is a player in nothing.
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'dm@h.test'),
  ('e0000000-0000-0000-0000-000000000002', 'pl@h.test'),
  ('e0000000-0000-0000-0000-000000000003', 'other@h.test');
insert into public.campaigns (id, dm_id, name) values
  ('f0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000001', 'C1'),
  ('f0000000-0000-0000-0000-0000000000c2', 'e0000000-0000-0000-0000-000000000001', 'C2');
insert into public.campaign_players (campaign_id, player_id) values
  ('f0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-0000000000c2', 'e0000000-0000-0000-0000-000000000002');
insert into public.characters (id, owner_id, campaign_id, character_name, data) values
  ('99000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000c1', 'Dana', '{"v":1}');
grant select on all tables in schema public to anon;   -- see rls_hardening.test.sql

-- ═══ 1. No client can delete ═════════════════════════════════════════════
select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_denied($q$delete from public.characters where owner_id = 'e0000000-0000-0000-0000-000000000002'$q$, 'PH1: an owner cannot delete their own character');
select t.act_as('e0000000-0000-0000-0000-000000000001');
select t.expect_denied($q$delete from public.campaigns where id = 'f0000000-0000-0000-0000-0000000000c1'$q$, 'PH1b: a DM cannot delete their campaign');
select t.expect_denied($q$delete from public.characters$q$, 'PH1c: a DM cannot delete a player''s character');

-- ═══ 2. Snapshots on edit ════════════════════════════════════════════════
select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set data = '{"v":2}' where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH2: the owner edits the sheet');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit' and data = '{"v":1}'$q$, 1,
  'PH2b: the state BEFORE the edit was snapshotted');

select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set data = '{"v":3}' where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH3: a second edit soon after');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 1,
  'PH3b: ...adds no snapshot (at most one every 10 minutes)');

select t.age_history('99000000-0000-0000-0000-000000000001');
select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set data = '{"v":4}' where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH4: an edit after the window');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 2, 'PH4b: ...is snapshotted');
select t.expect_count($q$select 1 from public.character_history where data = '{"v":3}'$q$, 1, 'PH4c: with the state as it was just before');

select t.age_history('99000000-0000-0000-0000-000000000001');
select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set data = data where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH5: a save that changes nothing');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 2, 'PH5b: ...is not snapshotted');

select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_affects($q$update public.characters set character_name = 'Dana Voss' where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH6: renaming counts as an edit');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 3, 'PH6b: and is snapshotted');

-- ═══ 3. schema_version changes are ALWAYS snapshotted ════════════════════
select t.expect_affects($q$update public.characters set schema_version = 2 where id = '99000000-0000-0000-0000-000000000001'$q$, 1, 'PH7: a rules/layout migration bumps schema_version');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'schema_change' and schema_version = 1$q$, 1,
  'PH7b: the pre-migration sheet is snapshotted immediately, even inside the 10-minute window');

-- ═══ 4. Retention ═══════════════════════════════════════════════════════
do $$
begin
  for i in 1..40 loop
    perform t.age_history('99000000-0000-0000-0000-000000000001');
    update public.characters set data = jsonb_build_object('n', i) where id = '99000000-0000-0000-0000-000000000001';
  end loop;
end $$;
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 30,
  'PH8: after 40 more edits only the newest 30 edit snapshots remain');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'schema_change'$q$, 1,
  'PH8b: the schema_change snapshot is kept regardless');

-- ═══ 5. Restore ═════════════════════════════════════════════════════════
insert into public.characters (id, owner_id, campaign_id, character_name, data) values
  ('99000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000c2', 'Grix', '{"hp":10,"notes":"precious"}');
update public.characters set data = '{"hp":0,"notes":"BROKEN BY A BAD DEPLOY"}' where id = '99000000-0000-0000-0000-000000000002';
select t.expect_count($q$select 1 from public.characters where id = '99000000-0000-0000-0000-000000000002' and data->>'notes' = 'BROKEN BY A BAD DEPLOY'$q$, 1, 'PH9: a sheet gets damaged');
update public.characters c
   set data = h.data, schema_version = h.schema_version, character_name = h.character_name
  from public.character_history h
 where h.character_id = c.id and c.id = '99000000-0000-0000-0000-000000000002'
   and h.id = (select max(id) from public.character_history where character_id = c.id);
select t.expect_count($q$select 1 from public.characters where id = '99000000-0000-0000-0000-000000000002' and data = '{"hp":10,"notes":"precious"}'$q$, 1,
  'PH9b: the documented restore recipe brings it back exactly');

-- ═══ 6. Admin deletes are snapshotted; history survives ═════════════════
delete from public.characters where id = '99000000-0000-0000-0000-000000000002';
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000002' and reason = 'delete' and data = '{"hp":10,"notes":"precious"}'$q$, 1,
  'PH10: deleting a character (as admin) snapshots it first');
select t.expect_count($q$select 1 from public.characters where id = '99000000-0000-0000-0000-000000000002'$q$, 0, 'PH10b: the row is gone but its history is not');

insert into public.characters (id, owner_id, campaign_id, character_name, data) values
  ('99000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000c2', 'Cascade', '{"c":1}');
delete from public.campaigns where id = 'f0000000-0000-0000-0000-0000000000c2';
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000003' and reason = 'delete'$q$, 1,
  'PH11: deleting a whole campaign snapshots every character it cascades to');

-- ═══ 7. Who can see history, and that nobody can write it ═══════════════
select t.act_as('e0000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001'$q$, 31, 'PH12: an owner can read their own sheet''s history');
select t.expect_denied($q$insert into public.character_history (character_id, owner_id, campaign_id, schema_version, character_name, data, reason) values (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000c1', 1, 'x', '{}', 'edit')$q$, 'PH13: a client cannot write history');
select t.expect_denied($q$update public.character_history set data = '{}'$q$, 'PH13b: ...or edit it');
select t.expect_denied($q$delete from public.character_history$q$, 'PH13c: ...or delete it');
select t.act_as('e0000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001'$q$, 31, 'PH14: the DM can read the history of characters in their campaign');
select t.act_as('e0000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.character_history$q$, 0, 'PH15: an unrelated user sees no history');
select t.act_as_superuser();
set local role anon;
select t.expect_count($q$select 1 from public.character_history$q$, 0, 'PH15b: anon sees no history');
reset role;

select t.expect_count(
  $q$select 1 from pg_constraint where conrelid = 'public.character_history'::regclass and contype = 'f'$q$, 0,
  'PH16: history has no foreign key, so it outlives the row it describes');

-- ═══ 8. schema_change snapshots are bounded too (0006) ══════════════════
-- A member flipping the version in a loop used to store an unbounded number of
-- snapshots. Versions may only go up now, so climb from 2 to 42 as the owner.
do $$
begin
  perform t.act_as('e0000000-0000-0000-0000-000000000002');
  for v in 3..42 loop
    update public.characters set schema_version = v where id = '99000000-0000-0000-0000-000000000001';
  end loop;
  perform t.act_as_superuser();
end $$;
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'schema_change'$q$, 10,
  'PH17: after 40 more version bumps only the newest 10 schema_change snapshots remain');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'schema_change' and schema_version = 41$q$, 1,
  'PH17b: the newest one (the state just before the last bump) is among them');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 30,
  'PH17c: pruning schema_change snapshots leaves the 30 edit snapshots alone');
select t.expect_count($q$select 1 from public.character_history where character_id = '99000000-0000-0000-0000-000000000002' and reason = 'delete'$q$, 1,
  'PH17d: ...and never touches a delete snapshot');

\echo ALL HISTORY TESTS PASSED
rollback;
