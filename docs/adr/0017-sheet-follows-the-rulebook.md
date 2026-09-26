# ADR 0017: The sheet follows the rulebook

Status: **Accepted.** Built.
Date: 2026-09-26
Amends: ADR 0008 (the sheet's rules) and ADR 0013 (a step that changes a value on purpose).
Migration: sheet version 1 to 2 (`MIGRATIONS[1]` in `public/js/eclipse-rules.js`). No database change.
Tests: `tests/unit/eclipse-rules.test.js`, `tests/unit/content.test.js`, `tests/unit/rehearse.test.js`,
`tests/e2e/sheet.spec.js`.

## Context

The sheet came from V4 (ADR 0008). The game's rules are in its rulebook, which is private: the repo
uses it to decide what the sheet does, and never quotes it. In three places the sheet and the book
disagreed. The owner chose the book each time.

## Decision

1. **The book is the authority.** When the sheet and the book disagree, the sheet changes to follow
   the book, through the ADR 0013 checklist. When the book disagrees with itself, the owner chooses.
2. **Morality runs the book's way:** level 1 is the most selfless, 10 the most monstrous. Version 1
   ran the other way. The words stay the same; only their order changes, and each word keeps its
   colour. The ends of the track show the words at its two ends.
   - The stored number changes its meaning, so this is a shape change: `SCHEMA_VERSION` is 2, and
     `MIGRATIONS[1]` mirrors each stored level L to 11 − L, so every character keeps its word. 0 (not
     recorded) stays 0, a number below 0 becomes 0, above 10 becomes 1, and a fraction first goes to
     the nearest level. A missing or wrong-typed Morality, which version 1 read as 5, becomes 6.
   - A new sheet starts at 6, Pragmatic, the word a new version 1 sheet started on.
   - Stored sheets, kept copies of players who left, history copies and `.eclipse` files (with or
     without a `schemaVersion`) all migrate when they are opened. A stored row changes only when the
     player next saves it.
3. **The skill cap is the book's play rule.** A skill is flagged when its rating, with the Master
   Skill bonus, is above twice its linked attribute, or above 10 (`SKILL_CAP` in
   `eclipse-content.js`). Version 1 flagged a level above the attribute and let the Master Skill pass.
   The book has no such exception, and counts the bonus in the rating. The book's lower cap at
   character creation is not flagged: nothing on the sheet tells creation from play.
4. **A medical treatment attempt takes the book's time** on every Reference card. The "Why you
   cannot just retry" table is now data that reads `RECOVERY.medicalMinutes`, like the Medical
   treatment card, and a test checks that the cards agree.
5. **A step that rewrites a value names it.** `npm run rehearse` reports any stored value that it
   cannot find after the migration. A step that changes a value in place, as `MIGRATIONS[1]` does,
   names the field in `MIGRATION_REWRITES`, and the rehearsal ignores the old value of that field
   for the sheets that ran that step only.
6. **A Sanity or Morality level that is not a whole number** (only a hand-edited file makes one)
   shows the nearest level. Before, it stopped the sheet and the Keeper's roster from drawing.

## Consequences

- The Keeper's roster shows the same words as before. Its number (for example "6/10") now counts
  toward monstrous.
- Other places where the sheet and the book disagree are not changed here. Each is a choice for the
  owner, made through this record's first decision.
