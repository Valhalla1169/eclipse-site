# ADR 0007: A proper account system

Status: **Accepted.** Steps 0 and 1 are built, and the player sheet (ADR 0008) and DM roster (ADR 0009) after them. Steps 2 and 3 are still to build.
Date: 2026-09-19
Replaces: the magic-link-only sign-in, the profile step, and the single-campaign home page.

## Problem

Today a person signs in with a magic link only. That has real costs:

- Every new browser or device needs a new email. The link must open in the same browser that
  asked for it (PKCE).
- There is no account page: no password, no change of email, no "sign out everywhere", no list
  of campaigns, no way to leave a campaign or ask for deletion.
- The project sends email with Supabase's **default** sender (custom SMTP is not set on the live
  project). I believe the default sender only delivers to your own team members and has a very
  small quota. If that is true, no other player can receive any sign-in email. **Verify this
  first** (step 0 below).
- The minimum password length on the project is 6, and "secure password change" is off.
- The home page assumes one campaign. The data model already allows several.
- Only an allowlist can create a campaign, and only the CLI edits it.

## Principles

1. **Use Supabase Auth. Do not build our own credential system.** `DESIGN.md` 3.3 and 5.5 say to
   prefer an established provider, and `CLAUDE.md` says not to hand-roll sessions. Supabase Auth
   stores each password as a salted **bcrypt** hash in `auth.users`. Our code never stores,
   hashes, logs or even sees a stored password. It sends the password over TLS to Supabase
   and nothing more. Our own hashing would be a step down.
2. **Passwords follow NIST SP 800-63B ideas:** length over complexity, no forced rotation,
   allow paste and password managers, screen against known-breached passwords.
3. **Defense in depth:** verified email, rate limits, CAPTCHA, optional second factor, generic
   error messages, short-lived tokens, and the strict CSP we already have.
4. **Never lose a character** (ADR 0004). Account deletion is never a client action.

## Design

### 1. Sign-in methods

| Method | Role |
|---|---|
| Email + password | Primary. |
| Magic link | Kept. A fallback and the recovery path. |
| Google sign-in | Not now. Optional later. |
| Passkeys | The server flag exists (off). Evaluate later. |

**Sign-up:** email, display name, password. Supabase emails a verification link. A person cannot
sign in until the email is verified (already enforced on the project).

**Profile:** a database trigger on `auth.users` creates the `profiles` row from the sign-up
name. This removes the "choose a display name" step and the "no profile yet" state. The trigger
is `SECURITY DEFINER` with a fixed `search_path`, and it clamps the name to the existing 1 to 40
character rule.

**Log in:** `signInWithPassword`. Every failure says "email or password is wrong". Nothing says
whether the email exists.

**Forgot / reset password:** emailed link, then a `/reset-password` page (Supabase's
`PASSWORD_RECOVERY` event). After a reset, all other sessions are signed out.

**Sessions:** unchanged. A 1-hour access token and a rotating refresh token, kept in
`localStorage`. The strict CSP is the protection against script injection. (Cookie sessions
through a Worker are stronger against token theft but add a server component. Revisit later.)

### 2. Passwords

- Stored: bcrypt, by Supabase. We change none of it.
- **Minimum 12 characters** (Supabase `minimum_password_length`, enforced on the server). Maximum
  72 bytes, which is bcrypt's limit. No composition rules (no "must have a symbol"). No expiry.
- Screening against breached passwords. Supabase's own check is, I believe, a paid-plan feature.
  The alternative is a browser-side check with the Have I Been Pwned range API (only the first
  5 characters of a hash leave the browser). It needs one CSP origin and is advice, not a
  server rule.
- Password fields use `autocomplete="new-password"` and `"current-password"`, and a show/hide
  button.
- No security questions, no hints, no SMS codes.
- The owner never sets a password for someone. The owner can only trigger a reset email.

### 3. Email (prerequisite for everything else)

Custom SMTP through a transactional provider. It is Resend, sending from
`no-reply@mail.deyderae.dev`. SPF, DKIM and DMARC records go in Cloudflare DNS. Templates are
written for: confirm sign-up, magic link, reset password, change email, reauthenticate. The
project's Auth rate limit for emails is raised to match.

### 4. Abuse protection

- **CAPTCHA** (Cloudflare Turnstile, supported by Supabase Auth) on sign-up, log-in and reset. It
  needs two CSP additions (its script and frame origin).
- Tune the Supabase Auth rate limits (sign-ups and sign-ins per IP).
- Open sign-up plus email links can be used to send email to strangers. CAPTCHA and custom
  SMTP together close this. (The audit in ADR 0006 named this risk.)
