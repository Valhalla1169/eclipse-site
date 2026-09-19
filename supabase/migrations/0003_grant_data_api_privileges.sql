-- Eclipse — explicit table and function privileges for the Data API.
--
-- 0001 created the tables and RLS policies but granted no privileges. On this
-- project a new public table gives anon/authenticated only TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN, not select/insert/update/delete, so every
-- signed-in query failed with "permission denied for table". (The test harness
-- had masked this by granting authenticated full CRUD; it now mirrors the real
-- defaults.)
--
-- Two layers protect the data, and both must allow an operation: a GRANT (this
-- file) decides whether a role may attempt it at all, then RLS (0001/0002)
-- decides which rows. Grant no more than the policies use.
--
-- Nothing here is granted to anon: no part of the app works signed out.

-- ════════════════════════════════════════════════════════════════════
-- TABLES
-- ════════════════════════════════════════════════════════════════════
-- Start from nothing. This also removes the TRUNCATE, REFERENCES and TRIGGER
-- privileges the platform defaults handed out: TRUNCATE bypasses RLS entirely,
-- so no client role should hold it.
revoke all on table
  public.profiles, public.campaigns, public.campaign_players, public.characters
  from anon, authenticated;

-- profiles: policies exist for select/insert/update only (no delete policy).
grant select, insert, update on public.profiles to authenticated;

-- campaigns: the DM creates, edits and deletes their own; players read.
grant select, insert, update, delete on public.campaigns to authenticated;

-- campaign_players: READ ONLY from the client. Every membership change goes
-- through join_campaign()/leave_campaign()/remove_player() (SECURITY DEFINER),
-- so no insert/update/delete grant, on top of there being no policy for them.
grant select on public.campaign_players to authenticated;

-- characters: the owner writes their own; the DM reads (RLS narrows both).
grant select, insert, update, delete on public.characters to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ════════════════════════════════════════════════════════════════════
-- Functions default to EXECUTE for PUBLIC (and this platform also grants it to
-- anon/authenticated explicitly). Callable by signed-in users only.
revoke execute on function
  public.join_campaign(text),
  public.leave_campaign(uuid),
  public.remove_player(uuid, uuid),
  public.is_dm_of_campaign(uuid),
  public.is_player_of_campaign(uuid),
  public.generate_invite_code()
  from public, anon;

grant execute on function
  public.join_campaign(text),
  public.leave_campaign(uuid),
  public.remove_player(uuid, uuid),
  public.is_dm_of_campaign(uuid),          -- called from RLS policies as the querying user
  public.is_player_of_campaign(uuid),      -- called from RLS policies as the querying user
  public.generate_invite_code()            -- column default, evaluated as the inserting user
  to authenticated;

-- Trigger functions run because a trigger fired; the firing role needs no
-- EXECUTE on them, so nobody outside the database owner should hold it.
revoke execute on function
  public.set_updated_at(),
  public.characters_lock_identity()
  from public, anon, authenticated;
