# Eclipse: implementation plan for the Supabase-backed roster + DM viewer

> **Read the ADRs alongside this plan.** It is the original handoff plan and has
> been superseded in places. Campaign creation is restricted to an allowlist and
> players join with hashed, expiring invites instead of a permanent campaign code
> (ADR 0005, so `campaigns.invite_code` and the "Create campaign" and
> "join by campaign code" steps below no longer describe the system). Character
> writes require membership (ADR 0002), the database grants are explicit
> (ADR 0003), and clients can never delete campaigns or characters (ADR 0004).
> The DM roster query below also needs a rethink: `characters` and
> `campaign_players` have no foreign key between them, so the embedded select
> shown will not work as written. The player sheet (Phase 3) is built as described in
> ADR 0008, and the DM roster (Phase 4) as described in ADR 0009, not as the file layout below.

This is the plan for turning `eclipse-site` from its current placeholder
"coming soon" page into the live character sheet + DM roster viewer,
backed by Supabase. It assumes the schema/RLS/RPC work in
`supabase/migrations/0001_init.sql` (see `docs/adr/0001-eclipse-supabase-data-model.md`
for why it's shaped that way) is already done and tested.

## What already exists (in this handoff bundle)

- `supabase/migrations/0001_init.sql` — full schema, RLS policies, and
  `join_campaign`/`leave_campaign`/`remove_player` RPC functions. Written
  and verified against a real local Postgres 16 instance emulating
  Supabase's auth model (14+ passing multi-role tests).
- `supabase/tests/local_auth_harness.sql` — a minimal `auth.users` /
  `auth.uid()` / `anon`+`authenticated` role emulation, for running the RLS
  test suite against a plain local/CI Postgres instance without a real
  Supabase project. Reusable in CI per DESIGN.md §6.4.
- `supabase/tests/rls_policies.test.sql` — the test suite itself: joins,
  wrong invite codes, cross-player read/write attempts, DM view-only
  enforcement, remove-player/restore semantics.
- `legacy/AgeOfEclipseCharacterSheet_V4.html` — the base single-player
  character sheet: all game-mechanics logic (attributes, skills, condition
  monitors, casting, encumbrance, the eclipse dial, etc.), no
  multiplayer/persistence layer beyond local file save/load.
- `legacy/AgeOfEclipseRoster_V5.html` — the same sheet wrapped with a join
  screen, a DM roster view, and shared/"live" storage via a small
  `sGet`/`sSet`/`sDel` abstraction (`shared: boolean` flag distinguishes
  local-only vs. shared state). This is the porting reference for the
  multiplayer layer — its storage abstraction is exactly the seam where
  Supabase calls replace whatever backend it was last pointed at.

## Target architecture

Single-page app, plain HTML/CSS/JS (no framework — DESIGN.md §3.2 says
don't add one without real cause, and this app's complexity, while real,
is UI-shaped, not routing/state-shaped enough to justify a framework's
overhead). Deployed as static assets via the existing Cloudflare Workers +
Wrangler setup (`wrangler.jsonc`, `assets.directory: ./public`).

### Routes (real URLs via the History API, not hash routing)

- `/` — landing: sign in (magic link) or, if already signed in, a list of
  the user's campaigns (as DM and as player) with "Create campaign" and
  "Join by code" actions.
- `/join/:code` — a shareable invite link. If not signed in, prompts
  magic-link sign-in first (preserving the code across the auth redirect),
  then calls `join_campaign(code)` and redirects into the campaign.
- `/campaign/:id/play` — the player's own character sheet (the ported V4
  sheet UI) for that campaign. Auto-creates a blank `characters` row on
  first visit if one doesn't exist yet for `(auth.uid(), campaign_id)`.
- `/campaign/:id/dm` — the DM's roster view: one card/tab per active
  player (from `campaign_players` joined against `characters`), read-only
  rendering of each character's key stats (not the full editable sheet UI
  — see below), plus "Remove player" (archives them) and "Restore" for
  players in campaign history that a real "archive" concept can surface
  later if wanted. Only reachable by the campaign's `dm_id` (RLS enforces
  this at the data layer regardless of what the client shows).

A minimal hand-rolled router (a `history.pushState` wrapper + a
route-matching function keyed on path segments) is enough here — there's
no need for a routing library. Keep it in its own `router.js` so it isn't
tangled into page logic.

### Persistence layer: what replaces `sGet`/`sSet`/`sDel`

This is the core porting seam. V5's storage abstraction (`shared: boolean`)
maps directly onto "is this Supabase-backed (`characters`/`campaigns`/
`campaign_players`) or is this still local-only":

| V5 concept | Supabase replacement |
|---|---|
| `sGet(key, shared)` for the player's own sheet | `supabase.from('characters').select('data').eq('owner_id', uid).eq('campaign_id', campaignId).single()` |
| `sSet(key, value, shared)` for the player's own sheet | `supabase.from('characters').upsert({owner_id, campaign_id, character_name, data}, {onConflict:'owner_id,campaign_id'})` — debounce this the same way V5/V4 debounce `window.storage.set` (see V4's `save()` — 600ms) |
| DM's live roster view | `supabase.from('characters').select('*, campaign_players!inner(joined_at)').eq('campaign_id', campaignId)` on load, **plus** a Realtime channel subscribed to `postgres_changes` on `characters` filtered to that `campaign_id`, to reflect edits live without polling |
| Join flow | `supabase.rpc('join_campaign', {p_invite_code: code})` |
| DM remove/restore | `supabase.rpc('remove_player', {p_campaign_id, p_player_id})`; "restore" is just calling `join_campaign` again with the same code from the player's side, or a DM-side re-invite — there is no separate `restore_player()` RPC in this migration, since re-joining is idempotent (`on conflict ... do nothing`) |
| Local file save/load (.eclipse export) | **Keep as-is, unchanged**, from V4 — it's an independent feature (personal backup / "hand a copy to the GM") that has nothing to do with the live sync layer. Both mechanisms coexist: Supabase for live shared state, file export/import for a portable personal backup. |
| Theme system (`window.storage` for `THEME_KEY`) | Can stay as browser `localStorage` — it's a per-device UI preference, not shared state, so it never needs to go through Supabase. |

