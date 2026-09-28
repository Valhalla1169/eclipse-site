# Eclipse: the system today

This is a present-tense summary of how Eclipse works right now. It is the first document a new
person reads. `docs/adr/` stays as history — the record of why each choice was made — but reading
newest-ADR-per-topic to find a current rule is slow, so this page states the current rule directly.
Where this page and an ADR disagree, this page is right; the ADR is a snapshot of the day it was
written.

## 1. What Eclipse is

Eclipse hosts live character sheets and a read-only Keeper roster for the campaigns of one tabletop
game, Age of Eclipse. About 10 people use it, in at most 4 campaigns at a time. It is a plain
HTML/CSS/JS site with no framework, served as static files from Cloudflare Workers. Its data — the
accounts, campaigns, characters and rulebook — lives in Supabase: a hosted Postgres database, its
Auth system, and its Realtime feed. There are two Supabase projects: **live**, which the deployed
site talks to, and **staging**, which local development (`npm run dev`) talks to instead, so testing
a change never touches real data.

## 2. People and roles

| Role | Who they are | How the app or database knows them |
|---|---|---|
| Stranger | Nobody signed in | No session |
| Signed-in person | Anyone with a confirmed account whose email a site admin approved | `auth.uid()` is set |
| Player | A signed-in person, while they own a character or belong to a campaign | Owns rows in `characters`; has a row in `campaign_players` |
| Keeper | A signed-in person who runs a campaign (the game master) | `campaigns.dm_id`. Prose always says "Keeper", never "DM" or "GM"; database names that already say `dm` (`dm_id`, `is_dm_of_campaign`, `dm_sees_character`) keep that spelling |
| Campaign creator | A person the owner allow-listed to make campaigns | A row in `campaign_creators` |
| Site admin | A person the owner allow-listed to approve new emails | A row in `site_admins` |
| Owner | Caleb, through the Supabase dashboard, the service role key, or the owner's `npm run` scripts | Bypasses Row Level Security entirely |

These roles are not exclusive. A Keeper is also a signed-in person and can own characters of their
own; a site admin is not automatically a Keeper or a campaign creator, and holding one role never
grants another.

## 3. Signing in

An account uses Supabase Auth, with the PKCE flow, in one of two ways: a password, or a magic link
emailed to you. Either way, only an email a site admin approved in the last 7 days can make a new
account (section 4, `hook_require_approved_email`) — the sign-up and sign-in pages show the same
message for an unapproved email as for any other failure, so a stranger cannot tell which emails are
approved. A password must be at least 12 characters; anything past 72 bytes is ignored, because
Supabase's hashing (bcrypt) ignores it too. A magic link must be opened in the browser that asked for
it. Confirming your email is what makes an approval count as used; until then the account might
belong to someone else who knew the same email, so the approval still waits and can still be
revoked.

## 4. The tables

Two layers guard every table: a GRANT decides whether a role may attempt an operation at all, then
Row Level Security decides which rows. A "Write" cell below is the direct columns a role may write
where the app writes directly (rare and narrow), or the function that is the only path in.

