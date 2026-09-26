# ADR 0013: Changing the game's rules without losing a sheet

Status: **Accepted.** Built.
Date: 2026-09-24
Builds on: ADR 0004 (never lose a character; `schema_version`; a `migrate()` step) and ADR 0008 (the
sheet: `openSheet`, `normalize`, read-only on a newer version).
Amends: ADR 0004 (spells out decision 6 as a checklist) and ADR 0008 (adds the missing guard to its
testing story).
Migration: none. This is a process and a test, not a data change.
Tests: `tests/unit/eclipse-rules.test.js` ("has a migration step for every version below
SCHEMA_VERSION").

## Problem

Age of Eclipse is still being written. Its rules, and the sheet that records them, will keep
changing. ADR 0004 already decided the shape of the fix — adding a field is free, a rename, a
removal or a retype bumps `characters.schema_version` and ships a `migrate()` step — and ADR 0008
built it (`normalize`, `migrate`, `openSheet` in `js/eclipse-rules.js`). No sheet has needed a real
migration yet, so three gaps were never closed:

- Nothing catches a bumped `SCHEMA_VERSION` with a forgotten `MIGRATIONS` step. A sheet would just
  fail to load for whoever hit it first.
- There was no written answer for a case that isn't quite "a stored field changed": a sheet stores a
  *name* that picks a row out of a table (a race, a profession, a skill, a spell school), and that
  name can be renamed or taken away without any field being renamed, removed or retyped.
- The two kinds of change were one sentence in `CLAUDE.md`, not a checklist someone (or a future
  session) can follow without re-deriving it.

## What it is

A two-question checklist for changing the rules, plus one guard test.

1. **Does a stored field's shape or meaning change, or does a sheet reference a name that's going
   away?**
   - No (a new field, a new row in a table, a different number, a new page section): edit
     `eclipse-content.js` or `eclipse-rules.js` directly. `normalize()` already fills in a default
     for anyone missing the new field. No version bump, no migration. A rule number or a content
     row changes in one place, `public/js/eclipse-content.js`; the sheet, the Reference cards and
     the rules all read it from there.
   - Yes: bump `SCHEMA_VERSION`, add a `MIGRATIONS[old version]` step, and add a unit test for that
     step against a small sample of real old-shape data (not just a synthetic object). Then rehearse
     it: make a fresh backup and run `npm run rehearse` on it before the pull request is merged.
2. **Is a row of a table marked Stored in `eclipse-content.js` (a race, a profession) being renamed
   or removed, or is a number marked Stored (`MONITOR_BOXES`, `TRACK_MAX`) changing?**
   - Renamed: that's a `migrate()` step like any other — rewrite the stored key.
   - Removed: don't delete the row. Mark it retired and leave it out of the pickers offered when
     making or changing a choice on a new or existing character; a sheet that already points at it
     keeps resolving it exactly as before.
   - A Stored number changing: that's a shape change too, the same as a rename — bump
     `SCHEMA_VERSION` and add a migration step.

A unit test in `tests/unit/eclipse-rules.test.js` fails if `SCHEMA_VERSION` goes up without a
`MIGRATIONS` step for every version below it. A changelog comment above `MIGRATIONS` in
`eclipse-rules.js` records one line per bump, so the whole migration history lives in the one file
that has to change to add the next one.

## Decisions

1. **Additive is still free.** This restates ADR 0004 decision 6; nothing about it changes here.
2. **A guard test, not a runtime check.** There's no old client running around that a runtime check
   would need to protect against — `openSheet` already refuses to save a sheet newer than the running
   app understands, and every read goes through it. What was missing was catching an author's mistake
   at test time, before it reaches a player.
3. **Retire a named entry instead of deleting it, because the failure is silent.** `own()` makes an
   unrecognised name resolve to nothing: `raceOf` falls back to human, `professionOf` and a skill's
   pool fall back to zero. That's not a crash and not a shown error — it's a quiet change in what a
   sheet means, for whoever picked the thing that's now gone. Retiring it keeps the resolution correct
   and intentional; only the picker for a *new* choice changes.
4. **No `retired` flag is built yet.** Nothing needs retiring today, and the rules tables are small
   (a dozen or so rows each). Building the flag and the picker filter now would be a guess at a shape
   for a change that hasn't happened; it's cheap enough to add the day a name actually needs to go.
5. **The guard only checks a step exists, not that it's correct.** A migration step is still
   hand-written and hand-tested against a real sample, the same as any other function in this file.

## Not done, and why

- **No `retired` flag or picker filtering.** See decision 4.
- **No tooling to generate a migration step.** A dozen players' worth of sheets is small enough that a
  hand-written step, checked against a sample, is enough; generating one would be solving a scale
  problem this project doesn't have (ADR 0004).
