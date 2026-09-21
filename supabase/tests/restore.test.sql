-- Self-asserting tests for 0008: restore_character_version() (docs/adr/0010).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

create function t.age_history(p_character uuid) returns void language sql as $$
  update public.character_history set saved_at = saved_at - interval '11 minutes' where character_id = p_character;
$$;

-- The sheet's current updated_at, as the page would have seen it.
create function t.stamp(p_character uuid) returns timestamptz language sql as $$
  select updated_at from public.characters where id = p_character;
$$;

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm ...01 runs C1. pl ...02 and pl2 ...04 are members. out ...03 is in nothing.
-- gone ...05 has a sheet but is in no campaign.
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'dm@r.test'),
  ('e1000000-0000-0000-0000-000000000002', 'pl@r.test'),
  ('e1000000-0000-0000-0000-000000000003', 'out@r.test'),
  ('e1000000-0000-0000-0000-000000000004', 'pl2@r.test'),
  ('e1000000-0000-0000-0000-000000000005', 'gone@r.test');
insert into public.campaigns (id, dm_id, name) values
  ('f1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000001', 'C1');
insert into public.campaign_players (campaign_id, player_id) values
  ('f1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000004');
insert into public.characters (id, owner_id, character_name, data) values
  ('98000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'Dana', '{"v":1}'),
  ('98000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'Gone', '{"g":1}');
grant select on all tables in schema public to anon;

-- Give the owner three edits: v1 is snapshotted at the first (the 10-minute window
-- then starts), and v2 is the state at the moment the page was opened.
select t.act_as('e1000000-0000-0000-0000-000000000002');
update public.characters set data = '{"v":2}', character_name = 'Dana Voss' where id = '98000000-0000-0000-0000-000000000001';
update public.characters set data = '{"v":3}' where id = '98000000-0000-0000-0000-000000000001';
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 1,
  'RS0: the first edit snapshotted v1; the second, inside the window, did not');

-- ═══ 1. The owner restores ══════════════════════════════════════════════
select t.act_as('e1000000-0000-0000-0000-000000000002');
select t.expect_count(
  $q$select 1 from (select public.restore_character_version(
       (select id from public.character_history where character_id = '98000000-0000-0000-0000-000000000001' and reason = 'edit'),
       t.stamp('98000000-0000-0000-0000-000000000001'))) x$q$, 1,
  'RS1: the owner restores their earlier version');
select t.expect_count($q$select 1 from public.characters where id = '98000000-0000-0000-0000-000000000001' and data = '{"v":1}' and character_name = 'Dana'$q$, 1,
  'RS1b: the sheet holds the earlier data and name exactly');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000001' and reason = 'restore' and data = '{"v":3}' and character_name = 'Dana Voss'$q$, 1,
  'RS2: the state just before the restore is snapshotted, though an edit snapshot was made under 10 minutes ago');
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000001' and reason = 'edit'$q$, 1,
  'RS2b: ...and it did not count as an edit snapshot');

-- ═══ 2. A restore can be undone ═════════════════════════════════════════
select t.act_as('e1000000-0000-0000-0000-000000000002');
select t.expect_count(
  $q$select 1 from (select public.restore_character_version(
       (select id from public.character_history where character_id = '98000000-0000-0000-0000-000000000001' and reason = 'restore'),
       t.stamp('98000000-0000-0000-0000-000000000001'))) x$q$, 1,
  'RS3: restoring the restore snapshot undoes the restore');
select t.expect_count($q$select 1 from public.characters where id = '98000000-0000-0000-0000-000000000001' and data = '{"v":3}' and character_name = 'Dana Voss'$q$, 1,
  'RS3b: the sheet is back as it was before');