- Generic messages everywhere (no email enumeration). Redirects go only to the allowlisted URLs.

### 5. Account page

`/account`: display name; change email (both addresses must confirm, already on); change
password (turn **on** `secure_password_change`, so a stolen session cannot change it without a
recent sign-in); enable two-factor (TOTP); "sign out everywhere else"; "request account
deletion".

### 6. Second factor (optional phase)

TOTP for everyone who wants it. For campaign creators and DMs, recommend requiring it: a
policy checks `aal2` in the token for creating a campaign and creating an invite, but only for
people who have enrolled a factor. A lost device is reset by the owner.

### 7. Data model

The current tables already give "characters in any campaign I belong to" and "manage my own
campaign". So the model changes are small:

- Profile trigger (above). No other `profiles` change.
- **Who may create a campaign** is decision D1 below.
- **Dashboard.** `/` lists every campaign the person runs or plays in. A person can run one
  campaign and play in others. A DM still cannot also play in their own campaign.
- **Built in ADR 0011:** several characters per person, one active per campaign. Anyone signed in
  can now make characters, so "an account with no invite can do nothing" no longer holds; sign-up
  needs CAPTCHA (step 3) more than before.
- **Optional, later:** transfer a campaign to another member; a co-DM role. I do not recommend a rebuild into a general
  `campaign_members` table now. Nothing asks for it.
- **Account deletion** is a CLI script for the owner (like `creators`). It refuses if the
  person runs a campaign. The character history trigger snapshots their sheets first.
  It can also export a person's data.

### 8. What gets replaced

- `signInView` (magic-link only), `ensureReady` and the profile screen.
- `auth.js` grows: `signUp`, `signInWithPassword`, reset and update functions, MFA.
- New routes: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/account`, and a
  `/` dashboard.
- A validated `?next=` return path (same-origin paths only).

### 9. Rollout

- **Step 0 (done):** custom SMTP through Resend and its DNS records are set up, and mail reaches
  non-team addresses. `minimum_password_length = 12` and `secure_password_change = true` are
  set in `config.toml` and pushed.
- **Step 1 (built):** password sign-up, log-in, reset, the profile trigger (migration 0007), and
  the account page. The existing account keeps working through the magic link and sets a
  password on the account page. Old and new methods coexist, so nobody is locked out.
- **Step 2:** the dashboard for several campaigns.
- **Step 3:** CAPTCHA, breached-password screening, two-factor.

Every database change is a new numbered migration with tests. Steps 2 and 3 need no data
migration: the live project holds a handful of test accounts and campaigns.

### 10. Threats and answers

| Threat | Answer |
|---|---|
| Guessing or stuffed passwords | Server rate limits, CAPTCHA, breached-password screening, 12-character minimum |
| Password database theft | Salted bcrypt in Supabase. Nothing password-related in our tables or logs |
| Account takeover through email | Verified email, double-confirmed email change, reauthentication for password change |
| Email enumeration | Generic errors and generic reset messages |
| Reset-link abuse | Redirect allowlist, single-use expiring links, sign out other sessions after reset |
| Token theft by script injection | Strict CSP, no inline code, rotating refresh tokens |
| Email bombing | CAPTCHA, per-address cooldown, custom SMTP with its own limits |
| Lost second factor | Owner reset through the CLI |

### 11. Tests

SQL suites for the profile trigger and any policy change (`supabase/tests/accounts.test.sql`).
Vitest for password, return-path and error-message validation. Playwright (`tests/e2e/`) runs
every page flow against the real dev server, so the real CSP applies, with a fake Supabase
in the page. It fails on any CSP violation or uncaught error. Email steps need a manual
checklist until a test inbox is set up: the fake cannot prove that mail arrives.

## Decisions for the owner

| # | Decision | Chosen |
|---|---|---|
| D1 | Who may create a campaign? | Allowlist only. The owner approves each person. Quota later if Eclipse opens to other groups |
| D2 | Sign-in methods | Password plus magic link. Google later |
| D3 | Email provider | Resend |
| D4 | Second factor | Optional for all, required for creators (step 3) |
| D5 | Sessions in `localStorage` or cookies through a Worker | Keep `localStorage` with the strict CSP |
| D6 | Account deletion | Owner-run script, not self-service |
| D7 | Order of work relative to the character sheet | Steps 0 and 1 first, then the sheet, then steps 2 and 3 |

## Assumptions to verify

- Breached-password protection in Supabase is a paid feature.
- Turnstile and passkey behavior in this Auth version (v2.197.0).
