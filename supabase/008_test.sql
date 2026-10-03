-- =====================================================================
-- Self-test for 008: contact details on cards + the designer's note
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
-- users: 101 admin, 102 branch reader (edit on S), 103 plain reader, 105 stranger
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'), (public.u(105), 'e1@t.test');
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

-- =====================================================================
-- Optional contact details on a card
-- =====================================================================
select public.expect('admin writes a phone and an e-mail on a card',
  $q$update public.persons set phone = '+000 111 222 301', email = 'ali@example.com' where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(1);
do $$
declare r record;
begin
  select * into r from public.persons where id = public.u(3);
  perform public.tlog('they are stored as typed', r.phone = '+000 111 222 301' and r.email = 'ali@example.com');
end $$;

select public.expect('a local number without + is fine', $q$update public.persons set phone = '0111-222-301' where id = public.u(3)$q$, 'rows=1');
select public.expect('a number with brackets is fine', $q$update public.persons set phone = '(0944) 123456' where id = public.u(3)$q$, 'rows=1');
select public.expect('letters in a phone number are refused', $q$update public.persons set phone = '0111abc' where id = public.u(3)$q$, 'error');
select public.expect('a phone made only of brackets is refused', $q$update public.persons set phone = '((((((' where id = public.u(3)$q$, 'error');
select public.expect('a phone that is too short is refused', $q$update public.persons set phone = '12' where id = public.u(3)$q$, 'error');
select public.expect('a phone that is too long is refused', format($q$update public.persons set phone = %L where id = public.u(3)$q$, '+' || repeat('9', 40)), 'error');
select public.expect('an e-mail without a domain is refused', $q$update public.persons set email = 'ali@' where id = public.u(3)$q$, 'error');
select public.expect('an e-mail with spaces is refused', $q$update public.persons set email = 'a li@example.com' where id = public.u(3)$q$, 'error');
select public.expect('an e-mail longer than 254 characters is refused', format($q$update public.persons set email = %L where id = public.u(3)$q$, repeat('a', 250) || '@x.co'), 'error');
select public.expect('both are optional: clearing them is allowed', $q$update public.persons set phone = null, email = null where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(2);
select public.expect('a card can be created without any contact detail',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(10), public.u(900), 'NoContact', 'male', public.u(3))$q$, 'rows=1');
select public.expect('...or with both',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id, phone, email) values (public.u(11), public.u(900), 'WithContact', 'male', public.u(3), '+49 170 1234567', 'w@example.de')$q$, 'rows=1');

-- undo restores them: group 2 changed the phone twice and then cleared phone + e-mail;
-- undoing it must bring back exactly the state after group 1
do $$
declare v_log bigint; r record; n int;
begin
  select count(*), max(id) into n, v_log from public.change_log where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(3) and txid = 2;
  perform public.tlog('group 2 holds the three edits (' || n || ')', n = 3);
  perform public.revert_change(public.u(900), v_log);
  select * into r from public.persons where id = public.u(3);
  perform public.tlog('undo brings the phone and e-mail back', r.phone = '+000 111 222 301' and r.email = 'ali@example.com');
end $$;
select public.seal_tx(3);

-- permissions follow the normal card rules
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a branch reader (edit) writes contact details below his head', $q$update public.persons set phone = '+90 532 111 2233' where id = public.u(3)$q$, 'rows=1');
select public.expect('...but not on the head card', $q$update public.persons set phone = '+90 532 111 2233' where id = public.u(2)$q$, 'rows=0');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot write them', $q$update public.persons set phone = '+90 532 111 2233' where id = public.u(3)$q$, 'rows=0');
do $$
declare n int;
begin
  select count(*) into n from public.persons where phone is not null;
  perform public.tlog('...but members can read them (' || n || ' cards with a phone)', n >= 1);
end $$;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('a stranger sees no contact details', (select count(*) from public.persons where phone is not null or email is not null) = 0);
end $$;

-- =====================================================================
-- The designer's note (trees.about): members read, only the admin writes
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin writes the note',
  $q$update public.trees set about = '{"name":"عبد الله","phone":"+000111222301","text":"نبذة"}'::jsonb where id = public.u(900)$q$, 'rows=1');
select public.expect('...and cannot make it huge', format($q$update public.trees set about = jsonb_build_object('text', %L) where id = public.u(900)$q$, repeat('x', 5000)), 'error');
select public.as_user(public.u(103), 'c1@t.test');
do $$
declare a jsonb;
begin
  select about into a from public.trees where id = public.u(900);
  perform public.tlog('a member reads the note', a ->> 'phone' = '+000111222301');
end $$;
select public.expect('a plain reader cannot change it', $q$update public.trees set about = '{"name":"x"}'::jsonb where id = public.u(900)$q$, 'rows=0');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a branch reader cannot change it', $q$update public.trees set about = '{"name":"x"}'::jsonb where id = public.u(900)$q$, 'rows=0');
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('a stranger cannot read the note (sees no tree at all)', (select count(*) from public.trees where id = public.u(900)) = 0);
end $$;

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
