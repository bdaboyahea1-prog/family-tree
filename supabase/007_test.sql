-- =====================================================================
-- Self-test for 007: access requests, error reports, comments, tree creation
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
-- users: 101 admin, 102 plain reader (asks for rights), 103 reader with add+edit+GRANT on S,
--        104 editor, 105 stranger (no membership at all), 106 another plain reader, 107 a reader for the limit test
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'), (public.u(104), 'd1@t.test'),
  (public.u(105), 'e1@t.test'), (public.u(106), 'f1@t.test'), (public.u(107), 'g1@t.test');
insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer'),
  (public.u(900), public.u(104), 'editor'),
  (public.u(900), public.u(106), 'viewer'),
  (public.u(900), public.u(107), 'viewer');
-- G(1) -> S(2) -> X(3) -> Y(4) ; G -> O(5) ; G -> O1..O6 (10..15) for the "too many requests" test
insert into public.persons (id, tree_id, first_name, gender, father_id) values
  (public.u(1), public.u(900), 'G', 'male', null),
  (public.u(2), public.u(900), 'S', 'male', public.u(1)),
  (public.u(3), public.u(900), 'X', 'male', public.u(2)),
  (public.u(4), public.u(900), 'Y', 'male', public.u(3)),
  (public.u(5), public.u(900), 'O', 'male', public.u(1)),
  (public.u(10), public.u(900), 'O1', 'male', public.u(1)),
  (public.u(11), public.u(900), 'O2', 'male', public.u(1)),
  (public.u(12), public.u(900), 'O3', 'male', public.u(1)),
  (public.u(13), public.u(900), 'O4', 'male', public.u(1)),
  (public.u(14), public.u(900), 'O5', 'male', public.u(1)),
  (public.u(15), public.u(900), 'O6', 'male', public.u(1));
insert into public.branch_grants (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
values (public.u(900), public.u(103), public.u(2), true, true, false, true, public.u(101));
select public.seal_tx(0);

set local role authenticated;

-- =====================================================================
-- Only tree admins can create trees
-- =====================================================================
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot create a tree', $q$select public.create_tree('my own tree')$q$, 'error');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a plain reader cannot create a tree', $q$select public.create_tree('my own tree')$q$, 'error');
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('an editor cannot create a tree', $q$select public.create_tree('my own tree')$q$, 'error');
select public.as_user(public.u(101), 'a1@t.test');
select public.tlog('an admin can (can_create_tree)', public.can_create_tree());
select public.as_user(public.u(105), 'e1@t.test');
select public.tlog('a stranger is told he cannot (can_create_tree)', not public.can_create_tree());

-- =====================================================================
-- A stranger sees nothing and can do nothing
-- =====================================================================
do $$
begin
  perform public.tlog('stranger sees no persons (' || (select count(*) from public.persons) || ')', (select count(*) from public.persons) = 0);
end $$;
select public.expect('stranger cannot comment',
  $q$insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), 'hello')$q$, 'error');
select public.expect('stranger cannot report an error', $q$select public.report_card_error(public.u(900), public.u(3), 'x')$q$, 'error');
select public.expect('stranger cannot request access', $q$select public.request_branch_access(public.u(900), public.u(3), true, false, false, 'x')$q$, 'error');

-- =====================================================================
-- Comments
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a plain reader comments on a card',
  $q$insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), 'جدي كان من حمص')$q$, 'rows=1');
select public.expect('...but not in someone else''s name',
  $q$insert into public.card_comments (tree_id, person_id, user_id, body) values (public.u(900), public.u(3), public.u(106), 'forged')$q$, 'error');
select public.expect('an empty comment is refused',
  $q$insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), '')$q$, 'error');
select public.expect('a comment over 1000 characters is refused',
  format($q$insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), %L)$q$, repeat('x', 1001)), 'error');

select public.as_user(public.u(106), 'f1@t.test');
do $$
declare n int;
begin
  select count(*) into n from public.card_comments where person_id = public.u(3);
  perform public.tlog('another member reads it (' || n || ')', n = 1);
end $$;
select public.expect('another reader cannot delete it', $q$delete from public.card_comments where user_id = public.u(102)$q$, 'rows=0');

select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('the stranger does not see comments', (select count(*) from public.card_comments) = 0);
end $$;

select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin deletes any comment', $q$delete from public.card_comments where user_id = public.u(102)$q$, 'rows=1');

select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a member adds another comment', $q$insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), 'second')$q$, 'rows=1');
select public.expect('...and deletes his own', $q$delete from public.card_comments where user_id = public.u(102)$q$, 'rows=1');

