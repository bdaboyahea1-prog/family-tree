-- =====================================================================
-- Self-test for 016: the names on the public page (first name + father + family)
-- Run in the SQL Editor AFTER 016_public_triple_name.sql. It creates fake data, tries it, then ROLLS
-- EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated, anon;
grant usage on sequence public.t_results_n_seq to authenticated, anon;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end || p_name) $$;

create function public.u(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- the names of the first row, in the order of the page, joined with " | "
create function public.row_names() returns text language sql stable as
$$ select string_agg(c ->> 'name', ' | ') from jsonb_array_elements(public.public_teaser() -> 'children') c $$;

grant execute on function public.tlog(text, boolean), public.u(int), public.row_names() to anon, authenticated;

-- ---------- fake data: a top ancestor and his first row (all deceased, so the page may show them) ----------
insert into public.trees (id, name, public_page, public_show_living) values (public.u(900), 'Test family', true, false);
insert into public.persons (id, tree_id, first_name, last_name, gender, father_id, mother_id, is_deceased, birth_date, death_date) values
  (public.u(1), public.u(900), 'خالد', 'هرموش', 'male', null, null, true, '1815', '1930'),
  (public.u(2), public.u(900), 'علي', 'هرموش', 'male', public.u(1), null, true, '1910', '1960'),
  (public.u(3), public.u(900), 'مصطفى', 'هرموش', 'male', public.u(1), null, true, null, '1980'),
  (public.u(4), public.u(900), 'عبد الرحمن خالد', 'هرموش', 'male', public.u(1), null, true, '1920', '1990'),   -- the father's name is already in the first name
  (public.u(5), public.u(900), 'خالد', 'هرموش', 'male', public.u(1), null, true, '1925', '1995'),                 -- a son with his father's name
  (public.u(6), public.u(900), 'سلمى', 'هرموش', 'female', null, public.u(1), true, '1930', '2000'),               -- hangs under him through the mother field: no father on record
  (public.u(7), public.u(900), 'يوسف', 'هرموش', 'male', public.u(1), null, false, '1950', null);                  -- living: stays hidden

-- The real tree of this project may have its public page on, and the page shows the OLDEST public tree. Inside this
-- test (everything is rolled back at the end) only the test tree may be public.
update public.trees set public_page = false where id <> public.u(900);

set local role anon;

-- =====================================================================
-- The names
-- =====================================================================
do $$
declare t jsonb := public.public_teaser();
begin
  perform public.tlog('the top ancestor stays "first name + family"', t -> 'root' ->> 'name' = 'خالد هرموش');
  perform public.tlog('a child is written with the father''s name in the middle', public.row_names() like '%علي خالد هرموش%');
  perform public.tlog('...also one with no birth year', public.row_names() like '%مصطفى خالد هرموش%');
  perform public.tlog('the father''s name already at the end of the first name is not written twice', public.row_names() like '%عبد الرحمن خالد هرموش%' and public.row_names() not like '%خالد خالد خالد%');
  perform public.tlog('a son with his father''s name keeps both', public.row_names() like '%خالد خالد هرموش%');
  perform public.tlog('a person who hangs under him through the mother field has no father to write', public.row_names() like '%سلمى هرموش%' and public.row_names() not like '%سلمى خالد%');
  perform public.tlog('the rest of the page is unchanged: five people shown, the living one hidden', jsonb_array_length(t -> 'children') = 5 and (t ->> 'hidden_children')::int = 1);
  perform public.tlog('...and the years and the gender are still there', (t -> 'children' -> 0 ->> 'gender') = 'male' and (t -> 'children' -> 0 -> 'death_year') is not null);
  perform public.tlog('no names of the hidden person anywhere in the answer', t::text not like '%يوسف%');
  perform public.tlog('the order is the order of birth (the one without a year last)', public.row_names() like 'علي خالد هرموش | عبد الرحمن خالد هرموش | خالد خالد هرموش | سلمى هرموش | مصطفى خالد هرموش');
end $$;

-- =====================================================================
-- The admin's default look can turn the father's name off for everybody
-- =====================================================================
reset role;
update public.trees set default_look = '{"tripleName": false}' where id = public.u(900);
set local role anon;
do $$
begin
  perform public.tlog('with "tripleName": false the names are plain again', public.row_names() like 'علي هرموش | عبد الرحمن خالد هرموش | خالد هرموش | سلمى هرموش | مصطفى هرموش');
end $$;

reset role;
update public.trees set default_look = '{"tripleName": true, "design": "tree"}' where id = public.u(900);
set local role anon;
do $$
begin
  perform public.tlog('with "tripleName": true (and other keys) the father''s name is back', public.row_names() like '%علي خالد هرموش%');
end $$;

reset role;
update public.trees set default_look = '{"cardStyle": "pill"}' where id = public.u(900);
set local role anon;
do $$
begin
  perform public.tlog('a default look that does not mention it: the father''s name is written', public.row_names() like '%علي خالد هرموش%');
end $$;

reset role;
update public.trees set default_look = null where id = public.u(900);
set local role anon;
do $$
begin
  perform public.tlog('no default look at all: the father''s name is written', public.row_names() like '%علي خالد هرموش%');
end $$;

-- =====================================================================
-- A change in the tree reaches the page by itself
-- =====================================================================
reset role;
update public.persons set first_name = 'عليّ' where id = public.u(2);
set local role anon;
do $$
begin
  perform public.tlog('a renamed person is renamed on the page', public.row_names() like '%عليّ خالد هرموش%');
end $$;

reset role;
update public.trees set public_page = false where id = public.u(900);
set local role anon;
do $$
begin
  perform public.tlog('with the public page off there is nothing to show', public.public_teaser() is null);
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
