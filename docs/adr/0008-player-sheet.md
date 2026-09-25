# ADR 0008: The player sheet

Status: **Accepted.** Built.
Date: 2026-09-19
Builds on: ADR 0001, 0002, 0004 and 0006. ADR 0011 moved the sheet from `/campaign/:id/play` to `/characters/:id`.

## What it is

`/characters/:id` shows one of the player's characters: the V4 sheet ported into the app. The
player edits it, and it saves to that `characters` row in Supabase (ADR 0011 explains which
character is active in which campaign). The DM has no sheet (ADR 0001).

## Decisions

1. **Keep V4's game logic and layout.** Only storage, inline styles and the theme changed. The pure
   rules were moved to `js/eclipse-rules.js` and checked against V4's own functions on random sheets
   before V4's code was set aside. One rules-data fix was made on the way: the Entertainer /
   Artist profession's Master Skill is Persuasion (V4 named Presence, an attribute).
2. **Two devices editing one sheet: detect and ask.** A save is an update that matches only while
   `updated_at` is still what the page last saw. If it matches nothing, the page reads the row:
   a newer `updated_at` is a conflict, and anything else means the database refused the write. On a
   conflict the player picks **Keep my version**, **Use their version**, or **Save copies of both**
   (two `.eclipse` files). Nothing is overwritten until they choose. The page does not watch for
   changes while idle; a conflict is found on the next save.
3. **V4's theme is dropped.** Its colour names are aliases onto the site's Catppuccin tokens (four
   palettes, the site's own theme switcher). V4's palettes are kept for reference in
   `legacy/v4-theme.css`. Two token kinds exist so the sheet passes WCAG AA in Latte: plain accents
   for fills and borders (3:1) and `-t` accents for text (4.5:1). `tests/unit/contrast.test.js`
   resolves them per palette and checks both.
4. **Loading an `.eclipse` file into the live sheet is allowed, after a confirmation** that offers to
   save a copy of the current sheet first. The history trigger snapshots an edit at most every 10
   minutes (ADR 0004), so the snapshot alone does not guarantee an undo of a load; the saved copy does.

## How it works

- **Loading.** `loadCharacter` reads the row (creating a blank one with only the client-writable
  columns if there is none; a lost race with another tab re-reads). `openSheet` migrates it, merges
  it onto `blank()` and checks its shape. Nothing is drawn or written before that succeeds. A failed
  read shows an error with a retry. Data that cannot be a sheet shows a message and is left alone.
  A `schema_version` newer than the app's opens read-only (the pages are `inert`, and no save runs).
- **Unknown fields are kept** at every level, and only inputs are stored. Both are unit tested.
- **Saving.** `autosave.js` waits 1.5 seconds after the last change (never longer than 10 seconds of
  continuous typing), retries a network failure after 5, 15, 30 and 60 seconds, and stops on a
  conflict or a refusal until the player acts. The state is shown in the sheet's header and, for
  problems, in an alert. The page saves when it is hidden and asks before it is closed with unsaved
  changes. Before the app shows another page, it saves, and asks only if that save fails.
- **The `.eclipse` file** is the sheet's inputs (the shape V4 and V5 wrote) plus `schemaVersion`. It
  works with no network. On import the version is read, the file is migrated like a stored row and
  the key is not stored. A file larger than the database's 512 KiB sheet limit is refused.
- **CSP.** The 89 inline `style` attributes became classes. The few values that are numbers
  (encumbrance bar, threshold marks, dying tracks) are CSS custom properties set from script.
  V4's 31 `innerHTML` uses were rebuilt with `h()`. The rules text on the Reference tab is markup in
  the repo, inserted with `staticHtml()`. `tests/unit/sources.test.js` fails on any other markup
  from strings.
- **Fonts** (Chakra Petch, IBM Plex Mono, IBM Plex Sans Condensed) are self-hosted Latin woff2 files
  from pinned `@fontsource` packages, copied by `npm run vendor`, under the SIL Open Font License.
  Text outside Latin falls back to the system font.
- **History.** A History button opens the copies the database keeps, and puts one back (ADR 0010).
- **Removed from V4:** its theme picker, the File System Access API "save over a file" flow (a saved
  copy is a download), and `window.storage` (a Claude artifact API that a browser does not have).
  Removing a row on the sheet (an advantage, a log entry, a container) edits the sheet's data. It
  never deletes the character (ADR 0004).

## Known gaps

- **No live update.** Changes made on another device appear after a reload, or as a conflict on the
  next save. The DM roster (Phase 4) is where Realtime is used.
- **Print styles** are ported from V4 and were not tried on a printer.
