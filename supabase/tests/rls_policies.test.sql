\set ON_ERROR_STOP off
\pset pager off

-- Seed three auth.users: dm, alice, bob, plus an outsider who never joins
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'dm@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'bob@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'eve@example.com');

insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-000000000001', 'The DM'),
  ('00000000-0000-0000-0000-000000000002', 'Alice'),
  ('00000000-0000-0000-0000-000000000003', 'Bob'),
  ('00000000-0000-0000-0000-000000000004', 'Eve');

insert into public.campaigns (id, dm_id, name, invite_code) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Age of Eclipse', 'TABLE1');

\echo '--- TEST 1: alice joins with the correct invite code (as alice) -- expect 1 row back ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select * from public.join_campaign('TABLE1');
commit;

\echo '--- TEST 2: bob joins with the correct invite code (as bob) -- expect 1 row back ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select * from public.join_campaign('TABLE1');
commit;

\echo '--- TEST 3: eve tries a WRONG invite code -- must raise an error ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select * from public.join_campaign('NOTREAL');
rollback;

\echo '--- alice and bob create their characters (as themselves) ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
insert into public.characters (owner_id, campaign_id, character_name, data)
values ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Dana Voss', '{"hp":10}');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
insert into public.characters (owner_id, campaign_id, character_name, data)
values ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Grix', '{"hp":8}');
commit;

\echo '--- TEST 4: alice reads her OWN character -- expect 1 row ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select character_name from public.characters where owner_id = '00000000-0000-0000-0000-000000000002';
commit;

\echo '--- TEST 5: alice tries to read BOBs character directly by owner_id -- expect 0 rows ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select character_name from public.characters where owner_id = '00000000-0000-0000-0000-000000000003';
commit;

\echo '--- TEST 6: the DM reads ALL characters in their campaign -- expect 2 rows (Dana Voss, Grix) ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select character_name from public.characters where campaign_id = '10000000-0000-0000-0000-000000000001' order by character_name;
commit;

\echo '--- TEST 7: eve (never joined) reads characters in the campaign -- expect 0 rows ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select character_name from public.characters where campaign_id = '10000000-0000-0000-0000-000000000001';
commit;

\echo '--- TEST 8: the DM tries to UPDATE a players character -- must affect 0 rows (view-only) ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
update public.characters set character_name = 'HACKED BY DM' where owner_id = '00000000-0000-0000-0000-000000000002';
commit;
select character_name from public.characters where owner_id = '00000000-0000-0000-0000-000000000002';

\echo '--- TEST 9: bob tries to UPDATE alices character -- must affect 0 rows ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
update public.characters set character_name = 'HACKED BY BOB' where owner_id = '00000000-0000-0000-0000-000000000002';
commit;
select character_name from public.characters where owner_id = '00000000-0000-0000-0000-000000000002';

\echo '--- TEST 10: alice updates her OWN character -- must succeed ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
update public.characters set data = '{"hp":9}' where owner_id = '00000000-0000-0000-0000-000000000002';
commit;
select data, updated_at from public.characters where owner_id = '00000000-0000-0000-0000-000000000002';

\echo '--- TEST 11: the DM removes bob from the roster -- his characters row stays DM-readable by design (see migration comment); campaign_players is what actually drops him ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.remove_player('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003');
select character_name from public.characters where campaign_id = '10000000-0000-0000-0000-000000000001';
commit;

\echo '--- TEST 12: bobs character row still exists underneath (removed from roster, not deleted) -- expect 1 row ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select character_name from public.characters where owner_id = '00000000-0000-0000-0000-000000000003';
commit;

\echo '--- TEST 12b: the DMs campaign_players roster (the actual "active roster" source) now shows only alice -- expect 1 row ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select player_id from public.campaign_players where campaign_id = '10000000-0000-0000-0000-000000000001';
commit;

\echo '--- TEST 13: a stranger inserts a campaign_players row directly, bypassing join_campaign() -- must fail ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
insert into public.campaign_players (campaign_id, player_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
rollback;

\echo '--- TEST 14: an outsider tries campaigns SELECT by guessing the id -- expect 0 rows ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select name from public.campaigns where id = '10000000-0000-0000-0000-000000000001';
commit;
