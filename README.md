# Eclipse

Live character sheets and a read-only Keeper roster for the campaigns of one tabletop game (Age of Eclipse), at
[eclipse.deyderae.dev](https://eclipse.deyderae.dev). A plain HTML/CSS/JS single-page app on
Cloudflare Workers static assets, with Supabase (Postgres, Auth, Realtime) as the backend.

This is one subdomain of `deyderae.dev`. The domain-wide design document lives in the
`deyderae-site` repo (`DESIGN.md`); read it, and [`CLAUDE.md`](CLAUDE.md), before changing anything.

## Development

```
npm install
npm run dev          # http://localhost:8787 (npm run dev 8810 for another port)
```

`npm run dev` uses the **staging** Supabase project, never the live one (ADR 0015). It serves a copy
of `public/` from `.wrangler/dev-public` and keeps it in step with your edits. Only two files in the
copy change: `_headers` (the CSP) and `js/config.js` name staging. The staging URL and public anon
key are in `supabase/staging.json`, and its settings in `supabase/staging.config.toml`.

Keep staging up to date with the repo. These commands always name the staging project, so they
cannot reach the live one:

```
npm run staging check      # what a push would change (read-only)
npm run staging push       # push new migrations, then the staging settings
```

Staging starts with no accounts. To get one:

```
npm run admins approve you@example.com staging
# sign up at http://localhost:8787/signup with exactly that email, and confirm it
npm run admins add you@example.com staging       # to use the Admin page there
npm run creators add you@example.com staging     # to create campaigns there
```

Staging has no custom SMTP, so Supabase's built-in mailer sends its emails (confirmation, reset,
sign-in link). It sends only to members of the Supabase organisation, and only a few an hour.
Emailed links go to port 8787. The live project sends its emails through Resend from
`no-reply@mail.deyderae.dev`; that key is in `supabase/.env`, which is not committed.

You create an account with an email a site admin has approved and a password (at least 12
characters), or sign in with an emailed link, opened in the same browser that asked for it.

## Tests

```
npm test             # unit tests (Vitest): rules, autosave, colour contrast, routing, validation
npm run test:e2e     # browser tests (Playwright, uses Edge) and an accessibility scan, against the local dev server
npm run test:db      # database tests: every migration plus every suite, in a throwaway database
```

`test:db` needs a Postgres it can create a database in (use 17, to match the live project) and the
standard `PG*` variables, for example:

```
PGHOST=127.0.0.1 PGUSER=postgres PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" npm run test:db
```

It never touches your Supabase project. The browser tests use a fake Supabase inside the page, so they
never touch it either. They cannot show that email arrives; check that by hand.

