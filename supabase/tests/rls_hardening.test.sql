-- Self-asserting RLS tests for 0002 (harden characters writes) and join normalisation.
--
-- Unlike rls_policies.test.sql (which prints results for a human to compare),
-- every check here RAISES on failure, so `psql -v ON_ERROR_STOP=1 -f` exits
-- non-zero and can gate CI (DESIGN.md 6.3/6.4).
--
-- Order: local_auth_harness.sql, 0001, 0002, then this file. It seeds its own
-- users and campaigns and rolls everything back, so it is order-independent
-- with rls_policies.test.sql and leaves no data behind.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

-- ── test helpers (rolled back with everything else) ─────────────────────
\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm ...a1 runs C1; dm2 ...a5 runs C2; p1 ...a2 and p2 ...a3 are players in
-- C1; eve ...a4 never joins anything.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'dm@h.test'),
  ('a0000000-0000-0000-0000-0000000000a2', 'p1@h.test'),
  ('a0000000-0000-0000-0000-0000000000a3', 'p2@h.test'),
  ('a0000000-0000-0000-0000-0000000000a4', 'eve@h.test'),
  ('a0000000-0000-0000-0000-0000000000a5', 'dm2@h.test');
insert into public.campaigns (id, dm_id, name) values
  ('b0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a1', 'C1'),
  ('b0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000a5', 'C2');
-- Invites (0005): codes HARDEN1 and OTHER22, stored only as hashes, generous limits.
insert into public.campaign_invites (campaign_id, code_hash, created_by, expires_at, max_uses) values
  ('b0000000-0000-0000-0000-0000000000c1', encode(sha256(convert_to('HARDEN1', 'UTF8')), 'hex'), 'a0000000-0000-0000-0000-0000000000a1', now() + interval '30 days', 50),
  ('b0000000-0000-0000-0000-0000000000c2', encode(sha256(convert_to('OTHER22', 'UTF8')), 'hex'), 'a0000000-0000-0000-0000-0000000000a5', now() + interval '30 days', 50);
-- anon has no table grants on the real platform (see grants.test.sql). Grant it
-- SELECT inside this rolled-back transaction anyway, so H14 proves RLS alone
-- would still hide every row from anon if a grant were ever added by mistake.
grant select on all tables in schema public to anon;

-- p1 and p2 join C1 through the real RPC, as themselves.
select t.act_as('a0000000-0000-0000-0000-0000000000a2');
select t.expect_count($q$select * from public.join_campaign('HARDEN1')$q$, 1, 'p1 joins C1');
select t.act_as('a0000000-0000-0000-0000-0000000000a3');
select t.expect_count($q$select * from public.join_campaign('HARDEN1')$q$, 1, 'p2 joins C1');

-- ═══ Writes require membership (ADR 0002) ═══════════════════════════════
select t.act_as('a0000000-0000-0000-0000-0000000000a4');
select t.expect_denied(
  $q$insert into public.characters (owner_id, campaign_id, character_name)
     values ('a0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-0000000000c1', 'Intruder')$q$,
  'H1: a non-member cannot insert a character into a campaign they never joined');

select t.act_as('a0000000-0000-0000-0000-0000000000a2');
select t.expect_affects(
  $q$insert into public.characters (owner_id, campaign_id, character_name, data)
     values ('a0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000c1', 'Dana', '{"hp":10}')$q$,
  1, 'H2: a member can insert their own character');
select t.expect_affects(
  $q$update public.characters set data = '{"hp":9}' where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  1, 'H2b: a member can update their own character');

