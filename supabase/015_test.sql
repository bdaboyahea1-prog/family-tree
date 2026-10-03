-- =====================================================================
-- Self-test for 015: the default look of a tree and a member's own look
-- Run in the SQL Editor AFTER 015_looks.sql. It creates fake data, tries it, then ROLLS
-- EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated;
grant usage on sequence public.t_results_n_seq to authenticated;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end || p_name) $$;

create function public.try_sql(p_sql text) returns text
language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'rows=' || n;
exception when others then
  return 'error: ' || sqlerrm;
end $$;

create function public.expect(p_name text, p_sql text, p_expected text) returns void
language plpgsql as $$
declare got text := public.try_sql(p_sql);
begin
  if (p_expected = 'error' and got like 'error%') or got = p_expected then
    insert into public.t_results (line) values ('PASS  ' || p_name);
  else
    insert into public.t_results (line) values ('FAIL  ' || p_name || '   [wanted ' || p_expected || ', got ' || got || ']');
  end if;
end $$;

create function public.u(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

create function public.as_user(p_id uuid, p_email text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text) to authenticated;

-- ---------- fake data ----------
-- users: 101 admin, 102 plain member, 103 another member, 105 stranger
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'), (public.u(105), 'e1@t.test');
insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer');

set local role authenticated;

-- =====================================================================
-- The default look of the tree: the admin writes it, every member reads it
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin writes the default look of the tree',
  $q$update public.trees set default_look = '{"cardStyle":"portrait","design":"classic","showFemales":true}' where id = public.u(900)$q$, 'rows=1');
do $$
begin
  perform public.tlog('it is stored as written', (select default_look ->> 'cardStyle' = 'portrait' and (default_look -> 'showFemales')::boolean from public.trees where id = public.u(900)));
end $$;
select public.expect('...and replaced by a new one', $q$update public.trees set default_look = '{"cardStyle":"pill"}' where id = public.u(900)$q$, 'rows=1');
select public.expect('a look that is not an object is refused', $q$update public.trees set default_look = '[1,2]' where id = public.u(900)$q$, 'error');
select public.expect('a look that is a plain text is refused', $q$update public.trees set default_look = '"pill"' where id = public.u(900)$q$, 'error');
select public.expect('a look that is too big is refused', format($q$update public.trees set default_look = %L where id = public.u(900)$q$, json_build_object('x', repeat('y', 2500))::text), 'error');
select public.expect('clearing the default (back to the factory look) is allowed', $q$update public.trees set default_look = null where id = public.u(900)$q$, 'rows=1');
select public.expect('...and writing it again', $q$update public.trees set default_look = '{"cardStyle":"soft"}' where id = public.u(900)$q$, 'rows=1');

select public.as_user(public.u(102), 'b1@t.test');
do $$
begin
  perform public.tlog('a member reads the default look', (select default_look ->> 'cardStyle' from public.trees where id = public.u(900)) = 'soft');
end $$;
select public.expect('a member cannot change it (nothing changes)', $q$update public.trees set default_look = '{"cardStyle":"dark"}' where id = public.u(900)$q$, 'rows=0');

select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot change it (nothing changes)', $q$update public.trees set default_look = '{"cardStyle":"dark"}' where id = public.u(900)$q$, 'rows=0');
select public.expect('...and cannot read it', $q$select default_look from public.trees$q$, 'rows=0');

-- =====================================================================
-- One's own look: only the owner writes it
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a member writes their own look', $q$update public.profiles set look = '{"cardStyle":"leaf","curves":false}' where id = public.u(102)$q$, 'rows=1');
do $$
begin
  perform public.tlog('...and reads it back', (select look ->> 'cardStyle' from public.profiles where id = public.u(102)) = 'leaf');
end $$;
select public.expect('a look that is not an object is refused', $q$update public.profiles set look = '[]' where id = public.u(102)$q$, 'error');
select public.expect('a look that is too big is refused', format($q$update public.profiles set look = %L where id = public.u(102)$q$, json_build_object('x', repeat('y', 2500))::text), 'error');
select public.expect('a member cannot write the look of another member (nothing changes)', $q$update public.profiles set look = '{"cardStyle":"dark"}' where id = public.u(103)$q$, 'rows=0');
select public.expect('...not even the admin''s', $q$update public.profiles set look = '{"cardStyle":"dark"}' where id = public.u(101)$q$, 'rows=0');
select public.expect('clearing one''s own look (back to the default) is allowed', $q$update public.profiles set look = null where id = public.u(102)$q$, 'rows=1');

select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot write the look of a member (nothing changes)', $q$update public.profiles set look = '{"cardStyle":"dark"}' where id = public.u(102)$q$, 'rows=0');

reset role;
do $$
begin
  perform public.tlog('after all the refused writes the default is still the one the admin wrote', (select default_look ->> 'cardStyle' from public.trees where id = public.u(900)) = 'soft');
  perform public.tlog('...and nobody''s own look was changed by someone else', (select count(*) from public.profiles where look is not null and id <> public.u(102)) = 0);
end $$;

do $$
declare
  r text := coalesce((select string_agg(line, E'\n' order by n) from public.t_results), '(no results)');
  fails int := (select count(*) from public.t_results where line like 'FAIL%');
  passes int := (select count(*) from public.t_results where line like 'PASS%');
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
