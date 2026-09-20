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

You sign in with an emailed magic link, opened in the same browser that asked for it. Sign-in and the
site talk to the real Supabase project (its URL and public anon key are in `public/js/config.js`).

## Tests

```
npm test             # unit tests (Vitest): routing, validation, the creators tool
npm run test:db      # database tests: every migration plus every suite, in a throwaway database
```

`test:db` needs a Postgres it can create a database in (use 17, to match the live project) and the
standard `PG*` variables, for example:

```
PGHOST=127.0.0.1 PGUSER=postgres PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" npm run test:db
```

It never touches your Supabase project. There is no browser test suite in the repo yet.

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

Only `public/` is published. Anything outside it (docs, migrations, scripts, `legacy/`) is never served.

## Layout

| Path | What it is |
|---|---|
| `public/` | The site: `index.html`, `style.css`, `script.js` (theme), `js/` (the app), `vendor/` (the pinned Supabase client), `_headers` (CSP and security headers) |
| `supabase/migrations/` | The schema, policies and grants |
| `supabase/tests/` | The database test suites and their harness |
| `scripts/` | `test-db`, `creators`, `vendor` |
| `tests/unit/` | Unit tests |
| `docs/adr/` | Why the design is the way it is |
| `legacy/` | The original single-file sheets the player sheet is being ported from (not published) |

## Security notes

The Supabase URL and anon key in `public/js/config.js` are public by design; access is decided by
grants and Row Level Security. Never commit a `service_role`/secret key or the database password.
