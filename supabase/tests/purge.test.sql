-- Self-asserting tests for 0013: purge_character() (docs/adr/0018).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm ...01 runs PG. owner ...02 and other ...03 are members. admin ...04 is a site
-- admin and is in no campaign.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-000000000001', 'dm@pg.test', '{"display_name": "The Keeper"}'),
  ('d1000000-0000-0000-0000-000000000002', 'owner@pg.test', '{"display_name": "Percy Owner"}'),
  ('d1000000-0000-0000-0000-000000000003', 'other@pg.test', '{"display_name": "Ozzy Other"}'),
  ('d1000000-0000-0000-0000-000000000004', 'admin@pg.test', '{"display_name": "Ada Admin"}');
insert into public.site_admins (user_id) values ('d1000000-0000-0000-0000-000000000004');
insert into public.campaigns (id, dm_id, name) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'PG');
insert into public.campaign_players (campaign_id, player_id) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'),
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003');
insert into public.characters (id, owner_id, character_name, data) values
  ('d3000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-000000000002', 'Live One', '{"a":1}'),
  ('d3000000-0000-0000-0000-0000000000a2', 'd1000000-0000-0000-0000-000000000002', 'Gone Girl', '{"g":1}'),
  ('d3000000-0000-0000-0000-0000000000a3', 'd1000000-0000-0000-0000-000000000002', 'Still Assigned', '{"s":1}');

-- ═══ 1. A live character cannot be purged ═══════════════════════════════
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a1')$q$,
  'cannot be purged', 'PG1: a live character cannot be purged');

-- ═══ 2. Set up an archived character with history and a departed copy ═══
update public.characters set data = '{"g":2}' where id = 'd3000000-0000-0000-0000-0000000000a2';  -- one edit snapshot
select t.expect_count($q$select 1 from (select public.choose_character('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000a2')) x$q$, 1,
  'PG2: the owner makes Gone Girl active in PG');
select t.expect_count($q$select 1 from (select public.leave_campaign('d2000000-0000-0000-0000-000000000001')) x$q$, 1,
  'PG2b: ...then leaves, which keeps the Keeper a copy');
select t.expect_count($q$select 1 from (select public.delete_character('d3000000-0000-0000-0000-0000000000a2')) x$q$, 1,
  'PG2c: now free of any campaign, the owner archives it');
select t.act_as_superuser();
-- Archiving only ever sets deleted_at, which the snapshot trigger does not watch
-- (ADR 0004 only tracks data, the name and schema_version), so only the edit is
-- snapshotted so far. purge_character's hard delete adds the 'delete' snapshot.
select t.expect_count($q$select 1 from public.character_history where character_id = 'd3000000-0000-0000-0000-0000000000a2' and reason = 'edit'$q$, 1,
  'PG2d: the edit is snapshotted');
select t.expect_count($q$select 1 from public.departed_sheets where character_id = 'd3000000-0000-0000-0000-0000000000a2'$q$, 1,
  'PG2e: the Keeper''s copy exists');

-- ═══ 3. Nobody else can purge it, and neither can the Keeper or an admin ═
select t.act_as('d1000000-0000-0000-0000-000000000003');
select t.expect_denied_with($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a2')$q$,
  'cannot be purged', 'PG3: another player cannot purge someone else''s archived character (they cannot even see it)');
select t.act_as('d1000000-0000-0000-0000-000000000001');
select t.expect_denied_with($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a2')$q$,
  'cannot be purged', 'PG3b: not even the Keeper of the campaign it once was in');
select t.act_as('d1000000-0000-0000-0000-000000000004');
select t.expect_denied_with($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a2')$q$,
  'cannot be purged', 'PG3c: not even a site admin');
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select public.purge_character('00000000-0000-0000-0000-000000000000')$q$,
  'cannot be purged', 'PG3d: an id that does not exist gives the same answer');

-- ═══ 4. A signed-out visitor is refused outright ════════════════════════
set local role anon;
select t.expect_denied($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a2')$q$, 'PG4: anon has no execute grant at all');
reset role;

-- ═══ 5. The defensive check: still active in a campaign ═════════════════
select t.act_as_superuser();
insert into public.campaign_players (campaign_id, player_id) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002');  -- Percy rejoins (they left in step 2)
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from (select public.choose_character('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000a3')) x$q$, 1,
  'PG5: Still Assigned is made active in PG');
select t.act_as_superuser();
update public.characters set deleted_at = now() where id = 'd3000000-0000-0000-0000-0000000000a3';  -- an anomaly: archived but still assigned
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select public.purge_character('d3000000-0000-0000-0000-0000000000a3')$q$,
  'cannot be purged', 'PG5b: archived but still active in a campaign is refused too');

