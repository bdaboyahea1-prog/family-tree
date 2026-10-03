-- =====================================================================
-- Self-test for 014: the nickname ("اللقب المشتهر به") on a card
-- Run in the SQL Editor AFTER 014_nickname.sql. It creates fake data, tries it, then ROLLS
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

-- The whole script is ONE transaction, so every logged change would share one txid. seal_tx() gives what was
-- logged so far its own group number, which is how the test pretends each step was a separate request.
create function public.seal_tx(n bigint) returns void
language sql security definer set search_path = public as
$$ update public.change_log set txid = n where txid = txid_current() $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text), public.seal_tx(bigint) to authenticated;

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
-- Writing it
-- =====================================================================
select public.expect('the admin writes a nickname on a card',
  $q$update public.persons set nickname = 'أبو علي' where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(1);
do $$
begin
  perform public.tlog('it is stored as typed', (select nickname from public.persons where id = public.u(3)) = 'أبو علي');
end $$;

select public.expect('a nickname of exactly 100 characters is accepted', format($q$update public.persons set nickname = %L where id = public.u(3)$q$, repeat('ن', 100)), 'rows=1');
select public.expect('a nickname of 101 characters is refused', format($q$update public.persons set nickname = %L where id = public.u(3)$q$, repeat('ن', 101)), 'error');
select public.expect('it is optional: clearing it is allowed', $q$update public.persons set nickname = null where id = public.u(3)$q$, 'rows=1');
select public.expect('a card can be created without a nickname',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(10), public.u(900), 'NoNick', 'male', public.u(3))$q$, 'rows=1');
select public.expect('...or with one',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id, nickname) values (public.u(11), public.u(900), 'WithNick', 'male', public.u(3), 'الحاج')$q$, 'rows=1');
select public.seal_tx(2);
select public.expect('the nickname is changed in a separate step', $q$update public.persons set nickname = 'الشيخ' where id = public.u(11)$q$, 'rows=1');
select public.seal_tx(3);

-- =====================================================================
-- The change log and the undo
-- =====================================================================
do $$
declare v_log bigint; r record;
begin
  select max(id) into v_log from public.change_log
   where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(11) and txid = 3;
  perform public.tlog('the change of the nickname is in the change log (old and new value)',
    (select old_data ->> 'nickname' = 'الحاج' and new_data ->> 'nickname' = 'الشيخ' from public.change_log where id = v_log));
  perform public.revert_change(public.u(900), v_log);
  select * into r from public.persons where id = public.u(11);
  perform public.tlog('undo brings the old nickname back', r.nickname = 'الحاج');
end $$;
select public.seal_tx(4);

-- undoing the creation of a card that had a nickname works too (the card is removed)
do $$
declare v_log bigint;
begin
  select max(id) into v_log from public.change_log where table_name = 'persons' and action = 'INSERT' and record_id = public.u(11);
  -- the group of that insert also holds the other card created in that step; both go together
  perform public.revert_change(public.u(900), v_log);
  perform public.tlog('undoing the step that created cards with and without a nickname removes them',
    not exists (select 1 from public.persons where id in (public.u(10), public.u(11))));
end $$;
select public.seal_tx(5);

-- a deleted card comes back with its nickname
select public.expect('a card with a nickname is created',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id, nickname) values (public.u(12), public.u(900), 'Gone', 'male', public.u(3), 'أبو خالد')$q$, 'rows=1');
select public.seal_tx(6);
select public.expect('...and deleted', $q$delete from public.persons where id = public.u(12)$q$, 'rows=1');
select public.seal_tx(7);
do $$
declare v_log bigint; r record;
begin
  select max(id) into v_log from public.change_log where table_name = 'persons' and action = 'DELETE' and record_id = public.u(12);
  perform public.revert_change(public.u(900), v_log);
  select * into r from public.persons where id = public.u(12);
  perform public.tlog('undoing the deletion brings the card back with its nickname', found and r.nickname = 'أبو خالد');
end $$;
select public.seal_tx(8);

-- =====================================================================
-- Who may write it: the same rules as the rest of the card
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a branch reader writes it on a card inside his branch',
  $q$update public.persons set nickname = 'ابن الفرع' where id = public.u(3)$q$, 'rows=1');
select public.expect('...but not on a card outside it (nothing changes)',
  $q$update public.persons set nickname = 'خارج الفرع' where id = public.u(1)$q$, 'rows=0');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot write it (nothing changes)',
  $q$update public.persons set nickname = 'ممنوع' where id = public.u(3)$q$, 'rows=0');
do $$
begin
  perform public.tlog('...and every member can read it', (select nickname from public.persons where id = public.u(3)) = 'ابن الفرع');
end $$;
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot write it (nothing changes)',
  $q$update public.persons set nickname = 'غريب' where id = public.u(3)$q$, 'rows=0');
select public.expect('...and cannot read any card', $q$select nickname from public.persons$q$, 'rows=0');

reset role;
do $$
begin
  perform public.tlog('after all the refused writes the card still has the branch reader''s nickname only',
    (select nickname from public.persons where id = public.u(3)) = 'ابن الفرع'
    and (select nickname from public.persons where id = public.u(1)) is null);
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
