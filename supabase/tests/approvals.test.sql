-- Self-asserting tests for 0011: approved emails, site admins and five characters (docs/adr/0014).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own data and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as superuser) ─────────────────────────────────────────────────
-- admin ...01 is a site admin. player ...02 and stranger ...03 are not, and nobody
-- approved the stranger's email. approved ...04 made an account with an approved email.
insert into auth.users (id, email, raw_user_meta_data, last_sign_in_at) values
  ('c9000000-0000-0000-0000-000000000001', 'admin@ap.test', '{"display_name": "Ada Admin"}', '2026-09-20T10:00:00Z'),
  ('c9000000-0000-0000-0000-000000000002', 'player@ap.test', '{"display_name": "Pat Player"}', null),
  ('c9000000-0000-0000-0000-000000000003', 'stranger@ap.test', '{}', null),
  ('c9000000-0000-0000-0000-000000000004', 'approved@ap.test', '{"display_name": "Abe Approved"}', null);
insert into public.site_admins (user_id) values ('c9000000-0000-0000-0000-000000000001');
insert into public.approved_emails (email, approved_by) values ('approved@ap.test', 'c9000000-0000-0000-0000-000000000001');

-- ═══ 1. A signed-out visitor can do nothing ═════════════════════════════
set local role anon;
select t.expect_denied($q$select public.is_site_admin()$q$, 'AP1: anon cannot ask whether it is an admin');
select t.expect_denied($q$select public.approve_email('x@example.com')$q$, 'AP1b: ...approve an email');
select t.expect_denied($q$select public.revoke_approval('approved@ap.test')$q$, 'AP1c: ...revoke an approval');
select t.expect_denied($q$select * from public.list_accounts()$q$, 'AP1d: ...list the accounts');
select t.expect_denied($q$select * from public.list_pending_approvals()$q$, 'AP1e: ...or list the approvals');
select t.expect_denied($q$select * from public.approved_emails$q$, 'AP1f: anon cannot read the approved emails');
select t.expect_denied($q$select * from public.site_admins$q$, 'AP1g: ...or the site admins');
select t.expect_denied($q$select public.hook_require_approved_email('{"user":{"email":"approved@ap.test"}}')$q$, 'AP1h: ...or call the sign-up hook');
reset role;

-- ═══ 2. A signed-in stranger, an approved person and a player are not admins ═══
select t.act_as('c9000000-0000-0000-0000-000000000003');
select t.expect_count($q$select 1 where not public.is_site_admin()$q$, 1, 'AP2: a stranger is told they are not an admin');
select t.expect_denied_with($q$select public.approve_email('friend@example.com')$q$, 'only a site admin', 'AP3: a stranger cannot approve an email');
select t.expect_denied_with($q$select public.revoke_approval('approved@ap.test')$q$, 'only a site admin', 'AP3b: ...or revoke one');
select t.expect_denied_with($q$select * from public.list_accounts()$q$, 'only a site admin', 'AP3c: ...or list the accounts');
select t.expect_denied_with($q$select * from public.list_pending_approvals()$q$, 'only a site admin', 'AP3d: ...or the approvals');
select t.expect_denied($q$select email from public.approved_emails$q$, 'AP3e: a signed-in person cannot read the approved emails');
select t.expect_denied($q$select * from public.site_admins$q$, 'AP3f: ...or the site admins');
select t.expect_denied($q$insert into public.site_admins (user_id) values ('c9000000-0000-0000-0000-000000000003')$q$, 'AP3g: ...or make themselves an admin');
select t.expect_denied($q$insert into public.approved_emails (email) values ('friend@example.com')$q$, 'AP3h: ...or approve an email by writing the table');
select t.expect_denied($q$select public.hook_require_approved_email('{"user":{"email":"friend@example.com"}}')$q$, 'AP3i: ...or call the sign-up hook');

select t.act_as('c9000000-0000-0000-0000-000000000004');
select t.expect_denied_with($q$select public.approve_email('friend@example.com')$q$, 'only a site admin', 'AP4: an approved person cannot approve anyone');
select t.act_as('c9000000-0000-0000-0000-000000000002');
select t.expect_denied_with($q$select public.approve_email('friend@example.com')$q$, 'only a site admin', 'AP4b: ...and neither can a player');

