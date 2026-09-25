# Architecture decision records

Each record says what was decided and why. Later records amend earlier ones, so read the newest
record on a topic first. The current state is in [`CLAUDE.md`](../../CLAUDE.md).

| ADR | Topic | Status |
|---|---|---|
| [0001](0001-eclipse-supabase-data-model.md) | Supabase data model: tables, roles, the DM reads and never writes | Accepted, amended by 0002 to 0012 |
| [0002](0002-require-membership-for-character-writes.md) | A player must be a member to write their sheet | Accepted, writes amended by 0011 |
| [0003](0003-explicit-data-api-grants.md) | Explicit grants on every table, next to RLS | Accepted, amended by 0006 |
| [0004](0004-scale-and-data-preservation.md) | One campaign of about a dozen; never lose a character; history snapshots | Accepted, amended by 0010, 0011 and 0013 |
| [0005](0005-creator-allowlist-and-hashed-invites.md) | Only allowlisted people create campaigns; hashed, expiring invites | Accepted |
| [0006](0006-least-privilege-columns-and-bounded-history.md) | Per-column write grants, bounded history, safer settings | Accepted |
| [0007](0007-account-system.md) | Password accounts and magic links; steps 2 and 3 still to build | Accepted, partly built |
| [0008](0008-player-sheet.md) | The player sheet: load, save, conflicts, `.eclipse` files, theme, fonts | Accepted, built, amended by 0013 |
| [0009](0009-dm-roster.md) | The DM roster: cards, live updates, read-only sheets, backup download | Accepted, built |
| [0010](0010-version-history.md) | Version history: look at an earlier copy of your sheet and put it back | Accepted, built |
| [0012](0012-invite-management.md) | Invites and members: join confirmation, which invite was used, remove and leave, replace a lost link | Accepted, built |
| [0011](0011-characters-belong-to-people.md) | Characters belong to people: up to 10 each, one active per campaign, a copy kept when a player leaves | Accepted, built |
| [0013](0013-rule-change-process.md) | A checklist for changing the game's rules: additive is free, a shape change is versioned, a named entry is retired not deleted | Accepted, built |

Add a record for any decision that would be hard to guess from the code, and update this table.
