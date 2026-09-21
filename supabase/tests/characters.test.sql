-- Self-asserting tests for 0009: characters belong to people (docs/adr/0011).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm1 ...01 runs CA, dm2 ...02 runs CB. p1 ...03, p2 ...04 and p3 ...05 are players in CA;
-- p2 is also in CB. p4 ...06 is in nothing.
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'dm1@ch.test'),
  ('b1000000-0000-0000-0000-000000000002', 'dm2@ch.test'),
  ('b1000000-0000-0000-0000-000000000003', 'p1@ch.test'),
  ('b1000000-0000-0000-0000-000000000004', 'p2@ch.test'),
  ('b1000000-0000-0000-0000-000000000005', 'p3@ch.test'),
  ('b1000000-0000-0000-0000-000000000006', 'p4@ch.test');
insert into public.campaigns (id, dm_id, name) values
  ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001', 'CA'),
  ('b2000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-000000000002', 'CB');
insert into public.campaign_players (campaign_id, player_id) values
  ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000003'),
  ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000004'),
  ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000005'),
  ('b2000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-000000000004');

-- ═══ 1. Ten characters, thirty in all ═══════════════════════════════════
select t.act_as('b1000000-0000-0000-0000-000000000006');
do $$
begin
  for i in 1..10 loop
    insert into public.characters (owner_id, character_name) values ('b1000000-0000-0000-0000-000000000006', 'C' || lpad(i::text, 2, '0'));
  end loop;
end $$;
select t.expect_count($q$select 1 from public.characters$q$, 10, 'CH1: a person in no campaign can make ten characters');
select t.expect_denied_with($q$insert into public.characters (owner_id, character_name) values ('b1000000-0000-0000-0000-000000000006', 'Eleven')$q$,
  'already have 10', 'CH2: an eleventh is refused');
select t.expect_count($q$select 1 from (select public.delete_character((select id from public.characters where character_name = 'C01'))) x$q$, 1,
  'CH3: a character can be deleted');
select t.expect_affects($q$insert into public.characters (owner_id, character_name) values ('b1000000-0000-0000-0000-000000000006', 'C11')$q$, 1,
  'CH3b: a deleted character does not count toward the ten');

-- 19 more delete-and-make cycles bring the total to 30.
do $$
declare
  v uuid;
begin
  for i in 1..19 loop
    select id into v from public.characters where owner_id = 'b1000000-0000-0000-0000-000000000006' and deleted_at is null order by character_name limit 1;
    perform public.delete_character(v);
    insert into public.characters (owner_id, character_name) values ('b1000000-0000-0000-0000-000000000006', 'R' || lpad(i::text, 2, '0'));
  end loop;
end $$;
select t.expect_count($q$select 1 from public.characters$q$, 30, 'CH4: thirty rows in all');
select t.expect_count($q$select 1 from (select public.delete_character((select id from public.characters where deleted_at is null order by character_name limit 1))) x$q$, 1,
  'CH4b: one more deleted');
select t.expect_denied_with($q$insert into public.characters (owner_id, character_name) values ('b1000000-0000-0000-0000-000000000006', 'Thirty-one')$q$,
  'most one person can keep', 'CH4c: thirty in all, deleted ones included, is the limit');
select t.expect_count($q$select 1 from (select public.undelete_character((select id from public.characters where deleted_at is not null order by character_name limit 1))) x$q$, 1,
  'CH5: a deleted character can be brought back');
select t.expect_denied_with($q$select public.undelete_character((select id from public.characters where deleted_at is not null order by character_name limit 1))$q$,
  'already have 10', 'CH5b: ...unless the person already has ten that are not deleted');

-- ═══ 2. Deleting hides, it does not remove ═════════════════════════════
select t.act_as('b1000000-0000-0000-0000-000000000003');
insert into public.characters (owner_id, character_name, data) values
  ('b1000000-0000-0000-0000-000000000003', 'Alpha', '{"a":1}'),
  ('b1000000-0000-0000-0000-000000000003', 'Beta', '{"b":1}');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Alpha'))) x$q$, 1,
  'CH6: p1 makes Alpha active in CA');
select t.expect_denied_with($q$select public.delete_character((select id from public.characters where character_name = 'Alpha'))$q$,
  'active in a campaign', 'CH6b: a character that is active in a campaign cannot be deleted');
select t.expect_count($q$select 1 from (select public.delete_character((select id from public.characters where character_name = 'Beta'))) x$q$, 1,
  'CH7: p1 deletes Beta');
select t.expect_count($q$select 1 from public.characters where character_name = 'Beta' and deleted_at is not null$q$, 1,
  'CH7b: Beta is still there for its owner, marked deleted');
select t.expect_affects($q$update public.characters set data = '{"b":2}' where character_name = 'Beta'$q$, 0,
  'CH7c: a deleted character cannot be edited (0 rows)');
