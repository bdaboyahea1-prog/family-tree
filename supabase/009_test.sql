-- =====================================================================
-- Self-test for 009: the rule for women's cards + the information table
-- Run in the SQL Editor AFTER 009_female_cards.sql. It creates fake data, tries the rules, then
-- ROLLS EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- Every line should start with PASS. Lines starting with INFO are diagnostics.
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated;
grant usage on sequence public.t_results_n_seq to authenticated;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when p_ok then 'PASS  ' else 'FAIL  ' end || p_name) $$;

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

grant execute on function public.tlog(text, boolean), public.try_sql(text),
  public.expect(text, text, text), public.u(int), public.as_user(uuid, text) to authenticated;

-- ---------- fake data ----------
-- users: 101 admin, 102 branch reader (add on S), 103 plain reader, 104 editor, 105 stranger
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'),
  (public.u(104), 'd1@t.test'), (public.u(105), 'e1@t.test');
insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer'),
  (public.u(900), public.u(104), 'editor');
-- G(1) -> S(2) -> W(20, a woman) ;  G(1) -> W2(21, a woman, outside S's branch) ; S(2) -> X(3)
insert into public.persons (id, tree_id, first_name, gender, father_id) values
  (public.u(1), public.u(900), 'G', 'male', null),
  (public.u(2), public.u(900), 'S', 'male', public.u(1)),
  (public.u(3), public.u(900), 'X', 'male', public.u(2)),
  (public.u(20), public.u(900), 'W', 'female', public.u(2)),
  (public.u(21), public.u(900), 'W2', 'female', public.u(1));
insert into public.branch_grants (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
values (public.u(900), public.u(102), public.u(2), true, true, false, false, public.u(101));

set local role authenticated;

-- =====================================================================
-- The rule itself
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('a new tree starts on full', (select female_card_mode from public.trees where id = public.u(900)) = 'full');
end $$;
select public.expect('an invalid rule is refused', $q$update public.trees set female_card_mode = 'maybe' where id = public.u(900)$q$, 'error');
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('an editor cannot change the rule', $q$update public.trees set female_card_mode = 'none' where id = public.u(900)$q$, 'rows=0');
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a branch reader cannot change the rule', $q$update public.trees set female_card_mode = 'none' where id = public.u(900)$q$, 'rows=0');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot change the rule', $q$update public.trees set female_card_mode = 'none' where id = public.u(900)$q$, 'rows=0');

-- ---------- full: nothing is blocked ----------
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('full: an editor adds a child under a woman (mother only)',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(30), public.u(900), 'Kid1', 'male', public.u(20))$q$, 'rows=1');
select public.expect('full: information rows are not accepted',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'son', 'Info1')$q$, 'error');

-- ---------- info ----------
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin switches the tree to info', $q$update public.trees set female_card_mode = 'info' where id = public.u(900)$q$, 'rows=1');

select public.as_user(public.u(104), 'd1@t.test');
select public.expect('info: an editor can no longer hang a card under a woman',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(31), public.u(900), 'Kid2', 'male', public.u(20))$q$, 'error');
select public.expect('info: ...but a child with a recorded father is fine (mother + father)',
  $q$insert into public.persons (id, tree_id, first_name, gender, father_id, mother_id) values (public.u(32), public.u(900), 'Kid3', 'male', public.u(3), public.u(20))$q$, 'rows=1');
select public.expect('info: ...and a child whose "mother" is a man is not a woman branch',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(33), public.u(900), 'Kid4', 'male', public.u(3))$q$, 'rows=1');
select public.expect('info: an editor writes an information row about a woman',
  $q$insert into public.card_info (id, tree_id, person_id, kind, first_name, last_name, birth_date, birth_country, birth_city, residence_country, phone, email, notes)
     values (public.u(40), public.u(900), public.u(20), 'son', 'Info1', 'Fam', '2016-03-01', 'SY', 'Jableh', 'DE', '+49 170 1234567', 'i@example.com', 'note')$q$, 'rows=1');