select t.expect_denied(
  $q$update public.characters set campaign_id = 'b0000000-0000-0000-0000-0000000000c2'
     where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H3: an owner cannot move their character into another campaign');
select t.expect_denied(
  $q$update public.characters set owner_id = 'a0000000-0000-0000-0000-0000000000a3'
     where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H4: an owner cannot hand their character to someone else');

-- ═══ Removed players: can still read, cannot write, can be restored ══════
select t.act_as('a0000000-0000-0000-0000-0000000000a3');
select t.expect_affects(
  $q$insert into public.characters (owner_id, campaign_id, character_name)
     values ('a0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-0000000000c1', 'Grix')$q$,
  1, 'H5a: p2 creates a character before removal');
select t.act_as('a0000000-0000-0000-0000-0000000000a1');
select t.expect_affects(
  $q$select public.remove_player('b0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a3')$q$,
  1, 'H5b: the DM removes p2');
select t.expect_count(
  $q$select 1 from public.characters where owner_id = 'a0000000-0000-0000-0000-0000000000a3'$q$,
  1, 'H5c: the DM can still read a removed players sheet (needed for Restore)');
select t.act_as('a0000000-0000-0000-0000-0000000000a3');
select t.expect_count(
  $q$select 1 from public.characters where owner_id = 'a0000000-0000-0000-0000-0000000000a3'$q$,
  1, 'H5d: a removed player can still READ their own sheet');
select t.expect_denied(
  $q$update public.characters set data = '{"note":"after removal"}' where owner_id = 'a0000000-0000-0000-0000-0000000000a3'$q$,
  'H5e: a removed player cannot WRITE their sheet');
select t.expect_count($q$select * from public.join_campaign('HARDEN1')$q$, 1, 'H5f: p2 rejoins with the code');
select t.expect_affects(
  $q$update public.characters set data = '{"note":"restored"}' where owner_id = 'a0000000-0000-0000-0000-0000000000a3'$q$,
  1, 'H5g: after rejoining, p2 can write again');

-- ═══ The DM stays strictly view-only ═════════════════════════════════════
select t.act_as('a0000000-0000-0000-0000-0000000000a1');
select t.expect_denied(
  $q$insert into public.characters (owner_id, campaign_id, character_name)
     values ('a0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000c1', 'Forged')$q$,
  'H6a: the DM cannot insert a character on a players behalf');
select t.expect_affects(
  $q$update public.characters set character_name = 'DM edit' where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  0, 'H6b: the DM cannot update a players character (0 rows)');
select t.expect_denied(
  $q$delete from public.characters where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H6c: the DM cannot delete a players character (no DELETE grant since 0004)');

-- ═══ Invite codes: normalisation (generation and limits are in access_model.test.sql) ═══
select t.act_as('a0000000-0000-0000-0000-0000000000a4');
select t.expect_count($q$select * from public.join_campaign('harden1')$q$, 1, 'H10a: join_campaign accepts a lower-case code');
select t.act_as('a0000000-0000-0000-0000-0000000000a5');
select t.expect_count($q$select * from public.join_campaign('  HARDEN1  ')$q$, 1, 'H10b: join_campaign accepts a padded code');
select t.expect_denied($q$select * from public.join_campaign('NOSUCHCODE')$q$, 'H10c: a wrong code is still rejected');

-- ═══ Size and shape limits ═══════════════════════════════════════════════
select t.act_as('a0000000-0000-0000-0000-0000000000a2');
select t.expect_denied(
  $q$update public.characters set data = jsonb_build_object('junk', repeat('x', 2000000)) where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H11a: a 2 MB sheet is rejected');
select t.expect_denied(
  $q$update public.characters set character_name = repeat('n', 101) where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H11b: a 101-character name is rejected');
select t.expect_denied(
  $q$update public.characters set data = '[]'::jsonb where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'H11c: sheet data that is not a JSON object is rejected');

-- ═══ Other roles and surfaces ════════════════════════════════════════════
select t.expect_affects(
  $q$update public.profiles set display_name = 'pwned' where id = 'a0000000-0000-0000-0000-0000000000a3'$q$,
  0, 'H12: a user cannot edit someone elses profile (0 rows)');
select t.expect_denied(
  $q$select public.remove_player('b0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a3')$q$,
  'H13a: a player (not the DM) cannot remove a player');
select t.act_as('a0000000-0000-0000-0000-0000000000a5');
select t.expect_denied(
  $q$select public.remove_player('b0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a3')$q$,
  'H13b: the DM of a different campaign cannot remove a player');

select t.act_as_superuser();
set local role anon;
select t.expect_count($q$select * from public.characters$q$, 0, 'H14a: anon sees no characters');
select t.expect_count($q$select * from public.campaigns$q$, 0, 'H14b: anon sees no campaigns');
select t.expect_denied($q$select * from public.join_campaign('HARDEN1')$q$, 'H14c: anon cannot join a campaign');
reset role;

-- ═══ Server-controlled columns and schema_version (0006) ═══════════════
select t.act_as('a0000000-0000-0000-0000-0000000000a2');   -- p1, owner of a character in C1
select t.expect_denied_with(
  $q$update public.characters set id = gen_random_uuid() where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'permission denied', 'H15a: an owner cannot rewrite characters.id (it links the sheet to its history)');
select t.expect_denied_with(
  $q$update public.characters set updated_at = '1999-01-01' where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$,
  'permission denied', 'H15b: ...or updated_at (the server stamps it, and concurrency checks rely on it)');
select t.expect_denied_with(
  $q$insert into public.characters (id, owner_id, campaign_id) values (gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000c1')$q$,
  'permission denied', 'H15c: ...or choose an id when inserting');
select t.expect_denied($q$update public.characters set schema_version = 0 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 'H15d: schema_version 0 is rejected');
select t.expect_denied($q$update public.characters set schema_version = -5 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 'H15e: a negative schema_version is rejected');
select t.expect_denied($q$update public.characters set schema_version = 1001 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 'H15f: schema_version above 1000 is rejected');
select t.expect_affects($q$update public.characters set schema_version = 2 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 1, 'H15g: a client can migrate a sheet up');
select t.expect_denied_with($q$update public.characters set schema_version = 1 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 'can only increase', 'H15h: ...but a stale client cannot downgrade it');
select t.act_as_superuser();
select t.expect_affects($q$update public.characters set schema_version = 1 where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 1, 'H15i: the project owner can still restore an older version (the 0004 recipe)');

select t.act_as('a0000000-0000-0000-0000-0000000000a1');   -- the DM of C1
select t.expect_denied_with($q$update public.campaigns set dm_id = 'a0000000-0000-0000-0000-0000000000a4' where id = 'b0000000-0000-0000-0000-0000000000c1'$q$, 'permission denied', 'H16a: a DM cannot hand their campaign to someone else');
select t.expect_denied_with($q$update public.campaigns set id = gen_random_uuid() where id = 'b0000000-0000-0000-0000-0000000000c1'$q$, 'permission denied', 'H16b: ...or change its id');
select t.expect_denied_with($q$update public.campaigns set created_at = '1999-01-01' where id = 'b0000000-0000-0000-0000-0000000000c1'$q$, 'permission denied', 'H16c: ...or its creation date');
select t.expect_affects($q$update public.campaigns set name = 'Renamed' where id = 'b0000000-0000-0000-0000-0000000000c1'$q$, 1, 'H16d: a DM can still rename their campaign');

select t.act_as('a0000000-0000-0000-0000-0000000000a4');   -- eve's profile came from the signup trigger
select t.expect_denied_with($q$insert into public.profiles (id, display_name, created_at) values ('a0000000-0000-0000-0000-0000000000a4', 'Eve', '1999-01-01')$q$, 'permission denied', 'H17a: a client cannot set profiles.created_at');
select t.expect_count($q$select 1 from public.profiles where id = 'a0000000-0000-0000-0000-0000000000a4' and display_name = 'eve'$q$, 1, 'H17b: eve already has a profile, made by the signup trigger from her email');
select t.expect_affects($q$update public.profiles set display_name = 'Eve' where id = 'a0000000-0000-0000-0000-0000000000a4'$q$, 1, 'H17d: a user can still rename their own profile');
select t.expect_denied_with($q$update public.profiles set id = gen_random_uuid() where id = 'a0000000-0000-0000-0000-0000000000a4'$q$, 'permission denied', 'H17c: a profile id cannot be rewritten');

select t.act_as('a0000000-0000-0000-0000-0000000000a2');
select t.expect_affects($q$update public.characters set data = jsonb_build_object('pad', repeat('x', 400000)) where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 1, 'H18a: a 400 KB sheet is accepted (a heavily filled real sheet is about 360 KiB)');
select t.expect_denied($q$update public.characters set data = jsonb_build_object('pad', repeat('x', 600000)) where owner_id = 'a0000000-0000-0000-0000-0000000000a2'$q$, 'H18b: a 600 KB sheet is rejected (cap is 512 KiB since 0006)');
select t.act_as_superuser();

\echo ALL HARDENING TESTS PASSED
rollback;
