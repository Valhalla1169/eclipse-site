# ADR 0016: The rulebook, for signed-in people only

Status: **Accepted.** Built.
Date: 2026-09-25
Migration: `supabase/migrations/0012_rulebook.sql`.
Files: `public/js/markdown.js` (the reader), `public/js/rulebook.js` (the reads), `public/js/rulebook-view.js`
(the pages), `scripts/rulebook.mjs` (`npm run rulebook`).
Tests: `supabase/tests/rulebook.test.sql`, the extended `grants.test.sql`, `tests/unit/markdown.test.js`,
`tests/unit/rulebook.test.js`, `tests/e2e/rulebook.spec.js`, and `/rules` in `tests/e2e/a11y.spec.js`.

## Context

The players need the player's rulebook (about 470 pages in about 50 chapters, many tables, no pictures)
next to their sheets. Its authors have not published it. The owner's decisions:

- Only this book goes on the site, shown as its authors wrote it. The site does not rewrite its words.
- Only a signed-in person reads it. Only an approved email makes an account (ADR 0014), so this means
  approved people. A signed-out visitor sees nothing of it.
- Only the owner changes it. The site has no editor.
- **This repo is public, so no text of the book is ever in it**: not in code, tests, fixtures or docs.
  Its Markdown is in a separate private repo. Tests use made-up chapters.

## Decision

1. **Storage.** `rulebook` holds one row, the book's title and version. `rulebook_pages` holds one row for
   each chapter: its place (`position`), its address (`slug`, lower-case words joined by hyphens), its title
   and its Markdown (at most 256 KiB). The site is `/rules` (the contents) and `/rules/<slug>` (a chapter,
   with the chapters either side).
2. **Access.** RLS is on for both tables. Each has one policy, `select` for `authenticated`, and that is
   the only grant. `anon` has nothing, and no client role can insert, update, delete or truncate. A
   signed-out visitor who asks the Data API gets 401. The pages send a signed-out
   visitor to sign in and back.
3. **Upload.** `npm run rulebook push <folder> [staging]` reads a folder outside this repo (it refuses one
   inside): `book.json` with the title and version, and one `<number>_<words>.md` file for each chapter.
   `05_combat_basics.md` is place 5 at `/rules/combat-basics`, and its first `# ` heading is its title. It
   checks every file first and uploads nothing if one is wrong. It replaces the whole book in one
   transaction, so a reader sees the old book or the new one. The text goes into the SQL as base64, so no
   chapter can end a string or add a statement. The SQL goes to the CLI in a file (`db query --file`),
   because a Windows command line holds about 32 KB and the book is about 1 MB. It prints counts and
   titles, never the text. Like
   `npm run admins`, it uses the owner's CLI login, and the live project unless the last word is
   `staging`.
4. **Safe reading.** `markdown.js` turns the Markdown into a tree, then into DOM with `h()`, so the text
   is only ever text nodes (the rendering rule in CLAUDE.md). It reads headings (each with an id, `sec-`
   and its GitHub-style slug, so no heading can take the id of a part of the page), paragraphs, bold and
   italics, nested lists, GitHub tables with a header row, block quotes, rules, inline code, code blocks
   and links. A link may go to a part of the page (`#part`), a page of the book (`/rules/<slug>`, with or
   without `#part`) or an `https:` address (with `rel="noopener noreferrer"`). Raw HTML shows as text, an
   image shows its alt text and is never loaded, and any other link (`javascript:`, `http:`, `mailto:`,
   a relative file) shows its text only. A wide table scrolls in its own box, which the keyboard can reach.

## Consequences

- The book's text is readable by every approved person, and by the owner through the dashboard. Anyone
  signed in can save what they read; the site cannot stop that, and does not try.
- The migration goes to staging and live first, then the pages merge. The book is uploaded to staging
  first, checked at `npm run dev`, then uploaded to live.
- The reader does not do everything Markdown can: no footnotes, reference-style links, HTML entities or
  pictures. The owner sees what is not read in the book's own words on the page, and can change the
  Markdown in the private repo.
- An uploaded chapter keeps its address while its file keeps its name, so a link to it keeps working.
