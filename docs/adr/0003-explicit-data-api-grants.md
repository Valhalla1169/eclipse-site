# ADR 0003: Grant Data API privileges explicitly, and mirror the platform in tests

Status: Accepted
Date: 2026-09-19
Amends: ADR 0001
Migration: `supabase/migrations/0003_grant_data_api_privileges.sql`
Tests: `supabase/tests/grants.test.sql`, and the stricter `local_auth_harness.sql`

## Context

Two layers guard a table: a **GRANT** decides whether a role may attempt an
operation at all, then **RLS** decides which rows it may touch. `0001` wrote
the RLS policies and never wrote a GRANT.

On this Supabase project the default privileges for a new table in `public`
(read from `pg_default_acl` on the linked project) give `anon` and
`authenticated` only `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN`. They do
not include `SELECT`, `INSERT`, `UPDATE` or `DELETE`. So on the live project:

- every signed-in query would have failed with "permission denied for table";
- `anon` and `authenticated` held `TRUNCATE`, which **bypasses RLS**. It is not
  reachable through the REST API, but no client role should hold it.

This was missed because `local_auth_harness.sql` granted `authenticated` full
CRUD on every table, which is not what the platform does. The RLS suites all
passed against a permissive stand-in for a stricter reality.

## Decision

1. **A migration grants exactly what the policies use, and nothing more.**
   `authenticated` gets select/insert/update on `profiles`; full CRUD on
   `campaigns` and `characters`; **select only** on `campaign_players` (all
   membership changes go through the `SECURITY DEFINER` RPCs). `anon` gets
   nothing, because no part of the app works signed out.
2. **Revoke the platform's stray privileges** (`TRUNCATE`, `REFERENCES`,
   `TRIGGER`) from both roles on these tables.
3. **Function execute rights are explicit.** The RPCs, the two RLS helper
   functions and the invite-code column default are executable by
   `authenticated` only. Trigger functions are executable by no client role.
4. **The test harness mirrors the real platform's defaults** and must never be
   more permissive than it. A test environment that grants more than
   production will hide exactly this class of bug.

## Consequences

- Any new table needs its own GRANT in the same migration that creates it, next
  to its RLS policies (DESIGN.md 5.5: a table is a security decision).
  `grants.test.sql` must be extended with it.
- A signed-out user can read nothing and call nothing. Anything anonymous later
  (a public share link, say) needs its own ADR, a deliberate grant and a policy.
- The Data API depends on these grants, so `supabase db push` must have applied
  `0003` before the app can work.
