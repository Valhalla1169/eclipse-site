-- Self-asserting tests for 0005: the creator allowlist, hashed/expiring/limited
-- invites, and profile visibility (docs/adr/0005).
--
-- Order: local_auth_harness.sql, 0001 to 0005, then this file. It seeds its own
-- users and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- owner   c...01  allowlisted creator, DM of C1
-- loner   c...02  signed up, in no campaign
-- p1..p3  c...03/04/05   players
-- dm2     c...06  allowlisted creator, DM of C2
-- p4, p5  c...07/08      more players;  p6 c...0a is a member of C2 only
insert into auth.users (id, email)
select ('c0000000-0000-0000-0000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'u' || n || '@a.test'
from generate_series(1, 10) n;
insert into public.campaign_creators (user_id, note) values
  ('c0000000-0000-0000-0000-000000000001', 'owner'),
  ('c0000000-0000-0000-0000-000000000006', 'second DM');
insert into public.campaigns (id, dm_id, name) values
  ('d0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'C1'),
  ('d0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-000000000006', 'C2');
insert into public.campaign_players (campaign_id, player_id) values
  ('d0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-00000000000a');
grant select on all tables in schema public to anon;   -- see rls_hardening.test.sql

-- ═══ 1. Only allowlisted people can create campaigns ═════════════════════
select t.act_as('c0000000-0000-0000-0000-000000000002');   -- loner
select t.expect_denied(
  $q$insert into public.campaigns (dm_id, name) values ('c0000000-0000-0000-0000-000000000002', 'Mine')$q$,
  'AM1: a signed-up user who is not on the allowlist cannot create a campaign');
select t.expect_denied(
  $q$insert into public.campaign_creators (user_id) values ('c0000000-0000-0000-0000-000000000002')$q$,
  'AM2: nobody can add themselves to the allowlist');
select t.expect_denied(
  $q$update public.campaign_creators set note = 'x'$q$,
  'AM2b: nobody can edit the allowlist through the API');
select t.expect_count($q$select * from public.campaign_creators$q$, 0, 'AM2c: a non-creator sees no allowlist rows');

select t.act_as('c0000000-0000-0000-0000-000000000001');   -- owner
select t.expect_count($q$select * from public.campaign_creators$q$, 1, 'AM3: a creator sees only their own allowlist row');
select t.expect_affects(
  $q$insert into public.campaigns (dm_id, name) values ('c0000000-0000-0000-0000-000000000001', 'A new game')$q$,
  1, 'AM3b: an allowlisted creator can create a campaign they run');
select t.expect_denied(
  $q$insert into public.campaigns (dm_id, name) values ('c0000000-0000-0000-0000-000000000006', 'Framed')$q$,
  'AM3c: ...but not one that names someone else as its DM');

-- ═══ 2. Invites: server-generated, hashed, limited ═══════════════════════
select t.expect_denied_with(
  $q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 0, 24)$q$,
  'between 1 and 50', 'AM4a: an invite must allow at least 1 use');
select t.expect_denied($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 51, 24)$q$, 'AM4b: ...and at most 50');
select t.expect_denied($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 1, 0)$q$, 'AM4c: an invite must last at least an hour');
select t.expect_denied($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 1, 721)$q$, 'AM4d: ...and at most 30 days');

-- code1: single use, 24h
select set_config('t.code1', r.code, false) from public.create_invite('d0000000-0000-0000-0000-0000000000c1', '  For Sam  ', 1, 24) r;
select t.act_as_superuser();
select t.expect_count(
  $q$select 1 from public.campaign_invites where code_hash = encode(sha256(convert_to(current_setting('t.code1'), 'UTF8')), 'hex') and label = 'For Sam' and max_uses = 1 and use_count = 0$q$,
  1, 'AM5: the invite is stored by hash, with a trimmed label');
select t.expect_count($q$select 1 from public.campaign_invites where code_hash = current_setting('t.code1')$q$, 0, 'AM5b: the plaintext code is never stored');
select t.expect_count($q$select 1 where current_setting('t.code1') ~ '^[A-Z0-9]{30}$'$q$, 1, 'AM5c: the code is 30 uppercase alphanumerics (120 bits)');
select t.expect_count($q$select 1 from public.campaign_invites where expires_at between now() + interval '23 hours' and now() + interval '25 hours'$q$, 1, 'AM5d: it expires in the requested 24 hours');

