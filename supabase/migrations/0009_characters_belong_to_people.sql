-- Eclipse — a character belongs to a person, not to a campaign (docs/adr/0011).
--
--   * A person can make up to 10 characters (30 counting deleted ones), with no campaign.
--   * In each campaign a player has one ACTIVE character (campaign_characters). A
--     character is active in at most one campaign at a time.
--   * The DM can read a character only while it is active in one of their campaigns,
--     and its history only from the time it became active there.
--   * When a player leaves or is removed, the database keeps a copy of their active
--     sheet as it was then (departed_sheets). The DM reads that copy, never the live
--     sheet, because the player can keep editing a character after they leave.
--   * "Deleting" a character hides it (deleted_at). Nothing is removed (ADR 0004).
--
-- The rows that exist now are kept: each character becomes the active character of
-- its player in its campaign, or a departed sheet if the player is no longer a member.

-- ════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════
alter table public.characters add column deleted_at timestamptz;
alter table public.characters add constraint characters_id_owner_key unique (id, owner_id);
create index characters_owner_idx on public.characters (owner_id);

-- One row per player per campaign. The two foreign keys mean a row can only name a
-- character its player owns, and only while that player is a member.
create table public.campaign_characters (
  campaign_id  uuid not null,
  player_id    uuid not null,
  character_id uuid not null,
  assigned_at  timestamptz not null default now(),
  primary key (campaign_id, player_id),
  unique (character_id),
  foreign key (campaign_id, player_id) references public.campaign_players (campaign_id, player_id) on delete cascade,
  foreign key (character_id, player_id) references public.characters (id, owner_id) on delete cascade
);

-- The DM's copy of a sheet from the moment its player left. character_id has no
-- foreign key on purpose: the copy outlives the character, like character_history.
create table public.departed_sheets (
  id             bigint generated always as identity primary key,
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  player_id      uuid not null references auth.users (id) on delete cascade,
  character_id   uuid not null,
  character_name text not null,
  schema_version int  not null,
  data           jsonb not null,
  reason         text not null check (reason in ('left', 'removed')),
  kept_at        timestamptz not null default now()
);
create index departed_sheets_campaign_idx on public.departed_sheets (campaign_id, player_id, kept_at desc);

-- ════════════════════════════════════════════════════════════════════
-- 2. Keep the sheets that exist
-- ════════════════════════════════════════════════════════════════════
-- assigned_at is when the player joined, so a DM's history window starts there.
insert into public.campaign_characters (campaign_id, player_id, character_id, assigned_at)
select cp.campaign_id, cp.player_id, ch.id, cp.joined_at
from public.characters ch
join public.campaign_players cp on cp.campaign_id = ch.campaign_id and cp.player_id = ch.owner_id;

insert into public.departed_sheets (campaign_id, player_id, character_id, character_name, schema_version, data, reason, kept_at)
select ch.campaign_id, ch.owner_id, ch.id, ch.character_name, ch.schema_version, ch.data, 'removed', ch.updated_at
from public.characters ch
where not exists (
  select 1 from public.campaign_players cp
  where cp.campaign_id = ch.campaign_id and cp.player_id = ch.owner_id);

-- ════════════════════════════════════════════════════════════════════
-- 3. Who can see what
-- ════════════════════════════════════════════════════════════════════
create function public.dm_sees_character(p_character_id uuid, p_at timestamptz default null) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_characters cc
    where cc.character_id = p_character_id
      and public.is_dm_of_campaign(cc.campaign_id)
      and (p_at is null or cc.assigned_at <= p_at)
  );
$$;
revoke execute on function public.dm_sees_character(uuid, timestamptz) from public, anon;
grant execute on function public.dm_sees_character(uuid, timestamptz) to authenticated;

drop policy "the DM can read characters in their own campaign" on public.characters;
drop policy "a campaign member can insert their own character" on public.characters;
drop policy "a campaign member can update their own character" on public.characters;
drop policy "the DM can read the history of characters in their campaign" on public.character_history;

create policy "the DM can read the characters active in their campaigns"
  on public.characters for select
  to authenticated
  using (public.dm_sees_character(id));

-- Anyone signed in can make a character (the limit is a trigger below). A deleted
-- character is read only.
create policy "a person can insert their own character"
  on public.characters for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "a person can update their own character"
  on public.characters for update
  to authenticated
  using (owner_id = auth.uid() and deleted_at is null)
  with check (owner_id = auth.uid());