| Table | Holds | Who reads | Who writes |
|---|---|---|---|
| `profiles` | One row per account: display name | Yourself; anyone who shares a campaign with you | Insert `(id, display_name)` and update `(display_name)`, your own row only. Never deleted |
| `campaigns` | One row per campaign: its Keeper, its name | The Keeper (own campaigns); a player who is a member | Insert `(dm_id, name)` only if `dm_id` is you and you are an allow-listed creator; update `(name)`, the Keeper only. No client delete |
| `campaign_players` | Campaign membership: who joined, when, with which invite | The Keeper, their campaign's rows; a player, their own row | Nothing direct. Only `join_campaign`, `leave_campaign`, `remove_player` |
| `characters` | A person's character sheet: name, `schema_version`, `data` (the sheet's fields as JSON), `deleted_at` | The owner, all their rows, deleted or not; the Keeper, only while the character is active in their campaign | Insert/update `(character_name, data, owner_id, schema_version)`, the owner only, and only while not deleted. `id`, `updated_at`, `deleted_at` are server-set. No client delete — `delete_character` sets `deleted_at` instead |
| `character_history` | A snapshot of a character's data before an edit, a schema change, a restore, or a delete | The owner of the character; the Keeper, only snapshots saved after the character became active in their campaign | Nothing. A trigger (`snapshot_character`) writes it |
| `campaign_creators` | The allow-list of who may create a campaign | Your own row only | Nothing. Managed only by `npm run creators` or the dashboard |
| `campaign_invites` | One row per invite: a hash of its code (never the code), who made it, its expiry, use limit, use count | The Keeper of the campaign, metadata columns only (`id, campaign_id, label, created_at, expires_at, max_uses, use_count, revoked_at`) — never `code_hash` or `created_by` | Nothing direct. Only `create_invite`, `revoke_invite`, `replace_invite` |
| `campaign_characters` | Which one character is active for each player in each campaign, right now | The player, their own row; the Keeper, their campaign's rows | Nothing direct. Only `choose_character`, `leave_campaign`, `remove_player` |
| `departed_sheets` | A frozen copy of a sheet from the moment its player left or was removed (newest 3 kept per player per campaign) | The Keeper of the campaign only | Nothing. `freeze_sheet` writes it, called from `leave_campaign` and `remove_player` |
| `site_admins` | Who may approve emails | Nobody from the client, not even a site admin | Nothing. Managed only by `npm run admins` or the dashboard |
| `approved_emails` | Emails a site admin approved, and when that approval ends (7 days) | Nobody from the client. Supabase Auth's sign-up hook reads `(email, expires_at)` only, as `supabase_auth_admin` | Nothing direct. Only `approve_email`, `revoke_approval`, or `npm run admins approve` |
| `rulebook` / `rulebook_pages` | The player's rulebook: its title and version, and each chapter's Markdown | Any signed-in person | Nothing from the client. Replaced whole, by the owner, with `npm run rulebook push` |
| `character_purges` | A log of forever-deletes: who, when, the character's id. No name, no sheet data | Nobody from the client, not even a site admin's own query — only through `list_purges()` | Nothing direct. `purge_character` writes it |

Two Auth-side hooks matter:

- **`on_auth_user_created`** (a trigger on `auth.users`) creates the `profiles` row for every new
  account (`handle_new_user`). A failure here only logs a warning; it never blocks sign-up. The app
  also creates a missing profile itself, on its own row, as a fallback.
- **`before_user_created`** (a Supabase Auth hook, `hook_require_approved_email`) runs before Auth
  makes any account, for a password sign-up or a magic link alike. It refuses one whose email has
  no live row in `approved_emails`. It runs as `supabase_auth_admin`, which can read only
  `approved_emails.email` and `expires_at` — nothing else in the schema.

`anon` (a request with no session) has no privilege on any table and can execute no function in
`public`. Nothing in the app works signed out except reading the login and sign-up pages themselves.

Realtime tells a page when to re-read, never what changed: it carries only `characters` and
`campaign_characters`, and a subscription still obeys the tables above, so it can never show a row a
plain read would refuse. The Keeper's roster uses it to notice a player's save or a change of active
character; nothing else in the app subscribes to it.

## 5. Who can do what

Roles are not exclusive (section 2), so "Player", "Keeper" and "Site admin" below all also carry
the "any signed-in person" rights above them.

| Action | Stranger | Player | Keeper | Site admin | Owner |
|---|---|---|---|---|---|
| Read own sheet | No | Yes | Yes | Yes | Yes |
| Write own sheet | No | Yes | Yes | Yes | Yes |
| Read a campaign's active sheets | No | No | Yes, own campaign | No | Yes |
| Create a campaign | No | Only if allow-listed | Yes (already a creator) | No, unless also allow-listed | Yes |
| Create/revoke/replace an invite | No | No | Yes, own campaign | No | Yes |
| Join a campaign | No | Yes | Yes, other campaigns (not their own) | Yes | Yes |
| Leave a campaign | No | Yes, own membership | Yes, memberships held as a player | Yes | Yes |
| Remove a player | No | No | Yes, own campaign | No | Yes |
| Delete / undelete a character | No | Yes, own | Yes, own | Yes, own | Yes |
| Delete a character forever | No | Yes, own, archived, 10/day | Yes, own | Yes, own | Yes |
| Restore a saved version | No | Yes, own | Yes, own | Yes, own | Yes |
| Read version history | No | Yes, own | Yes, own campaign, from when the character joined it | Yes, own | Yes |
| Read the rulebook | No | Yes | Yes | Yes | Yes |
| Approve an email | No | No | No | Yes | Yes |
| Manage site admins or campaign creators | No | No | No | No | Yes, `npm run admins`/`creators` |
| Upload the rulebook | No | No | No | No | Yes, `npm run rulebook push` |
| Back up the database | No | No | No | No | Yes, `npm run backup` |

## 6. Functions clients call (RPCs)

