-- =====================================================================
-- Self-test for 004 (+005): residence, undo, photo rules
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
-- users: 101 admin, 102 branch reader (add+edit on S), 103 plain reader, 104 editor, 105 outsider
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'),
  (public.u(104), 'd1@t.test'), (public.u(105), 'e1@t.test');

insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer'),
  (public.u(900), public.u(104), 'editor');

-- G(1) -> S(2) -> X(3) -> Y(4) ; X -> D(7) ; G -> O(5) ; W(6) wife of X
insert into public.persons (id, tree_id, first_name, gender, father_id) values
  (public.u(1), public.u(900), 'G', 'male',   null),
  (public.u(2), public.u(900), 'S', 'male',   public.u(1)),
  (public.u(3), public.u(900), 'X', 'male',   public.u(2)),
  (public.u(4), public.u(900), 'Y', 'male',   public.u(3)),
  (public.u(5), public.u(900), 'O', 'male',   public.u(1)),
  (public.u(7), public.u(900), 'D', 'female', public.u(3));
insert into public.persons (id, tree_id, first_name, gender) values (public.u(6), public.u(900), 'W', 'female');
insert into public.marriages (tree_id, person_a, person_b) values (public.u(900), public.u(3), public.u(6));

insert into public.branch_grants (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
values (public.u(900), public.u(102), public.u(2), true, true, false, false, public.u(101));

-- the fixtures above were logged too: give them their own group so no undo can ever touch them
select public.seal_tx(0);
select public.snap('fixtures');

-- =====================================================================
-- UNDO as admin
-- =====================================================================
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');

-- 1) an edit is undone
select public.expect('admin renames Y', $q$update public.persons set first_name = 'Y2' where id = public.u(4)$q$, 'rows=1');
select public.seal_tx(1);
do $$
declare v_log bigint; v_name text; n int;
begin
  select max(id) into v_log from public.change_log where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(4);
  perform public.tlog('the edit is in the change log', v_log is not null);
  select count(*) into n from public.change_log where txid = 1;
  perform public.tlog('group 1 is just that one edit (' || n || ' row)', n = 1);
  perform public.revert_change(public.u(900), v_log);
  select first_name into v_name from public.persons where id = public.u(4);
  perform public.tlog('undoing the edit brings the old name back (' || coalesce(v_name, 'NULL') || ')', v_name = 'Y');
end $$;
select public.seal_tx(2);
select public.snap('after undoing the rename');

-- 1b) residence: country is an ISO code, city free text; undo restores both
select public.expect('residence: a country code and a city are accepted',
  $q$update public.persons set residence_country = 'SY', residence_city = 'دمشق' where id = public.u(4)$q$, 'rows=1');
select public.seal_tx(20);
select public.expect('residence: a country NAME instead of a code is refused',
  $q$update public.persons set residence_country = 'Syria' where id = public.u(4)$q$, 'error');
select public.expect('residence: a lower-case code is refused',
  $q$update public.persons set residence_country = 'sy' where id = public.u(4)$q$, 'error');
do $$
declare v_log bigint; c text; t text;
begin
  select max(id) into v_log from public.change_log where table_name = 'persons' and action = 'UPDATE' and record_id = public.u(4);
  perform public.revert_change(public.u(900), v_log);
  select residence_country, residence_city into c, t from public.persons where id = public.u(4);
  perform public.tlog('undo restores the residence fields too', c is null and t is null);
end $$;
select public.seal_tx(21);

-- 2) a deletion is undone together with everything that went with it:
--    deleting X removes his marriage (W) and detaches his children Y and D
select public.expect('admin deletes X (a wife and 2 children)', $q$delete from public.persons where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(3);
do $$
declare v_log bigint; n int; m int; detached int;
begin
  select count(*) into n from public.persons where id = public.u(3);
  select count(*) into detached from public.persons where id in (public.u(4), public.u(7)) and father_id is null;
  select count(*) into m from public.marriages where person_a = public.u(3) or person_b = public.u(3);
  perform public.tlog('after the delete: X gone, 2 children detached, marriage gone', n = 0 and detached = 2 and m = 0);

  select id into v_log from public.change_log where table_name = 'persons' and action = 'DELETE' and record_id = public.u(3) order by id desc limit 1;
  select count(*) into n from public.change_log where txid = (select txid from public.change_log where id = v_log);
  perform public.tlog('the delete and its side effects share one group (' || n || ' rows)', n >= 4);

  n := public.revert_change(public.u(900), v_log);
  perform public.tlog('undo restored ' || n || ' rows', n >= 4);
  select count(*) into n from public.persons where id = public.u(3) and first_name = 'X' and father_id = public.u(2);
  perform public.tlog('X is back under his father', n = 1);
  select count(*) into n from public.persons where id in (public.u(4), public.u(7)) and father_id = public.u(3);
  perform public.tlog('Y and D hang under X again', n = 2);
  select count(*) into m from public.marriages where person_a = public.u(3) or person_b = public.u(3);
  perform public.tlog('the marriage with W is back', m = 1);

  select id into v_log from public.change_log where table_name = 'persons' and action = 'INSERT' and record_id = public.u(3) order by id desc limit 1;
  perform set_config('ft.restore_log', v_log::text, true);
end $$;
select public.seal_tx(4);
select public.snap('after deleting and restoring X');

-- 3) refused when something changed since
select public.expect('admin renames X after the restore', $q$update public.persons set first_name = 'X9' where id = public.u(3)$q$, 'rows=1');
select public.seal_tx(5);
select public.expect('undoing the restore is refused now (X changed since)',
  format($q$select public.revert_change(public.u(900), %s)$q$, current_setting('ft.restore_log')), 'error');
