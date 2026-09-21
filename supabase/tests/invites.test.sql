-- Self-asserting tests for 0010: previewing, replacing and limiting invites, and
-- remembering which invite a player joined with (docs/adr/0012).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- dm1 ...01 runs CA. dm2 ...02 runs CB. p1 ...03 and p2 ...04 are players; out ...05 is in nothing.
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'dm1@iv.test'),
  ('a1000000-0000-0000-0000-000000000002', 'dm2@iv.test'),
  ('a1000000-0000-0000-0000-000000000003', 'p1@iv.test'),
  ('a1000000-0000-0000-0000-000000000004', 'p2@iv.test'),
  ('a1000000-0000-0000-0000-000000000005', 'out@iv.test');
insert into public.campaigns (id, dm_id, name) values
  ('a2000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000001', 'CA'),
  ('a2000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-000000000002', 'CB');

-- Invites for CA with known codes: GOOD (1 use), MANY (3 uses, none used), OLD (expired),
-- GONE (revoked), SPENT (used up).
insert into public.campaign_invites (id, campaign_id, code_hash, label, created_by, created_at, expires_at, max_uses, use_count, revoked_at) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000a1', encode(sha256(convert_to('GOOD', 'UTF8')), 'hex'), 'for Pia', 'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour', now() + interval '47 hours', 1, 0, null),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-0000000000a1', encode(sha256(convert_to('MANY', 'UTF8')), 'hex'), 'the table', 'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour', now() + interval '71 hours', 3, 1, null),
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-0000000000a1', encode(sha256(convert_to('OLD', 'UTF8')), 'hex'), null, 'a1000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 day', 1, 0, null),
  ('a3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-0000000000a1', encode(sha256(convert_to('GONE', 'UTF8')), 'hex'), null, 'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour', now() + interval '1 day', 1, 0, now()),
  ('a3000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-0000000000a1', encode(sha256(convert_to('SPENT', 'UTF8')), 'hex'), null, 'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour', now() + interval '1 day', 1, 1, null);

-- ═══ 1. Previewing ══════════════════════════════════════════════════════
select t.act_as('a1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.preview_invite('good') where campaign_name = 'CA' and dm_name = 'dm1' and not already_member$q$, 1,
  'IV1: a signed-in person sees the campaign and its DM (the code is forgiving about case)');
select t.expect_count($q$select 1 from public.campaign_invites$q$, 0, 'IV1b: ...and still cannot read the invite table');
select t.act_as_superuser();
select t.expect_count($q$select 1 from public.campaign_invites where code_hash = encode(sha256(convert_to('GOOD', 'UTF8')), 'hex') and use_count = 0$q$, 1,
  'IV2: previewing does not use the invite');

select t.act_as('a1000000-0000-0000-0000-000000000003');
select t.expect_denied_with($q$select * from public.preview_invite('NOSUCH')$q$, 'invalid invite code', 'IV3: a wrong code');
select t.expect_denied_with($q$select * from public.preview_invite('OLD')$q$, 'invalid invite code', 'IV3b: an expired code gives the same answer');
select t.expect_denied_with($q$select * from public.preview_invite('GONE')$q$, 'invalid invite code', 'IV3c: ...a revoked one');
select t.expect_denied_with($q$select * from public.preview_invite('SPENT')$q$, 'invalid invite code', 'IV3d: ...and a used-up one');
select t.act_as('a1000000-0000-0000-0000-000000000001');
select t.expect_denied_with($q$select * from public.preview_invite('GOOD')$q$, 'you run this campaign', 'IV4: the DM is told they run it');
select t.act_as_superuser();
set local role anon;
select t.expect_denied($q$select * from public.preview_invite('GOOD')$q$, 'IV5: anon cannot preview');
reset role;

