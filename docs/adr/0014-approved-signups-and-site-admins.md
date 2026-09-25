# ADR 0014: Only approved emails make accounts; site admins; five characters each

Status: **Accepted.** Built.
Date: 2026-09-24
Amends: ADR 0004 (the scale), ADR 0005 (why sign-up could stay open) and ADR 0011 (the character
limit).
Migration: `supabase/migrations/0011_approved_signups_and_site_admins.sql`.
Tests: `supabase/tests/approvals.test.sql` (61 checks), the extended `grants.test.sql`,
`characters.test.sql`, `tests/e2e/admin.spec.js`, and the sign-up and limit tests in
`tests/e2e/auth.spec.js` and `tests/e2e/characters.spec.js`.
Tool: `npm run admins` (`scripts/admins.mjs`).

## Context

ADR 0005 kept public sign-up open because "an account with no invite and no allowlist entry can
create nothing". ADR 0011 made that false: anyone signed in can make characters, 10 each, and every
restore and every rules update also keeps a copy in the history. One stranger filled 10 MB of the
database in seconds. The free plan's database holds 500 MB.

The owner's numbers: never more than about 10 people on the site, and at most 4 campaigns (1 or 2 for
testing, 2 or 3 in use). ADR 0004 said one campaign of about a dozen players.

## Decision

### 1. An account needs an approved email

`approved_emails` holds the emails a site admin approved, lower-cased, with who approved each and when.
Supabase Auth calls a Postgres function, `hook_require_approved_email(event)`, before it makes any
account. It answers `{}` for an approved email and refuses every other one with
`{"error": {"http_code": 403, "message": "this email is not approved to make an account"}}`. This is
Supabase's "before user created" hook, and it covers every way an account is made: sign-up with a
password, a magic link to a new email, and an account made in the dashboard. Its shapes and grants
follow the Supabase docs:
<https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook> and
<https://supabase.com/docs/guides/auth/auth-hooks>.

- The hook runs as `supabase_auth_admin`, not as its owner (the docs advise against `security
  definer`). That role gets exactly what the function needs: `usage` on `public`, `execute` on the
  hook, `select` on the one column `approved_emails.email`, and an RLS policy for that role only.
  `public`, `anon` and `authenticated` cannot execute it.
- `enable_signup` stays `true` in `supabase/config.toml`. The hook is the gate, set there as
  `[auth.hook.before_user_created]`.
- The hook runs inside Supabase. The service role key stays out of the app and out of the Worker, and
  there is no new server to run (DESIGN.md 5.3, 5.6).

**An approval is kept after its account is made**, not marked "used". An approval is "waiting" while
no account has its email, and "in use" when one does. The reasons:

- The hook runs before Auth makes the account, outside the transaction that makes it, so it cannot
  know that the account was made. A mark set there could be wrong.
- Keeping the hook read only keeps `supabase_auth_admin` at one column and one privilege.
- The state comes from `auth.users` every time it is read, so it cannot drift. An account that changes
  its email frees its approval, which then shows as waiting again and can be revoked.

### 2. Site admins

`site_admins` (keyed by `user_id`) says who may approve emails. No client role can read or write it,
and RLS with no policy refuses every row as a second layer. The owner manages it with
`npm run admins add|remove|list <email>`. `npm run admins approve <email>` approves an email when no
admin can, such as the owner's own when no account exists yet. The owner and a separate account for
the AI assistant are the admins.

A site admin is not a Keeper and not a campaign creator. A site admin approves people for the site; a
Keeper runs a campaign and invites players to it; `campaign_creators` (ADR 0005) is unchanged.

The functions an admin calls are `security definer`, pin `search_path`, can be executed by
`authenticated` only, and refuse anyone who is not a site admin with "only a site admin can ...":

| Function | What it does |
|---|---|
| `is_site_admin()` | Whether the caller is an admin. The app uses it to show the Admin link and page |
| `approve_email(email)` | Approves an email, trimmed and lower-cased. Approving it again changes nothing. At most 20 approvals can wait for an account at one time |
| `revoke_approval(email)` | Removes an approval that no account uses yet |
| `list_accounts()` | Every account: email, display name, when it was made, when it last signed in, and whether it is an admin |
| `list_pending_approvals()` | The approvals that wait for an account, with who approved each |

The Admin page is `/admin`. Anyone who is not an admin gets the same "Not found" page as for a page
that does not exist, and the database refuses them anyway.

### 3. Five characters each

A person can have **5 characters that are not deleted** (ADR 0011 said 10), and 30 in all as before.
Bringing a deleted character back counts too. At 5, the characters page turns off the buttons that make
one and says how to make room: open a character, press **Save a copy** to keep its `.eclipse` file, then
delete it. **New character from a file** makes it again later.

### 4. The scale

About 10 people and up to 4 campaigns. Nothing else in ADR 0004 changes: nothing here needs
pagination, search or caching.

## What people see

- The sign-up page says that only an email a site admin approved can make an account.
- A refused sign-up gets the same answer as any other: "Check your email. If *email* is approved and
  has no account yet, we sent a link to confirm it." A refused magic link gets the same answer as a
  sent one: "If *email* can sign in here, we sent a link." So the page never tells whether an email is
  approved or has an account (ADR 0007).

## Consequences

- Nobody can make an account until an admin approves the email. After the database is emptied, the
  owner runs `npm run admins approve` for their own email, makes the account, then runs
  `npm run admins add`.
- The migration must be applied before the hook is set in the project's settings, or Auth calls a
  function that does not exist and every sign-up fails.
- The worst a stranger can do now is nothing: they cannot make an account. An approved person can fill
  at most 5 sheets under the 512 KiB cap, plus their history.
- The HTTP answer itself differs: a refused request gets a 403 where an accepted one gets a 200. The
  page hides this, but someone who reads the network traffic can tell that an email has no account and
  is not approved. That is the price of refusing on the server. Supabase's own answer to a sign-up for
  an existing account is not the same as for a new one either (its `identities` list is empty).
- An email link can no longer be sent to an address with no account and no approval: Auth refuses
  before it makes the account, so no email goes out. Anyone can still ask for a link to an existing
  account's address (ADR 0006).
