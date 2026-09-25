# ADR 0009: The DM roster

Status: **Accepted.** Built.
Date: 2026-09-20
Builds on: ADR 0001 (the DM reads every sheet and never writes one), 0004 (a backup button for the
DM) and 0008 (the player sheet). ADR 0011 changed what the roster reads: each player's active
character, and the copies kept from players who left, instead of one sheet per player per campaign.
ADR 0012 added **Remove from campaign** and **Invite again** to the cards, and the invite each player joined with.

## What it is

The DM page (`/campaign/:id/dm`) has a **Players** section above the invites:

- One card per player, in the order they joined: character name, player name, race and profession,
  the dice penalty, Shock, Trauma and Rot (boxes and penalty), load, action points, soak, Sanity,
  Morality, days without rations, and when the sheet was last saved. A badge shows Dying,
  Corrupted, Unconscious or Starved. A member who has not opened their sheet yet is listed too.
- **Open sheet** shows that player's full sheet at `/campaign/:id/dm/:characterId`. It is the same
  sheet as the player's, read only: the pages are `inert`, and there is no Save now or Load file.
  It follows the row while it is open.
- **Save a copy** on a card downloads that sheet as an `.eclipse` file, exactly as stored.
- **Download all sheets** downloads one JSON file for the campaign
  (`<campaign>-sheets-<date>.json`): every sheet exactly as stored (not cleaned or migrated), with
  player name, whether they are still a member, `schemaVersion` and `updatedAt`. Each `data` with
  its `schemaVersion` is a valid `.eclipse` file. It is read fresh when you press the button, not
  taken from what is on screen. It does not include `character_history`.
- **Former players.** A sheet whose owner is no longer a member is kept, in its own list (ADR 0001:
  the DM can still read it). A sheet that cannot be read is listed without numbers, and is in the
  backup file as stored.

## Decisions

1. **Cards plus the real sheet, not a new summary layout.** The card holds what a DM needs at the
   table. Anything more opens the same sheet the player uses, so there is no second copy of the
   layout to keep in step. The card numbers come from `summarizeSheet` in `eclipse-rules.js`, the
   same functions the player's sheet uses.
2. **Realtime tells the page to look; it does not carry the data.** A subscription to
   `postgres_changes` on `characters`, filtered to the campaign, only triggers a refresh. The refresh
   reads each sheet's `id` and `updated_at` and re-reads only the ones that changed. A change
   payload can be cut short for a large sheet, and a message can be missed, so nothing depends on
   its content. The page also checks every 30 seconds, and again each time the subscription comes
   back. A badge says Live or Not live. The subscription follows the same RLS policy as a read.
3. **No write of any kind from the DM's pages.** No insert, update, delete or RPC is called.
   `tests/e2e/roster.spec.js` fails if one is.
4. **Removing a player, built in ADR 0012.** The card's **Remove from campaign** button calls
   `remove_player`. A removed player's sheet still shows under Former players, and **Invite again**
   brings them back with a new invite.

## Known gaps

- The 30-second check reads a small list of ids and times, not the sheets.
- The roster is not paged. It is built for about a dozen players (ADR 0004).
- Realtime was checked in the browser tests against a stand-in for the websocket. It has to be seen
  once on the live project (a player edits, the DM's page changes).