select t.act_as('c0000000-0000-0000-0000-000000000001');
select t.expect_count($q$select id, label, expires_at, max_uses, use_count, revoked_at from public.campaign_invites where campaign_id = 'd0000000-0000-0000-0000-0000000000c1'$q$, 1, 'AM6: the DM can list their campaign''s invite metadata');
select t.expect_denied($q$select code_hash from public.campaign_invites$q$, 'AM6b: ...but can never read code_hash');
select t.expect_denied($q$select * from public.campaign_invites$q$, 'AM6c: ...nor select * (which would include it)');
select t.expect_denied($q$update public.campaign_invites set max_uses = 50$q$, 'AM6d: the DM cannot edit an invite directly');
select t.expect_denied($q$insert into public.campaign_invites (campaign_id, code_hash, created_by, expires_at, max_uses) values ('d0000000-0000-0000-0000-0000000000c1', 'x', 'c0000000-0000-0000-0000-000000000001', now(), 1)$q$, 'AM6e: the DM cannot insert an invite (with a hash they chose) directly');

select t.act_as('c0000000-0000-0000-0000-000000000003');   -- p1
select t.expect_count($q$select id from public.campaign_invites$q$, 0, 'AM7: a player cannot see any invites (RLS hides every row)');
select t.expect_denied_with($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1')$q$, 'only the DM', 'AM7b: a non-DM cannot create an invite');
select t.act_as('c0000000-0000-0000-0000-000000000006');   -- dm2: a creator, but of another campaign
select t.expect_denied_with($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1')$q$, 'only the DM', 'AM7c: another DM cannot create an invite for this campaign');

-- ═══ 3. Joining ══════════════════════════════════════════════════════════
select t.act_as('c0000000-0000-0000-0000-000000000002');   -- loner joins with code1
select t.expect_count($q$select * from public.join_campaign(current_setting('t.code1'))$q$, 1, 'AM8: a signed-in stranger joins with a valid invite');
select t.expect_count($q$select 1 from public.campaign_players where player_id = 'c0000000-0000-0000-0000-000000000002'$q$, 1, 'AM8b: and is now a member');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.campaign_invites where use_count = 1$q$, 1, 'AM8c: the invite has been used once');

select t.act_as('c0000000-0000-0000-0000-000000000004');   -- p2 tries the used-up single-use code
select t.expect_denied_with($q$select * from public.join_campaign(current_setting('t.code1'))$q$, 'invalid invite code', 'AM9: a single-use invite cannot be used a second time');
select t.act_as('c0000000-0000-0000-0000-000000000002');   -- the first joiner re-opens the link
select t.expect_count($q$select * from public.join_campaign(current_setting('t.code1'))$q$, 1, 'AM9b: a member re-opening their own link still gets the campaign');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.campaign_invites where use_count = 1$q$, 1, 'AM9c: ...without using the invite up again');

-- code2: 5 uses. Expiry.
select t.act_as('c0000000-0000-0000-0000-000000000001');
select set_config('t.code2', r.code, false) from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 5, 24) r;
select t.act_as('c0000000-0000-0000-0000-000000000003');   -- p1 joins
select t.expect_count($q$select * from public.join_campaign(current_setting('t.code2'))$q$, 1, 'AM10: a multi-use invite works');
select t.act_as_superuser();
update public.campaign_invites set expires_at = now() - interval '1 minute' where use_count = 1 and max_uses = 5;
select t.act_as('c0000000-0000-0000-0000-000000000004');   -- p2 too late
select t.expect_denied_with($q$select * from public.join_campaign(current_setting('t.code2'))$q$, 'invalid invite code', 'AM11: an expired invite is refused');

-- code3: revocation
select t.act_as('c0000000-0000-0000-0000-000000000001');
select set_config('t.code3', r.code, false), set_config('t.inv3', r.invite_id::text, false)
  from public.create_invite('d0000000-0000-0000-0000-0000000000c1', 'to revoke', 3, 24) r;
select t.act_as('c0000000-0000-0000-0000-000000000003');
select t.expect_denied($q$select public.revoke_invite(current_setting('t.inv3')::uuid)$q$, 'AM12: a player cannot revoke an invite');
select t.act_as('c0000000-0000-0000-0000-000000000006');
select t.expect_denied($q$select public.revoke_invite(current_setting('t.inv3')::uuid)$q$, 'AM12b: another DM cannot revoke it');
select t.act_as('c0000000-0000-0000-0000-000000000001');
select t.expect_affects($q$select public.revoke_invite(current_setting('t.inv3')::uuid)$q$, 1, 'AM12c: the DM can revoke it');
select t.expect_denied($q$select public.revoke_invite(current_setting('t.inv3')::uuid)$q$, 'AM12d: revoking twice is an error, not a silent no-op');
select t.act_as('c0000000-0000-0000-0000-000000000005');   -- p3
select t.expect_denied_with($q$select * from public.join_campaign(current_setting('t.code3'))$q$, 'invalid invite code', 'AM13: a revoked invite is refused');

