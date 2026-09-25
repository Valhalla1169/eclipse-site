-- Shared assertion helpers for the self-asserting suites. Not a suite itself:
-- each suite opens a transaction, then runs `\ir helpers.sql`, so everything here
-- (the schema `t` and its functions) is rolled back with the suite's own data.
--
--   t.act_as(uuid)                       become that signed-in user (role authenticated)
--   t.act_as_superuser()                 back to the project owner
--   t.expect_denied(sql, msg)            must fail: RLS/privilege (42501), CHECK (23514) or RAISE (P0001)
--   t.expect_denied_with(sql, text, msg) ...and the error message must contain `text`
--   t.expect_affects(sql, n, msg)        must succeed and touch exactly n rows
--   t.expect_count(query, n, msg)        the query must return exactly n rows
create schema t;
grant usage on schema t to anon, authenticated, supabase_auth_admin;

create function t.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $$;

create function t.act_as_superuser() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  reset role;
end $$;

create function t.expect_denied(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege or check_violation or raise_exception then
    raise notice 'ok   %', p_msg;
    return;
  end;
  raise exception 'ASSERTION FAILED (expected denial, but it succeeded): %', p_msg;
end $$;

create function t.expect_denied_with(p_sql text, p_text text, p_msg text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if position(p_text in v_msg) = 0 then
      raise exception 'ASSERTION FAILED (denied, but with "%" instead of "%"): %', v_msg, p_text, p_msg;
    end if;
    raise notice 'ok   %', p_msg;
    return;
  end;
  raise exception 'ASSERTION FAILED (expected denial, but it succeeded): %', p_msg;
end $$;

create function t.expect_affects(p_sql text, p_rows int, p_msg text) returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> p_rows then
    raise exception 'ASSERTION FAILED (% affected %, expected %): %', p_sql, n, p_rows, p_msg;
  end if;
  raise notice 'ok   %', p_msg;
end $$;

create function t.expect_count(p_query text, p_rows int, p_msg text) returns void language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || p_query || ') q' into n;
  if n <> p_rows then
    raise exception 'ASSERTION FAILED (got % rows, expected %): %', n, p_rows, p_msg;
  end if;
  raise notice 'ok   %', p_msg;
end $$;
