# ADR 0004: Scale limits and never losing a character

Status: Accepted for the constraints and the "decided now" items. The items under
"Proposed, not yet decided" need the owner's go-ahead before any migration.
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

### Decided now

1. **No client UI can delete a campaign or a character.** Both cascade
   (deleting a campaign deletes every character in it; deleting an `auth.users`
   row deletes theirs). "Remove player" only removes membership and never
   touches the sheet (ADR 0001).
2. **Never write before a successful load.** A failed or partial load must never
   leave a blank `blank()` state that then autosaves over a real sheet.
3. **Unknown keys are preserved.** The V4 `applyState` already merges saved
   data onto `blank()` (so new fields get defaults and unknown fields survive a
   load-and-save). The port keeps that behaviour and must not "clean" data.
4. **Store inputs, never derived numbers.** Rules changes then need no data
   migration, because totals, penalties and tiers are recomputed by the shared
   `eclipse-rules.js`. To be verified while porting `blank()`.
5. **Non-additive sheet changes are versioned.** Adding a field is free (its
   default fills in). A rename, removal or type change bumps
   `characters.schema_version` (currently always 1; V4 has no version marker)
   and ships a `migrate(data)` step in `eclipse-rules.js`. A client must refuse
   to save a sheet whose `schema_version` is newer than it understands, so a
   stale cached tab cannot overwrite a newer sheet.
6. **Concurrent edits are detected**, not silently last-write-wins: saves compare
   `updated_at` and surface a conflict instead of overwriting.

### Proposed, not yet decided (would be migration `0004`)

- **Revoke `DELETE` on `campaigns` and `characters`** from `authenticated`.
  Nothing in the app needs it, and it removes the cascade footgun at the
  permission layer. Deletion stays possible from the dashboard.
- **A `character_history` table** (append-only snapshots written by a database
  trigger when `schema_version` changes, or at most every few minutes on edit,
  pruned to the last N per character). This revisits ADR 0001's "no in-app
  history": with rules changing, one bad client deploy could otherwise damage
  every sheet at once with nothing to restore from. A dozen sheets make it
  cheap.
- **A DM "download all sheets" button.** The DM can already read every sheet, so
  this is a one-click backup of the whole table. The per-player `.eclipse`
  export stays.
- **Close public sign-ups** in the Supabase dashboard once the group has signed
  in. Only about a dozen people are expected, and open sign-up lets anyone who
  finds the site create accounts and campaigns.

### To check outside the code

- Whether this Supabase plan takes automatic backups (Dashboard, Database,
  Backups). The free tier may not.
- Whether the plan pauses inactive projects. A weekly game keeps one active, but
  a long break could pause it.

## Consequences

- Phase 2 (landing page) builds the single-campaign-first UI and no delete
  controls. Phase 3 (player sheet) carries items 2 to 6 above.
- Any migration that touches `characters.data` is additive, or is preceded by a
  snapshot and tested against realistic data before it is pushed.
