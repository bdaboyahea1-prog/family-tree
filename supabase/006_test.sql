-- =====================================================================
-- Self-test for 006: provinces + structured birthplace
-- Run in the SQL Editor AFTER the migrations. It creates fake data, tries the undo and the
-- photo rules, then ROLLS EVERYTHING BACK (the red "error" at the end is the report and is
-- expected). Every line should start with PASS. Lines starting with INFO are diagnostics.
-- =====================================================================

begin;

-- results live in a table (rolled back with everything), not in a session variable
create table public.t_results (n serial primary key, line text not null);
-- "automatic RLS" is on in this project, so every new table starts locked: open this scratch table
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated;
grant usage on sequence public.t_results_n_seq to authenticated;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when p_ok then 'PASS  ' else 'FAIL  ' end || p_name) $$;

create function public.info(p_text text) returns void
language sql as $$ insert into public.t_results (line) values ('INFO  ' || p_text) $$;

-- runs a statement as the current role; returns 'rows=N' or 'error: <message>'
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

-- runs p_sql and logs PASS/FAIL against the expectation ('rows=N' or 'error'); a FAIL shows what happened
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

-- The whole script is ONE transaction, so every logged change would share one txid.
-- In real use each web request is its own transaction. seal_tx() gives what was logged so far
-- its own group number, which is how the test pretends each step was a separate request.
create function public.seal_tx(n bigint) returns void
language sql security definer set search_path = public as
$$ update public.change_log set txid = n where txid = txid_current() $$;

-- state snapshot for diagnostics
create function public.snap(p_label text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.t_results (line) values ('INFO  ' || p_label || ': persons=' || (select count(*) from public.persons)
    || ' grants=' || (select count(*) from public.branch_grants)
    || ' marriages=' || (select count(*) from public.marriages)
    || ' S=' || (select count(*) from public.persons where id = public.u(2))
    || ' X=' || (select count(*) from public.persons where id = public.u(3))
    || ' Y=' || (select count(*) from public.persons where id = public.u(4)));
end $$;

grant execute on function public.tlog(text, boolean), public.info(text), public.try_sql(text),
  public.expect(text, text, text), public.u(int), public.as_user(uuid, text), public.seal_tx(bigint),
  public.snap(text) to authenticated;

-- ---------- fake data ----------
-- users: 101 admin, 102 branch reader (edit on S), 103 plain reader
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test');
insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer');
-- G(1) -> S(2) -> X(3)
insert into public.persons (id, tree_id, first_name, gender, father_id) values
  (public.u(1), public.u(900), 'G', 'male', null),
  (public.u(2), public.u(900), 'S', 'male', public.u(1)),
  (public.u(3), public.u(900), 'X', 'male', public.u(2));
insert into public.branch_grants (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
values (public.u(900), public.u(102), public.u(2), true, true, false, false, public.u(101));
select public.seal_tx(0);

set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');

-- all six place columns can be written
select public.expect('admin writes birth + residence (country, province, city)',
  $q$update public.persons set
       birth_country = 'SY', birth_province = 'ريف دمشق', birth_city = 'دوما', birth_place = 'مستشفى الشفاء',
       residence_country = 'DE', residence_province = 'برلين', residence_city = 'برلين'
     where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(1);
do $$
declare r record;
begin
  select * into r from public.persons where id = public.u(3);
  perform public.tlog('the values are stored as typed',
    r.birth_country = 'SY' and r.birth_province = 'ريف دمشق' and r.birth_city = 'دوما'
    and r.residence_country = 'DE' and r.residence_province = 'برلين' and r.birth_place = 'مستشفى الشفاء');
end $$;

-- constraints
select public.expect('birth country must be an ISO code (a name is refused)',
  $q$update public.persons set birth_country = 'Syria' where id = public.u(3)$q$, 'error');
select public.expect('birth country must be upper case',
  $q$update public.persons set birth_country = 'sy' where id = public.u(3)$q$, 'error');
select public.expect('residence country must be an ISO code',
  $q$update public.persons set residence_country = 'Germany' where id = public.u(3)$q$, 'error');
select public.expect('a province longer than 100 characters is refused',
  format($q$update public.persons set birth_province = %L where id = public.u(3)$q$, repeat('p', 101)), 'error');
select public.expect('a city longer than 100 characters is refused',
  format($q$update public.persons set residence_city = %L where id = public.u(3)$q$, repeat('c', 101)), 'error');
select public.expect('clearing a place (NULL) is allowed',
  $q$update public.persons set birth_province = null where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(2);

-- undo restores every place column
do $$
declare v_log bigint; r record;
begin
  select id into v_log from public.change_log where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(3) and txid = 2;
  perform public.revert_change(public.u(900), v_log);
  select * into r from public.persons where id = public.u(3);
  perform public.tlog('undo brings back the province that was cleared', r.birth_province = 'ريف دمشق');
  select id into v_log from public.change_log where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(3) and txid = 1;
  perform public.revert_change(public.u(900), v_log);
  select * into r from public.persons where id = public.u(3);
  perform public.tlog('undo of the big write clears all six place columns',
    r.birth_country is null and r.birth_province is null and r.birth_city is null
    and r.residence_country is null and r.residence_province is null and r.residence_city is null and r.birth_place is null);
end $$;
select public.seal_tx(3);

-- permissions follow the normal card rules
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('branch reader (edit) writes places below the head',
  $q$update public.persons set residence_country = 'SA', residence_province = 'منطقة الرياض', residence_city = 'الرياض' where id = public.u(3)$q$, 'rows=1');
select public.expect('...but not on the head card',
  $q$update public.persons set residence_country = 'SA' where id = public.u(2)$q$, 'rows=0');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot write places',
  $q$update public.persons set residence_country = 'SA' where id = public.u(3)$q$, 'rows=0');

reset role;
do $$
declare
  r text := coalesce((select string_agg(line, E'\n' order by n) from public.t_results), '(no results)');
  fails int := (select count(*) from public.t_results where line like 'FAIL%');
  passes int := (select count(*) from public.t_results where line like 'PASS%');
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