select t.expect_denied_with($q$select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Beta'))$q$,
  'was not found', 'CH7d: a deleted character cannot be made active');
select t.expect_denied($q$update public.characters set deleted_at = null where character_name = 'Beta'$q$, 'CH7e: a client cannot un-hide it with a plain update either');
select t.act_as('b1000000-0000-0000-0000-000000000004');
select t.expect_denied_with($q$select public.delete_character((select id from public.characters where character_name = 'Alpha'))$q$,
  'was not found', 'CH8: nobody else can delete someone''s character (they cannot even see it)');

-- ═══ 3. Choosing, and who can see the result ════════════════════════════
insert into public.characters (owner_id, character_name, data) values
  ('b1000000-0000-0000-0000-000000000004', 'P2A', '{"p":"a"}'),
  ('b1000000-0000-0000-0000-000000000004', 'P2B', '{"p":"b"}');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'P2A'))) x$q$, 1,
  'CH9: p2 makes P2A active in CA');
select t.expect_denied_with($q$select public.choose_character('b2000000-0000-0000-0000-0000000000b1', (select id from public.characters where character_name = 'P2A'))$q$,
  'already active in another campaign', 'CH9b: a character can be active in one campaign at a time');
select t.expect_denied_with($q$select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Alpha'))$q$,
  'was not found', 'CH9c: nobody can choose someone else''s character');
select t.act_as('b1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.characters where character_name = 'P2A'$q$, 1, 'CH10: dm1 reads a character active in their campaign');
select t.expect_count($q$select 1 from public.characters where character_name = 'Alpha'$q$, 1, 'CH10b: ...and the other one');
select t.expect_count($q$select 1 from public.characters$q$, 2, 'CH10c: ...and nothing else');
select t.act_as('b1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.characters$q$, 0, 'CH10d: dm2 sees none of them');
select t.act_as('b1000000-0000-0000-0000-000000000004');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'P2B'))) x$q$, 1,
  'CH11: p2 switches to P2B in CA');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000b1', (select id from public.characters where character_name = 'P2A'))) x$q$, 1,
  'CH11b: P2A, now free, can be made active in CB');
select t.act_as('b1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.characters where character_name = 'P2B'$q$, 1, 'CH12: dm1 now reads P2B');
select t.expect_count($q$select 1 from public.characters where character_name = 'P2A'$q$, 0, 'CH12b: ...and no longer P2A');
select t.expect_count($q$select 1 from public.campaign_characters$q$, 2, 'CH12c: dm1 reads the active characters of CA');
select t.act_as('b1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.characters where character_name = 'P2A'$q$, 1, 'CH12d: dm2 reads P2A');
select t.act_as('b1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.campaign_characters$q$, 1, 'CH13: a player reads only their own active characters');

-- choosing the character that is already active changes nothing
select t.act_as_superuser();
update public.campaign_characters set assigned_at = '2001-01-01' where player_id = 'b1000000-0000-0000-0000-000000000003';
select t.act_as('b1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Alpha'))) x$q$, 1,
  'CH14: choosing the character that is already active');
select t.expect_count($q$select 1 from public.campaign_characters where assigned_at = '2001-01-01'$q$, 1, 'CH14b: ...keeps the time it became active');

