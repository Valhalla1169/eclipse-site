-- Eclipse — initial schema, RLS, and realtime wiring.
-- Implements DESIGN.md §3.3.1 with the decisions recorded in
-- docs/adr/0001-eclipse-supabase-data-model.md:
--   - Auth: Supabase magic link (email, no password)
--   - DM/player linking: DM shares an invite code; player calls join_campaign()
--   - DM access to characters: strictly view-only (no DM write policy at all)
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor once,
-- in order. Never hand-edit the schema in the dashboard afterward — add a
-- new migration file instead (DESIGN.md §3.3).
--
-- Layout: all tables first (so cross-table policies below never forward-
-- reference a table that doesn't exist yet), then RLS + policies per table,
-- then functions, then realtime.

-- ════════════════════════════════════════════════════════════════════
-- TABLES
-- ════════════════════════════════════════════════════════════════════

-- profiles — Supabase's own auth.users table isn't queryable from client
-- code the way app data needs to be (no RLS, not meant for joins from
-- anon/authenticated roles). This is the public, RLS-governed mirror: one
-- row per signed-in person, holding just the display name a join screen or
-- DM view needs.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(trim(display_name)) between 1 and 40),
  created_at    timestamptz not null default now()
);

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  dm_id       uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table public.campaign_players (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id   uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (campaign_id, player_id)
);

-- One row per player's CURRENT character in a campaign (matches the
-- original roster spec's "no in-app history, upload/download is the
-- backup" model). `data` holds the full sheet state blob exactly as the
-- existing sheet already serializes it for save/load — this table adds an
-- identity/ownership/campaign boundary around that blob, it does not
-- re-normalize the sheet's ~3,700 lines of fields into columns.
create table public.characters (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  schema_version int not null default 1,
  character_name text not null default '',
  data           jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  unique (owner_id, campaign_id)  -- one current character per player per campaign
);

create index characters_campaign_id_idx on public.characters(campaign_id);

-- ════════════════════════════════════════════════════════════════════
-- CROSS-TABLE RLS HELPERS
-- ════════════════════════════════════════════════════════════════════
-- campaigns and campaign_players each need to check a fact that lives in
-- the OTHER table (is this user the DM of this campaign? / is this user a
-- player in this campaign?). Doing that with a plain subquery straight in
-- the policy is a trap: campaigns' policy would query campaign_players,
-- whose own policy queries campaigns, whose own policy queries
-- campaign_players again -- Postgres detects that as infinite recursion
-- and refuses to evaluate either policy at all (confirmed while testing
-- this migration -- it is not a hypothetical). The fix is the standard
-- Supabase/Postgres pattern: put each cross-table check in its own
-- SECURITY DEFINER function. A SECURITY DEFINER function runs as its
-- owner (the migration role), which -- because RLS is never FORCEd on
-- these tables -- is exempt from RLS as the tables' owner, so the check
-- runs once, plainly, without re-triggering the calling policy.
create function public.is_dm_of_campaign(p_campaign_id uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id and c.dm_id = auth.uid()
  );
$$;

create function public.is_player_of_campaign(p_campaign_id uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_players cp
    where cp.campaign_id = p_campaign_id and cp.player_id = auth.uid()
  );
$$;

-- ════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_players enable row level security;
alter table public.characters enable row level security;

-- ── profiles ──────────────────────────────────────────────────────────
-- Display names are low-sensitivity and every authenticated person in this
-- app is either a DM or a player who needs to see co-players' names (roster,
-- DM tabs) — so reads are open to any signed-in user rather than scoped per
-- campaign. Nothing else about a person lives here.
create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "a user can insert only their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "a user can update only their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── campaigns ─────────────────────────────────────────────────────────
create policy "the DM can read their own campaign"
  on public.campaigns for select
  to authenticated
  using (dm_id = auth.uid());

create policy "a player can read a campaign they belong to"
  on public.campaigns for select
  to authenticated
  using (public.is_player_of_campaign(id));

create policy "a signed-in user can create a campaign they DM"
  on public.campaigns for insert
  to authenticated
  with check (dm_id = auth.uid());

create policy "only the DM can update their campaign"
  on public.campaigns for update
  to authenticated
  using (dm_id = auth.uid())
  with check (dm_id = auth.uid());

create policy "only the DM can delete their campaign"
  on public.campaigns for delete
  to authenticated
  using (dm_id = auth.uid());

-- Note: there is deliberately NO policy letting a bare authenticated user
-- SELECT a campaign by invite_code before joining it — that lookup happens
-- inside join_campaign() below (SECURITY DEFINER), not via a client-side
-- query, so the invite_code space can't be scanned/enumerated from the
-- client.

