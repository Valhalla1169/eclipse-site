-- Eclipse — least-privilege columns and bounded history (docs/adr/0006).
--
-- An audit, attacking the deployed schema as an ordinary player, found:
--   1. INSERT and UPDATE were granted on every column, so a client could rewrite
--      columns only the server should control: characters.id (breaking the link to
--      its history), created_at, and for a DM campaigns.id.
--   2. schema_version accepted any integer (-5, 2147483647).
--   3. Every schema_version change is snapshotted and 'schema_change' snapshots
--      were never pruned, so a member flipping the version in a loop could fill
--      the database with snapshots without limit.
-- Measured against V4's real state shape: a blank sheet is 1.5 KB and an absurdly
-- full one (50 items in every list, long text everywhere, 500 log lines) is 361 KiB,
-- so the 1 MiB cap on `data` was 3x looser than it needs to be.

-- ════════════════════════════════════════════════════════════════════
-- 1. Column-level INSERT/UPDATE: only what the app writes
-- ════════════════════════════════════════════════════════════════════
-- Table-level write grants come off; each writable column is granted by name. Any
-- column not listed (ids, timestamps, foreign keys the server sets) is read-only
-- to clients. SELECT is unchanged.
revoke insert, update on table public.profiles, public.campaigns, public.characters from authenticated;

grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name)     on public.profiles to authenticated;

-- dm_id cannot be changed after creation (a DM cannot hand a campaign away or
-- steal one), and id and created_at are server-controlled.
grant insert (dm_id, name) on public.campaigns to authenticated;
grant update (name)        on public.campaigns to authenticated;

-- owner_id and campaign_id are updatable ONLY so that an upsert (which lists every
-- payload column in its DO UPDATE SET) works; the characters_lock_identity trigger
-- (0002) still refuses any actual change to either. id and updated_at are not
-- writable at all.
grant insert (owner_id, campaign_id, character_name, data, schema_version) on public.characters to authenticated;
grant update (owner_id, campaign_id, character_name, data, schema_version) on public.characters to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. schema_version: a sane range that only ever goes up (for clients)
-- ════════════════════════════════════════════════════════════════════
alter table public.characters
  add constraint characters_schema_version_range check (schema_version between 1 and 1000);

-- A stale client (an old cached tab) must not be able to downgrade a sheet that a
-- newer client already migrated (ADR 0004). The project owner is exempt, so the
-- restore recipe in 0004 can still bring back an older snapshot.
create function public.characters_guard_schema_version() returns trigger
language plpgsql as $$
begin
  if new.schema_version < old.schema_version and current_user in ('anon', 'authenticated') then
    raise exception 'schema_version can only increase';
  end if;
  return new;
end;
$$;

create trigger characters_guard_schema_version
  before update on public.characters
  for each row execute function public.characters_guard_schema_version();

revoke execute on function public.characters_guard_schema_version() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. Bounded history and a tighter sheet-size cap
-- ════════════════════════════════════════════════════════════════════
-- Same as 0004 except 'schema_change' snapshots are now also pruned, to the newest
-- 10 per character (a legitimate migration happens a handful of times in a
-- campaign's life). 'delete' snapshots are still kept indefinitely: only an admin
-- can delete, and each is a recovery point.
create or replace function public.snapshot_character() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_last   timestamptz;
begin
  if tg_op = 'DELETE' then
    v_reason := 'delete';
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

  -- Retention: newest 30 'edit' and newest 10 'schema_change' per character.
  delete from public.character_history h
  where h.character_id = old.id
    and h.reason in ('edit', 'schema_change')
    and h.id not in (
      select k.id from (
        select r.id,
               row_number() over (partition by r.reason order by r.saved_at desc, r.id desc) as rn,
               r.reason
        from public.character_history r
        where r.character_id = old.id and r.reason in ('edit', 'schema_change')
      ) k
      where (k.reason = 'edit' and k.rn <= 30) or (k.reason = 'schema_change' and k.rn <= 10));

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter table public.characters drop constraint characters_data_size;
alter table public.characters add constraint characters_data_size check (pg_column_size(data) <= 524288);
