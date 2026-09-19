-- Eclipse — harden the characters write policies and invite codes.
-- See docs/adr/0002-require-membership-for-character-writes.md.
--
-- Found by probing 0001 with cases its test suite did not cover
-- (supabase/tests/rls_hardening.test.sql now covers them):
--   1. characters INSERT/UPDATE checked only owner_id, so a signed-in user who
--      never joined a campaign could insert a sheet into it, an owner could
--      UPDATE campaign_id to move a sheet into any campaign, and a removed
--      player could keep writing.
--   2. Nothing generated invite codes, and a 1-character code was accepted.
--   3. Nothing bounded the size of a sheet.
--   4. Invite codes were case- and whitespace-sensitive.
--
-- Never edit 0001 after it has been applied anywhere; changes go in new files.

-- ════════════════════════════════════════════════════════════════════
-- 1. characters: writes require membership; identity is immutable
-- ════════════════════════════════════════════════════════════════════
-- Reads are unchanged: an owner can always read their own row (so a removed
-- player can still see and export their sheet) and the DM can read every
-- sheet in their campaign, including a removed player's (needed for Restore).
drop policy "only the owner can insert their character" on public.characters;
drop policy "only the owner can update their character" on public.characters;

create policy "a campaign member can insert their own character"
  on public.characters for insert
  to authenticated
  with check (owner_id = auth.uid() and public.is_player_of_campaign(campaign_id));

create policy "a campaign member can update their own character"
  on public.characters for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_player_of_campaign(campaign_id));

-- A sheet never changes owner or campaign. Enforced by trigger because RLS
-- WITH CHECK only sees the new row, not what it used to be.
create function public.characters_lock_identity() returns trigger
language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id
     or new.campaign_id is distinct from old.campaign_id then
    raise exception 'a character''s owner_id and campaign_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger characters_lock_identity
  before update on public.characters
  for each row execute function public.characters_lock_identity();

-- ════════════════════════════════════════════════════════════════════
-- 2. Size and shape limits, enforced in the database (DESIGN.md 5.5)
-- ════════════════════════════════════════════════════════════════════
-- The 1 MiB cap on `data` is generous headroom over a real sheet; revisit it
-- with a real serialized sheet's size before tightening.
alter table public.characters
  add constraint characters_name_len check (char_length(character_name) <= 100),
  add constraint characters_data_is_object check (jsonb_typeof(data) = 'object'),
  add constraint characters_data_size check (pg_column_size(data) <= 1048576);

-- ════════════════════════════════════════════════════════════════════
-- 3. Invite codes: generated server-side, well-formed, forgiving to type
-- ════════════════════════════════════════════════════════════════════
-- 10 uppercase hex characters (40 bits) from gen_random_uuid(), which is
-- backed by a CSPRNG. Still a shared secret, not a hardened token: see the
-- "no rate limiting on join_campaign()" note in ADR 0001.
create function public.generate_invite_code() returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

alter table public.campaigns
  alter column invite_code set default public.generate_invite_code();

alter table public.campaigns
  add constraint campaigns_invite_code_format check (invite_code ~ '^[A-Z0-9]{6,32}$');

-- join_campaign() now normalizes what a human typed or pasted. Otherwise
-- identical to 0001, including qualifying ON CONFLICT by constraint name.
create or replace function public.join_campaign(p_invite_code text)
returns table (campaign_id uuid, campaign_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_campaign_name text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join a campaign';
  end if;

  select c.id, c.name into v_campaign_id, v_campaign_name
  from public.campaigns c
  where c.invite_code = upper(btrim(p_invite_code));

  if v_campaign_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into public.campaign_players (campaign_id, player_id)
  values (v_campaign_id, auth.uid())
  on conflict on constraint campaign_players_pkey do nothing;

  return query select v_campaign_id, v_campaign_name;
end;
$$;
