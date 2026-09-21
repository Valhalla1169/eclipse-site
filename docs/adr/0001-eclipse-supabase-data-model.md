# ADR 0001: Eclipse data model, auth, and access control on Supabase

Status: Accepted, amended by ADR 0011 (characters belong to people, not campaigns; what the DM reads), ADR 0002 (character writes require membership), ADR 0003 (explicit grants), ADR 0004 (no client deletes, snapshot history), ADR 0005 (campaign creator allowlist, hashed invites instead of a permanent campaign code, profile visibility), ADR 0006 (least-privilege columns), ADR 0007 (password accounts replace magic-link-only sign-in), ADR 0008 (the player sheet), ADR 0009 (the DM roster) and ADR 0010 (version history)
Date: 2026-09-19
Repo: eclipse-site (eclipse.deyderae.dev)

## Context

DESIGN.md §3.3.1 (deyderae-site, the domain-wide design doc) already commits
Eclipse to Supabase (Postgres + Auth + Realtime) as a deliberate exception to
the domain's otherwise Cloudflare D1/KV/R2 default, because Eclipse's access
pattern — a DM and several players sharing live, per-campaign state — needs
row-level multi-tenant access control and live push updates that D1+KV don't
give you directly.

DESIGN.md §8 (open questions) left three things unresolved that this ADR
closes, because they determine the schema and RLS policies directly:

1. **Auth method** — how does a person prove who they are?
2. **DM/player linking** — how does a player end up attached to a specific
   DM's campaign?
3. **DM write access** — can a DM ever edit a player's character sheet?

## Decision

1. **Auth: Supabase Auth, magic link (email, no password).** No password to
   forget, reset, or leak; Supabase issues the email and verifies the click.
   Trade-off accepted: a player without email access mid-session is locked
   out until they can check email again — acceptable for a hobby TTRPG tool.

2. **DM/player linking: invite code.** Each campaign gets a unique
   `invite_code` (short, unguessable-enough for a hobby app, not
   cryptographically hardened — see Security notes below). The DM shares it
   out-of-band (Discord, in person). A player calls the `join_campaign(code)`
   RPC function once signed in, which look up the campaign server-side and
   inserts their `campaign_players` row. There is deliberately **no** client
   SELECT policy on `campaigns` by `invite_code` — that lookup only happens
   inside the `SECURITY DEFINER` function, so the invite-code space can't be
   enumerated by a signed-in stranger running ad hoc queries.

3. **DM access to characters: strictly view-only.** No DM write policy
   exists on `characters`, on any statement type (insert/update/delete), at
   all. The DM's client UI simply never renders editable controls in the
   roster view — but the enforcement is at the database (RLS), not the UI,
   so this holds even if the DM's own client is compromised, buggy, or
   someone opens dev tools. This matches how the original V5 roster's DM
   view worked (read-only roster + archive/restore of *membership*, never of
   sheet contents) and is the safer default for a game where the DM should
   never appear to have silently edited a player's sheet.

## Schema (see `supabase/migrations/0001_init.sql`)

Four tables:

