-- Eclipse — only approved emails make accounts, site admins, five characters (docs/adr/0014).
--
--   * approved_emails: the emails a site admin approved. Supabase Auth calls
--     hook_require_approved_email() before it makes any account, and it refuses every
--     email with no approval, or with one older than 7 days. An approval is kept after
--     its account is made.
--   * An account counts only once its email is confirmed. Until then it may belong to
--     someone else who knew the approved email and signed up first.
--   * site_admins: who may approve emails. No client can write it; the owner manages it
--     with `npm run admins`. A site admin is not a Keeper: a Keeper runs a campaign.
--   * A person can have 5 characters that are not deleted, and 30 in all.
--
-- Every new table gets its GRANTs here, next to its policies (ADR 0003).

-- ════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════
create table public.site_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

-- Stored lower-cased. approved_by is null for an approval made with `npm run admins`.
-- Approving the email again sets both times back to their defaults.
create table public.approved_emails (
  email       text primary key check (
                email = lower(btrim(email))
                and char_length(email) <= 254
                and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);

alter table public.site_admins enable row level security;
alter table public.approved_emails enable row level security;

-- Supabase Auth runs the hook below as supabase_auth_admin, which reads two columns.
create policy "Supabase Auth reads the approved emails"
  on public.approved_emails for select
  to supabase_auth_admin
  using (true);

-- No client role reads or writes either table: only the functions below do. site_admins
-- has no policy at all, so RLS refuses every row even if a grant is added by mistake.
revoke all on table public.site_admins, public.approved_emails from anon, authenticated, supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select (email, expires_at) on table public.approved_emails to supabase_auth_admin;

-- ════════════════════════════════════════════════════════════════════
-- 2. The gate: Supabase Auth's "before user created" hook
-- ════════════════════════════════════════════════════════════════════
-- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
-- Auth calls it before it makes an account for a password sign-up or a magic link to a
-- new email. '{}' lets the account be made. An error object stops it, and Auth answers
-- the request with that status and message. It runs as supabase_auth_admin, not as definer.
create function public.hook_require_approved_email(event jsonb) returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.approved_emails a
      where a.email = lower(event -> 'user' ->> 'email') and a.expires_at > now())
      then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'this email is not approved to make an account'))
  end;
$$;

revoke execute on function public.hook_require_approved_email(jsonb) from public, anon, authenticated;
grant execute on function public.hook_require_approved_email(jsonb) to supabase_auth_admin;

-- ════════════════════════════════════════════════════════════════════
-- 3. Site admins
-- ════════════════════════════════════════════════════════════════════
-- The app asks this to show the Admin link. The functions below ask it before they act.
create function public.is_site_admin() returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.site_admins a where a.user_id = auth.uid());
$$;

-- Only a confirmed account counts: an unconfirmed one may not belong to the person
-- who was approved, so their approval stays waiting and can be revoked.
create function public.email_has_account(p_email text) returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from auth.users u where lower(u.email) = p_email and u.email_confirmed_at is not null);
$$;

-- Approves an email for 7 days, or renews its approval. An email that already has an
-- account needs none, and has_account says so. At most 20 approvals that have not
-- expired can wait for an account. The lock makes two requests at once count one after
-- the other.
create function public.approve_email(p_email text)
returns table (email text, has_account boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(btrim(p_email));
  v_waiting int;
begin
  if not public.is_site_admin() then
    raise exception 'only a site admin can approve an email';
  end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'that is not an email address';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('approved_emails', 0));
  if public.email_has_account(v_email) then
    return query select v_email, true, null::timestamptz;
    return;
  end if;
  if not exists (select 1 from public.approved_emails a where a.email = v_email and a.expires_at > now()) then
    select count(*) into v_waiting
    from public.approved_emails a
    where a.expires_at > now() and not public.email_has_account(a.email);
    if v_waiting >= 20 then
      raise exception 'there are already 20 approved emails with no account. Revoke one first';
    end if;
  end if;
  -- Named constraint, not a column list: OUT parameters shadow column names.
  insert into public.approved_emails as a (email, approved_by) values (v_email, auth.uid())
  on conflict on constraint approved_emails_pkey
  do update set approved_by = excluded.approved_by, approved_at = default, expires_at = default;
  return query select a.email, false, a.expires_at from public.approved_emails a where a.email = v_email;
end;
$$;

-- Only an approval that no confirmed account uses can be revoked.
create function public.revoke_approval(p_email text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not public.is_site_admin() then
    raise exception 'only a site admin can revoke an approval';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('approved_emails', 0));
  if public.email_has_account(v_email) then
    raise exception 'that email already has an account, so its approval cannot be revoked';
  end if;
  delete from public.approved_emails a where a.email = v_email;
  if not found then
    raise exception 'that email is not approved';
  end if;
end;
$$;

-- Every account, oldest first. email_confirmed_at is null for an account whose email is
-- not confirmed yet.
create function public.list_accounts()
returns table (user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz, is_admin boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'only a site admin can list the accounts';
  end if;
  return query
    select u.id, u.email::text, p.display_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           exists (select 1 from public.site_admins a where a.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at, u.id;
end;
$$;

-- The approvals that no confirmed account uses, expired ones too, oldest first.
create function public.list_pending_approvals()
returns table (email text, approved_at timestamptz, expires_at timestamptz, approved_by_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'only a site admin can list the approvals';
  end if;
  return query
    select a.email, a.approved_at, a.expires_at, p.display_name
    from public.approved_emails a
    left join public.profiles p on p.id = a.approved_by
    where not public.email_has_account(a.email)
    order by a.approved_at, a.email;
end;
$$;

revoke execute on function public.email_has_account(text) from public, anon, authenticated;
revoke execute on function
  public.is_site_admin(),
  public.approve_email(text),
  public.revoke_approval(text),
  public.list_accounts(),
  public.list_pending_approvals()
  from public, anon;
grant execute on function
  public.is_site_admin(),
  public.approve_email(text),
  public.revoke_approval(text),
  public.list_accounts(),
  public.list_pending_approvals()
  to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Five characters that are not deleted, and 30 in all, per person
-- ════════════════════════════════════════════════════════════════════
-- Bringing a deleted character back counts toward the 5.
create or replace function public.characters_enforce_limits() returns trigger
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
    if v_live >= 5 then
      raise exception 'you already have 5 characters, the most one person can have';
    end if;
    if tg_op = 'INSERT' and v_all >= 30 then
      raise exception 'you have made 30 characters, the most one person can keep, including deleted ones';
    end if;
  end if;
  return new;
end;
$$;
