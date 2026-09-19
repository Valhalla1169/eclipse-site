-- Eclipse — who may create a campaign, and how players get in (docs/adr/0005).
--
--   1. Only people on an allowlist can create a campaign. Nobody can add
--      themselves to it: it has no client write grant and is managed with
--      `npm run creators` (or SQL as the project owner).
--   2. Players join only through an invite the DM created. Invites are
--      server-generated with 120 bits of randomness, stored only as a SHA-256
--      hash, expire, have a use limit, can be revoked, and are shown to the DM
--      exactly once. The old plaintext campaigns.invite_code is removed.
--   3. A stranger with an account can no longer read other people's display
--      names: profiles are visible to yourself and to people you share a
--      campaign with.
--
-- Every new table gets its GRANTs here, next to its policies (ADR 0003).

-- ════════════════════════════════════════════════════════════════════
-- 1. Campaign creator allowlist
-- ════════════════════════════════════════════════════════════════════
create table public.campaign_creators (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

alter table public.campaign_creators enable row level security;

-- A signed-in user can see only their own row (so the app knows whether to show
-- the "create campaign" form). There is no insert, update or delete grant at
-- all: the allowlist changes only from outside the app.
create policy "a user can see whether they are an allowed creator"
  on public.campaign_creators for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.campaign_creators from anon, authenticated;
grant select on table public.campaign_creators to authenticated;

create function public.is_campaign_creator() returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.campaign_creators c where c.user_id = auth.uid());
$$;

revoke execute on function public.is_campaign_creator() from public, anon;
grant execute on function public.is_campaign_creator() to authenticated;

drop policy "a signed-in user can create a campaign they DM" on public.campaigns;

create policy "only an allowed creator can create a campaign they DM"
  on public.campaigns for insert
  to authenticated
  with check (dm_id = auth.uid() and public.is_campaign_creator());

-- ════════════════════════════════════════════════════════════════════
-- 2. Invites: hashed, expiring, limited, revocable
-- ════════════════════════════════════════════════════════════════════
create table public.campaign_invites (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  code_hash   text not null unique,   -- SHA-256 of the code; the code itself is never stored
  label       text check (label is null or char_length(label) <= 60),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uses    int not null check (max_uses between 1 and 50),
  use_count   int not null default 0 check (use_count >= 0),
  revoked_at  timestamptz,
  check (use_count <= max_uses)
);

create index campaign_invites_campaign_idx on public.campaign_invites (campaign_id);

alter table public.campaign_invites enable row level security;

create policy "the DM can read their campaign's invites"
  on public.campaign_invites for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

-- Column-level grant: the DM sees the invite's metadata but never code_hash or
-- created_by. All writes go through the SECURITY DEFINER functions below.
revoke all on table public.campaign_invites from anon, authenticated;
grant select (id, campaign_id, label, created_at, expires_at, max_uses, use_count, revoked_at)
  on public.campaign_invites to authenticated;