do $$
declare n int;
begin
  select count(*) into n from public.persons where id = public.u(3) and first_name = 'X9'
    and exists (select 1 from public.persons where id = public.u(4) and father_id = public.u(3));
  perform public.tlog('the refused undo changed nothing (all or nothing)', n = 1);
end $$;

-- 4) a person that now has children cannot be "un-added"
select public.expect('admin adds N under G', $q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(40), public.u(900), 'N', 'male', public.u(1))$q$, 'rows=1');
select public.seal_tx(6);
select public.expect('admin adds C under N', $q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(41), public.u(900), 'C', 'male', public.u(40))$q$, 'rows=1');
select public.seal_tx(7);
do $$
declare v_log bigint;
begin
  select id into v_log from public.change_log where table_name = 'persons' and action = 'INSERT' and record_id = public.u(40) order by id desc limit 1;
  perform public.expect('undoing N''s creation is refused (C hangs under N)', format($q$select public.revert_change(public.u(900), %s)$q$, v_log), 'error');
  select id into v_log from public.change_log where table_name = 'persons' and action = 'INSERT' and record_id = public.u(41) order by id desc limit 1;
  perform public.expect('undoing C works', format($q$select public.revert_change(public.u(900), %s)$q$, v_log), 'rows=1');
  select id into v_log from public.change_log where table_name = 'persons' and action = 'INSERT' and record_id = public.u(40) order by id desc limit 1;
  perform public.expect('then undoing N works', format($q$select public.revert_change(public.u(900), %s)$q$, v_log), 'rows=1');
end $$;
select public.seal_tx(8);
select public.snap('after the undo tests');

-- 5) only admins may undo
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('an editor cannot undo', $q$select public.revert_change(public.u(900), (select max(id) from public.change_log))$q$, 'error');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a branch reader cannot undo', $q$select public.revert_change(public.u(900), (select max(id) from public.change_log))$q$, 'error');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot undo', $q$select public.revert_change(public.u(900), (select max(id) from public.change_log))$q$, 'error');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('an outsider cannot undo', $q$select public.revert_change(public.u(900), (select max(id) from public.change_log))$q$, 'error');

-- =====================================================================
-- PHOTOS: who may edit a card's photo
-- =====================================================================
select public.tlog('try_uuid rejects garbage and accepts a uuid',
  public.try_uuid('nope') is null and public.try_uuid('00000000-0000-0000-0000-000000000001') is not null);

select public.as_user(public.u(101), 'a1@t.test');
select public.tlog('admin may change any photo', public.can_edit_photo(public.u(900), public.u(3)) and public.can_edit_photo(public.u(900), public.u(1)));
select public.as_user(public.u(104), 'd1@t.test');
select public.tlog('editor may change any photo', public.can_edit_photo(public.u(900), public.u(3)));
select public.as_user(public.u(102), 'b1@t.test');
do $$
begin
  perform public.info('102 sees ' || (select count(*) from public.branch_grants) || ' grant(s); role=' || coalesce(public.tree_role(public.u(900)), 'NULL')
    || '; has edit right=' || public.has_grants(public.u(900), 'edit')
    || '; under grant(X,edit)=' || public.under_my_grant(public.u(900), public.u(3), 'edit')
    || '; X father=' || coalesce((select father_id::text from public.persons where id = public.u(3)), 'NULL'));
end $$;
select public.tlog('branch reader (edit) may change photos below the head (X)', public.can_edit_photo(public.u(900), public.u(3)));
select public.tlog('...but not the head card (S)', not public.can_edit_photo(public.u(900), public.u(2)));
select public.tlog('...nor another branch (O)', not public.can_edit_photo(public.u(900), public.u(5)));
select public.as_user(public.u(103), 'c1@t.test');
select public.tlog('plain reader may not change photos', not public.can_edit_photo(public.u(900), public.u(3)));
select public.tlog('unknown person / wrong tree is refused', not public.can_edit_photo(public.u(900), public.u(999)));

-- =====================================================================
-- PHOTOS: the storage policies themselves (rows are rolled back; no file is stored)
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('admin uploads a photo for X',
  $q$insert into storage.objects (bucket_id, name) values ('photos', public.u(900)::text || '/' || public.u(3)::text || '/a.jpg')$q$, 'rows=1');

select public.as_user(public.u(102), 'b1@t.test');
select public.expect('branch reader uploads for X (below his head)',
  $q$insert into storage.objects (bucket_id, name) values ('photos', public.u(900)::text || '/' || public.u(3)::text || '/b.jpg')$q$, 'rows=1');
select public.expect('branch reader cannot upload for the head (S)',
  $q$insert into storage.objects (bucket_id, name) values ('photos', public.u(900)::text || '/' || public.u(2)::text || '/c.jpg')$q$, 'error');
select public.expect('branch reader cannot upload for another branch (O)',
  $q$insert into storage.objects (bucket_id, name) values ('photos', public.u(900)::text || '/' || public.u(5)::text || '/d.jpg')$q$, 'error');

select public.as_user(public.u(103), 'c1@t.test');
select public.expect('plain reader cannot upload',
  $q$insert into storage.objects (bucket_id, name) values ('photos', public.u(900)::text || '/' || public.u(3)::text || '/e.jpg')$q$, 'error');
select public.expect('garbage path is refused',
  $q$insert into storage.objects (bucket_id, name) values ('photos', 'x/y.jpg')$q$, 'error');
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'photos';
  perform public.tlog('a reader of the tree can see its photos (' || n || ')', n = 2);
end $$;

select public.as_user(public.u(105), 'e1@t.test');
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'photos';
  perform public.tlog('an outsider sees no photos (' || n || ')', n = 0);
end $$;

-- =====================================================================
-- report (raising the error cancels the whole transaction)
-- =====================================================================
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
