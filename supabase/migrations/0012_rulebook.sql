-- Eclipse — the rulebook (docs/adr/0016).
--
--   * rulebook: one row, the book's title and version.
--   * rulebook_pages: one row for each chapter, in the order of `position`, with its
--     Markdown text.
--   * Only a signed-in person reads them. No client role writes them: the owner replaces
--     the whole book in one transaction with `npm run rulebook push`.
--
-- The book's text is not in this repo, which is public.
-- Every new table gets its GRANTs here, next to its policies (ADR 0003).

create table public.rulebook (
  id      boolean primary key default true check (id),
  title   text not null check (char_length(title) between 1 and 200),
  version text not null check (char_length(version) between 1 and 100)
);

-- The slug is the page's address: /rules/<slug>. The limits are the ones that
-- scripts/rulebook.mjs checks before an upload.
create table public.rulebook_pages (
  position integer primary key check (position between 0 and 9999),
  slug     text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  title    text not null check (char_length(title) between 1 and 200),
  body     text not null check (octet_length(body) <= 262144)
);

alter table public.rulebook enable row level security;
alter table public.rulebook_pages enable row level security;

create policy "Signed-in people read the rulebook"
  on public.rulebook for select
  to authenticated
  using (true);

create policy "Signed-in people read the rulebook's pages"
  on public.rulebook_pages for select
  to authenticated
  using (true);

revoke all on table public.rulebook, public.rulebook_pages from anon, authenticated;
grant select on table public.rulebook, public.rulebook_pages to authenticated;
