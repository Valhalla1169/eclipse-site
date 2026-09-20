# Architecture decision records

Each record says what was decided and why. Later records amend earlier ones, so read the newest
record on a topic first. The current state is in [`CLAUDE.md`](../../CLAUDE.md).

| ADR | Topic | Status |
|---|---|---|
| [0001](0001-eclipse-supabase-data-model.md) | Supabase data model: tables, roles, the DM reads and never writes | Accepted, amended by 0002 to 0010 |
| [0002](0002-require-membership-for-character-writes.md) | A player must be a member to write their sheet | Accepted |
| [0003](0003-explicit-data-api-grants.md) | Explicit grants on every table, next to RLS | Accepted, amended by 0006 |
| [0004](0004-scale-and-data-preservation.md) | One campaign of about a dozen; never lose a character; history snapshots | Accepted, amended by 0010 |
| [0005](0005-creator-allowlist-and-hashed-invites.md) | Only allowlisted people create campaigns; hashed, expiring invites | Accepted |
| [0006](0006-least-privilege-columns-and-bounded-history.md) | Per-column write grants, bounded history, safer settings | Accepted |
| [0007](0007-account-system.md) | Password accounts and magic links; steps 2 and 3 still to build | Accepted, partly built |
| [0008](0008-player-sheet.md) | The player sheet: load, save, conflicts, `.eclipse` files, theme, fonts | Accepted, built |
| [0009](0009-dm-roster.md) | The DM roster: cards, live updates, read-only sheets, backup download | Accepted, built |
| [0010](0010-version-history.md) | Version history: look at an earlier copy of your sheet and put it back | Accepted, built |

Add a record for any decision that would be hard to guess from the code, and update this table.