-- ── campaign_players ──────────────────────────────────────────────────
create policy "the DM can read their campaign's roster"
  on public.campaign_players for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

create policy "a player can read their own membership rows"
  on public.campaign_players for select
  to authenticated
  using (player_id = auth.uid());

-- No direct INSERT/UPDATE/DELETE policy for campaign_players: membership is
-- only ever created by join_campaign() (SECURITY DEFINER, below) and only
-- ever removed by remove_player()/leave_campaign() (also below) — never by
-- a raw client insert/delete, so a player can't add themselves to an
-- arbitrary campaign_id without the matching invite code, and can't remove
-- another player's row.

-- ── characters ────────────────────────────────────────────────────────
create policy "an owner can read their own character"
  on public.characters for select
  to authenticated
  using (owner_id = auth.uid());

create policy "the DM can read characters in their own campaign"
  on public.characters for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

-- Strictly owner-write, per the "DM is view-only" decision: no DM write
-- policy exists at all, on any statement type, for this table.
create policy "only the owner can insert their character"
  on public.characters for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "only the owner can update their character"
  on public.characters for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "only the owner can delete their character"
  on public.characters for delete
  to authenticated
  using (owner_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ════════════════════════════════════════════════════════════════════

-- Keep `updated_at` honest on every write, so the DM view's "last edit"
-- timestamp is trustworthy without the client having to set it itself.
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_set_updated_at
  before update on public.characters
  for each row execute function public.set_updated_at();

-- join_campaign(): the only way a campaign_players row is created.
-- SECURITY DEFINER so it can look up a campaign by invite_code (which the
-- calling user has no SELECT policy for) without exposing that lookup as a
-- general-purpose policy. Runs as its owner (the migration role), not the
-- calling user -- keep this function's body narrow and specific.
create function public.join_campaign(p_invite_code text)
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
  where c.invite_code = p_invite_code;

  if v_campaign_id is null then
    raise exception 'invalid invite code';
  end if;

  -- Qualified by constraint name, not column list: this function's OUT
  -- parameters (from `returns table (campaign_id, campaign_name)`) are
  -- implicitly in scope as PL/pgSQL variables for the whole function body,
  -- and `on conflict (campaign_id, player_id)` is ambiguous between that
  -- variable and the table's own column of the same name (confirmed while
  -- testing this migration -- Postgres refuses to guess). Naming the
  -- constraint sidesteps the collision entirely.
  insert into public.campaign_players (campaign_id, player_id)
  values (v_campaign_id, auth.uid())
  on conflict on constraint campaign_players_pkey do nothing;

  return query select v_campaign_id, v_campaign_name;
end;
$$;

grant execute on function public.join_campaign(text) to authenticated;

-- leave_campaign(): a player removing themselves.
create function public.leave_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.campaign_players
  where campaign_id = p_campaign_id and player_id = auth.uid();
end;
$$;

grant execute on function public.leave_campaign(uuid) to authenticated;

-- remove_player(): DM removing a player from their own campaign (the
-- roster spec's "archive" action).
--
-- IMPORTANT, confirmed by testing this migration: this does NOT revoke the
-- DM's read access to that player's characters row. "the DM can read
-- characters in their own campaign" (above) is grounded in the DM owning
-- the *campaign* (is_dm_of_campaign(campaign_id)), not in the player's
-- current campaign_players membership -- and that's intentional, not an
-- oversight: the roster spec's "Restore" flow requires the DM to still be
-- able to see (and reinstate) an archived player's last character. If a
-- player is removed and later restored, their data must still be there to
-- restore.
--
-- What this DOES do: remove the campaign_players row, so the player drops
-- off `join_campaign`'s effect and off any query that lists "active"
-- members. The DM's "active roster" tab strip is therefore a CLIENT-QUERY
-- concern, not an RLS concern: build it from campaign_players (who's
-- currently active) joined against characters, not from characters alone
-- -- characters alone includes archived players' rows too, by design.
--
-- A genuine permanent-delete tool (actually destroying a characters row),
-- if ever needed, is a separate, more deliberate function -- do not fold
-- it into this one.
create function public.remove_player(p_campaign_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign_id and dm_id = auth.uid()
  ) then
    raise exception 'only the DM of this campaign can remove a player';
  end if;

  delete from public.campaign_players
  where campaign_id = p_campaign_id and player_id = p_player_id;
end;
$$;

grant execute on function public.remove_player(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- REALTIME
-- ════════════════════════════════════════════════════════════════════

-- Scoped narrowly per DESIGN.md §3.2/§3.3.1: only the table the DM's live
-- view actually needs. Subscriptions still go through the RLS policies
-- above -- a realtime subscription can't read what a plain SELECT couldn't.
alter publication supabase_realtime add table public.characters;
