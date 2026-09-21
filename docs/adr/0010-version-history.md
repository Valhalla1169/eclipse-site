# ADR 0010: Version history and restore

Status: **Accepted.** Built.
Date: 2026-09-20
Builds on: ADR 0004 (the database keeps snapshots), 0002 (writes need ownership, ADR 0011) and 0008 (the sheet).
Amended by ADR 0011: the pages are under `/characters/:id`, a restore no longer needs a campaign, and the DM has a read-only history page.
Migration: `supabase/migrations/0008_restore_character_version.sql`.
Tests: `supabase/tests/restore.test.sql` (25 checks), `tests/e2e/history.spec.js`.

## Problem

The database has kept a snapshot of every sheet before each change since ADR 0004, but a player
could not reach it. Putting a version back needed the project owner and SQL. A bad edit, a wrong
file load or a wrong rules update meant asking the owner.

## What it is

- A **History** button on the sheet opens `/characters/:id/history`: the copies the database
  has kept, newest first. Each says when, what it was kept before, and the character's name at the
  time.
- **Look at it** opens that copy in the same sheet, read only (`/characters/:id/history/:id`).
  Nothing changes until the player chooses **Put this version back**, and confirms.
- **Save a copy** on a row downloads that version as an `.eclipse` file, as stored.
- A copy is the sheet as it was just before the time shown. Copies are kept before an edit (at
  most one every 10 minutes, newest 30), before a rules update (`schema_version` change, newest 10),
  and before a restore (newest 10). ADR 0004 and 0006 set the first two.

## Decisions

1. **Restore is a database function, not a client update.** `restore_character_version(history id,
   expected updated_at)` runs as its owner (`character_history` has no client write access).
   Doing it as an ordinary update would fall under the 10-minute limit on edit snapshots, and the
   sheet being replaced could be lost. The function tells the snapshot trigger, through a setting
   that lasts one transaction, to always snapshot and to file it under the reason `restore`. A
   client can call functions but cannot run SQL, so it cannot set that setting.
2. **A restore can be undone.** The sheet it replaced is in the history as "Kept before an earlier
   version was put back". Putting that back restores the sheet as it was.
3. **A restore never overwrites a save it has not seen.** The page sends the `updated_at` it last
   saw. If the sheet changed since, the function refuses and the page says so (the same rule as the
   two-device conflict in ADR 0008).
4. **Same rules as writing the sheet.** Only the owner, and not for a deleted character (ADR 0011). Someone else's history id, a missing id, and a DM all get the same answer, "that
   version was not found", so history ids cannot be probed.
5. **Data and `schema_version` come back as a pair.** Restoring a copy from before a rules update
   puts the older version number back too, and the app migrates it again when it opens. The
   function may lower `schema_version` (the guard against it applies to clients, not to the
   function's owner). Nothing else does.
6. **The History button saves first.** The page reads the stored sheet, so the sheet view saves
   what is waiting, and asks if it cannot.
7. **The DM has a history page, and cannot restore** (ADR 0011). The DM reads the copies of a
   character kept since it became active in their campaign, to see how a sheet changed during play.

## Known gaps

- The copies are only as fine as the 10-minute limit: the last few minutes before a change may not
  have a copy of their own. "Save a copy" on the sheet is the way to keep an exact moment.
- No side-by-side comparison. A player looks at a copy, then decides.
- The list shows the newest 100. Retention keeps at most 50 in any case.
- A character deleted by the owner (ADR 0004) has its snapshot, but a client cannot restore it. That
  stays an owner task.
- The function has to be pushed to the live project (`npx supabase db push`) before the button works there.
