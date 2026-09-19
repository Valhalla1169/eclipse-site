-- Eclipse — make it very hard to lose a character (docs/adr/0004).
--
--   1. No client role can delete a campaign or a character. Both cascade
--      (a campaign takes every character in it with it), and nothing in the app
--      needs a delete. Deleting stays possible from the dashboard or the CLI.
--   2. Every meaningful change to a character is snapshotted, and so is any
--      delete, so a bad edit, a bad client deploy or a mistaken admin command
--      can be undone. The snapshot table has no foreign key on purpose: it must
--      outlive the row it describes.
--
-- Restoring (run as the project owner; RLS does not apply to that role):
--   update public.characters c
--      set data = h.data, schema_version = h.schema_version, character_name = h.character_name
--     from public.character_history h
--    where h.id = <history id> and c.id = h.character_id;
-- A restore is itself an update, so it is snapshotted too and can be undone.
-- To bring back a deleted character, insert it from its 'delete' snapshot.

-- ════════════════════════════════════════════════════════════════════
-- 1. No client-side deletes
-- ════════════════════════════════════════════════════════════════════
-- Remove the grant and the policy: a missing GRANT stops the attempt and a
-- missing policy means it would still fail if a grant were ever added by mistake.
revoke delete on table public.campaigns, public.characters from authenticated;
drop policy "only the DM can delete their campaign" on public.campaigns;
drop policy "only the owner can delete their character" on public.characters;

-- ════════════════════════════════════════════════════════════════════
-- 2. Snapshot history
-- ════════════════════════════════════════════════════════════════════
create table public.character_history (
  id             bigint generated always as identity primary key,
  character_id   uuid not null,   -- deliberately NOT a foreign key: history must outlive the row
  owner_id       uuid not null,
  campaign_id    uuid not null,
  schema_version int  not null,
  character_name text not null,
  data           jsonb not null,
  reason         text not null check (reason in ('edit', 'schema_change', 'delete')),
  saved_at       timestamptz not null default now()
);

create index character_history_character_idx
  on public.character_history (character_id, saved_at desc);

alter table public.character_history enable row level security;

-- Read-only from the client. Rows are written only by the trigger below.
create policy "an owner can read the history of their own characters"
  on public.character_history for select
  to authenticated
  using (owner_id = auth.uid());

create policy "the DM can read the history of characters in their campaign"
  on public.character_history for select
  to authenticated
  using (public.is_dm_of_campaign(campaign_id));

revoke all on table public.character_history from anon, authenticated;
grant select on table public.character_history to authenticated;

-- What gets snapshotted (the state BEFORE the change):
--   'delete'         every delete, including cascades from a campaign or account.
--   'schema_change'  every change of schema_version, always, so a rules or
--                    layout migration can always be rolled back.
--   'edit'           a change to data or the name, at most once per 10 minutes
--                    (autosave writes every few seconds; this keeps a restore
--                    point every ten minutes without storing every keystroke).
-- Retention: the newest 30 'edit' snapshots per character. 'schema_change' and
-- 'delete' snapshots are kept indefinitely.
create function public.snapshot_character() returns trigger
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

  delete from public.character_history h
  where h.character_id = old.id
    and h.reason = 'edit'
    and h.id not in (
      select k.id from public.character_history k
      where k.character_id = old.id and k.reason = 'edit'
      order by k.saved_at desc, k.id desc
      limit 30);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger characters_snapshot_update
  before update on public.characters
  for each row execute function public.snapshot_character();

create trigger characters_snapshot_delete
  before delete on public.characters
  for each row execute function public.snapshot_character();

-- A trigger function needs no EXECUTE for the role whose statement fired it.
revoke execute on function public.snapshot_character() from public, anon, authenticated;
