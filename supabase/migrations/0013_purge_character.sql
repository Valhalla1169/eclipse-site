-- Eclipse — a player can delete their own archived character forever (docs/adr/0018).
--
--   * purge_character(id): only the character's owner, only while it is archived
--     (deleted_at is not null), removes the characters row, every character_history
--     copy of it, and every departed_sheets copy a Keeper kept. One transaction.
--   * Every refusal gives the same message, so it never tells a caller whether
--     someone else's character exists.
--   * character_purges logs who, when, and the character's id. No name, no data.
--     No client role can read it, like site_admins: only list_purges() (a site
--     admin only) reads it.

-- ════════════════════════════════════════════════════════════════════
-- 1. The log
-- ════════════════════════════════════════════════════════════════════
create table public.character_purges (
  id           bigint generated always as identity primary key,
  character_id uuid not null,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  purged_at    timestamptz not null default now()
);

alter table public.character_purges enable row level security;
-- No policy at all, like site_admins: RLS refuses every row even if a grant is
-- added by mistake.
revoke all on table public.character_purges from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. purge_character: gone for good
-- ════════════════════════════════════════════════════════════════════
-- Refuses unless the caller is signed in, owns the character, and it is archived,
-- and (defensively) unless it is still active in a campaign. One message for
-- every refusal: it must not say whether someone else's character exists.
create function public.purge_character(p_character_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_char public.characters;
begin
  if auth.uid() is null then
    raise exception 'that character cannot be purged';
  end if;

  -- The same lock characters_enforce_limits takes, so this cannot race
  -- undelete_character or a new character for the same person.
  perform pg_advisory_xact_lock(hashtextextended('characters:' || auth.uid()::text, 0));

  select * into v_char from public.characters
   where id = p_character_id and owner_id = auth.uid()
   for update;

  if not found
     or v_char.deleted_at is null
     or exists (select 1 from public.campaign_characters where character_id = p_character_id)
  then
    raise exception 'that character cannot be purged';
  end if;

  delete from public.departed_sheets where character_id = p_character_id;
  delete from public.characters where id = p_character_id;   -- snapshots a 'delete' copy first (0004)
  delete from public.character_history where character_id = p_character_id;

  insert into public.character_purges (character_id, owner_id) values (p_character_id, auth.uid());
end;
$$;

-- The log, for a site admin only (like list_accounts). Newest first.
create function public.list_purges()
returns table (purged_at timestamptz, character_id uuid, owner_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'only a site admin can list the purges';
  end if;
  return query
    select p.purged_at, p.character_id, coalesce(pr.display_name, '(no account)')
    from public.character_purges p
    left join public.profiles pr on pr.id = p.owner_id
    order by p.purged_at desc, p.id desc;
end;
$$;

revoke execute on function public.purge_character(uuid), public.list_purges() from public, anon;
grant execute on function public.purge_character(uuid), public.list_purges() to authenticated;