-- flooding: the 31st comment within an hour is refused
select public.as_user(public.u(106), 'f1@t.test');
do $$
declare i int; ok int := 0;
begin
  for i in 1..32 loop
    begin
      insert into public.card_comments (tree_id, person_id, body) values (public.u(900), public.u(3), 'spam ' || i);
      ok := ok + 1;
    exception when others then
      exit;
    end;
  end loop;
  perform public.tlog('comment flooding stops at 30 (' || ok || ' accepted)', ok = 30);
end $$;

-- =====================================================================
-- Error reports
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a plain reader reports an error on X', $q$select public.report_card_error(public.u(900), public.u(3), 'سنة الميلاد خاطئة')$q$, 'rows=1');
select public.expect('an empty report is refused', $q$select public.report_card_error(public.u(900), public.u(3), '   ')$q$, 'error');
select public.expect('a report about a person that does not exist is refused', $q$select public.report_card_error(public.u(900), public.u(999), 'x')$q$, 'error');

do $$
declare n int;
begin
  select count(*) into n from public.card_reports;
  perform public.tlog('the reporter sees his report (' || n || ')', n = 1);
end $$;
select public.as_user(public.u(106), 'f1@t.test');
do $$
begin
  perform public.tlog('another plain reader does not see it', (select count(*) from public.card_reports) = 0);
end $$;
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('the admin sees it', (select count(*) from public.card_reports) = 1);
end $$;
select public.as_user(public.u(104), 'd1@t.test');
do $$
begin
  perform public.tlog('an editor sees it', (select count(*) from public.card_reports) = 1);
end $$;
select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('a reader who may edit X (below his head S) sees it', (select count(*) from public.card_reports) = 1);
end $$;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('a stranger does not see it', (select count(*) from public.card_reports) = 0);
end $$;

select public.as_user(public.u(106), 'f1@t.test');
select public.expect('a plain reader cannot resolve reports',
  $q$select public.set_report_status((select id from public.card_reports limit 1), 'resolved', 'x')$q$, 'error');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('the reporter (plain reader) cannot resolve his own report',
  $q$select public.set_report_status((select id from public.card_reports limit 1), 'resolved', 'x')$q$, 'error');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a reader who may edit the card resolves it',
  $q$select public.set_report_status((select id from public.card_reports limit 1), 'resolved', 'صُحّح')$q$, 'rows=1');
select public.as_user(public.u(101), 'a1@t.test');
do $$
declare s text;
begin
  select status into s from public.card_reports limit 1;
  perform public.tlog('the report is resolved (' || s || ')', s = 'resolved');
end $$;
select public.expect('the admin can reopen it', $q$select public.set_report_status((select id from public.card_reports limit 1), 'open')$q$, 'rows=1');

-- too many reports in an hour
select public.as_user(public.u(107), 'g1@t.test');
do $$
declare i int; ok int := 0;
begin
  for i in 1..12 loop
    begin
      perform public.report_card_error(public.u(900), public.u(3), 'r ' || i);
      ok := ok + 1;
    exception when others then
      exit;
    end;
  end loop;
  perform public.tlog('report flooding stops at 10 (' || ok || ' accepted)', ok = 10);
end $$;

-- =====================================================================
-- Access requests
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('before approval a plain reader cannot edit Y', $q$update public.persons set first_name = 'hack' where id = public.u(4)$q$, 'rows=0');
select public.expect('...nor add persons', $q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'N', 'male', public.u(3))$q$, 'error');

select public.expect('a reader asks for add+edit on X', $q$select public.request_branch_access(public.u(900), public.u(3), true, true, false, 'أريد تحديث بيانات فرع عمي')$q$, 'rows=1');
select public.expect('a second open request for the same card is refused', $q$select public.request_branch_access(public.u(900), public.u(3), true, false, false, 'again')$q$, 'error');
select public.expect('a request without any right is refused', $q$select public.request_branch_access(public.u(900), public.u(5), false, false, false, 'x')$q$, 'error');
do $$
begin
  perform public.tlog('the requester sees his request', (select count(*) from public.access_requests) = 1);
end $$;

select public.as_user(public.u(106), 'f1@t.test');
do $$
begin
  perform public.tlog('another reader does not see it', (select count(*) from public.access_requests) = 0);
end $$;
select public.expect('...and cannot decide it', $q$select public.decide_access_request((select id from public.access_requests limit 1), true, true, true, false, false)$q$, 'error');

