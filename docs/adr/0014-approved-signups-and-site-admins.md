# ADR 0014: Only approved emails make accounts; site admins; five characters each

Status: **Accepted.** Built.
Date: 2026-09-24
Amends: ADR 0004 (the scale), ADR 0005 (why sign-up could stay open) and ADR 0011 (the character
limit).
Migration: `supabase/migrations/0011_approved_signups_and_site_admins.sql`.
Tests: `supabase/tests/approvals.test.sql` (75 checks), the extended `grants.test.sql`,
`characters.test.sql`, `tests/unit/config.test.js`, `tests/e2e/admin.spec.js`, and the sign-up and
limit tests in `tests/e2e/auth.spec.js` and `tests/e2e/characters.spec.js`.
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

`approved_emails` holds the emails a site admin approved, lower-cased, with who approved each, when,
and when the approval ends: **an approval lasts 7 days**. Supabase Auth calls a Postgres function,
`hook_require_approved_email(event)`, before it makes an account for a password sign-up or for a
magic link to a new email. It answers `{}` for an email with an approval that has not ended, and
refuses every other one with
`{"error": {"http_code": 403, "message": "this email is not approved to make an account"}}`. This is
Supabase's "before user created" hook. Its shapes and grants follow the Supabase docs:
<https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook> and
<https://supabase.com/docs/guides/auth/auth-hooks>.

- Only the owner can make an account that skips the gate: an account made in the Supabase dashboard,
  or with the service role key, does not call the hook.
- The hook runs as `supabase_auth_admin`, not as its owner (the docs advise against `security
  definer`). That role gets exactly what the function needs: `usage` on `public`, `execute` on the
  hook, `select` on the two columns `approved_emails.email` and `expires_at`, and an RLS policy for
  that role only. `public`, `anon` and `authenticated` cannot execute it.
- `enable_signup` stays `true` in `supabase/config.toml`. The hook is the gate, set there as
  `[auth.hook.before_user_created]`, and `tests/unit/config.test.js` fails if it is off or names a
  function no migration makes.
- The hook runs inside Supabase. The service role key stays out of the app and out of the Worker, and
  there is no new server to run (DESIGN.md 5.3, 5.6).

**An account counts only once its email is confirmed.** Auth makes the account at sign-up, before
the email is confirmed. Until then it may belong to anyone who knew the approved email and signed up
first. So an approval with only an unconfirmed account still "waits" and can be revoked, and the
Admin page marks such an account "Not confirmed".

**An approval is kept after its account is made**, not marked "used". An approval "waits" while no
confirmed account has its email, and is "in use" when one does. The reasons:

- The hook runs before Auth makes the account, outside the transaction that makes it, so it cannot
  know that the account was made, or confirmed. A mark set there could be wrong.
- Keeping the hook read only keeps `supabase_auth_admin` at two columns and one privilege.
- The state comes from `auth.users` every time it is read, so it cannot drift. An account that changes
  its email frees its approval, which then waits again and can be revoked.

**An approval that ends stays in the list, marked expired**, folded under "Expired approvals" on the
Admin page, with **Approve again** and **Revoke**. The admin sees who never made their account and
decides: approve again (7 more days) or remove it. Hiding it would leave rows that nobody can see or
clear. Only approvals that have not ended count toward the 20 that can wait.

### 2. Site admins

`site_admins` (keyed by `user_id`) says who may approve emails. No client role can read or write it,
and RLS with no policy refuses every row as a second layer. The owner manages it with
`npm run admins add|remove|list <email>`. `npm run admins approve <email>` approves an email (or
renews its approval) when no admin can, such as the owner's own when no account exists yet. The owner
and a separate account for the AI assistant are the admins.

A site admin is not a Keeper and not a campaign creator. A site admin approves people for the site; a
Keeper runs a campaign and invites players to it; `campaign_creators` (ADR 0005) is unchanged.

The functions an admin calls are `security definer`, pin `search_path`, can be executed by
`authenticated` only, and refuse anyone who is not a site admin with "only a site admin can ...":

| Function | What it does |
|---|---|
| `is_site_admin()` | Whether the caller is an admin. The app uses it to show the Admin link and page; if it fails, the app treats the person as not an admin |
| `approve_email(email)` | Approves an email, trimmed and lower-cased, for 7 days, or renews its approval. An email that already has a confirmed account needs none, and the answer says so. At most 20 approvals that have not ended can wait for an account |
| `revoke_approval(email)` | Removes an approval that no confirmed account uses |
| `list_accounts()` | Every account: email, display name, when it was made, when it last signed in, when its email was confirmed, and whether it is an admin |
| `list_pending_approvals()` | The approvals that no confirmed account uses, ended ones too, with who approved each and when each ends |

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
- A refused sign-up gets the same text as any other: "Check your email. If *email* is approved and
  has no account yet, we sent a link to confirm it." A refused magic link gets the same text as a
  sent one: "If *email* can sign in here, we sent a link." So the page's own words do not tell whether
  an email is approved or has an account (ADR 0007). The HTTP status and Auth's rate-limit answers
  still can (see Consequences).
- After an approval, the Admin page shows the sign-up link to send and when the approval ends. For an
  email that already has an account it says so, and shows no link.

## Operating it

1. Approve the email on the Admin page, send the person the sign-up link, and ask them to sign up
   and confirm their email **right away**.
2. If the Admin page shows an account "Not confirmed" that the person did not make, someone else
   signed up first with their email. The owner deletes that account in the Supabase dashboard
   (Authentication, Users), and an admin approves the email again.
3. After the database is emptied: `npm run admins approve <owner email>`, make the account and
   confirm it, then `npm run admins add <owner email>`.

## Consequences

- Nobody can make an account until an admin approves the email.
- The migration must be applied before the hook is set in the project's settings, or Auth calls a
  function that does not exist and every sign-up fails. The app must be deployed after the migration
  too, but a failed admin check only hides the Admin link.
- **The remaining risk: someone who knows an approved email can sign up with it first**, with their own
  password, while the approval lasts. If the real person then confirms that account from their inbox,
  the other person knows its password. The 7-day limit, "sign up right away", and the "Not confirmed"
  mark bound this; the person can also reset the password. An approved person can fill at most 5
  sheets under the 512 KiB cap, plus their history.
- The HTTP answer itself differs: a refused request gets a 403 where an accepted one gets a 200, and a
  second email link within a minute gets a rate-limit answer only for an address that has an account
  or an approval. Someone who reads these can tell those emails apart. That is the price of refusing
  on the server. Supabase's own answer to a sign-up for an existing account is not the same as for a
  new one either (its `identities` list is empty).
- An email link can no longer be sent to an address with no account and no approval: Auth refuses
  before it makes the account, so no email goes out. Anyone can still ask for a link to an existing
  account's address (ADR 0006).
