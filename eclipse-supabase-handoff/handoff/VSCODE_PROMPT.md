Paste everything below into Claude Code (VS Code extension or terminal) at
the root of the `eclipse-site` repo.

---

I'm migrating `eclipse-site` (eclipse.deyderae.dev) from a placeholder
"coming soon" page into a live, Supabase-backed TTRPG character sheet with
a DM roster viewer, for a game called Age of Eclipse. Before writing any
code, read these in order:

1. `CLAUDE.md` in this repo.
2. `DESIGN.md` in the sibling `deyderae-site` repo (clone it if you don't
   have it locally — it's the canonical domain-wide design doc CLAUDE.md
   points you to). Pay special attention to §3.2 (when a framework is
   actually warranted — it isn't, here), §3.3.1 (Eclipse's Supabase
   architecture, already decided), §5 (security, especially §5.1 CSP/
   headers and §5.3 secrets handling), and §6.3–§6.4 (CI/CD and the RLS
   multi-role testing requirement).
3. `docs/adr/0001-eclipse-supabase-data-model.md` in this handoff bundle —
   the ADR that closes the schema/auth/access-control decisions (magic-link
   auth, invite-code joining, strictly view-only DM access) and explains
   *why* the schema is shaped the way it is, including an RLS-recursion
   trap that's already been worked around.
4. `docs/IMPLEMENTATION_PLAN.md` in this handoff bundle — the concrete
   plan: routes, file layout, the persistence-layer mapping from the old
   local-storage/Firebase-style code to Supabase calls, and acceptance
   criteria.

## What's already done, and where it goes in this repo

- `supabase/migrations/0001_init.sql` — the full schema, RLS policies, and
  `join_campaign`/`leave_campaign`/`remove_player` RPC functions. This has
  already been written and empirically verified (14+ passing tests) against
  a real local Postgres 16 instance emulating Supabase's auth model. Copy
  it into this repo at `supabase/migrations/0001_init.sql` (create a
  Supabase project if one doesn't exist yet — `supabase init` /
  `supabase link` — and apply this migration with `supabase db push`,
  rather than hand-typing it into the SQL editor).
- `supabase/tests/local_auth_harness.sql` and
  `supabase/tests/rls_policies.test.sql` — the RLS test suite and the
  minimal auth-emulation harness it needs to run against a plain Postgres
  instance. Copy both into this repo under `supabase/tests/`. Run
  `local_auth_harness.sql` then the migration then
  `rls_policies.test.sql`, in that order, against a fresh local/CI Postgres
  16 instance to confirm the policies hold before building anything on top
  of them. Wire this into CI once this repo has CI (per DESIGN.md §6.3/
  §6.4) — a `postgres:16` service container running these three files in
  order on every PR touching `supabase/migrations/` is the target.
- `legacy/AgeOfEclipseCharacterSheet_V4.html` — the base single-player
  character sheet: **this is the actual UI and game-logic source to port
  from, not a spec to re-derive from scratch.** It's a complete,
  self-contained HTML file (inline CSS + JS) implementing every mechanic
  (attributes, skills, condition monitors, the eclipse dial, casting,
  encumbrance, containers, testament/backstory, log, a themed Catppuccin
  4-palette system). Copy it into this repo at `legacy/` for reference,
  and treat its `<script>` block as the thing you're extracting and
  re-wiring, not rewriting fresh. In particular:
  - The `blank()` function defines the full state shape. This is exactly
    what should be serialized into the new `characters.data` jsonb column
    — do not re-normalize it into SQL columns.
  - `render()`, all the `build*()` DOM builder functions, and the
    `FIELDS`-table-driven `writeField()` input router are the real UI/game
    logic. Preserve these essentially as-is.
  - Only the persistence layer at the bottom (`save()`, `load()`,
    `doSave()`, `ingest()`, the File System Access API calls, and
    `window.storage.get/set`) is what changes — see the mapping table in
    `docs/IMPLEMENTATION_PLAN.md` for exactly what replaces what. Keep the
    local `.eclipse` file export/import working unchanged (it's an
    independent personal-backup feature, not part of the live-sync layer).
- `legacy/AgeOfEclipseRoster_V5.html` — the same sheet already wrapped with
  a join screen, a DM roster view, and a `sGet`/`sSet`/`sDel` storage
  abstraction (a `shared: boolean` flag distinguishes local-only vs. shared
  state) pointed at some prior backend. This is the porting reference for
  the *multiplayer layer specifically* — study how it structures the join
  screen and DM view, then re-implement that layer against Supabase using
  the mapping table in `docs/IMPLEMENTATION_PLAN.md`, rather than
  reusing whatever backend V5 was last wired to.

## What I need you to build

Follow `docs/IMPLEMENTATION_PLAN.md`'s architecture section (routes, file
layout, persistence-layer mapping) and its acceptance criteria at the end
— treat that list as the definition of done. In short:

1. Supabase project set up, migration applied, RLS tests passing locally.
2. A plain HTML/CSS/JS SPA (no framework — see DESIGN.md §3.2) served as
   Cloudflare Workers static assets via the existing `wrangler.jsonc`
   (`assets.directory: ./public`), with routes for: sign-in/landing,
   `/join/:code`, `/campaign/:id/play` (the ported player sheet), and
   `/campaign/:id/dm` (the read-only DM roster view, live via Supabase
   Realtime on the `characters` table).
3. Magic-link auth via Supabase Auth, a `profiles` row bootstrap on first
   sign-in.
4. The player sheet page reuses the V4 sheet's actual DOM/CSS/JS almost
   entirely, with its persistence layer replaced per the mapping table.
5. The DM view is a **reduced, read-only** rendering (not the full editable
   sheet) — per the ADR, the DM has no write access at the database level
   at all, and the UI should reflect that rather than presenting editable
   controls that would just fail. Extract the pure calculation functions
   from V4's script (`total()`, `penalties()`, `encTiers()`, etc.) into a
   shared module so both the player sheet and the DM view compute derived
   numbers identically.
6. Security headers/CSP per DESIGN.md §5.1, no inline scripts/handlers
   anywhere (both legacy files already follow this convention — keep it).

Work through this incrementally and check in with me between major phases
(schema setup and RLS verification; auth + landing page; player sheet port;
DM view + realtime) rather than doing it all in one pass — I'd like to
review the join flow and the DM view specifically before you wire up
Realtime, since that's the part with no precedent in the legacy files to
copy from directly.
