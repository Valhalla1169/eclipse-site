# ADR 0019: One field list for the sheet's inputs

Status: **Accepted.** Built for the Core and Log pages; the rest of the sheet is still on the old path.
Date: 2026-09-27
Builds on: ADR 0008 (the sheet) and ADR 0013 (a rules change: additive is free, a shape change is
versioned).
Migration: none. Nothing stored changes; `blank()` gives the same JSON, and a saved sheet or an
`.eclipse` file reads and writes exactly as before.
Tests: `tests/unit/fields.test.js`, the extended `tests/e2e/sheet.spec.js` ("field list coverage").

## Context

Before this, one sheet field lived in four places that had to agree: its default in `blank()`
(`eclipse-rules.js`), an input with a `data-*` code in a page builder (`sheet/*-page.js`), a writer
in `bindings.js`'s `fieldTable` (one entry per code, about 25 of them: `sk`, `so`, `wx`, `cl`, `lt`...),
and a reader in `render.js`'s `fillInputs` or `fillIdentity`. A new or changed field needed four edits,
each one a place to get the path or the parsing wrong. The Core page also used page-wide element ids
(`#f_name`, `#a_soaked`...) paired with a `<label for>`, which only works once per document: a second
sheet on the same page would have two elements answering to the same id.

## Decision

1. **One field list, `sheet/fields.js`.** Each field says its path in the sheet (a dot-separated
   string that doubles as its `data-f` attribute, e.g. `"skills.Athletics"` or `"weapons.0.name"`),
   its kind, and a label for tooling. A field whose row comes and goes (a list `rebuild.js` redraws)
   still gets one entry per row, built by `rows(listPath, count, subFields)`; `count` is the list's
   length at the time the rows are built; a page whose rows are fixed (Core's weapons, mods,
   soakMods) passes `blank()`'s length once, and a page whose rows grow or shrink (the Log page's
   entries) passes the live sheet's current length instead, each time it draws them, calling
   `setListFields` to match that page's slice of `FIELD_BY_PATH` to the count just drawn: a row not
   drawn cannot be written into either.
2. **Four kinds, not four files.** `text` (kept exactly as typed), `number` (always a whole number),
   `blankNumber` (blank stays blank, otherwise a whole number), and `checkbox`. `KINDS[kind].toStored`
   turns an input's value into a stored one; `pathGet`/`pathSet` read and write a sheet by path,
   creating a missing step (an object, or a list row) instead of throwing, the same way the old
   `intoRow` did for one family at a time.
3. **A generic binder, not per-field code.** One input carries `data-f="<path>"`. `bindings.js`
   writes it: look up the path in `FIELD_BY_PATH`, convert with its kind, then either set the path
   directly or call the field's `apply(sheet, value)` when picking the value has a side effect of its
   own (`chooseRace` sets Sanity; `chooseProfession` sets the Master Skill). `render.js`'s `fillFields`
   reads it back the same way. A field's `after: "render"` (the default) redraws the whole sheet, since
   most feed some computed total; a field that only feeds itself (a name, a note) says `after: null`.
4. **The old path stays, for pages not yet converted.** `fieldTable` in `bindings.js` and the `each(...)`
   calls in `render.js`'s `fillInputs` still carry every other page's `data-*` code. A page moves onto
   the field list by adding its entries to `fields.js`, tagging its inputs `data-f`, and deleting its
   old entries and per-field reads and writes; nothing about a page not yet converted changes. Both
   paths are checked into the same two files on purpose, so the diff for the next page is small and
   the same shape as this one.
5. **A stored key never gets renamed by this change.** `cm`, `dy`, `sother`, and the rest keep the
   letters they were saved under; `fields.js` may give a key a readable label, but the path is the
   stored shape (docs/adr/0013 already covers what does need a migration).
6. **The Core page's ids are scoped to its inputs, not the whole document.** A converted input carries
   `data-f` and nothing else; where it had a paired `<label for>`, the label now wraps the input
   instead (implicit association, no id needed) except where the two must stay separate grid cells
   (a skill row): there the input keeps its own `aria-label`. Two Core pages open at once would still
   share no input id. The rest of the page (a page container's own id, a computed total's id such as
   `d_ap` or `thr_shock`) is unchanged; that is a wider question than one field's binding.
7. **The tabs run in DOM order.** `TABS` in `sheet/index.js` used ids 1, 2, 4, 3, 6, 5 for Core,
   Equipment, Casting, Testament, Log, Reference; nothing saves or remembers which tab was open
   (`store.tab` lives only for the life of the view), so the six `page`/`tab` id pairs across the page
   builders were renumbered to run 1 to 6 in the order shown. `LOCKED_PAGES` in `index.js` follows.

## How to add a field

- A field on the Core page: add one entry to `CORE_FIELDS` (`sheet/fields.js`) with its path, kind and
  label; add its default to `blank()` if the group needs one (`eclipse-rules.js`); tag its input
  `data-f="<path>"` in `core-page.js`. Nothing else changes.
- A field in a growing list (the Log page's entries): add one entry to that page's row template
  (`LOG_FIELDS`) with its relative path, kind and label; tag its input with the `data-f` path
  `rows()` builds for it. Nothing else changes — `setListFields` keeps `FIELD_BY_PATH` matching the
  row count each time the page draws its rows.
- A field on a page not yet converted: for now, still four places, as before this ADR.
- Converting a whole page: move its fields into `fields.js`, tag its inputs, delete its old
  `fieldTable` entries and `fillInputs`/`fillIdentity` reads, and extend the field-list coverage test
  for that page (docs/adr/0019, this record).

## Consequences

- The Core and Log pages' field binding is one list plus one binder; the other four pages are
  unchanged and still four places per field, until each is converted the same way.
- `tests/unit/fields.test.js` fails if a Core field's path is duplicated, if a Log entry's fields
  don't round-trip at 0, 1 and several rows, or if writing a sample value through a field's kind and
  reading it back does not land at its own path.
- `tests/e2e/sheet.spec.js`'s "field list coverage" test fails if the Core or Log page ever draws an
  input with no entry in its field list, or lists an entry with no input on the page.
- `pathGet`/`pathSet` are plain dot-path helpers with no notion of "the sheet"; they would work for any
  nested object, which is what lets one binder cover every kind of field this sheet has, and the kinds
  it will need on the pages still to convert.