-- ═══ 4. The DM's history starts when the character became active ═══════
select t.act_as_superuser();
update public.campaign_characters set assigned_at = '2026-01-10' where player_id = 'b1000000-0000-0000-0000-000000000003';
insert into public.character_history (character_id, owner_id, schema_version, character_name, data, reason, saved_at)
select c.id, c.owner_id, 1, 'Alpha', '{}', 'edit', s.saved_at
from public.characters c, (values ('2026-01-05'::timestamptz), ('2026-01-12'::timestamptz)) s(saved_at)
where c.character_name = 'Alpha';
select t.act_as('b1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.character_history where character_name = 'Alpha'$q$, 2, 'CH15: the owner reads all of the history');
select t.act_as('b1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.character_history where character_name = 'Alpha'$q$, 1, 'CH15b: the DM reads only what was kept after it became active in their campaign');
select t.act_as('b1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.character_history where character_name = 'Alpha'$q$, 0, 'CH15c: another DM reads none');

-- ═══ 5. Leaving and removal keep a copy for the DM ═════════════════════
select t.act_as('b1000000-0000-0000-0000-000000000005');
insert into public.characters (owner_id, character_name, data) values ('b1000000-0000-0000-0000-000000000005', 'Cora', '{"c":1}');
select t.expect_count($q$select 1 from (select public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Cora'))) x$q$, 1,
  'CH16: p3 makes Cora active in CA');
select t.expect_count($q$select 1 from (select public.leave_campaign('b2000000-0000-0000-0000-0000000000a1')) x$q$, 1, 'CH16b: p3 leaves');
select t.expect_count($q$select 1 from public.campaign_characters$q$, 0, 'CH16c: their active character is cleared with the membership');
select t.expect_count($q$select 1 from public.departed_sheets$q$, 0, 'CH16d: p3 cannot read the DM''s copy');
select t.expect_affects($q$update public.characters set data = '{"c":2}' where character_name = 'Cora'$q$, 1, 'CH16e: p3 keeps editing Cora');
select t.act_as('b1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.departed_sheets where character_name = 'Cora' and reason = 'left' and data = '{"c":1}'$q$, 1,
  'CH17: the DM reads the copy from the moment p3 left');
select t.expect_count($q$select 1 from public.characters where character_name = 'Cora'$q$, 0, 'CH17b: ...and not the live sheet');
select t.act_as('b1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from public.departed_sheets$q$, 0, 'CH17c: another DM reads no copies of CA');

select t.act_as('b1000000-0000-0000-0000-000000000005');
select t.expect_count($q$select 1 from (select public.leave_campaign('b2000000-0000-0000-0000-0000000000a1')) x$q$, 1, 'CH18: leaving again, as a non-member, is harmless');
select t.act_as('b1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.departed_sheets where character_name = 'Cora'$q$, 1, 'CH18b: ...and adds no copy');

select t.expect_count($q$select 1 from (select public.remove_player('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000004')) x$q$, 1, 'CH19: the DM removes p2');
select t.expect_count($q$select 1 from public.departed_sheets where character_name = 'P2B' and reason = 'removed' and data = '{"p":"b"}'$q$, 1, 'CH19b: a copy of what p2 had active is kept');
select t.act_as('b1000000-0000-0000-0000-000000000004');
select t.expect_count($q$select 1 from public.campaign_characters$q$, 1, 'CH19c: p2''s character in CB is untouched');

-- Only the newest three copies per player per campaign are kept.
do $$
begin
  for i in 1..5 loop
    perform t.act_as_superuser();
    insert into public.campaign_players (campaign_id, player_id) values ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000005');
    update public.characters set data = jsonb_build_object('n', i) where character_name = 'Cora';
    perform t.act_as('b1000000-0000-0000-0000-000000000005');
    perform public.choose_character('b2000000-0000-0000-0000-0000000000a1', (select id from public.characters where character_name = 'Cora'));
    perform public.leave_campaign('b2000000-0000-0000-0000-0000000000a1');
  end loop;
  perform t.act_as_superuser();
end $$;
select t.expect_count($q$select 1 from public.departed_sheets where player_id = 'b1000000-0000-0000-0000-000000000005'$q$, 3, 'CH20: only the newest 3 copies are kept');
select t.expect_count($q$select 1 from public.departed_sheets where player_id = 'b1000000-0000-0000-0000-000000000005' and data = '{"n":5}'$q$, 1, 'CH20b: the newest is among them');
select t.expect_count($q$select 1 from public.departed_sheets where player_id = 'b1000000-0000-0000-0000-000000000005' and data = '{"c":1}'$q$, 0, 'CH20c: the oldest is gone');

-- ═══ 6. Only the functions write ════════════════════════════════════════
select t.act_as('b1000000-0000-0000-0000-000000000003');
select t.expect_denied($q$insert into public.campaign_characters (campaign_id, player_id, character_id) select 'b2000000-0000-0000-0000-0000000000a1', owner_id, id from public.characters where character_name = 'Beta'$q$,
  'CH21: a client cannot write campaign_characters');
select t.expect_denied($q$update public.campaign_characters set assigned_at = now()$q$, 'CH21b: ...or change it');
select t.expect_denied($q$delete from public.campaign_characters$q$, 'CH21c: ...or delete from it');
select t.expect_denied($q$insert into public.departed_sheets (campaign_id, player_id, character_id, character_name, schema_version, data, reason) values ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000003', gen_random_uuid(), 'x', 1, '{}', 'left')$q$,
  'CH21d: ...or write a departed sheet');
select t.expect_denied($q$select public.freeze_sheet('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000003', 'left')$q$, 'CH21e: ...or call the function that makes copies');

-- ═══ 7. The tables themselves keep a link honest ═══════════════════════
select t.act_as_superuser();
insert into public.campaign_players (campaign_id, player_id) values ('b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000004');
select t.expect_denied_with(
  $q$insert into public.campaign_characters (campaign_id, player_id, character_id)
     select 'b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000004', id from public.characters where character_name = 'Beta'$q$,
  'foreign key', 'CH22: a link cannot name a character its player does not own');
select t.expect_denied_with(
  $q$insert into public.campaign_characters (campaign_id, player_id, character_id)
     select 'b2000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000006', id from public.characters where character_name = 'C11'$q$,
  'foreign key', 'CH22b: ...or belong to someone who is not a member');

select t.expect_count($q$select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'campaign_characters'$q$, 1,
  'CH23: the roster hears when a player chooses a different character');

\echo ALL CHARACTER TESTS PASSED
rollback;
