# ADR 0018: A player can delete their own archived character forever

Status: **Accepted.** Built.
Date: 2026-09-27
Amends: ADR 0004 (never losing a character had no exception) and ADR 0011 (an archived character had
no way off the count except staying archived forever).
Migration: `supabase/migrations/0013_purge_character.sql`.
Tests: `supabase/tests/purge.test.sql`, the extended `supabase/tests/grants.test.sql`,
`tests/e2e/characters.spec.js`, `tests/e2e/admin.spec.js`.

## Context

GitHub issue #12. "Delete" only ever archives a character (`delete_character` sets `deleted_at`), kept
by ADR 0004 so a mistake is never final. An archived character still counts toward the 30-in-all limit
and still holds its owner's history, and some players want a character actually gone: theirs alone,
finished with, not merely hidden.

## Decision

1. **Only the owner, only while archived.** `purge_character(id)` refuses anyone else, including a
   site admin and the Keeper of a campaign the character was once in, and refuses a character that is
   still live. It also refuses one still linked in `campaign_characters`, which should never happen to
   an archived character but is checked anyway. Every refusal gives the same message, so it never says
   whether someone else's character exists.
2. **No waiting time.** Archiving is enough; ADR 0014's approval-style delay does not apply here; the
   player already chose to archive it once.
3. **Everything about the character goes:** every `departed_sheets` copy a Keeper kept from when the
   player left a campaign with it active, then the row, then every `character_history` copy. Removing
   the row before its history means the row's own delete trigger, which adds one more history snapshot,
   is cleaned up too. One transaction, so a crash midway never leaves any of it half gone.
4. **A small log, `character_purges`: who, when, the character's id. No name, no sheet data.** It has
   no client grant at all, like `site_admins`; only `list_purges()`, a site admin's own read (like
   `list_accounts`), reads it. It exists so the owner can point to when something was deleted forever
   if it is ever asked about, without keeping the thing itself. Capped at 10 purges per owner per day,
   so it cannot grow without end; `owner_id` is set null, not cascaded, when the account is deleted, so
   the log still shows the purge happened.
5. **The dialog makes it hard to do by accident.** It says what is lost and that it cannot be undone,
   offers **Save a copy** first when the sheet can be read, and keeps **Delete forever** off until the
   player types the character's name exactly.
6. **A backup made before the purge still holds the character.** `npm run backup` and a player's own
   `.eclipse` file are both taken outside this table, so deleting forever removes it from the live
   database only, not from any copy already saved.

## Consequences

- The 30-in-all limit frees a place: a purged character no longer counts.
- ADR 0004's "nothing is ever deleted by a client" now has its one exception: the owner, purging their
  own archived character, through this function.
- A departed sheet a Keeper reads can vanish without the Keeper doing anything: it was already the
  player's copy to keep or let go.
- Realtime does not apply RLS to a DELETE event, so a purge sends the character's id (only the id) to
  every subscriber of `characters`, such as an open roster. An open Keeper page keeps a purged departed
  copy in memory until its next sync, at most 30 seconds later.