create policy "the DM can read the history of their active characters"
  on public.character_history for select
  to authenticated
  using (public.dm_sees_character(character_id, saved_at));

alter table public.campaign_characters enable row level security;
alter table public.departed_sheets enable row level security;

create policy "a player can read their own active characters"
  on public.campaign_characters for select
  to authenticated
  using (player_id = auth.uid());

create policy "the DM can read the active characters in their campaign"
  on public.campaign_characters for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

create policy "the DM can read the sheets kept from players who left"
  on public.departed_sheets for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

-- Clients only read these two tables. Every change goes through a function below.
revoke all on table public.campaign_characters, public.departed_sheets from anon, authenticated;
grant select on table public.campaign_characters, public.departed_sheets to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. characters no longer has a campaign
-- ════════════════════════════════════════════════════════════════════
alter table public.characters drop column campaign_id;
alter table public.character_history drop column campaign_id;

create or replace function public.characters_lock_identity() returns trigger
language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'a character''s owner_id cannot be changed';
  end if;
  return new;
end;
$$;

-- At most 10 characters that are not deleted, and 30 in all, per person. The lock
-- makes two requests at once count one after the other.
create function public.characters_enforce_limits() returns trigger
language plpgsql
as $$
declare
  v_live int;
  v_all  int;
begin
  perform pg_advisory_xact_lock(hashtextextended('characters:' || new.owner_id::text, 0));
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    select count(*) filter (where deleted_at is null), count(*) into v_live, v_all
    from public.characters where owner_id = new.owner_id;
    if v_live >= 10 then
      raise exception 'you already have 10 characters, the most one person can have';
    end if;
    if tg_op = 'INSERT' and v_all >= 30 then
      raise exception 'you have made 30 characters, the most one person can keep, including deleted ones';
    end if;
  end if;
  return new;
end;
$$;

create trigger characters_enforce_limits
  before insert or update of deleted_at on public.characters
  for each row execute function public.characters_enforce_limits();

revoke execute on function public.characters_enforce_limits() from public, anon, authenticated;

