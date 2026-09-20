-- Eclipse — let a player put back an earlier version of their own sheet (docs/adr/0010).
--
-- Until now a restore needed the project owner and SQL (see 0004). This adds
-- restore_character_version(), which a player calls from the version history page.
--
--   * Only the owner of the character can restore, and only while they are still a
--     member of its campaign (the same rule as writing the sheet, ADR 0002).
--   * It is conditional on the sheet not having changed since the page was opened
--     (p_expected is the updated_at the caller last saw), so a restore never
--     overwrites a save from another device.
--   * A restore is ALWAYS snapshotted, whatever the 10-minute limit on edit
--     snapshots says, under its own reason 'restore'. So a restore can always be
--     undone by restoring the snapshot it made.
--
-- The function is SECURITY DEFINER because character_history has no client write
-- access at all. The snapshot itself is still made by the snapshot_character()
-- trigger, told about the restore through a setting that lasts one transaction
-- and that a client cannot set (a client can only call functions, not run SQL).

-- ════════════════════════════════════════════════════════════════════
-- 1. A new reason, and its retention
-- ════════════════════════════════════════════════════════════════════
alter table public.character_history drop constraint character_history_reason_check;
alter table public.character_history
  add constraint character_history_reason_check check (reason in ('edit', 'schema_change', 'delete', 'restore'));

-- Same as 0006, plus 'restore' snapshots, kept newest 10 per character like
-- 'schema_change'. 'delete' snapshots are still kept indefinitely.
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
    (character_id, owner_id, campaign_id, schema_version, character_name, data, reason)
  values
    (old.id, old.owner_id, old.campaign_id, old.schema_version, old.character_name, old.data, v_reason);

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
-- 2. The restore function
-- ════════════════════════════════════════════════════════════════════
-- Returns the sheet's new updated_at, for the caller's next conditional save.
-- The same message for a snapshot that does not exist and one that belongs to
-- someone else, so a caller cannot probe other people's history ids.
create function public.restore_character_version(p_history_id bigint, p_expected timestamptz)
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

  if not public.is_player_of_campaign(v_char.campaign_id) then
    raise exception 'you are not a member of this campaign';
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

revoke execute on function public.restore_character_version(bigint, timestamptz) from public, anon;
grant execute on function public.restore_character_version(bigint, timestamptz) to authenticated;
