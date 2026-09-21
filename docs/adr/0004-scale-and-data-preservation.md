# ADR 0004: Scale limits and never losing a character

Status: Accepted. The database protections below are implemented by migration
`0004_protect_characters_from_deletion.sql`. Amended by ADR 0010 (a player can restore) and ADR 0011
(a campaign no longer holds characters, so deleting one no longer cascades to them; a player's
"delete" hides a character).
Date: 2026-09-19

## Context

Stated by the owner:

- Eclipse hosts **one campaign**, with **at most about a dozen players** (each
  with one character) plus the DM.
- The **character sheet layout and the game rules will change over time**, and
  **updates must never delete or corrupt existing characters**.

## What this means for the design

### Scale (a dozen rows)

Nothing here needs to scale. No pagination, search, virtualization or caching.
One realtime channel. A sheet is tens of KB, so 12 sheets are well under
1 MiB in total. The schema stays multi-campaign-capable (that costs nothing and
the ADR 0001 model is unchanged), but the UI is **single-campaign-first**: a
person with exactly one campaign goes straight to it, and there is no campaign
switcher until someone actually has more than one.

### Enforced in the database (migration 0004)

1. **No client can delete a campaign or a character.** Both cascade (deleting a
   campaign deletes every character in it; deleting an `auth.users` row deletes
   theirs). The DELETE grant and the DELETE policies are gone, so it fails at two
   layers. "Remove player" only removes membership and never touches the sheet
   (ADR 0001). Deleting stays possible from the dashboard or the CLI.
2. **Every change is snapshotted** into `character_history`, by a database
   trigger, so it cannot be skipped by a client bug:
   - **every delete**, including cascades from a campaign or account;
   - **every change of `schema_version`**, always, so a rules or layout migration
     can be rolled back (ADR 0006: the newest 10 per character are kept, versions can
     only increase for a client, and they are limited to 1 to 1000);
   - **edits** to the data or name, at most one snapshot per 10 minutes (autosave
     writes every few seconds), keeping the newest 30 per character.
   `character_history` has no foreign key on purpose, so it outlives the row. It
   is read-only to clients (owner and DM can read it). An owner puts a version back
   from the sheet's History page (ADR 0010); the recipe for the project owner is
   still in migration 0004's header. A restore is always snapshotted too.

### Decided for the application code (Phase 3)

3. **Never write before a successful load.** A failed or partial load must never
   leave a blank `blank()` state that then autosaves over a real sheet.
4. **Unknown keys are preserved.** The V4 `applyState` already merges saved data
   onto `blank()` (so new fields get defaults and unknown fields survive a
   load-and-save). The port keeps that behaviour and must not "clean" data.
5. **Store inputs, never derived numbers.** Rules changes then need no data
   migration, because totals, penalties and tiers are recomputed by the shared
   `eclipse-rules.js`. To be verified while porting `blank()`.
6. **Non-additive sheet changes are versioned.** Adding a field is free (its
   default fills in). A rename, removal or type change bumps
   `characters.schema_version` (currently always 1; V4 has no version marker)
   and ships a `migrate(data)` step in `eclipse-rules.js`. A client must refuse
   to save a sheet whose `schema_version` is newer than it understands, so a
   stale cached tab cannot overwrite a newer sheet.
7. **Concurrent edits are detected**, not silently last-write-wins: saves compare
   `updated_at` and surface a conflict instead of overwriting.

### Still to build

- **A DM "download all sheets" button.** Built (ADR 0009). The DM can already read every
  sheet, so this is a one-click backup of the whole table. The per-player
  `.eclipse` export stays.

### Superseded

- "Close public sign-ups" was proposed here as the way to keep strangers out.
  ADR 0005 makes the invite and the creator allowlist the gate, so sign-up can
  stay open. Turning it off after everyone has signed in remains an optional extra.

### To check outside the code

- Whether this Supabase plan takes automatic backups (Dashboard, Database,
  Backups). The free tier may not, which is why the snapshot history and the
  download-all button matter.
- Whether the plan pauses inactive projects. A weekly game keeps one active, but
  a long break could pause it.

## Consequences

- The UI has no delete controls, and the database would refuse them anyway.
- Any migration that touches `characters.data` is additive, or is preceded by a
  snapshot (the trigger writes one for every `schema_version` change) and tested
  against realistic data before it is pushed.