-- ═══ 3. An admin approves and lists ═════════════════════════════════════
select t.act_as('c9000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 where public.is_site_admin()$q$, 1, 'AP5: an admin is told they are one');
select t.expect_count($q$select 1 where public.approve_email('  New.Person@Example.COM ') = 'new.person@example.com'$q$, 1,
  'AP6: an admin approves an email, and it is stored trimmed and lower-cased');
select t.expect_count($q$select 1 where public.approve_email('new.person@example.com') = 'new.person@example.com'$q$, 1,
  'AP6b: approving it again is harmless');
select t.expect_denied_with($q$select public.approve_email('not an email')$q$, 'not an email address', 'AP7: an admin cannot approve something that is not an email');
select t.expect_denied_with($q$select public.approve_email('a@b')$q$, 'not an email address', 'AP7b: ...or an address with no domain');
select t.expect_denied_with($q$select public.approve_email(null)$q$, 'not an email address', 'AP7c: ...or nothing');
select t.expect_count($q$select 1 from public.list_pending_approvals() where email = 'new.person@example.com' and approved_by_name = 'Ada Admin'$q$, 1,
  'AP8: the new approval waits for an account, and says who approved it');
select t.expect_count($q$select 1 from public.list_pending_approvals()$q$, 1, 'AP8b: an approval that has an account is not waiting');
select t.expect_count(
  $q$select 1 from public.list_accounts() where
       (email, display_name, is_admin) in (('admin@ap.test', 'Ada Admin', true), ('player@ap.test', 'Pat Player', false),
                                           ('stranger@ap.test', 'stranger', false), ('approved@ap.test', 'Abe Approved', false))$q$, 4,
  'AP9: an admin lists every account with its email, name and whether it is an admin');
select t.expect_count($q$select 1 from public.list_accounts() where email = 'admin@ap.test' and last_sign_in_at = '2026-09-20T10:00:00Z' and created_at is not null$q$, 1,
  'AP9b: ...and when it was made and last signed in');

select t.act_as_superuser();
select t.expect_count($q$select 1 from public.approved_emails where email = 'new.person@example.com' and approved_by = 'c9000000-0000-0000-0000-000000000001'$q$, 1,
  'AP10: the approval records who approved it');
select t.expect_denied($q$insert into public.approved_emails (email) values ('Mixed@Example.com')$q$, 'AP10b: the table itself refuses an email that is not lower-case');

-- ═══ 4. The hook, called the way Supabase Auth calls it ═════════════════
set local role supabase_auth_admin;
select t.expect_count($q$select 1 where public.hook_require_approved_email('{"user":{"email":"New.Person@example.com"}}') = '{}'::jsonb$q$, 1,
  'AP11: the hook lets an approved email make an account, whatever its case');
select t.expect_count(
  $q$select 1 where public.hook_require_approved_email('{"user":{"email":"friend@example.com"}}')
       = '{"error": {"http_code": 403, "message": "this email is not approved to make an account"}}'::jsonb$q$, 1,
  'AP12: the hook refuses an email nobody approved, with a 403');
select t.expect_count($q$select 1 where public.hook_require_approved_email('{"user":{"phone":"15550000000"}}') ? 'error'$q$, 1,
  'AP12b: ...and an account with no email');
select t.expect_denied($q$select approved_by from public.approved_emails$q$, 'AP13: Supabase Auth reads only the email column');
select t.expect_denied($q$insert into public.approved_emails (email) values ('friend@example.com')$q$, 'AP13b: ...and cannot approve one');
select t.expect_denied($q$delete from public.approved_emails$q$, 'AP13c: ...or remove one');
select t.expect_denied($q$select * from public.site_admins$q$, 'AP13d: ...or read the site admins');
reset role;

-- ═══ 5. An approval in use is kept; one not in use can be revoked ══════
insert into auth.users (id, email) values ('c9000000-0000-0000-0000-000000000005', 'new.person@example.com');
select t.act_as('c9000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.list_pending_approvals()$q$, 0, 'AP14: once its account is made, an approval no longer waits');
select t.expect_denied_with($q$select public.revoke_approval('new.person@example.com')$q$, 'already has an account', 'AP15: an approval an account uses cannot be revoked');
select t.expect_count($q$select 1 from (select public.approve_email('later@example.com')) x$q$, 1, 'AP16: an admin approves another email');
select t.expect_count($q$select 1 from (select public.revoke_approval(' Later@Example.com ')) x$q$, 1, 'AP16b: ...and revokes it before anyone uses it');
select t.expect_count($q$select 1 from public.list_pending_approvals()$q$, 0, 'AP16c: ...so it no longer waits');
select t.expect_denied_with($q$select public.revoke_approval('later@example.com')$q$, 'is not approved', 'AP17: revoking it again says it is not approved');
set local role supabase_auth_admin;
select t.expect_count($q$select 1 where public.hook_require_approved_email('{"user":{"email":"later@example.com"}}') ? 'error'$q$, 1,
  'AP17b: the hook refuses a revoked email');
reset role;

-- ═══ 6. At most 20 approvals wait for an account ═══════════════════════
select t.act_as('c9000000-0000-0000-0000-000000000001');
do $$
begin
  for i in 1..20 loop
    perform public.approve_email('wait' || i || '@example.com');
  end loop;
end $$;
select t.expect_count($q$select 1 from public.list_pending_approvals()$q$, 20, 'AP18: 20 approvals can wait');
select t.expect_denied_with($q$select public.approve_email('wait21@example.com')$q$, 'already 20 approved emails', 'AP19: a 21st is refused');
select t.expect_count($q$select 1 from (select public.approve_email('player@ap.test')) x$q$, 1, 'AP19b: an email that already has an account does not wait, so it can still be approved');
select t.expect_count($q$select 1 from (select public.revoke_approval('wait1@example.com')) x$q$, 1, 'AP19c: revoking one...');
select t.expect_count($q$select 1 from (select public.approve_email('wait21@example.com')) x$q$, 1, 'AP19d: ...makes room for another');

-- ═══ 7. An admin removed with `npm run admins remove` loses the rights at once ═══
select t.act_as_superuser();
delete from public.site_admins where user_id = 'c9000000-0000-0000-0000-000000000001';
select t.act_as('c9000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 where not public.is_site_admin()$q$, 1, 'AP20: a removed admin is told they are not one');
select t.expect_denied_with($q$select public.approve_email('friend@example.com')$q$, 'only a site admin', 'AP20b: ...and can approve nobody');

-- ═══ 8. Five characters that are not deleted ═══════════════════════════
select t.act_as('c9000000-0000-0000-0000-000000000002');
do $$
begin
  for i in 1..5 loop
    insert into public.characters (owner_id, character_name) values ('c9000000-0000-0000-0000-000000000002', 'C' || i);
  end loop;
end $$;
select t.expect_count($q$select 1 from public.characters$q$, 5, 'AP21: a person can have five characters');
select t.expect_denied_with($q$insert into public.characters (owner_id, character_name) values ('c9000000-0000-0000-0000-000000000002', 'C6')$q$,
  'already have 5 characters', 'AP22: a sixth is refused');
select t.expect_count($q$select 1 from (select public.delete_character((select id from public.characters where character_name = 'C1'))) x$q$, 1,
  'AP23: deleting one...');
select t.expect_affects($q$insert into public.characters (owner_id, character_name) values ('c9000000-0000-0000-0000-000000000002', 'C6')$q$, 1,
  'AP23b: ...makes room for a new one');
select t.expect_denied_with($q$select public.undelete_character((select id from public.characters where character_name = 'C1'))$q$,
  'already have 5 characters', 'AP24: bringing one back over the limit is refused');
select t.expect_count($q$select 1 from public.characters where character_name = 'C1' and deleted_at is not null$q$, 1, 'AP24b: ...and it stays deleted');
select t.expect_count($q$select 1 from (select public.delete_character((select id from public.characters where character_name = 'C2'))) x$q$, 1,
  'AP25: with room again...');
select t.expect_count($q$select 1 from (select public.undelete_character((select id from public.characters where character_name = 'C1'))) x$q$, 1,
  'AP25b: ...a deleted character can be brought back');

\echo ALL APPROVAL TESTS PASSED
rollback;
