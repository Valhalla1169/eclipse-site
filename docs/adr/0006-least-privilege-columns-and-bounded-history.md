# ADR 0006: Least-privilege columns, bounded history, and safer configuration

Status: Accepted
Date: 2026-09-19
Amends: ADR 0002 (the sheet-size cap), ADR 0003 (grants are now per column), ADR 0004
(history retention)
Amended by: ADR 0011 (`characters.campaign_id` is gone; `deleted_at` is server-controlled)
Migration: `supabase/migrations/0006_least_privilege_columns_and_bounded_history.sql`

## Context

A security and quality audit of everything built so far. The database was checked live (its
real catalog, and by probing it as an anonymous visitor), compared against the repo's migration
chain (no drift), and attacked as an ordinary player. The client code was scanned for dangerous
sinks, dead code and leftovers.

What held up: RLS is on for every table; every policy is scoped to `authenticated`; anon can read,
write and call nothing; every `SECURITY DEFINER` function pins `search_path` and is unreachable by
anon; no client role can create objects in `public`; there is no OpenAPI or GraphQL exposure; no
secrets are committed; and no dangerous DOM sinks exist in the client.

## Findings and decisions

### 1. Writes were granted on every column (database)

`INSERT` and `UPDATE` were granted on whole tables, so a client could rewrite columns the server
should control: `characters.id` (which silently breaks the link to a character's history),
`created_at`, and, for a DM, `campaigns.id`. **Decision:** grant writes per column, exactly the
ones the app uses (`profiles`: `id, display_name`; `campaigns`: `dm_id, name` on insert and `name`
on update, so a campaign can never change hands; `characters`: `owner_id, campaign_id,
character_name, data, schema_version`). `owner_id` and `campaign_id` stay updatable only so an
upsert works; the identity-lock trigger still refuses any real change. `grants.test.sql` asserts the
exact column lists.

### 2. `schema_version` was unconstrained and history was unbounded (database)

`schema_version` took any integer, and every change is snapshotted with no pruning, so a member
flipping it in a loop stored one snapshot per flip without limit, enough to fill the database and
take the whole project down (reproduced: 200 flips, 200 snapshots). **Decision:**
`schema_version` is limited to 1 to 1000 and can only increase for a client (a stale cached tab can
no longer downgrade a migrated sheet; the project owner is exempt so the restore recipe still
works), and `schema_change` snapshots are pruned to the newest 10 per character. Edit snapshots
stay at 30, and `delete` snapshots are kept indefinitely.

### 3. The sheet-size cap was a guess (database)

Measured against V4's real state shape: a blank sheet is 1.5 KB, and an absurdly full one (50
items in every list, long text everywhere, 500 log lines) is 361 KiB. **Decision:** the cap on
`characters.data` drops from 1 MiB to 512 KiB.

### 4. The generated `supabase/config.toml` could overwrite live settings (configuration)

`npx supabase config push` writes every declared property to the live project, and the template
`supabase init` generated declared local-development values. A push would have replaced the
redirect URLs (breaking magic links) and switched **email confirmation off**. The CLI also fills
undeclared sections with its own defaults, so "declare less" does not make it safe. **Decision:**
the file is minimal and mirrors the live values, so `config diff` shows only deliberate changes.
It found two now: the live Site URL is still `http://localhost:3000` (it must be
`https://eclipse.deyderae.dev`, since expired sign-in links fall back to it), and an unused phone
(Twilio) login provider is switched on (declared off).

### 5. A failed revoke could erase the once-only invite link (client)

The error from a failed revoke was written into the same container that shows a new invite link,
which can never be shown again. **Decision:** errors have their own container.

### 6. Headers and tooling

- `Referrer-Policy: no-referrer` (an invite code is in the URL path) and `X-Robots-Tag: noindex,
  nofollow` (a private app should not be indexed).
- `package.json`: `private: true`, the license set to `UNLICENSED` until the owner chooses one,
  wrangler pinned like the other tools, the meaningless `main` and empty fields removed, and a real
  `test` script.
- The three copies of the SQL test helpers are now one `supabase/tests/helpers.sql`, and the
  print-only `rls_policies.test.sql` (which could not fail a CI run) is replaced by the
  self-asserting `rls_core.test.sql`. `npm run test:db` runs the whole chain, and `npm test` runs
  the unit tests, so the tests live in the repo instead of a scratch folder.

## Accepted risks and open items

- **Open sign-up plus magic links can be abused to send email.** Anyone can ask Supabase to email a
  sign-in link to any address, which spends the project's email quota and can lock real players out
  of receiving theirs. The per-address limit (1 minute) does not stop this. Options: turn sign-up
  off once the group has signed in (existing players can still sign in), or add a CAPTCHA (Cloudflare
  Turnstile) to the sign-in form, which needs CSP additions. Recommended: turn sign-up off after
  onboarding.
- **The DM can read a character's history**, including content a player later deleted. That is
  consistent with the DM reading every sheet, but it is a privacy decision to confirm.
- **No rate limit on a member's writes.** A member can still write their own sheet (up to 512 KiB) as
  fast as they like. Acceptable for a group of friends; storage growth is bounded by the history
  limits above.
- **Display names can imitate others** (look-alike characters, "The DM"). Visible only to people in
  the same campaign; accepted.
- **`localhost:8787` stays in the production redirect allowlist** so local development works. Remove
  it if you stop developing against this project, or use a separate development project.