-- Same as 0008 without campaign_id.
create or replace function public.snapshot_character() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason    text;
  v_last      timestamptz;
  v_restoring boolean := coalesce(current_setting('eclipse.restoring', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    v_reason := 'delete';
  elsif v_restoring
        and (new.data is distinct from old.data
             or new.character_name is distinct from old.character_name
             or new.schema_version is distinct from old.schema_version) then
    v_reason := 'restore';
  elsif new.schema_version is distinct from old.schema_version then
    v_reason := 'schema_change';
  elsif new.data is distinct from old.data
        or new.character_name is distinct from old.character_name then
    select max(h.saved_at) into v_last
    from public.character_history h
    where h.character_id = old.id and h.reason = 'edit';
    if v_last is not null and v_last > now() - interval '10 minutes' then
      return new;
    end if;
    v_reason := 'edit';
  else
    return new;   -- nothing that matters changed
  end if;

  insert into public.character_history
    (character_id, owner_id, schema_version, character_name, data, reason)
  values
    (old.id, old.owner_id, old.schema_version, old.character_name, old.data, v_reason);

  -- Retention: newest 30 'edit', newest 10 each of 'schema_change' and 'restore'.
  delete from public.character_history h
  where h.character_id = old.id
    and h.reason in ('edit', 'schema_change', 'restore')
    and h.id not in (
      select k.id from (
        select r.id,
               row_number() over (partition by r.reason order by r.saved_at desc, r.id desc) as rn,
               r.reason
        from public.character_history r
        where r.character_id = old.id and r.reason in ('edit', 'schema_change', 'restore')
      ) k
      where (k.reason = 'edit' and k.rn <= 30) or (k.reason in ('schema_change', 'restore') and k.rn <= 10));

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 5. Functions a player calls
-- ════════════════════════════════════════════════════════════════════
-- Makes a character the player's active one in a campaign. It frees the one it
-- replaces. A character can be active in one campaign at a time.
create function public.choose_character(p_campaign_id uuid, p_character_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if not exists (select 1 from public.campaign_players where campaign_id = p_campaign_id and player_id = auth.uid()) then
    raise exception 'you are not a member of this campaign';
  end if;
  perform 1 from public.characters
   where id = p_character_id and owner_id = auth.uid() and deleted_at is null
   for share;
  if not found then
    raise exception 'that character was not found';
  end if;
  if exists (select 1 from public.campaign_characters
              where campaign_id = p_campaign_id and player_id = auth.uid() and character_id = p_character_id) then
    return;
  end if;
  begin
    insert into public.campaign_characters (campaign_id, player_id, character_id)
    values (p_campaign_id, auth.uid(), p_character_id)
    on conflict (campaign_id, player_id) do update set character_id = excluded.character_id, assigned_at = now();
  exception when unique_violation then
    raise exception 'that character is already active in another campaign. Choose a different character there first';
  end;
end;
$$;

-- "Deleting" hides a character: nothing is removed. A character that is active in a
-- campaign has to be replaced there first.
create function public.delete_character(p_character_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_char public.characters;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  select * into v_char from public.characters
   where id = p_character_id and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'that character was not found';
  end if;
  if v_char.deleted_at is not null then
    return;
  end if;
  if exists (select 1 from public.campaign_characters where character_id = p_character_id) then
    raise exception 'that character is active in a campaign. Choose a different character there first';
  end if;
  update public.characters set deleted_at = now() where id = p_character_id;
end;
$$;

-- The 10-character limit applies (characters_enforce_limits).
create function public.undelete_character(p_character_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  perform 1 from public.characters where id = p_character_id and owner_id = auth.uid() for update;
  if not found then
    raise exception 'that character was not found';
  end if;
  update public.characters set deleted_at = null where id = p_character_id and deleted_at is not null;
end;
$$;

revoke execute on function
  public.choose_character(uuid, uuid),
  public.delete_character(uuid),
  public.undelete_character(uuid)
  from public, anon;
grant execute on function
  public.choose_character(uuid, uuid),
  public.delete_character(uuid),
  public.undelete_character(uuid)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Leaving and removing keep the DM's copy
-- ════════════════════════════════════════════════════════════════════
-- Keeps the newest 3 copies per player per campaign.
create function public.freeze_sheet(p_campaign_id uuid, p_player_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.departed_sheets (campaign_id, player_id, character_id, character_name, schema_version, data, reason)
  select cc.campaign_id, cc.player_id, ch.id, ch.character_name, ch.schema_version, ch.data, p_reason
  from public.campaign_characters cc
  join public.characters ch on ch.id = cc.character_id
  where cc.campaign_id = p_campaign_id and cc.player_id = p_player_id;

  delete from public.departed_sheets d
  where d.campaign_id = p_campaign_id and d.player_id = p_player_id
    and d.id not in (
      select k.id from public.departed_sheets k
      where k.campaign_id = p_campaign_id and k.player_id = p_player_id
      order by k.kept_at desc, k.id desc
      limit 3);
end;
$$;
revoke execute on function public.freeze_sheet(uuid, uuid, text) from public, anon, authenticated;

-- Deleting the membership deletes the active-character row with it (foreign key).
create or replace function public.leave_campaign(p_campaign_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.freeze_sheet(p_campaign_id, auth.uid(), 'left');
  delete from public.campaign_players
  where campaign_id = p_campaign_id and player_id = auth.uid();
end;
$$;

create or replace function public.remove_player(p_campaign_id uuid, p_player_id uuid) returns void
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

  perform public.freeze_sheet(p_campaign_id, p_player_id, 'removed');
  delete from public.campaign_players
  where campaign_id = p_campaign_id and player_id = p_player_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 7. Restoring an earlier version (0008) no longer needs a campaign
-- ════════════════════════════════════════════════════════════════════
create or replace function public.restore_character_version(p_history_id bigint, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snap public.character_history;
  v_char public.characters;
  v_new  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select * into v_snap
  from public.character_history
  where id = p_history_id and owner_id = auth.uid();
  if not found then
    raise exception 'that version was not found';
  end if;

  select * into v_char
  from public.characters
  where id = v_snap.character_id and owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'that version cannot be restored because its character no longer exists';
  end if;
  if v_char.deleted_at is not null then
    raise exception 'that character is deleted. Bring it back first';
  end if;

  if p_expected is null or v_char.updated_at is distinct from p_expected then
    raise exception 'the sheet changed since you opened it';
  end if;

  perform set_config('eclipse.restoring', 'on', true);
  update public.characters
     set data = v_snap.data,
         schema_version = v_snap.schema_version,
         character_name = v_snap.character_name
   where id = v_char.id
  returning updated_at into v_new;
  perform set_config('eclipse.restoring', '', true);

  return v_new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 8. Realtime
-- ════════════════════════════════════════════════════════════════════
-- The roster hears when a player chooses a different character. Subscriptions
-- still obey the policies above.
alter publication supabase_realtime add table public.campaign_characters;