-- ═══ 3. It never overwrites a save it has not seen ══════════════════════
select t.expect_denied_with(
  $q$select public.restore_character_version(
       (select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000001'),
       '2000-01-01T00:00:00Z')$q$,
  'changed since you opened it', 'RS4: a stale updated_at is refused');
select t.expect_denied_with(
  $q$select public.restore_character_version((select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000001'), null)$q$,
  'changed since you opened it', 'RS4b: no updated_at at all is refused');
select t.expect_count($q$select 1 from public.characters where id = '98000000-0000-0000-0000-000000000001' and data = '{"v":3}'$q$, 1,
  'RS4c: a refused restore changes nothing');

-- ═══ 4. Only the owner ═════════════════════════════
select t.act_as('e1000000-0000-0000-0000-000000000004');
select t.expect_denied_with(
  $q$select public.restore_character_version((select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000001'), t.stamp('98000000-0000-0000-0000-000000000001'))$q$,
  'was not found', 'RS5: another player cannot restore someone else''s sheet');
select t.act_as('e1000000-0000-0000-0000-000000000001');
select t.expect_denied_with(
  $q$select public.restore_character_version((select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000001'), t.stamp('98000000-0000-0000-0000-000000000001'))$q$,
  'was not found', 'RS6: the DM cannot restore a player''s sheet (the DM never writes one)');
select t.act_as('e1000000-0000-0000-0000-000000000003');
select t.expect_denied_with(
  $q$select public.restore_character_version((select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000001'), now())$q$,
  'was not found', 'RS7: an unrelated user cannot');
select t.expect_denied_with($q$select public.restore_character_version(-1, now())$q$, 'was not found', 'RS8: an id that does not exist gives the same answer');

-- A person in no campaign restores their own sheet: it is theirs (ADR 0011).
select t.act_as_superuser();
update public.characters set data = '{"g":2}' where id = '98000000-0000-0000-0000-000000000005';
select t.act_as('e1000000-0000-0000-0000-000000000005');
select t.expect_count(
  $q$select 1 from (select public.restore_character_version((select id from public.character_history where character_id = '98000000-0000-0000-0000-000000000005'), t.stamp('98000000-0000-0000-0000-000000000005'))) x$q$, 1,
  'RS9: a person who is in no campaign can restore their own sheet');


-- ═══ 5. A deleted character cannot be restored this way ═════════════════
select t.act_as_superuser();
delete from public.characters where id = '98000000-0000-0000-0000-000000000005';
select t.act_as('e1000000-0000-0000-0000-000000000005');
select t.expect_denied_with(
  $q$select public.restore_character_version((select id from public.character_history where character_id = '98000000-0000-0000-0000-000000000005' and reason = 'delete'), now())$q$,
  'no longer exists', 'RS10: a delete snapshot is not restorable by a client (bringing a character back is an owner task, ADR 0004)');

-- ═══ 6. It restores the version number with the data ════════════════════
select t.act_as_superuser();
insert into public.characters (id, owner_id, character_name, data) values
  ('98000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000004', 'Pia', '{"m":1}');
select t.act_as('e1000000-0000-0000-0000-000000000004');
update public.characters set schema_version = 3, data = '{"m":3}' where id = '98000000-0000-0000-0000-000000000006';
select t.expect_count(
  $q$select 1 from (select public.restore_character_version(
       (select id from public.character_history where character_id = '98000000-0000-0000-0000-000000000006' and reason = 'schema_change'),
       t.stamp('98000000-0000-0000-0000-000000000006'))) x$q$, 1,
  'RS11: a snapshot from before a rules update can be restored');
select t.expect_count($q$select 1 from public.characters where id = '98000000-0000-0000-0000-000000000006' and schema_version = 1 and data = '{"m":1}'$q$, 1,
  'RS11b: data and schema_version come back as a pair, so the app migrates it again on open');
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000006' and reason = 'restore' and schema_version = 3 and data = '{"m":3}'$q$, 1,
  'RS11c: the newer sheet is kept in a restore snapshot');

-- ═══ 7. Restore snapshots are bounded ═══════════════════════════════════
do $$
declare
  v_snap bigint;
begin
  select id into v_snap from public.character_history where character_id = '98000000-0000-0000-0000-000000000006' and reason = 'schema_change';
  for i in 1..12 loop
    update public.characters set data = jsonb_build_object('n', i) where id = '98000000-0000-0000-0000-000000000006';
    perform public.restore_character_version(v_snap, t.stamp('98000000-0000-0000-0000-000000000006'));
  end loop;
end $$;
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000006' and reason = 'restore'$q$, 10,
  'RS12: only the newest 10 restore snapshots are kept');
select t.expect_count($q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000006' and reason = 'schema_change'$q$, 1,
  'RS12b: ...and the snapshots it restored from are untouched');

-- ═══ 8. The restore flag does not leak into later edits ═════════════════
select t.act_as_superuser();
select t.age_history('98000000-0000-0000-0000-000000000006');
select t.act_as('e1000000-0000-0000-0000-000000000004');
update public.characters set data = '{"later":true}' where id = '98000000-0000-0000-0000-000000000006';
select t.expect_count(
  $q$select 1 from public.character_history where character_id = '98000000-0000-0000-0000-000000000006'
       and id = (select max(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000006') and reason = 'edit'$q$, 1,
  'RS13: an ordinary edit after a restore is an ordinary edit snapshot');

-- ═══ 9. A deleted (hidden) character cannot be restored ═════════════════
select t.act_as_superuser();
update public.characters set deleted_at = now() where id = '98000000-0000-0000-0000-000000000006';
select t.act_as('e1000000-0000-0000-0000-000000000004');
select t.expect_denied_with(
  $q$select public.restore_character_version((select min(id) from public.character_history where character_id = '98000000-0000-0000-0000-000000000006'), t.stamp('98000000-0000-0000-0000-000000000006'))$q$,
  'is deleted', 'RS13b: a deleted character has to be brought back first');
select t.act_as_superuser();

-- ═══ 10. Privileges ══════════════════════════════════════════════════════
select t.act_as_superuser();
select t.expect_count($q$select 1 where has_function_privilege('authenticated', 'public.restore_character_version(bigint,timestamptz)', 'execute')$q$, 1,
  'RS14: signed-in users can call it');
select t.expect_count($q$select 1 where not has_function_privilege('anon', 'public.restore_character_version(bigint,timestamptz)', 'execute')$q$, 1,
  'RS14b: anon cannot');

\echo ALL RESTORE TESTS PASSED
rollback;