-- code4: exactly 2 uses, raced by 3 people; DM cannot join own campaign
select t.act_as('c0000000-0000-0000-0000-000000000001');
select set_config('t.code4', r.code, false) from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 2, 24) r;
select t.expect_denied_with($q$select * from public.join_campaign(current_setting('t.code4'))$q$, 'you run this campaign', 'AM14: the DM cannot join their own campaign as a player');
select t.act_as('c0000000-0000-0000-0000-000000000005');
select t.expect_count($q$select * from public.join_campaign(current_setting('t.code4'))$q$, 1, 'AM15a: first of two uses');
select t.act_as('c0000000-0000-0000-0000-000000000007');
select t.expect_count($q$select * from public.join_campaign(current_setting('t.code4'))$q$, 1, 'AM15b: second of two uses');
select t.act_as('c0000000-0000-0000-0000-000000000008');
select t.expect_denied_with($q$select * from public.join_campaign(current_setting('t.code4'))$q$, 'invalid invite code', 'AM15c: the third person is refused: an invite never exceeds max_uses');

-- one message for every failure: wrong, expired, revoked and used-up are indistinguishable
select t.act_as('c0000000-0000-0000-0000-000000000008');
select t.expect_denied_with($q$select * from public.join_campaign('NOSUCHCODENOSUCHCODENOSUCHCODE')$q$, 'invalid invite code', 'AM16: a wrong code gets the very same error as an expired, revoked or used-up one');

-- normalisation
select t.act_as('c0000000-0000-0000-0000-000000000001');
select set_config('t.code5', r.code, false) from public.create_invite('d0000000-0000-0000-0000-0000000000c1', null, 1, 24) r;
select t.act_as('c0000000-0000-0000-0000-000000000008');
select t.expect_count($q$select * from public.join_campaign('  ' || lower(current_setting('t.code5')) || '  ')$q$, 1, 'AM17: a lower-case, padded code works');

-- brute force: random guesses never succeed
select t.act_as('c0000000-0000-0000-0000-000000000009');
select t.expect_denied(format('select * from public.join_campaign(%L)', upper(substr(md5(g::text), 1, 30))), 'AM18: random guess ' || g || ' fails')
from generate_series(1, 5) g;

-- ═══ 4. Profile visibility ═══════════════════════════════════════════════
-- C1 members: owner (DM), loner, p1, p3, p4(c..07), p5(c..08).  C2: dm2 + p6(c..0a).
select t.act_as('c0000000-0000-0000-0000-000000000009');   -- in no campaign
select t.expect_count($q$select 1 from public.profiles$q$, 1, 'AM19: a user in no campaign sees exactly one profile: their own');
select t.act_as('c0000000-0000-0000-0000-000000000003');   -- p1, a player in C1
select t.expect_count($q$select 1 from public.profiles where id = 'c0000000-0000-0000-0000-000000000001'$q$, 1, 'AM20: a player can read their DM''s profile');
select t.expect_count($q$select 1 from public.profiles where id = 'c0000000-0000-0000-0000-000000000005'$q$, 1, 'AM20b: ...and a fellow player''s');
select t.expect_count($q$select 1 from public.profiles where id in ('c0000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-00000000000a')$q$, 0, 'AM21: ...but not anyone in a campaign they are not in');
select t.act_as('c0000000-0000-0000-0000-000000000001');   -- the DM
select t.expect_count($q$select 1 from public.profiles where id in ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000005')$q$, 2, 'AM22: the DM can read their players'' profiles');
select t.expect_count($q$select 1 from public.profiles where id = 'c0000000-0000-0000-0000-00000000000a'$q$, 0, 'AM22b: ...but not another campaign''s');

-- ═══ 5. Everything else ═════════════════════════════════════════════════
select t.act_as('c0000000-0000-0000-0000-000000000003');
select t.expect_denied($q$insert into public.campaign_players (campaign_id, player_id) values ('d0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-000000000003')$q$, 'AM23: a player still cannot insert themselves into a campaign');
select t.act_as_superuser();
select t.expect_count($q$select 1 from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name = 'invite_code'$q$, 0, 'AM24: the plaintext campaigns.invite_code column is gone');
select t.expect_count($q$select 1 from (select public.generate_invite_code() c from generate_series(1, 300)) g having count(distinct c) = 300 and bool_and(c ~ '^[A-Z0-9]{30}$')$q$, 1, 'AM25: 300 generated codes are distinct and well-formed');

set local role anon;
select t.expect_count($q$select * from public.campaign_invites$q$, 0, 'AM26: anon sees no invites');
select t.expect_count($q$select * from public.campaign_creators$q$, 0, 'AM26b: anon sees no allowlist');
select t.expect_denied($q$select * from public.create_invite('d0000000-0000-0000-0000-0000000000c1')$q$, 'AM26c: anon cannot create an invite');
reset role;

\echo ALL ACCESS-MODEL TESTS PASSED
rollback;
