-- Self-asserting tests for 0007: every new account gets a profile (docs/adr/0007).
-- Order: local_auth_harness.sql, all migrations, then this file. Rolls everything back.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

create function pg_temp.new_user(p_id uuid, p_email text, p_meta jsonb default '{}') returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (p_id, p_email, p_meta);
$$;

-- ═══ The profile comes from the sign-up name ═══════════════════════════
select pg_temp.new_user('d1000000-0000-0000-0000-000000000001', 'dana@x.test', '{"display_name": "Dana Voss"}');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000001' and display_name = 'Dana Voss'$q$, 1,
  'AC1: a new account gets a profile with the name it signed up with');

select pg_temp.new_user('d1000000-0000-0000-0000-000000000002', 'sam@x.test', '{"display_name": "  Sam    the   Bold  "}');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000002' and display_name = 'Sam the Bold'$q$, 1,
  'AC2: the name is trimmed and its spaces collapsed');

select pg_temp.new_user('d1000000-0000-0000-0000-000000000003', 'long@x.test', jsonb_build_object('display_name', repeat('x', 100)));
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000003' and char_length(display_name) = 40$q$, 1,
  'AC3: a name over 40 characters is cut to 40 (the profiles limit) instead of failing');

-- ═══ Fallbacks: sign-up must never fail for lack of a name ══════════════
select pg_temp.new_user('d1000000-0000-0000-0000-000000000004', 'no.name@x.test');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000004' and display_name = 'no.name'$q$, 1,
  'AC4: with no name, the email''s local part is used');

select pg_temp.new_user('d1000000-0000-0000-0000-000000000005', 'blank@x.test', '{"display_name": "   "}');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000005' and display_name = 'blank'$q$, 1,
  'AC5: a name of only spaces counts as no name');

select pg_temp.new_user('d1000000-0000-0000-0000-000000000006', null);
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000006' and display_name = 'Player'$q$, 1,
  'AC6: with no name and no email, the name is "Player"');

select pg_temp.new_user('d1000000-0000-0000-0000-000000000007', 'num@x.test', '{"display_name": 42}');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000007' and display_name = '42'$q$, 1,
  'AC7: a name of the wrong JSON type does not break sign-up');

-- ═══ Stored as text, exactly as given ══════════════════════════════════
select pg_temp.new_user('d1000000-0000-0000-0000-000000000008', 'mk@x.test', $j${"display_name": "<b>x</b> & \"q\" '"}$j$);
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000008' and display_name = $n$<b>x</b> & "q" '$n$$q$, 1,
  'AC8: markup and quotes are stored as plain text (the app only ever renders text)');

-- ═══ A profile problem never blocks an account ═════════════════════════
alter table public.profiles add constraint deny_all check (false) not valid;
select pg_temp.new_user('d1000000-0000-0000-0000-000000000009', 'still@x.test', '{"display_name": "Still Here"}');
select t.expect_count($q$select 1 from auth.users where id = 'd1000000-0000-0000-0000-000000000009'$q$, 1,
  'AC9: the account is created even if the profile insert fails');
select t.expect_count($q$select 1 from public.profiles where id = 'd1000000-0000-0000-0000-000000000009'$q$, 0,
  'AC9b: ...and it simply has no profile (the app makes one)');
alter table public.profiles drop constraint deny_all;

-- ═══ The app can still create a missing profile itself, only for itself ═
select t.act_as('d1000000-0000-0000-0000-000000000009');
select t.expect_affects($q$insert into public.profiles (id, display_name) values ('d1000000-0000-0000-0000-000000000009', 'Made By App')$q$, 1,
  'AC10: a user with no profile can create their own');
select t.expect_denied($q$insert into public.profiles (id, display_name) values ('d1000000-0000-0000-0000-000000000001', 'Hijack')$q$,
  'AC11: ...but not one for someone else');

-- ═══ Who may run the helpers ═══════════════════════════════════════════
select t.expect_denied($q$select public.derive_display_name('{}', 'a@b.c')$q$, 'AC12: a client cannot call the name helper');
select t.expect_denied($q$select public.handle_new_user()$q$, 'AC13: a client cannot call the trigger function');

\echo ALL ACCOUNT TESTS PASSED
rollback;
