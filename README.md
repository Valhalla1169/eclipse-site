# Eclipse

Live character sheets and a read-only DM roster for one tabletop campaign (Age of Eclipse), at
[eclipse.deyderae.dev](https://eclipse.deyderae.dev). A plain HTML/CSS/JS single-page app on
Cloudflare Workers static assets, with Supabase (Postgres, Auth, Realtime) as the backend.

This is one subdomain of `deyderae.dev`. The domain-wide design document lives in the
`deyderae-site` repo (`DESIGN.md`); read it, and [`CLAUDE.md`](CLAUDE.md), before changing anything.

## Run it locally

```
npm install
npm run dev          # http://localhost:8787
```

You create an account with an email and a password (at least 12 characters), or sign in with an
emailed link, opened in the same browser that asked for it. The site talks to the real Supabase project
(its URL and public anon key are in `public/js/config.js`). Emails (confirmation, reset, sign-in link) are sent by Resend from `no-reply@mail.deyderae.dev`; the
key is in `supabase/.env`, which is not committed.

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

## The database

Schema changes are new numbered files in `supabase/migrations/`, never edits to an applied one.

```
npx supabase db push --dry-run     # what would be applied
npx supabase db push               # apply it
npx supabase config diff           # what `config push` would change in the project's settings
```

Run `npm run test:db` first. Every new table needs its RLS policy **and** its grants in the same
migration. The reasoning is in [`docs/adr/`](docs/adr/).

## Who can create a campaign

Only people on an allowlist. Nobody can add themselves; you manage it with the CLI and your own
login. The person must have signed in once.

```
npm run creators add someone@example.com
npm run creators list
npm run creators remove someone@example.com
```

Players join only through an invite link the DM creates on the DM page.

## Deploying

```
npx wrangler deploy --dry-run      # must exit 0; only public/ is uploaded
npm run deploy
```

Only `public/` is published. Anything outside it (docs, migrations, scripts) is never served.

## Layout

| Path | What it is |
|---|---|
| `public/` | The site: `index.html`, `style.css`, `sheet.css`, `script.js` (theme), `js/` (the app; `js/sheet/` is the character sheet), `vendor/` (the pinned Supabase client), `fonts/` (self-hosted sheet fonts), `_headers` (CSP and security headers) |
| `supabase/migrations/` | The schema, policies and grants |
| `supabase/tests/` | The database test suites and their harness |
| `scripts/` | `test-db`, `creators`, `vendor` (copies the Supabase client and the fonts into `public/`) |
| `tests/unit/` | Unit tests |
| `tests/e2e/` | Browser tests (Playwright) and the fake Supabase they use |
| `docs/adr/` | Why the design is the way it is |

## Security notes

The Supabase URL and anon key in `public/js/config.js` are public by design; access is decided by
grants and Row Level Security. Never commit a `service_role`/secret key or the database password.

## License

This code and the game text have no license (`UNLICENSED` in `package.json`). All rights are
reserved. A license can be added later, but one cannot be taken back once code is published under
it, so none is granted for now.
