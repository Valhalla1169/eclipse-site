# CLAUDE.md — eclipse-site

This repo is the `eclipse.deyderae.dev` subdomain. Before making changes, read **`DESIGN.md`** from the `deyderae-site` repo — it's the design document for the whole `deyderae.dev` domain (architecture, security, and workflow standards apply here too, even though the canonical copy lives in that repo). On the author's machine it's at `../deyderae-site/deyderae-site/DESIGN.md` (relative to this repo's root; note the extra wrapper folder). If it isn't there, don't guess at its contents or proceed from memory: stop and ask the user to provide it.

## What this repo is
Currently a static "coming soon" placeholder for Eclipse — character-sheet hosting for tabletop games (build, track, share characters). Deployed to Cloudflare Workers (static assets) via Wrangler, same as `deyderae-site`, but as its own independent Worker/repo (see DESIGN.md §3.1 — subdomains don't share a deploy or a runtime).

## Where this is headed
Per DESIGN.md §3.2–§3.3, once real functionality is built here this stops being a single static page and becomes a genuinely client-routed SPA with a data layer:
- It will need a router with real URLs and a server-side fallback to `index.html` for deep links (configure `not_found_handling` in `wrangler.jsonc` when this happens — it isn't needed yet for the current single-page placeholder).
- It will need persistence for character data — default assumption is Cloudflare D1 unless a specific access pattern argues otherwise (see DESIGN.md §3.3).
- If accounts/sharing are needed, prefer an established auth approach over hand-rolled sessions (DESIGN.md §3.3, §5.5).
- Pick a lightweight framework based on this app's actual complexity when the static-page approach stops being enough — don't default to a heavy one "just in case," and don't feel obligated to match whatever the apex site uses (DESIGN.md §3.1).

## Working in this repo now
- **Only `public/` is published.** `wrangler.jsonc` sets `assets.directory` to `./public`; everything in that folder is served publicly, and nothing outside it is. Site files (HTML/CSS/JS/images/fonts, plus `_headers` / `_redirects`) go in `public/`. Repo tooling and docs (`wrangler.jsonc`, `package.json`, `CLAUDE.md`, etc.) stay at the repo root. Wrangler does not skip `.git` or `node_modules` when uploading, so pointing `assets.directory` back at the repo root would publish them (and fail the deploy on large binaries).
- The theme system (Catppuccin, `data-theme` + `localStorage`) is currently a duplicate of `deyderae-site`'s. Don't keep re-copying it into new places — check DESIGN.md §3.4 for the intended shared approach before touching it.
- No tests, CI, or build step exist yet. Follow DESIGN.md §6.3–§6.4 when adding them rather than improvising.
- Once this app handles user data, treat DESIGN.md §5.5 (input validation, rate limiting, least-privilege bindings) as required reading before writing any backend logic, not optional hardening to add later.

## Don't
- Don't point `assets.directory` in `wrangler.jsonc` back at the repo root, and don't put non-site files (docs, config, source that isn't served, secrets) in `public/`.
- Don't commit secrets, tokens, or (once there's a database) real user data/fixtures.
- Don't wire this Worker directly to a shared database credential used by other subdomains — route through a dedicated API service if cross-subdomain data sharing is ever needed (DESIGN.md §3.3).