-- ═══ 2. Joining remembers the invite ════════════════════════════════════
select t.act_as('a1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select * from public.join_campaign('GOOD')$q$, 1, 'IV6: p1 joins with GOOD');
select t.act_as('a1000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.campaign_players where player_id = 'a1000000-0000-0000-0000-000000000003' and invite_id = 'a3000000-0000-0000-0000-000000000001'$q$, 1,
  'IV7: the DM can see which invite p1 joined with');
select t.act_as('a1000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 from public.preview_invite('GOOD') where already_member$q$, 1,
  'IV8: a member can still preview an invite that is now used up, and is told they are in');
select t.expect_denied($q$insert into public.campaign_players (campaign_id, player_id, invite_id) values ('a2000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000003', null)$q$,
  'IV9: nobody can write invite_id themselves');
select t.expect_denied($q$update public.campaign_players set invite_id = null$q$, 'IV9b: ...or change it');

-- ═══ 3. Replacing a lost link ═══════════════════════════════════════════
select t.act_as('a1000000-0000-0000-0000-000000000004');
select t.expect_denied_with($q$select * from public.replace_invite('a3000000-0000-0000-0000-000000000002')$q$, 'not active, or is not yours', 'IV10: a player cannot replace an invite');
select t.act_as('a1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select * from public.replace_invite('a3000000-0000-0000-0000-000000000002')$q$, 'not active, or is not yours', 'IV10b: nor can the DM of another campaign');
select t.act_as('a1000000-0000-0000-0000-000000000001');
select t.expect_denied_with($q$select * from public.replace_invite('a3000000-0000-0000-0000-000000000005')$q$, 'not active, or is not yours', 'IV11: a used-up invite cannot be replaced');
select t.expect_denied_with($q$select * from public.replace_invite('a3000000-0000-0000-0000-000000000004')$q$, 'not active, or is not yours', 'IV11b: ...nor a revoked one');
select t.expect_denied_with($q$select * from public.replace_invite('a3000000-0000-0000-0000-000000000003')$q$, 'not active, or is not yours', 'IV11c: ...nor an expired one');

do $$
declare
  v_new text;
begin
  perform t.act_as('a1000000-0000-0000-0000-000000000001');
  select r.code into v_new from public.replace_invite('a3000000-0000-0000-0000-000000000002') r;
  perform t.expect_count(format($q$select 1 from public.campaign_invites where id = 'a3000000-0000-0000-0000-000000000002' and revoked_at is not null$q$), 1,
    'IV12: the old invite is revoked');
  perform t.act_as('a1000000-0000-0000-0000-000000000004');
  perform t.expect_denied_with($q$select * from public.preview_invite('MANY')$q$, 'invalid invite code', 'IV12b: its code no longer works');
  perform t.expect_count(format($q$select 1 from public.preview_invite(%L)$q$, v_new), 1, 'IV12c: the new code works');
  perform t.act_as('a1000000-0000-0000-0000-000000000001');
  perform t.expect_count(
    $q$select 1 from public.campaign_invites where label = 'the table' and revoked_at is null and max_uses = 2 and use_count = 0
         and expires_at between now() + interval '71 hours' and now() + interval '73 hours'$q$, 1,
    'IV13: the new invite has the same label and lifetime, and only the uses that were left');
end $$;

-- ═══ 4. Limits ══════════════════════════════════════════════════════════
-- CA has 1 active invite now (the replacement). Fill it to 50.
select t.act_as('a1000000-0000-0000-0000-000000000001');
do $$
begin
  for i in 1..49 loop
    perform public.create_invite('a2000000-0000-0000-0000-0000000000a1', 'n' || i, 1, 24);
  end loop;
end $$;
select t.expect_count($q$select 1 from public.campaign_invites where campaign_id = 'a2000000-0000-0000-0000-0000000000a1' and revoked_at is null and expires_at > now() and use_count < max_uses$q$, 50,
  'IV14: 50 invites are active');
select t.expect_denied_with($q$select * from public.create_invite('a2000000-0000-0000-0000-0000000000a1', 'one too many', 1, 24)$q$, '50 active invites', 'IV15: a 51st is refused');
select t.expect_count($q$select 1 from (select * from public.replace_invite((select id from public.campaign_invites where label = 'n1'))) x$q$, 1,
  'IV16: replacing one still works at 50, because it ends one and makes one');
select t.expect_affects($q$select public.revoke_invite((select id from public.campaign_invites where label = 'n2'))$q$, 1, 'IV17: the DM revokes one');
select t.expect_count($q$select 1 from (select * from public.create_invite('a2000000-0000-0000-0000-0000000000a1', 'fits again', 1, 24)) x$q$, 1,
  'IV18: a revoked invite does not count, so one more fits');
select t.act_as('a1000000-0000-0000-0000-000000000002');
select t.expect_count($q$select 1 from (select * from public.create_invite('a2000000-0000-0000-0000-0000000000b1', 'other campaign', 1, 24)) x$q$, 1,
  'IV19: another campaign has its own count');

-- 500 in all.
select t.act_as_superuser();
insert into public.campaign_invites (campaign_id, code_hash, created_by, expires_at, max_uses, revoked_at)
select 'a2000000-0000-0000-0000-0000000000b1', 'bulk' || g, 'a1000000-0000-0000-0000-000000000002', now() + interval '1 day', 1, now()
from generate_series(1, 499) g;
select t.act_as('a1000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select * from public.create_invite('a2000000-0000-0000-0000-0000000000b1', 'too many in all', 1, 24)$q$, '500 invites', 'IV20: 500 invites in all is the limit, revoked ones included');

-- ═══ 5. Privileges ══════════════════════════════════════════════════════
select t.act_as_superuser();
select t.expect_count($q$select 1 where has_function_privilege('authenticated', 'public.preview_invite(text)', 'execute') and has_function_privilege('authenticated', 'public.replace_invite(uuid)', 'execute')$q$, 1,
  'IV21: signed-in users can call the two new functions');
select t.expect_count($q$select 1 where not has_function_privilege('anon', 'public.preview_invite(text)', 'execute') and not has_function_privilege('anon', 'public.replace_invite(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.assert_invite_room(uuid)', 'execute')$q$, 1,
  'IV22: anon cannot, and the limit check is not callable by clients');

\echo ALL INVITE TESTS PASSED
rollback;