CI (GitHub Actions, [`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all three on every push and pull
request, with the deploy dry run, a check that `npm run vendor` changes nothing, and `npm audit`. Dependabot opens
grouped dependency updates each week.

## The database

Schema changes are new numbered files in `supabase/migrations/`, never edits to an applied one.

```
npx supabase db push --dry-run     # what would be applied
npx supabase db push               # apply it
npx supabase config diff           # what `config push` would change in the project's settings
```

Run `npm run test:db` first. Every new table needs its RLS policy **and** its grants in the same
migration. The reasoning is in [`docs/adr/`](docs/adr/).

## Backups

The free Supabase plan keeps no backup that you can download, so make one on this computer after
each game session, and before a `db push` or other risky work:

```
npm run backup                   # to Documents\Eclipse backups
npm run backup D:\Somewhere      # another folder, never one inside this repo
```

`pg_dump` (PostgreSQL 17 or newer, found in `C:\Program Files\PostgreSQL`, or set `PG_DUMP`) asks
for the database password. If you do not have it, reset it in the dashboard (Project Settings,
Database); nothing else uses it. The script prints the file, its size and the rows in each table.

The file holds all the site's data and every account (`auth.users` and `auth.identities`), with
emails and password hashes. **Keep it secret**: never put it in the repo, a chat or a shared folder.
It has no schema; that comes from `supabase/migrations/`.

Check a file. This loads it into a throwaway database, with the same Postgres and `PG*` variables as
`npm run test:db`, and compares the rows in each table:

```
npm run backup:check "C:\Users\you\Documents\Eclipse backups\eclipse-backup-2026-09-25-134512Z.sql"
```

To restore onto a new Supabase project:

1. `npx supabase link --project-ref <new ref>`, then `npx supabase db push` (the schema).
2. `npx supabase config diff`, then `npx supabase config push` (Auth settings and the sign-up hook).
3. Load the file through the new project's session pooler (dashboard, Connect):
   `psql --single-transaction -v ON_ERROR_STOP=1 -f <file> "postgresql://postgres.<new ref>@<pooler host>:5432/postgres?sslmode=require"`
4. Put the new URL and anon key in `public/js/config.js`, and the new origin in `connect-src` in
   `public/_headers`, then deploy. People sign in again with their old passwords.

## Who can make an account

Only someone whose email a site admin has approved. A site admin approves emails on the Admin page
(`/admin`), and the database refuses every other new account (ADR 0014). An approval lasts 7 days.
Until the person signs up, anyone who knows the email could sign up first, so:

1. Approve the email, send the person the sign-up link, and ask them to sign up and confirm their
   email right away.
2. If the Admin page shows an account "Not confirmed" that the person did not make, delete it in the
   Supabase dashboard (Authentication, Users), then approve the email again.

Nobody can make themselves an admin; you manage the admins with the CLI and your own login:

```
npm run admins approve you@example.com     # an email with no admin to approve it, such as your own at the start
npm run admins add someone@example.com     # after they have made and confirmed their account
npm run admins list
npm run admins remove someone@example.com
```

A site admin is not a Keeper: an admin approves people for the site, and a Keeper runs a campaign. A
person can have 5 characters; for more, they keep a copy of one as a file and delete it.

## Who can create a campaign

Only people on an allowlist. Nobody can add themselves; you manage it with the CLI and your own
login. The person must have an account.

```
npm run creators add someone@example.com
npm run creators list
npm run creators remove someone@example.com
```

Players join only through an invite link the Keeper creates on the Keeper page.

## Deploying

```
npx wrangler deploy --dry-run      # must exit 0; only public/ is uploaded
npm run deploy
```

Only `public/` is published. Anything outside it (docs, migrations, scripts) is never served.

## Releasing a change

1. All tests pass: `npm test`, `npm run test:db`, `npm run test:e2e`, and the dry run
   (`npx wrangler deploy --dry-run`) reads the right file count. CI runs these on every
   pull request; the pull request's checks must be green.
2. For a change with a migration, back up first: `npm run backup`.
3. Merge the pull request into `main`.
4. Database first: `npx supabase db push --dry-run`, then `npx supabase db push`. The
   new code may call a function that the old database does not have yet.
5. Settings, only if `supabase/config.toml` changed: `npx supabase config diff`, then
   `npx supabase config push`.
6. Deploy from `main`: `npm run deploy`.
7. Check the live site: sign in, open a sheet, edit it, look at the Keeper page, and
   (for an admin) the Admin page.

A tab already open keeps the old code until it reloads. A change must keep working
with the database for that old code too, or players must reload.

## Layout

| Path | What it is |
|---|---|
| `public/` | The site: `index.html`, `style.css`, `sheet.css`, `script.js` (theme), `js/` (the app; `js/sheet/` is the character sheet), `vendor/` (the pinned Supabase client), `fonts/` (self-hosted sheet fonts), `_headers` (CSP and security headers) |
| `supabase/migrations/` | The schema, policies and grants |
| `supabase/tests/` | The database test suites and their harness |
| `scripts/` | `test-db` and `backup-check` (with `local-db`, what they share), `backup`, `creators` and `admins` (with `account-lists`, what they share), `dev` (serves a copy of `public/` that talks to staging), `staging` (pushes migrations and settings to staging), `supabase-target` and `projects` (pick live or staging for the scripts above), `vendor` (copies the Supabase client and the fonts into `public/`) |
| `tests/unit/` | Unit tests |
| `tests/e2e/` | Browser tests (Playwright) and the fake Supabase they use |
| `docs/adr/` | Why the design is the way it is |
| `.github/` | The CI workflow and the Dependabot settings |

## Security notes

The Supabase URL and anon key in `public/js/config.js` are public by design; access is decided by
grants and Row Level Security. Never commit a `service_role`/secret key or the database password.

## License

This code and the game text have no license (`UNLICENSED` in `package.json`). All rights are
reserved. A license can be added later, but one cannot be taken back once code is published under
it, so none is granted for now.