- `profiles` — one row per signed-in person (`id` = `auth.users.id`),
  holding just a `display_name`. `auth.users` itself isn't queryable the way
  app code needs (no RLS, not meant for joins), so this is the public
  RLS-governed mirror. Readable by any signed-in user (display names are
  low-sensitivity and every DM/player needs to see co-players' names);
  writable only by the row's own owner.

- `campaigns` — one row per campaign: `dm_id`, `name`, unique `invite_code`.
  DM has full CRUD on their own campaigns. A player can SELECT a campaign
  they belong to (via the `is_player_of_campaign()` helper, see below). No
  client-side SELECT-by-invite_code policy (see decision #2).

- `campaign_players` — join table (`campaign_id`, `player_id`,
  `joined_at`), primary key `(campaign_id, player_id)`. DM can SELECT their
  roster; a player can SELECT their own membership row. **No direct
  insert/update/delete policy at all** — every membership change goes
  through `join_campaign()`, `leave_campaign()`, or `remove_player()`
  (all `SECURITY DEFINER`), so a player can never self-insert into an
  arbitrary campaign or remove someone else.

- `characters` — one row per player's *current* character in a campaign
  (`owner_id`, `campaign_id`, `character_name`, `data jsonb`,
  `schema_version`, `updated_at`, unique on `(owner_id, campaign_id)`). This
  matches the original roster spec's "no in-app history, the .eclipse file
  export is the backup" model — `data` holds the *entire* serialized sheet
  state (see the `blank()` state shape in
  `legacy/AgeOfEclipseCharacterSheet_V4.html`'s script), not a re-normalized
  set of SQL columns. Owner has full CRUD on their own row. DM has
  SELECT-only on every character row in a campaign they DM — no write
  policy at all (decision #3).

### The RLS-recursion trap (why two helper functions exist)

`campaigns` and `campaign_players` each need to check a fact that lives in
the *other* table (`is this user the DM of this campaign?` / `is this user a
player in this campaign?`). A naive inline subquery causes Postgres to
detect infinite recursion between the two tables' policies and refuse to
evaluate either — this was reproduced directly against a local Postgres 16
instance while building this migration, it is not a hypothetical concern.
The fix, and the standard Supabase/Postgres pattern: `is_dm_of_campaign(uuid)`
and `is_player_of_campaign(uuid)` are `SECURITY DEFINER STABLE` functions
that run as their owner (exempt from RLS, since RLS is never `FORCE`d on
these tables), breaking the cycle. All three affected policies
(`campaigns`' player-read, `campaign_players`' DM-read, `characters`'
DM-read) use these helpers rather than inline subqueries.

### `remove_player()` does not revoke DM read access — intentionally

**Amended by ADR 0011.** A character no longer belongs to a campaign, so the DM reads a character
only while it is active in their campaign. When a player leaves or is removed, the DM keeps a copy
of the sheet as it was then (`departed_sheets`), not the live sheet. The reasoning below is the
original one.

`remove_player(campaign_id, player_id)` deletes the `campaign_players` row
(so the player drops off the "active roster"), but the DM's
`characters`-read policy is grounded in `is_dm_of_campaign(campaign_id)`,
not in current `campaign_players` membership — so the DM can *still* read
(and later restore) a removed player's last character. This is required by
the original roster spec's Restore flow, and was confirmed by direct
testing (see `supabase/tests/rls_policies.test.sql`, TEST 11/12/12b). The
client's "active roster" list must therefore be built by querying
`campaign_players` (the actual source of "who's currently active") joined
against `characters`, not by relying on RLS to hide archived rows from
`characters` alone.

## Realtime

Only `public.characters` is added to the `supabase_realtime` publication —
that's the one table the DM's live view actually needs to watch. A realtime
subscription is still bound by the same RLS policies as a plain SELECT: a
subscription can't leak rows a query couldn't return.

## Security notes / things NOT solved here

- **Invite codes are shared secrets, not cryptographic tokens.** They're
  suitable for a hobby game shared with people you know. If codes need to
  be revocable/rotatable, add a `regenerate_invite_code()` function in a
  later migration rather than reusing this one.
- **No rate limiting on `join_campaign()`.** A malicious authenticated user
  could brute-force short invite codes by calling it repeatedly. Acceptable
  for now; flag if this app becomes more widely shared than "your gaming
  group."
- **This ADR does not cover storage of file uploads (character portraits,
  etc.)** — out of scope for the roster/sheet port. If added later, treat it
  as a new ADR per DESIGN.md §7.

## Consequences

- Every DB access from the client goes through Supabase's JS client with
  the signed-in user's JWT — never a service-role key in client code
  (DESIGN.md §5.3).
- The client's storage layer replaces V5's `sGet`/`sSet`/`sDel` +
  Firebase-flavored calls with Supabase `select`/`upsert`/realtime-channel
  calls against these four tables — see
  the later ADRs for what was built.
- RLS tests (`supabase/tests/`) must be run against any future migration
  that touches these tables, per DESIGN.md §6.4's multi-role RLS testing
  requirement.
