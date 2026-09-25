# ADR 0015: A staging project for development, and a dev copy of the site

Status: **Accepted.** Built.
Date: 2026-09-25
Amends: ADR 0006 (`localhost:8787` in the live redirect list).
Files: `scripts/dev.mjs`, `scripts/staging.mjs`, `scripts/supabase-target.mjs`, `scripts/projects.mjs`,
`supabase/staging.json`, `supabase/staging.config.toml`.
Tests: `tests/unit/projects.test.js`, `tests/unit/config.test.js`, `tests/unit/account-lists.test.js`.

## Context

`npm run dev` served `public/` as it is, so local development used the live Supabase project: its
real accounts, sheets and emails. A mistake while developing could change or lose real data, and
the live project had to allow `http://localhost:8787` as a redirect (ADR 0006).

The published files must name only the live project: `connect-src` in `public/_headers` is the one
Supabase origin the site may talk to.

## Decision

1. **A second Supabase project, staging**, on the free plan. Its URL and anon key (public, like the
   live ones) are in `supabase/staging.json`, and its settings in `supabase/staging.config.toml`:
   the same sign-up hook, password rules and email rules as live, the local dev server as the site,
   and no custom SMTP.
2. **`npm run dev` serves a copy of `public/`** in `.wrangler/dev-public`. The copy changes two
   files: the Supabase origins in `_headers` and the URL and key in `js/config.js` become staging's.
   It follows every edit to `public/` while it runs. If a file no longer names the live project as
   expected, the dev server stops, so it never serves the live policy by mistake. The browser tests
   still serve `public/` itself, with the fake Supabase.
3. **The target is always in the command.** `npm run staging push` (and `check`) and the last word
   `staging` on `npm run admins` and `npm run creators` run the CLI in a new folder outside the repo,
   with the staging config and a copy of the migrations, and `--project-ref` on every command. That
   folder has no link, so a staging command cannot fall back to the live project, and the repo's link
   to live (`supabase/.temp`) is never changed. The scripts refuse a staging URL that names the live
   project. No database password is needed: the CLI uses your login.
4. **Localhost leaves the live redirect list.**

## Consequences

- Development cannot change live data. A new migration goes to staging (`npm run staging push`) and
  to live (`npx supabase db push`) as two steps.
- Staging uses Supabase's built-in mailer. It sends only to members of the Supabase organisation, and
  only a few emails an hour, so only they can confirm a staging account.
- Staging is empty. A developer approves their own email there with `npm run admins approve <email>
  staging`, then signs up at `http://localhost:8787`.
- The free plan pauses a project after a week with no use. Restore staging from the dashboard when
  that happens.
- DESIGN.md §6.6 wants settings that differ by environment kept out of source. Here the two projects'
  public values are in the repo and the dev copy picks staging's; nothing differs by branch.
