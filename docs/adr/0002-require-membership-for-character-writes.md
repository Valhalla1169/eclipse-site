# ADR 0002: Require campaign membership to write a character; server-side invite codes

Status: Accepted
Date: 2026-09-19
Amends: ADR 0001 (the `characters` write policies and invite codes)
Migration: `supabase/migrations/0002_harden_characters_and_invite_codes.sql`
Tests: `supabase/tests/rls_hardening.test.sql`

## Context

ADR 0001 says an owner has "full CRUD on their own row" of `characters`. When
`0001_init.sql` was verified against cases its own suite did not cover, that
turned out to be too loose. The INSERT and UPDATE policies checked only
`owner_id = auth.uid()`, which allowed:

1. A signed-in user who never joined a campaign to insert a character into it
   (any campaign whose id they knew), where the DM could then read it.
2. An owner to `UPDATE campaign_id` and move a sheet into any campaign.
3. A player removed by the DM to keep writing to their sheet.

Separately, nothing generated invite codes (a client had to invent one, and a
one-character code was accepted), nothing bounded the size of a sheet, and
codes were case- and whitespace-sensitive.

## Decision

1. **Writing a character requires current membership.** INSERT and UPDATE on
   `characters` now require `owner_id = auth.uid()` **and**
   `is_player_of_campaign(campaign_id)`. Reads are unchanged.
2. **A character's `owner_id` and `campaign_id` never change**, enforced by a
   `BEFORE UPDATE` trigger (a `WITH CHECK` cannot compare against the old row).
3. **A removed player can still read and export their own sheet but cannot
   write it until they rejoin.** Rejoining with the invite code (idempotent)
   is the restore flow, as in ADR 0001 (since ADR 0005 that takes a fresh invite from the DM, because an invite can be single-use). The DM's read access to a removed
   player's sheet is unchanged, because Restore needs it.
4. **Invite codes are generated in the database** (`generate_invite_code()`,
   10 uppercase hex characters from `gen_random_uuid()`), must match
   `^[A-Z0-9]{6,32}$`, and `join_campaign()` upper-cases and trims its input.
5. **Sheets are bounded in the database** (DESIGN.md 5.5): `character_name` at
   most 100 characters, `data` a JSON object of at most 1 MiB.

## Consequences

- The DM stays strictly view-only, as ADR 0001 decided. Nothing about that
  changed; this ADR only narrows who else can write.
- A player who is removed and then keeps editing will see their writes fail.
  The client should treat that as "you were removed", not as a generic error.
- The 1 MiB cap is generous headroom, not a measured limit. Revisit it against
  a real serialized sheet when the player sheet is ported.
- Invite codes are still shared secrets, and `join_campaign()` still has no
  rate limiting (see ADR 0001, Security notes).
- Every future migration touching these tables must keep
  `rls_policies.test.sql` and `rls_hardening.test.sql` passing (DESIGN.md 6.4).