-- ═══ 6. The owner purges Gone Girl: everything about it is gone, nothing else ═
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from (select public.purge_character('d3000000-0000-0000-0000-0000000000a2')) x$q$, 1,
  'PG6: the owner purges their own archived character');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.characters where id = 'd3000000-0000-0000-0000-0000000000a2'$q$, 0, 'PG6b: the row is gone');
select t.expect_count($q$select 1 from public.character_history where character_id = 'd3000000-0000-0000-0000-0000000000a2'$q$, 0,
  'PG6c: every history copy is gone, including the delete snapshot the trigger just made');
select t.expect_count($q$select 1 from public.departed_sheets where character_id = 'd3000000-0000-0000-0000-0000000000a2'$q$, 0,
  'PG6d: the Keeper''s copy is gone too');
select t.expect_count($q$select 1 from public.characters where id = 'd3000000-0000-0000-0000-0000000000a1' and data = '{"a":1}'$q$, 1,
  'PG6e: Live One is untouched');
select t.expect_count($q$select 1 from public.characters where owner_id = 'd1000000-0000-0000-0000-000000000002'$q$, 2,
  'PG6f: nothing else of the owner''s is gone (Live One and the still-assigned anomaly)');

-- ═══ 7. The log: who, when, the id, no name and no data ═════════════════
select t.expect_count($q$select 1 from public.character_purges where character_id = 'd3000000-0000-0000-0000-0000000000a2' and owner_id = 'd1000000-0000-0000-0000-000000000002' and purged_at is not null$q$, 1,
  'PG7: the log holds who, when, and the character''s id');
select t.expect_count($q$select 1 from information_schema.columns where table_schema = 'public' and table_name = 'character_purges'$q$, 4,
  'PG7b: the log has exactly four columns');
select t.expect_count($q$select 1 from information_schema.columns where table_schema = 'public' and table_name = 'character_purges' and column_name in ('id','character_id','owner_id','purged_at')$q$, 4,
  'PG7c: ...and none of them is a name or the sheet data');

-- ═══ 8. Only a site admin can list the log ═══════════════════════════════
select t.act_as('d1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select * from public.list_purges()$q$, 'only a site admin', 'PG8: the owner cannot list the purge log');
set local role anon;
select t.expect_denied($q$select * from public.list_purges()$q$, 'PG8b: anon cannot either');
reset role;
select t.act_as('d1000000-0000-0000-0000-000000000004');
select t.expect_count($q$select 1 from public.list_purges() where character_id = 'd3000000-0000-0000-0000-0000000000a2' and owner_name = 'Percy Owner'$q$, 1,
  'PG9: a site admin lists the log, with the owner''s display name');

-- ═══ 9. The 30-in-all limit frees a place ════════════════════════════════
select t.act_as('d1000000-0000-0000-0000-000000000002');
do $$
declare v uuid;
begin
  -- Percy already has Live One and the still-assigned anomaly (2 total, both
  -- already archived except Live One). Bring the total to 30 by making and
  -- archiving 28 more; the live count never passes 5.
  for i in 1..28 loop
    insert into public.characters (owner_id, character_name) values ('d1000000-0000-0000-0000-000000000002', 'Filler ' || i) returning id into v;
    perform public.delete_character(v);
  end loop;
end $$;
select t.expect_count($q$select 1 from public.characters where owner_id = 'd1000000-0000-0000-0000-000000000002'$q$, 30, 'PG10: thirty characters in all');
select t.expect_denied_with($q$insert into public.characters (owner_id, character_name) values ('d1000000-0000-0000-0000-000000000002', 'Thirty-one')$q$,
  'most one person can keep', 'PG10b: a thirty-first is refused');
select t.expect_count($q$select 1 from (select public.purge_character((select id from public.characters where owner_id = 'd1000000-0000-0000-0000-000000000002' and character_name = 'Filler 1'))) x$q$, 1,
  'PG10c: purging one archived character frees a place');
select t.expect_count($q$select 1 from public.characters where owner_id = 'd1000000-0000-0000-0000-000000000002'$q$, 29, 'PG10d: down to twenty-nine');
select t.expect_affects($q$insert into public.characters (owner_id, character_name) values ('d1000000-0000-0000-0000-000000000002', 'Thirty-one')$q$, 1,
  'PG10e: a new one now fits');

\echo ALL PURGE TESTS PASSED
rollback;
