-- Eclipse — every new account gets its profile automatically (docs/adr/0007).
--
-- The sign-up form sends the display name as user metadata. A trigger on auth.users
-- turns it into the profiles row, so there is no "choose a display name" step and no
-- account without a profile.
--
-- A failure here must never stop someone creating an account, so the trigger only
-- warns. The app creates a missing profile itself (own row, allowed by policy).

-- One rule for what a display name is, shared by the trigger and the backfill below:
-- collapse spaces, at most 40 characters (the profiles constraint), else the email's
-- local part, else "Player".
create function public.derive_display_name(p_meta jsonb, p_email text) returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_meta ->> 'display_name', '')), '\s+', ' ', 'g'), 40), ''),
    nullif(left(pg_catalog.btrim(pg_catalog.split_part(coalesce(p_email, ''), '@', 1)), 40), ''),
    'Player');
$$;

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.derive_display_name(new.raw_user_meta_data, new.email));
  return new;
exception when others then
  raise warning 'handle_new_user: could not create a profile for %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke execute on function public.derive_display_name(jsonb, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts made before this trigger (the app used to ask for a name).
insert into public.profiles (id, display_name)
select u.id, public.derive_display_name(u.raw_user_meta_data, u.email)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
