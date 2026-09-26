-- Self-asserting tests for 0012: the rulebook (docs/adr/0016).
-- Order: local_auth_harness.sql, every migration, then this file.
-- Seeds its own made-up book and rolls everything back. Every check raises on failure.
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

begin;

\ir helpers.sql

-- ── seed (as the owner, like npm run rulebook push) ─────────────────────
insert into auth.users (id, email, email_confirmed_at) values
  ('c8000000-0000-0000-0000-000000000001', 'reader@rb.test', now());
insert into public.rulebook (title, version) values ('A Made-up Book', 'test 1');
insert into public.rulebook_pages (position, slug, title, body) values
  (1, 'first-steps', 'First Steps', '# First Steps' || chr(10) || 'Made-up text.'),
  (2, 'second-steps', 'Second Steps', '# Second Steps' || chr(10) || 'More made-up text.'),
  (10, 'last-steps', 'Last Steps', '# Last Steps' || chr(10) || 'The end of the made-up text.');

-- ═══ 1. A signed-in person reads the whole book ═════════════════════════
select t.act_as('c8000000-0000-0000-0000-000000000001');
select t.expect_count($q$select 1 from public.rulebook_pages$q$, 3, 'RB1: a signed-in person reads every page');
select t.expect_count($q$select 1 from public.rulebook_pages where slug = 'last-steps' and body like '%end of the made-up%'$q$, 1,
  'RB1b: ...with its text');
select t.expect_count($q$select 1 from public.rulebook where title = 'A Made-up Book' and version = 'test 1'$q$, 1,
  'RB1c: ...and the book''s title and version');

-- ═══ 2. ...and changes nothing ══════════════════════════════════════════
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (3, 'mine', 'Mine', 'x')$q$,
  'RB2: a signed-in person cannot add a page');
select t.expect_denied($q$update public.rulebook_pages set body = 'changed'$q$, 'RB2b: ...change a page');
select t.expect_denied($q$delete from public.rulebook_pages$q$, 'RB2c: ...remove a page');
select t.expect_denied($q$truncate public.rulebook_pages$q$, 'RB2d: ...empty the book');
select t.expect_denied($q$insert into public.rulebook (title, version) values ('Mine', 'x') on conflict (id) do update set title = 'Mine'$q$,
  'RB2e: ...replace the book''s title');
select t.expect_denied($q$update public.rulebook set version = 'mine'$q$, 'RB2f: ...change its version');
select t.expect_denied($q$delete from public.rulebook$q$, 'RB2g: ...or remove it');
select t.act_as_superuser();

-- ═══ 3. A signed-out visitor reads nothing, and changes nothing ═════════
set local role anon;
select t.expect_denied($q$select slug from public.rulebook_pages$q$, 'RB3: a signed-out visitor cannot read the pages');
select t.expect_denied($q$select count(*) from public.rulebook_pages$q$, 'RB3b: ...not even how many there are');
select t.expect_denied($q$select title from public.rulebook$q$, 'RB3c: ...or the book''s title');
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (3, 'mine', 'Mine', 'x')$q$,
  'RB3d: ...add a page');
select t.expect_denied($q$update public.rulebook_pages set body = 'changed'$q$, 'RB3e: ...change one');
select t.expect_denied($q$delete from public.rulebook_pages$q$, 'RB3f: ...or remove one');
reset role;

-- ═══ 4. The tables keep their shape ═════════════════════════════════════
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (4, 'Big Slug', 'x', 'x')$q$,
  'RB4: a slug is lower-case letters and digits in words joined by hyphens');
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (4, '../admin', 'x', 'x')$q$,
  'RB4b: ...so it cannot leave /rules/');
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (4, 'big', 'x', repeat('x', 262145))$q$,
  'RB4c: a page holds at most 256 KiB');
select t.expect_affects($q$insert into public.rulebook_pages (position, slug, title, body) values (4, 'big', 'x', repeat('x', 262144))$q$, 1,
  'RB4d: ...and 256 KiB is allowed');
select t.expect_denied($q$insert into public.rulebook_pages (position, slug, title, body) values (5, 'no-title', '', 'x')$q$,
  'RB4e: a page has a title');
select t.expect_denied_with($q$insert into public.rulebook_pages (position, slug, title, body) values (1, 'other', 'x', 'x')$q$, 'duplicate key',
  'RB4f: two pages cannot share a place in the book');
select t.expect_denied_with($q$insert into public.rulebook_pages (position, slug, title, body) values (6, 'first-steps', 'x', 'x')$q$, 'duplicate key',
  'RB4g: ...or an address');
select t.expect_denied_with($q$insert into public.rulebook (title, version) values ('Another Book', 'x')$q$, 'duplicate key',
  'RB4h: there is one book');
select t.expect_denied($q$insert into public.rulebook (id, title, version) values (false, 'Another Book', 'x')$q$,
  'RB4i: ...and no second row beside it');
select t.expect_denied($q$update public.rulebook set version = ''$q$, 'RB4j: the book has a version');

\echo ALL RULEBOOK TESTS PASSED
rollback;
