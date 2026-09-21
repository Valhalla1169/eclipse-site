-- Eclipse — managing invites and members (docs/adr/0012).
--
--   * campaign_players remembers which invite a player joined with (invite_id), so the
--     DM's roster can say "joined with the invite for Sam".
--   * preview_invite() lets someone see what an invite is for (the campaign and its DM)
--     before joining, without using the invite up. join_campaign() still does the joining.
--   * replace_invite() ends an active invite and makes a new one like it, in one step,
--     for a link that was lost.
--   * A campaign can have 50 active invites and 500 in all.

-- ════════════════════════════════════════════════════════════════════
-- 1. Which invite a player joined with
-- ════════════════════════════════════════════════════════════════════
-- Only join_campaign() writes it (players have no write grant on campaign_players).
-- Members from before this migration have none.
alter table public.campaign_players
  add column invite_id uuid references public.campaign_invites (id) on delete set null;

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
    insert into public.campaign_players (campaign_id, player_id, invite_id)
    values (v_inv.campaign_id, auth.uid(), v_inv.id)
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

-- ════════════════════════════════════════════════════════════════════
-- 2. Look before joining
-- ════════════════════════════════════════════════════════════════════
-- The same checks and the same single error as join_campaign(), but it changes nothing.
-- It shows the campaign's name and the DM's name to whoever holds a valid code, who is
-- about to be told them anyway. A member gets an answer even if the invite is used up.
create function public.preview_invite(p_invite_code text)
returns table (campaign_id uuid, campaign_name text, dm_name text, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.campaign_invites%rowtype;
  v_member boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select i.* into v_inv
  from public.campaign_invites i
  where i.code_hash = encode(sha256(convert_to(upper(btrim(p_invite_code)), 'UTF8')), 'hex');

  if not found then
    raise exception 'invalid invite code';
  end if;

  if public.is_dm_of_campaign(v_inv.campaign_id) then
    raise exception 'you run this campaign';
  end if;

  v_member := exists (
    select 1 from public.campaign_players cp
    where cp.campaign_id = v_inv.campaign_id and cp.player_id = auth.uid());

  if not v_member and (v_inv.revoked_at is not null or v_inv.expires_at <= now() or v_inv.use_count >= v_inv.max_uses) then
    raise exception 'invalid invite code';
  end if;

  return query
    select c.id, c.name, coalesce(p.display_name, 'the DM'), v_member
    from public.campaigns c
    left join public.profiles p on p.id = c.dm_id
    where c.id = v_inv.campaign_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Limits, and replacing a lost link
-- ════════════════════════════════════════════════════════════════════
-- 50 active invites and 500 in all, per campaign. The lock makes two requests at once
-- count one after the other.
create function public.assert_invite_room(p_campaign_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
  v_all    int;
begin
  perform pg_advisory_xact_lock(hashtextextended('invites:' || p_campaign_id::text, 0));
  select count(*) filter (where i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses), count(*)
    into v_active, v_all
  from public.campaign_invites i
  where i.campaign_id = p_campaign_id;
  if v_active >= 50 then
    raise exception 'this campaign already has 50 active invites. Revoke one first';
  end if;
  if v_all >= 500 then
    raise exception 'this campaign has made 500 invites, the most it can keep';
  end if;
end;
$$;

revoke execute on function public.assert_invite_room(uuid) from public, anon, authenticated;

-- Same as 0005, with the limits.
create or replace function public.create_invite(
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
  perform public.assert_invite_room(p_campaign_id);

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

-- Ends an active invite and makes a new one with the same label, the uses it has left,
-- and the same lifetime. The new code is returned once, like any new invite.
create function public.replace_invite(p_invite_id uuid)
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   public.campaign_invites%rowtype;
  v_code  text;
  v_id    uuid;
  v_exp   timestamptz;
  v_hours int;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select i.* into v_old
  from public.campaign_invites i
  where i.id = p_invite_id and public.is_dm_of_campaign(i.campaign_id)
  for update;

  if not found or v_old.revoked_at is not null or v_old.expires_at <= now() or v_old.use_count >= v_old.max_uses then
    raise exception 'that invite is not active, or is not yours';
  end if;

  update public.campaign_invites i set revoked_at = now() where i.id = v_old.id;
  perform public.assert_invite_room(v_old.campaign_id);

  v_hours := least(720, greatest(1, ceil(extract(epoch from (v_old.expires_at - v_old.created_at)) / 3600)::int));
  v_code  := public.generate_invite_code();
  v_exp   := now() + make_interval(hours => v_hours);

  insert into public.campaign_invites (campaign_id, code_hash, label, created_by, expires_at, max_uses)
  values (
    v_old.campaign_id,
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    v_old.label,
    auth.uid(),
    v_exp,
    greatest(1, v_old.max_uses - v_old.use_count))
  returning id into v_id;

  return query select v_id, v_code, v_exp;
end;
$$;

revoke execute on function
  public.preview_invite(text),
  public.replace_invite(uuid)
  from public, anon;
grant execute on function
  public.preview_invite(text),
  public.replace_invite(uuid)
  to authenticated;
