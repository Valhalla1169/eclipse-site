# ADR 0012: Managing invites and members

Status: **Accepted.** Built.
Date: 2026-09-20
Amends: ADR 0005 (invites), ADR 0009 (what the roster can do) and ADR 0011 (leaving and removing).
Migration: `supabase/migrations/0010_invite_management.sql`.
Tests: `supabase/tests/invites.test.sql` (32 checks), `tests/e2e/invites.spec.js`, and the changed
join tests in `tests/e2e/campaigns.spec.js`.

## Problem

ADR 0005 made invites safe: server-made, hashed, expiring, limited, revocable, shown once. Since then
characters moved to people (ADR 0011) and leaving keeps a copy for the DM. The invite flow around
that had gaps:

- Opening a link joined you at once. There was no "what is this?" step.
- The site never recorded which invite a player used, so a label such as "for Sam" could not be
  matched to a player.
- A player who left or was removed could not come back without the DM making a new invite by hand,
  and there was no button to leave or to remove anyone.
- A lost link meant revoking it and making a new one from scratch.
- Nothing bounded the invite list, and old invites stayed in it.

## What it is

- **Join confirmation.** `/join/CODE` first asks the database what the invite is for
  (`preview_invite`), and shows "Join Age of Eclipse? Ravi runs this campaign." with **Yes, join this
  campaign** and **Not now**. Someone who is already a member goes straight to the campaign.
- **Which invite.** `campaign_players.invite_id` is set by `join_campaign`. A roster card says
  "Joined with the invite 'Sam'". Members from before this have none.
- **Remove and Leave.** A DM's roster card has **Remove from campaign**. A player's campaign card has
  **Leave campaign**. Both ask first and say what is kept. They call the functions that already
  existed (`remove_player`, `leave_campaign`), which keep a copy of the active sheet (ADR 0011).
- **Invite again.** A former player's card has **Invite again**. It fills in the invite form with
  their name and moves focus to **Create invite link**. It creates nothing by itself.
- **Replace link.** An active invite has **Replace link**. `replace_invite` ends it and makes a new
  one with the same label, the uses it had left, and the same lifetime. The new link is shown once.
- **Limits and clutter.** A campaign can have 50 active invites and 500 in all. Invites that are used
  up, expired or revoked are folded under "Older invites".

## Decisions

1. **Preview is a separate function, not a change to join.** It makes the same checks and gives the
   same single error as `join_campaign`, and it changes nothing, so looking never uses an invite up.
   It tells the holder of a valid code the campaign's name and the DM's display name. They are about
   to be told anyway, and the code is the secret.
2. **A member skips the confirmation.** Opening a link again is harmless (ADR 0005), and asking twice
   would be noise.
3. **The confirmation is on the site, not in the link.** A link preview or an email scanner that opens
   the URL never joins anyone, because the page runs no request until the button is pressed.
4. **`invite_id` is written only by `join_campaign`.** Players have no write grant on
   `campaign_players`. If an invite row is ever removed, the column becomes empty
   (`on delete set null`) and the roster simply says nothing.
5. **Replace keeps the promise of ADR 0005.** The new code is server-made and shown once, and only its
   hash is stored. The old invite is revoked in the same transaction, so there is never a moment with
   both. Only an active invite can be replaced.
6. **The limits count active invites, plus a total.** Active ones (not revoked, not expired, not used
   up) cap at 50, so a DM can always clear room by revoking. The total of 500 stops a loop. Both checks
   share one lock per campaign.
7. **Remove and Invite again are the DM's own choices, not reading a sheet.** The roster panel takes
   them as callbacks. Sheet pages stay read only (ADR 0001, 0009).
8. **Leaving needs a new invite to come back.** That is ADR 0005's rule, kept. "Invite again" makes it
   one click.

## Not done, and why

- **A shared link with a DM approval queue.** It would mean fewer links, and a leaked link would be
  harmless, but it needs a pending table and a live approval screen. Not worth it for a table of about
  a dozen people. It can be added later without changing what is here.
- **Invites tied to an email address.** It needs email sending from the server and stores addresses.
- **Rate limiting on joining.** The 120-bit code makes guessing pointless, as ADR 0005 says.
- **Removing a player does not end their sign-in or delete their characters.** Their characters are
  theirs (ADR 0011).
