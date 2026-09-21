# ADR 0005: Only allow-listed people create campaigns; players join with hashed, expiring invites

Status: Accepted
Date: 2026-09-19
Amended by: ADR 0012 (a preview before joining, the invite recorded on the membership, replacing
a link, limits on how many invites a campaign has).
Amends: ADR 0001 (campaign creation, the invite mechanism, profile visibility),
ADR 0002 (the "rejoin with the code" restore flow)
Migration: `supabase/migrations/0005_creator_allowlist_and_hashed_invites.sql`
Tests: `supabase/tests/access_model.test.sql` (59 checks) and the updated `grants.test.sql`
Tool: `npm run creators` (`scripts/creators.mjs`)

## Context

The owner wants to be the only person who can create a campaign (or to choose
exactly who can), and wants players to be able to join a campaign, and create
their character, only through a link the DM provides.

As built through ADR 0004, none of that was true:

- Any signed-in user could create a campaign. With public sign-up open, that
  meant anyone who found the site.
- A campaign had one permanent, plaintext `invite_code`, readable through the
  API by every player in it, valid forever, with no way to revoke it.
- Any signed-in user could read every other user's display name.

## Decision

### 1. A creator allowlist

`campaign_creators (user_id)` lists who may create a campaign. The `campaigns`
INSERT policy requires the caller to be on it (`is_campaign_creator()`) as well as
naming themselves as DM. Nobody can add themselves: the table has no client write
grant at all. It changes only from outside the app, with `npm run creators add
<email>` (which uses the project owner's CLI login) or SQL as the project owner. A
person must have signed in once before they can be added, because the list is
keyed by their account. Adding or removing someone never touches existing
campaigns.

### 2. Invites replace the campaign code

`campaign_invites` holds one row per invite the DM creates:

- **Server-generated, 120 bits.** `create_invite()` builds the code from
  `gen_random_uuid()` (a CSPRNG) with the fixed version/variant nibbles dropped:
  30 uppercase hex characters. The client never invents a code.
- **Stored only as a SHA-256 hash.** The plaintext exists once, in the
  `create_invite()` response, and the DM sees the link exactly once. A database
  leak or a read of the table yields no usable link. An unsalted fast hash is the
  right tool for a high-entropy random token (there is nothing to brute-force).
  The DM cannot read `code_hash` at all: column-level grants expose only metadata.
- **Expiring.** 1 hour to 30 days; the UI defaults to 7 days.
- **Limited.** 1 to 50 uses; the UI defaults to 1. `join_campaign()` locks the
  invite row (`for update`), so concurrent joins can never exceed the limit.
- **Revocable** by the DM (`revoke_invite()`), and labelled ("for Sam") so the DM
  can tell them apart.
- **One error for every failure.** A wrong, expired, revoked or used-up code all
  answer `invalid invite code`, so a caller cannot probe which it was.
- **Idempotent for members.** Someone already in the campaign who re-opens their
  link gets the campaign back without using the invite up again.
- The DM cannot join their own campaign as a player.
- `campaigns.invite_code` is dropped (the live project held no campaigns).

Creating a character still requires membership (ADR 0002), so a link is also the
only way to get a character into a campaign.

### 3. Profiles are visible only to people you share a campaign with

A profile is readable by its owner and by anyone who is in a campaign with them
(as its DM or as a player), through `shares_campaign_with()`. A signed-up
stranger sees nothing about anyone.

## Consequences

- **Restoring a removed player now takes a new invite.** ADR 0002 said they
  rejoin with the code; a used-up invite no longer works. The DM creates a fresh
  one. Their sheet is untouched (ADR 0001) and is still readable to them.
- **Sign-up can stay open.** An account with no allowlist entry and no invite can
  create nothing, join nothing and read nothing. Public sign-up in the Supabase
  dashboard can be turned off once everyone has signed in, as an extra layer;
  after that, a brand-new player cannot sign in until it is re-enabled or the
  owner invites them from the dashboard.
- **The link contains the code in its path** (`/join/<code>`), so it can appear
  in browser history and in the host's request logs. The hash-at-rest, expiry,
  use limit and revocation are what bound that. The `Referrer-Policy` header
  stops it leaking to other sites. A URL fragment would keep it out of server
  logs but does not survive the magic-link redirect cleanly, so it was not used.
- **No rate limit on `join_campaign()`.** With 120 bits of entropy a guess
  cannot succeed, so a throttle adds cost without adding safety. Revisit if codes
  ever get shorter.
- **The invite code is no longer readable through the API by players.** That
  closes the gap noted after Phase 2.
- **The allowlist is the owner's responsibility.** Nobody is on it until the owner
  adds themselves, so campaign creation is closed by default.

## Operating it

```
npm run creators add you@example.com       # use the email you signed in with; after you have signed in once
npm run creators list
npm run creators remove someone@example.com
```