The app calls these through Supabase's RPC endpoint. Each checks the caller itself; a grant alone
never proves the action is allowed. Helper functions used only inside RLS policies
(`is_dm_of_campaign`, `is_player_of_campaign`, `is_campaign_creator`, `dm_sees_character`,
`shares_campaign_with`) are not listed — the app never calls them directly.

| Function | Who may call it | What it does | Limits |
|---|---|---|---|
| `join_campaign(code)` | Any signed-in person | Joins the campaign behind a valid, active invite. Calling it again while already a member is harmless | — |
| `leave_campaign(campaign_id)` | A player | Leaves a campaign; freezes a copy of their active sheet for the Keeper first | — |
| `remove_player(campaign_id, player_id)` | The campaign's Keeper | Removes a player from their campaign; freezes a copy of their sheet first | — |
| `create_invite(campaign_id, label?, max_uses?, ttl_hours?)` | The campaign's Keeper | Makes a new invite; returns its plaintext code once | 1-50 uses, 1 hour-30 days, 50 active/500 total invites per campaign |
| `revoke_invite(invite_id)` | The campaign's Keeper | Ends an invite early | — |
| `replace_invite(invite_id)` | The campaign's Keeper | Ends an active invite and makes a new one with the same label, remaining uses and lifetime | — |
| `preview_invite(code)` | Any signed-in person | Shows what an invite is for (the campaign and the Keeper's name) without using it | — |
| `choose_character(campaign_id, character_id)` | A campaign member | Makes one of your characters active in that campaign; frees the one it replaces | A character is active in one campaign at a time |
| `delete_character(id)` | The character's owner | Hides a character (`deleted_at`); refused while it is active in a campaign | — |
| `undelete_character(id)` | The owner | Brings a hidden character back | The 5-character limit still applies |
| `restore_character_version(history_id, expected_updated_at)` | The owner | Replaces the live sheet with an earlier saved version | Refused if the sheet changed since it was opened, or is deleted |
| `purge_character(id)` | The owner | Deletes an already-archived character forever, with its history and any departed copies | 10 purges per person per 24 hours |
| `is_site_admin()` | Any signed-in person | Says whether you are a site admin, to show or hide the Admin link | — |
| `approve_email(email)` | A site admin | Approves an email for 7 days, or renews it | At most 20 approvals waiting for an account at once |
| `revoke_approval(email)` | A site admin | Cancels an approval that no confirmed account has used yet | — |
| `list_accounts()` | A site admin | Every account, oldest first | — |
| `list_pending_approvals()` | A site admin | Approvals still waiting for a confirmed account | — |
| `list_purges()` | A site admin | The forever-delete log, newest first | — |

Creating a campaign and choosing to create one are not an RPC: a Keeper's first campaign is a plain
insert into `campaigns`, allowed only when `is_campaign_creator()` is true (section 4).

## 7. The pages

Every page below except the first five needs a signed-in, approved account; visiting one signed out
sends you to `/login` and back afterward. A page marked "Keeper only" answers "not found" or "not
allowed" to anyone else, including a site admin who is not that campaign's Keeper.

| URL | Who can open it | What it shows |
|---|---|---|
| `/` | Signed-in person | Your campaigns, with a "leave" button on each; or, if you are in none, a form to join one by invite code and (if you may create one) a form to start one |
| `/login` | Stranger | Sign in with a password or a magic link. Sends a signed-in visitor onward instead |
| `/signup` | Stranger | Create an account, for an email a site admin approved. Sends a signed-in visitor onward instead |
| `/forgot-password` | Stranger | Ask for a password-reset email |
| `/reset-password` | Whoever an emailed reset link just signed in | Choose a new password, then signs you out everywhere else |
| `/account` | Signed-in person | Your display name, email and password, and buttons to sign out other sessions or everywhere |
| `/admin` | Site admin | Approve or revoke emails, list every account, list forever-deletes |
| `/join/:code` | Signed-in person | Confirms what an invite is for before you use it; joining needs a further click |
| `/characters` | Signed-in person | Your characters, in or out of a campaign: make, import, delete, undelete |
| `/characters/:characterId` | The character's owner | The sheet itself, live and editable (read-only if it is deleted or its schema is newer than this app understands) |
| `/characters/:characterId/history` | The owner | The saved versions kept for that character |
| `/characters/:characterId/history/:historyId` | The owner | One saved version, with a button to restore it |
| `/rules` | Signed-in person | The rulebook's table of contents |
| `/rules/:slug` | Signed-in person | One rulebook chapter, with the chapters either side of it |
| `/campaign/:id/character` | A member of that campaign | Choose which of your characters is active there. A Keeper who opens their own campaign's page sees a notice instead: they have no sheet |
| `/campaign/:id/keeper` | That campaign's Keeper | The roster: each active player's card, a live read-only view of their sheet, invite management, and "download all sheets" |
| `/campaign/:id/keeper/:characterId` | That campaign's Keeper | One active player's sheet, read only |
| `/campaign/:id/keeper/:characterId/history` | That campaign's Keeper | That character's saved versions, from when it became active in this campaign onward |
| `/campaign/:id/keeper/:characterId/history/:historyId` | That campaign's Keeper | One saved version, read only — the Keeper never restores a player's sheet |
| `/campaign/:id/left/:copyId` | That campaign's Keeper | A frozen copy kept from a player who left or was removed |

## 8. Limits at a glance

Numbers already given above are not repeated here.

| What | Limit |
|---|---|
| Characters per person | 5 kept, 30 ever (deleted ones count) |
| A character's saved sheet | at most 512 KiB |
| Character name | at most 100 characters |
| Campaign name | 1-80 characters |
| Display name | 1-40 characters |
| Campaigns | at most 4 |
| People on the site | about 10 |
| Saved versions kept per character | newest 30 edits, 10 schema changes, 10 restores; every delete kept forever |
| Departed-sheet copies | newest 3 per player per campaign |
| Invites per campaign | 50 active, 500 ever |
| An invite's uses | 1-50 |
| An invite's lifetime | 1 hour to 30 days |
| Approved emails waiting for an account | at most 20 |
| An approval's lifetime | 7 days |
| A rulebook chapter | at most 256 KiB |
| Forever-deletes (`purge_character`) | 10 per person per 24 hours |

## 9. Owner tasks

Full steps for each are in the README, under the section named.

| Task | What it does |
|---|---|
| `npm run backup [folder]` | Saves all live data, including every account's email and password hash, to a file outside the repo (README, Backups) |
| `npm run backup:check <file>` | Loads a backup file into a throwaway database and compares row counts, to check the file is good (README, Backups) |
| `npm run rehearse <file>` | Opens every sheet in a backup with the current app, to catch a bad rules or schema change before it ships (README, Backups) |
| `npm run admins add\|remove\|list\|approve <email> [staging]` | Manages site admins, and approves an email when no admin exists yet to do it (README, Who can make an account) |
| `npm run creators add\|remove\|list <email> [staging]` | Manages who may create a campaign (README, Who can create a campaign) |
| `npm run rulebook push <folder> [staging]` | Replaces the whole rulebook in one transaction (README, Rulebook) |
| `npm run staging push\|check` | Pushes new migrations and settings to the staging project, or previews what a push would change (README, Development) |
| `npm run dev` | Runs the site locally against the staging project, on port 8787 (README, Development) |

**Release order:** back up (`npm run backup`), push the migration to staging (`npm run staging
push`), push it to live (`npx supabase db push`), push settings only if `supabase/config.toml`
changed (`npx supabase config push`), then merge the pull request into `main` — Cloudflare Workers
Builds deploys that merge at once. Full steps: README, Releasing a change.

## 10. Where to read more

- **README.md** — setup, running the site locally, the three test suites, backups, deploying, and
  the exact steps for releasing a change.
- **CLAUDE.md** — the rules and conventions an agent (or a person) follows while changing this repo:
  what goes in `public/`, the sheet's save rules, the CSP, accessibility, and more.
- **docs/adr/** — why each decision was made, one file per decision, oldest first:

| ADR | Title |
|---|---|
| 0001 | Eclipse data model, auth, and access control on Supabase |
| 0002 | Require campaign membership to write a character; server-side invite codes |
| 0003 | Grant Data API privileges explicitly, and mirror the platform in tests |
| 0004 | Scale limits and never losing a character |
| 0005 | Only allow-listed people create campaigns; players join with hashed, expiring invites |
| 0006 | Least-privilege columns, bounded history, and safer configuration |
| 0007 | A proper account system |
| 0008 | The player sheet |
| 0009 | The DM roster |
| 0010 | Version history and restore |
| 0011 | Characters belong to people, not campaigns |
| 0012 | Managing invites and members |
| 0013 | Changing the game's rules without losing a sheet |
| 0014 | Only approved emails make accounts; site admins; five characters each |
| 0015 | A staging project for development, and a dev copy of the site |
| 0016 | The rulebook, for signed-in people only |
| 0017 | The sheet follows the rulebook |
| 0018 | A player can delete their own archived character forever |
| 0019 | One field list for the sheet's inputs |
