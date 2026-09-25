# ADR 0011: Characters belong to people, not campaigns

Status: **Accepted.** Built.
Date: 2026-09-20
Amended by: ADR 0014 (5 characters that are not deleted, not 10, and only an approved email makes an
account).
Amends: ADR 0001 (what a DM can read), ADR 0002 (who can write a sheet), ADR 0004 (one sheet per
campaign, cascading deletes), ADR 0006 (grants), ADR 0007 (what a new account can do), ADR 0008
(where the sheet lives), ADR 0009 (how the roster reads) and ADR 0010 (restore, and who reads history).
Migration: `supabase/migrations/0009_characters_belong_to_people.sql`.
Tests: `supabase/tests/characters.test.sql` (60 checks), `tests/e2e/characters.spec.js`, and the
rewritten database and browser suites.

## Problem

A character was one row per player per campaign. A player could not make a character before they
had an invite, could not keep one between campaigns, and could not play a different one in the same
campaign without starting over.

## What it is

- A person has up to **10 characters** that are not deleted, and 30 in all. Anyone signed in can
  make one, with or without a campaign. A character has no campaign column.
- In each campaign a player has one **active character** (`campaign_characters`). They join first and
  choose after (`/campaign/:id/character`). Until they choose, the roster says "No character chosen yet".
- A character is active in **one campaign at a time**. To use it elsewhere, choose another
  character in the first campaign, or make a copy (the character is theirs; a copy is a new one).
- The DM reads a character only **while it is active in their campaign**, and reads its history only
  from the time it became active there.
- When a player **leaves or is removed**, the database keeps a copy of their active sheet as it was
  then (`departed_sheets`, newest 3 per player per campaign). The DM reads that copy, never the live
  sheet, because the player owns the character and can keep editing it.
- **Deleting** a character hides it (`deleted_at`). Nothing is removed (ADR 0004). A deleted
  character is read only and does not count toward the 10. It can be brought back if the person has
  room. A character that is active in a campaign cannot be deleted.
- **Make a copy** and **New character from a file** are on the characters page. Both count toward the limits.

## Pages

| Path | What |
|---|---|
| `/characters` | The person's characters, deleted ones, the limits, new / copy / delete / from a file |
| `/characters/:id` | The sheet. `/history` and `/history/:id` are ADR 0010 |
| `/campaign/:id/character` | Choose the character for a campaign, or make a new one |
| `/campaign/:id/dm/:characterId` | The DM's read-only sheet. `/history` and `/history/:id` are new |
| `/campaign/:id/left/:copyId` | The DM's copy of a sheet from when a player left |

`/campaign/:id/play` is gone. Nothing linked to it outside the app.

## Decisions

1. **Ownership is the write rule.** A sheet is written by its owner and nobody else. Membership no
   longer matters, because the reason for it (a stranger writing into a campaign's sheet) is gone.
   The owner can also restore their own history (ADR 0010), except for a deleted character.
2. **The link is only ever changed by functions** (`choose_character`, `leave_campaign`,
   `remove_player`). Two foreign keys make a row impossible to fake: it can only name a character its
   player owns, and only while that player is a member. A unique key on `character_id` makes "one
   campaign at a time" a database rule.
3. **Leaving clears the link and keeps a copy.** The player's character is theirs, so their edits
   after they leave are not the DM's business. The DM keeps what they saw. A player who rejoins
   chooses again.
4. **A DM can read history, since the character became active** (`assigned_at`). The player's history
   from before that, or from another campaign, is not the DM's. The DM has a history page but cannot
   restore anything. It exists so a DM can see how a sheet changed during play. A player who switches
   away and back starts a new window, and the last copy from a player who left is only the sheet at that moment.
5. **Anyone signed in can make characters.** ADR 0007 said an account with no invite and no allowlist
   entry can do and see nothing. That is no longer true. Sign-up is open and needs a confirmed email, and
   CAPTCHA is not built yet (ADR 0007 step 3). The worst case is one account storing 10 sheets under the
   512 KiB size cap, plus history. A trigger enforces the 10 and 30 with a per-person lock.
6. **Realtime.** The roster listens to `campaign_characters` for its campaign, and to `characters`
   without a filter. The database only sends a DM the sheets they can read. An event only tells the page
   to read again.
7. **Old data was kept.** The migration made each existing character the active one for its player
   in its campaign, and each sheet of a player who was no longer a member a departed copy.
   The DM's history window for them starts when the player joined.
8. **`characters.campaign_id` and `character_history.campaign_id` are gone.** Deleting a campaign
   (an owner task) no longer deletes characters. It removes the links and the departed copies.

## Known gaps

- A campaign's name on the sheet is gone from the footer. A "Campaign" entry at the top of the sheet
  is planned.
- Leaving and removing have buttons now (ADR 0012). Coming back still needs a new invite.
- The history a DM reads stops when a player leaves. What the DM keeps is the one departed copy.
- An owner cannot restore a character that is deleted, and a character deleted by an administrator
  is a delete snapshot in `character_history` (ADR 0004).
- Nothing frees a slot except deleting: there is no "archive" apart from delete. A deleted
  character counts toward the 30.