select public.as_user(public.u(104), 'd1@t.test');
select public.expect('an editor cannot ask (he already edits)', $q$select public.request_branch_access(public.u(900), public.u(3), true, false, false, 'x')$q$, 'error');
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin cannot ask either', $q$select public.request_branch_access(public.u(900), public.u(3), true, false, false, 'x')$q$, 'error');

select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('the delegate (grant above X) sees the request', (select count(*) from public.access_requests) = 1);
end $$;
select public.expect('he cannot approve a right he does not hold (delete)',
  $q$select public.decide_access_request((select id from public.access_requests limit 1), true, true, true, true, false)$q$, 'error');
select public.expect('he cannot approve with no right at all',
  $q$select public.decide_access_request((select id from public.access_requests limit 1), true, false, false, false, false)$q$, 'error');
select public.expect('he approves add+edit',
  $q$select public.decide_access_request((select id from public.access_requests limit 1), true, true, true, false, false, 'مقبول')$q$, 'rows=1');
select public.expect('deciding the same request again is refused',
  $q$select public.decide_access_request((select id from public.access_requests limit 1), false, false, false, false, false)$q$, 'error');

select public.as_user(public.u(101), 'a1@t.test');
do $$
declare g record;
begin
  select * into g from public.branch_grants where user_id = public.u(102) and person_id = public.u(3);
  perform public.tlog('the grant exists with add+edit only',
    g.user_id is not null and g.can_add and g.can_edit and not g.can_delete and not g.can_grant);
  perform public.tlog('the grant was given by the approver (103)', g.created_by = public.u(103));
end $$;

select public.as_user(public.u(102), 'b1@t.test');
select public.expect('after approval the reader edits Y (below X)', $q$update public.persons set first_name = 'Y2' where id = public.u(4)$q$, 'rows=1');
select public.expect('...but still not X itself', $q$update public.persons set first_name = 'hack' where id = public.u(3)$q$, 'rows=0');
select public.expect('...and cannot delete (not granted)', $q$delete from public.persons where id = public.u(4)$q$, 'rows=0');
do $$
declare s text;
begin
  select status into s from public.access_requests limit 1;
  perform public.tlog('the requester sees it as approved (' || s || ')', s = 'approved');
end $$;

-- reject and cancel
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('another reader asks for delete on O', $q$select public.request_branch_access(public.u(900), public.u(5), false, false, true, 'x')$q$, 'rows=1');
select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('the delegate does NOT see a request for O (not below his head)', (select count(*) from public.access_requests where person_id = public.u(5)) = 0);
end $$;
select public.expect('...and cannot reject it',
  $q$select public.decide_access_request((select id from public.access_requests where person_id = public.u(5) limit 1), false, false, false, false, false)$q$, 'error');
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin rejects it',
  $q$select public.decide_access_request((select id from public.access_requests where person_id = public.u(5) limit 1), false, false, false, false, false, 'لا حاجة')$q$, 'rows=1');
select public.as_user(public.u(106), 'f1@t.test');
do $$
declare s text;
begin
  select status into s from public.access_requests where person_id = public.u(5);
  perform public.tlog('the requester sees it as rejected (' || s || ')', s = 'rejected');
end $$;
select public.expect('he can ask again after a rejection', $q$select public.request_branch_access(public.u(900), public.u(5), true, false, false, 'x')$q$, 'rows=1');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('someone else cannot cancel it', $q$select public.cancel_access_request((select id from public.access_requests where person_id = public.u(5) and status = 'pending' limit 1))$q$, 'error');
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('the requester cancels it', $q$select public.cancel_access_request((select id from public.access_requests where person_id = public.u(5) and status = 'pending' limit 1))$q$, 'rows=1');

-- at most 5 open requests per person
select public.as_user(public.u(107), 'g1@t.test');
do $$
declare i int; ok int := 0;
begin
  for i in 10..15 loop
    begin
      perform public.request_branch_access(public.u(900), public.u(i), true, false, false, null);
      ok := ok + 1;
    exception when others then
      exit;
    end;
  end loop;
  perform public.tlog('open requests are capped at 5 (' || ok || ' accepted)', ok = 5);
end $$;

-- direct writes to the request tables are not possible
select public.expect('nobody writes requests directly', $q$insert into public.access_requests (tree_id, person_id, user_id, can_add) values (public.u(900), public.u(3), public.u(107), true)$q$, 'error');
select public.expect('nobody edits a request directly', $q$update public.access_requests set status = 'approved'$q$, 'error');
select public.expect('nobody writes reports directly', $q$insert into public.card_reports (tree_id, person_id, message) values (public.u(900), public.u(3), 'x')$q$, 'error');

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