-- 30 hex characters = 120 random bits, taken from gen_random_uuid() (backed by
-- the server's CSPRNG) with the fixed version and variant nibbles left out.
-- Only create_invite() calls it; clients have no EXECUTE.
create or replace function public.generate_invite_code() returns text
language sql
volatile
as $$
  select upper(substr(s, 1, 12) || substr(s, 14, 3) || substr(s, 18))
  from (select replace(gen_random_uuid()::text, '-', '') as s) x;
$$;

revoke execute on function public.generate_invite_code() from public, anon, authenticated;

-- The DM creates an invite and receives the plaintext code exactly once.
create function public.create_invite(
  p_campaign_id uuid,
  p_label       text default null,
  p_max_uses    int  default 1,
  p_ttl_hours   int  default 168
)
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id   uuid;
  v_exp  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if not public.is_dm_of_campaign(p_campaign_id) then
    raise exception 'only the DM of this campaign can create invites';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 50 then
    raise exception 'an invite must allow between 1 and 50 uses';
  end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 720 then
    raise exception 'an invite must last between 1 hour and 30 days';
  end if;

  v_code := public.generate_invite_code();
  v_exp  := now() + make_interval(hours => p_ttl_hours);

  insert into public.campaign_invites (campaign_id, code_hash, label, created_by, expires_at, max_uses)
  values (
    p_campaign_id,
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    nullif(btrim(p_label), ''),
    auth.uid(),
    v_exp,
    p_max_uses)
  returning id into v_id;

  return query select v_id, v_code, v_exp;
end;
$$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  update public.campaign_invites i
     set revoked_at = now()
   where i.id = p_invite_id
     and i.revoked_at is null
     and public.is_dm_of_campaign(i.campaign_id);
  if not found then
    raise exception 'invite not found, already revoked, or not yours';
  end if;
end;
$$;

-- join_campaign() now checks an invite instead of a permanent campaign code.
-- Every failure says the same thing, so a wrong, expired, used-up or revoked
-- code cannot be told apart. Someone who is already a member gets the campaign
-- back even if the invite has since been used up, so re-opening a link is
-- harmless. `for update` serialises concurrent joins so an invite can never be
-- used more than max_uses times.
create or replace function public.join_campaign(p_invite_code text)
returns table (campaign_id uuid, campaign_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv   public.campaign_invites%rowtype;
  v_added int;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join a campaign';
  end if;

  select i.* into v_inv
  from public.campaign_invites i
  where i.code_hash = encode(sha256(convert_to(upper(btrim(p_invite_code)), 'UTF8')), 'hex')
  for update;

  if not found then
    raise exception 'invalid invite code';
  end if;

  if public.is_dm_of_campaign(v_inv.campaign_id) then
    raise exception 'you run this campaign';
  end if;

  if not exists (
    select 1 from public.campaign_players cp
    where cp.campaign_id = v_inv.campaign_id and cp.player_id = auth.uid()
  ) then
    if v_inv.revoked_at is not null or v_inv.expires_at <= now() or v_inv.use_count >= v_inv.max_uses then
      raise exception 'invalid invite code';
    end if;

    -- Named constraint, not a column list: OUT parameters shadow column names.
    insert into public.campaign_players (campaign_id, player_id)
    values (v_inv.campaign_id, auth.uid())
    on conflict on constraint campaign_players_pkey do nothing;
    get diagnostics v_added = row_count;

    if v_added = 1 then
      update public.campaign_invites i set use_count = i.use_count + 1 where i.id = v_inv.id;
    end if;
  end if;

  return query
    select c.id, c.name from public.campaigns c where c.id = v_inv.campaign_id;
end;
$$;

revoke execute on function
  public.create_invite(uuid, text, int, int),
  public.revoke_invite(uuid)
  from public, anon;
grant execute on function
  public.create_invite(uuid, text, int, int),
  public.revoke_invite(uuid)
  to authenticated;

-- The plaintext, permanent, player-readable code is gone. (No data is lost: the
-- live project held no campaigns when this was written.)
alter table public.campaigns drop column invite_code;

-- ════════════════════════════════════════════════════════════════════
-- 3. Profiles: yourself, and people you share a campaign with
-- ════════════════════════════════════════════════════════════════════
-- A person "is in" a campaign as its DM or as a player. Two people share a
-- campaign when they are both in one.
create function public.shares_campaign_with(p_user uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from (select cp.campaign_id as cid, cp.player_id as person from public.campaign_players cp
          union all
          select c.id, c.dm_id from public.campaigns c) me
    join (select cp.campaign_id as cid, cp.player_id as person from public.campaign_players cp
          union all
          select c.id, c.dm_id from public.campaigns c) them on them.cid = me.cid
    where me.person = auth.uid() and them.person = p_user
  );
$$;

revoke execute on function public.shares_campaign_with(uuid) from public, anon;
grant execute on function public.shares_campaign_with(uuid) to authenticated;

drop policy "profiles are readable by any signed-in user" on public.profiles;

create policy "a user can read their own profile and those of people in their campaigns"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.shares_campaign_with(id));