select public.expect('info: ...about a daughter and a husband too',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name, death_date, is_deceased) values (public.u(900), public.u(20), 'daughter', 'Info2', '2020', true), (public.u(900), public.u(20), 'spouse', 'Husb', null, false)$q$, 'rows=2');
select public.expect('info: not about a man', $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(3), 'son', 'Bad')$q$, 'error');
select public.expect('info: a kind that does not exist is refused', $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'cousin', 'Bad')$q$, 'error');
select public.expect('info: a name is required', $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'son', '')$q$, 'error');
select public.expect('info: a bad phone is refused', $q$insert into public.card_info (tree_id, person_id, kind, first_name, phone) values (public.u(900), public.u(20), 'son', 'Bad', '0111abc')$q$, 'error');
select public.expect('info: a bad e-mail is refused', $q$insert into public.card_info (tree_id, person_id, kind, first_name, email) values (public.u(900), public.u(20), 'son', 'Bad', 'x@')$q$, 'error');
select public.expect('info: a bad country code is refused', $q$insert into public.card_info (tree_id, person_id, kind, first_name, birth_country) values (public.u(900), public.u(20), 'son', 'Bad', 'syria')$q$, 'error');
select public.expect('info: an editor edits a row', $q$update public.card_info set first_name = 'Info1b', notes = 'changed' where id = public.u(40)$q$, 'rows=1');
select public.expect('info: the woman and the tree of a row cannot be changed',
  $q$update public.card_info set person_id = public.u(21) where id = public.u(40)$q$, 'error');
do $$
declare r record;
begin
  select * into r from public.card_info where id = public.u(40);
  perform public.tlog('info: the row keeps who wrote it and when it changed', r.created_by = public.u(104) and r.updated_by = public.u(104));
end $$;

-- branch reader: only on women in his branch
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('info: a branch reader (add) writes about a woman below his head',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'daughter', 'ByBranch')$q$, 'rows=1');
select public.expect('info: ...but not about a woman outside his branch',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(21), 'daughter', 'Outside')$q$, 'error');
select public.expect('info: a branch reader cannot hang a card under a woman either',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(34), public.u(900), 'Kid5', 'male', public.u(20))$q$, 'error');

-- plain reader / stranger
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('info: a plain reader cannot write',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'son', 'Nope')$q$, 'error');
select public.expect('info: ...cannot edit', $q$update public.card_info set notes = 'x' where id = public.u(40)$q$, 'rows=0');
select public.expect('info: ...cannot delete', $q$delete from public.card_info where id = public.u(40)$q$, 'rows=0');
do $$
declare n int;
begin
  select count(*) into n from public.card_info;
  perform public.tlog('info: ...but members read the rows (' || n || ')', n >= 4);
end $$;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('info: a stranger sees no information rows', (select count(*) from public.card_info) = 0);
end $$;
select public.expect('info: a stranger cannot write',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'son', 'Nope')$q$, 'error');

-- admin is exempt from the card rule (import, undo)
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('info: the admin may still create a card under a woman',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(35), public.u(900), 'KidAdmin', 'male', public.u(20))$q$, 'rows=1');

-- ---------- none ----------
select public.expect('the admin switches the tree to none', $q$update public.trees set female_card_mode = 'none' where id = public.u(900)$q$, 'rows=1');
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('none: no new information rows',
  $q$insert into public.card_info (tree_id, person_id, kind, first_name) values (public.u(900), public.u(20), 'son', 'Late')$q$, 'error');
select public.expect('none: existing rows cannot be edited', $q$update public.card_info set notes = 'again' where id = public.u(40)$q$, 'error');
select public.expect('none: no card under a woman', $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(36), public.u(900), 'Kid6', 'male', public.u(20))$q$, 'error');
select public.expect('none: existing rows can still be deleted', $q$delete from public.card_info where id = public.u(40)$q$, 'rows=1');

-- ---------- back to full ----------
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin switches back to full', $q$update public.trees set female_card_mode = 'full' where id = public.u(900)$q$, 'rows=1');
select public.as_user(public.u(104), 'd1@t.test');
select public.expect('full again: a card under a woman is accepted',
  $q$insert into public.persons (id, tree_id, first_name, gender, mother_id) values (public.u(37), public.u(900), 'Kid7', 'male', public.u(20))$q$, 'rows=1');
do $$
declare n int;
begin
  select count(*) into n from public.card_info where person_id = public.u(20);
  perform public.tlog('the rows written earlier are kept when the rule changes (' || n || ')', n >= 3);
end $$;

-- ---------- the woman goes, her information goes ----------
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('deleting a woman', $q$delete from public.persons where id = public.u(20)$q$, 'rows=1');
do $$
begin
  perform public.tlog('her information rows are deleted with her', (select count(*) from public.card_info where person_id = public.u(20)) = 0);
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