### Auth flow

1. `supabase.auth.signInWithOtp({ email })` on the sign-in form.
2. Supabase emails a magic link back to `/` (or wherever `emailRedirectTo`
   points — set it to the current origin's landing page).
3. On load, check `supabase.auth.getSession()`; if there's a session, hit
   `profiles` — if no row exists yet for this `auth.uid()`, prompt once for
   a display name and `insert` it (the "a user can insert only their own
   profile" policy allows this).
4. Keep a single Supabase client instance (anon key only, never a
   service-role key — DESIGN.md §5.3) initialized once and reused across
   pages/routes.

### What the DM roster view renders (view-only, by RLS *and* by UI)

Per ADR 0001, the DM's `characters` access has no write policy at all — so
even though it would be *possible* to build a full editable sheet UI and
just hope the DM doesn't click anything, the correct UI here is a
deliberately reduced, read-only summary view: name, key attributes,
condition monitor states, encumbrance tier, and current Trauma/Shock/Rot —
not the full interactive sheet with editable inputs. Reuse the V4 sheet's
`render()`-computed *values* (by pulling in the same calculation functions
from a shared module — see below) but render them into plain read-only
markup, not into the input-heavy sheet layout.

### Sharing sheet logic between the player sheet and the DM view

The V4 sheet's calculation functions (`total()`, `penalties()`,
`encTiers()`, `encPenalty()`, `overflowPool()`, etc.) and its `blank()`
state shape are pure functions of the `S` state object — extract them into
a shared ES module (e.g. `public/js/eclipse-rules.js`) imported by both the
full editable player-sheet page and the read-only DM roster view, so the
DM's derived numbers (encumbrance tier, dice penalty, etc.) are computed
identically rather than duplicated and risking drift.

## File layout (suggested)

```
public/
  index.html            landing / sign-in / campaign list
  join.html             /join/:code handler (or folded into a router SPA — see below)
  play.html             player sheet page (ported V4 content)
  dm.html               DM roster view
  js/
    router.js           minimal history-API router (if going single-HTML-file SPA)
    supabase-client.js   single shared Supabase client init (anon key from env/build-time config)
    eclipse-rules.js     extracted pure calculation functions + blank() state shape, shared by play + dm
    auth.js              magic-link sign-in/session handling, profile bootstrap
    play.js              player sheet page logic: load/save characters row, debounce, realtime-optional
    dm.js                DM roster page logic: list players, realtime subscription, remove/restore
  style.css              extends/reuses the existing Catppuccin theme system already in this repo
```

(Whether this ends up as one SPA `index.html` with client-side routing, or
several static HTML entry points Wrangler serves directly, is an
implementation choice — either is compatible with "plain HTML/CSS/JS, no
framework." A single SPA is likely simpler for the sign-in-session-then-
redirect-into-a-route flow.)

## Security / config requirements (DESIGN.md §5, §6)

- Supabase URL + anon key are public-safe (RLS is what actually protects
  data) but should still come from a build-time config file, not hardcoded
  inline strings scattered across pages — one `config.js` (git-ignored if
  it varies per environment, or committed if it's just the anon key/URL,
  which are not secrets).
- No inline `<script>`/event handlers anywhere (DESIGN.md §4/§6.1) — matches
  what both legacy sheets already do (all bindings via `addEventListener`,
  `data-*` attributes).
- Add/verify a CSP header (via a Cloudflare Workers `_headers` file or
  Worker logic) allowing `connect-src` to the Supabase project's REST/
  Realtime endpoints, and Google Fonts as the existing sheets already load.
- RLS tests (`supabase/tests/`) should be wired into CI once CI exists for
  this repo (DESIGN.md §6.3/§6.4) — run `local_auth_harness.sql` then
  `rls_policies.test.sql` against a fresh Postgres instance (e.g. via a
  `postgres:16` service container in GitHub Actions) on every PR that
  touches `supabase/migrations/`.

## Acceptance criteria

1. A new user can sign in via magic link, set a display name, and land on
   an empty campaign list.
2. A DM can create a campaign and see its invite code.
3. A player visiting `/join/:code` (after signing in) is added to the
   campaign and lands on their own (initially blank) character sheet.
4. Editing the player's sheet persists to `characters.data` and survives a
   reload (own-row read/write works).
5. A second player cannot read or write the first player's `characters`
   row directly (verified against the schema's RLS, already covered by the
   included test suite — confirm the client never tries to bypass it).
6. The DM, opening `/campaign/:id/dm`, sees all active players' key stats
   and sees them update live (via Realtime) when a player edits their
   sheet — without the DM needing to refresh.
7. The DM cannot write to any player's `characters` row — attempting to
   (e.g. via a stray dev-tools call) fails at the database, not just the UI.
8. Removing a player takes them off the DM's active roster list but their
   character data is still intact and re-joinable later.
9. The player sheet's local `.eclipse` file export/import (from V4)
   continues to work unchanged, independent of the Supabase sync.
10. RLS test suite passes against a fresh Postgres instance running the
    migration.
