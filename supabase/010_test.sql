-- =====================================================================
-- Self-test for 010: the public page + join requests
-- Run in the SQL Editor AFTER 010_public_page_and_join.sql. It creates fake data, tries the rules,
-- then ROLLS EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- Every line should start with PASS. Lines starting with INFO are diagnostics.
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated, anon;
grant usage on sequence public.t_results_n_seq to authenticated, anon;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when p_ok then 'PASS  ' else 'FAIL  ' end || p_name) $$;

create function public.info(p_text text) returns void
language sql as $$ insert into public.t_results (line) values ('INFO  ' || p_text) $$;

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

grant execute on function public.tlog(text, boolean), public.info(text), public.try_sql(text),
  public.expect(text, text, text), public.u(int), public.as_user(uuid, text) to authenticated, anon;

-- ---------- fake data ----------
-- users: 101 admin, 103 plain reader (a member), 105 / 106 / 107 strangers (signed in, not members)
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(103), 'c1@t.test'), (public.u(105), 'e1@t.test'), (public.u(106), 'f1@t.test'), (public.u(107), 'g1@t.test');
insert into public.trees (id, name) values (public.u(900), 'Test family');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(103), 'viewer');
-- R(1, deceased 1890-1960) -> K1(2, deceased 1920-1990), K2(3, living), K3(4, deceased 1925, no death year) ; K1 -> G(5) ; a wife W(6) without parents
insert into public.persons (id, tree_id, first_name, last_name, gender, father_id, birth_date, death_date, is_deceased, birth_city, residence_city, phone, notes) values
  (public.u(1), public.u(900), 'Root', 'Fam', 'male', null, '1890-05-01', '1960', true, 'SecretTown', 'SecretCity', '+000 111 222 301', 'private note'),
  (public.u(2), public.u(900), 'KidOne', 'Fam', 'male', public.u(1), '1920', '1990-02-02', true, null, null, null, null),
  (public.u(3), public.u(900), 'KidLiving', 'Fam', 'female', public.u(1), '1950', null, false, null, null, null, null),
  (public.u(4), public.u(900), 'KidThree', 'Fam', 'male', public.u(1), 'about 1925', null, true, null, null, null, null),
  (public.u(5), public.u(900), 'Grandchild', 'Fam', 'male', public.u(2), '1950', null, true, null, null, null, null),
  (public.u(6), public.u(900), 'Wife', 'Other', 'female', null, '1925', null, true, null, null, null, null);

-- =====================================================================
-- The public teaser
-- =====================================================================
set local role anon;
do $$
begin
  perform public.tlog('page off: a stranger gets nothing', public.public_teaser() is null);
end $$;
select public.expect('page off: a stranger cannot read the people table', $q$select count(*) from public.persons$q$, 'error');
select public.expect('a stranger cannot read join requests', $q$select count(*) from public.join_requests$q$, 'error');

reset role;
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin switches the public page on', $q$update public.trees set public_page = true where id = public.u(900)$q$, 'rows=1');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a plain reader cannot switch it', $q$update public.trees set public_page = false where id = public.u(900)$q$, 'rows=0');
select public.expect('...nor allow living people', $q$update public.trees set public_show_living = true where id = public.u(900)$q$, 'rows=0');

reset role;
set local role anon;
do $$
declare t jsonb := public.public_teaser(); txt text;
begin
  txt := t::text;
  perform public.tlog('page on: a stranger gets the teaser', t is not null);
  perform public.tlog('...with the tree name and a head count', t ->> 'tree_name' = 'Test family' and (t ->> 'people_count')::int = 6);
  perform public.tlog('...the top ancestor (the biggest line), with his years', t -> 'root' ->> 'name' = 'Root Fam' and (t -> 'root' ->> 'birth_year')::int = 1890 and (t -> 'root' ->> 'death_year')::int = 1960);
  perform public.tlog('...and the first row: only the deceased ones (2 of 3), oldest first',
    jsonb_array_length(t -> 'children') = 2 and t -> 'children' -> 0 ->> 'name' = 'KidOne Fam' and t -> 'children' -> 1 ->> 'name' = 'KidThree Fam');
  perform public.tlog('...the living one is only counted as hidden', (t ->> 'hidden_children')::int = 1 and txt not like '%KidLiving%');
  perform public.tlog('...no years for a person with no year in the record', t -> 'children' -> 1 -> 'death_year' = 'null'::jsonb);
  perform public.tlog('...the lower generation is not in it', txt not like '%Grandchild%');
  perform public.tlog('...nor the wife', txt not like '%Wife%');
  perform public.tlog('...nor places, phone numbers or notes', txt not like '%SecretTown%' and txt not like '%SecretCity%' and txt not like '%+000%' and txt not like '%private%');
  perform public.tlog('...only the expected keys are given', (select array_agg(k order by k) from jsonb_object_keys(t -> 'root') k) = array['birth_year','death_year','deceased','gender','name']);
  perform public.info(txt);
end $$;

-- living people on the page only when the admin allows it
reset role;
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin allows living people', $q$update public.trees set public_show_living = true where id = public.u(900)$q$, 'rows=1');
reset role;
set local role anon;
do $$
declare t jsonb := public.public_teaser();
begin
  perform public.tlog('living allowed: the living one appears, with no years', jsonb_array_length(t -> 'children') = 3
    and exists (select 1 from jsonb_array_elements(t -> 'children') e where e ->> 'name' = 'KidLiving Fam' and e -> 'birth_year' = 'null'::jsonb));
  perform public.tlog('...and nobody is hidden', (t ->> 'hidden_children')::int = 0);
end $$;

-- a living top ancestor hides his whole row
reset role;
update public.persons set is_deceased = false where id = public.u(1);
update public.trees set public_show_living = false where id = public.u(900);
set local role anon;
do $$
declare t jsonb := public.public_teaser();
begin
  perform public.tlog('a living top ancestor is not shown', t -> 'root' = 'null'::jsonb);
  perform public.tlog('...and neither is his row', jsonb_array_length(t -> 'children') = 0 and (t ->> 'hidden_children')::int = 3);
end $$;
reset role;
update public.persons set is_deceased = true where id = public.u(1);

-- =====================================================================
-- Join requests
-- =====================================================================
set local role authenticated;
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger asks to join',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, residence_country, residence_city, phone, contact_email, doc_path)
     values (%L, public.u(900), 'Visitor One', 'I am the grandson of Root, my father is KidOne', 'DE', 'Berlin', '+49 170 1234567', 'v1@example.com', %L)$q$,
     public.u(500), public.u(105)::text || '/' || public.u(500)::text || '.pdf'), 'rows=1');
select public.expect('...but not twice while the first is open',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Visitor One', 'second request about the same family', '+49 170 1234567', 'v1@example.com', %L)$q$, public.u(105)::text || '/b.pdf'), 'error');
select public.expect('a bad phone is refused',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Visitor Two', 'a relation text that is long enough', '0945abc', 'v@example.com', %L)$q$, public.u(106)::text || '/b.pdf'), 'error');
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('a bad e-mail is refused',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'nope', %L)$q$, public.u(106)::text || '/b.pdf'), 'error');
select public.expect('a request needs a document',
  $q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email) values (public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com')$q$, 'error');
select public.expect('the document must be in the person''s own folder',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(105)::text || '/other.pdf'), 'error');
select public.expect('nobody can write a request in another person''s name',
  format($q$insert into public.join_requests (user_id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(105), public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(105)::text || '/x.pdf'), 'error');
select public.expect('a second stranger asks to join',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(106)::text || '/m.pdf'), 'rows=1');

select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a member cannot ask to join',
  format($q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(900), 'Member', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(103)::text || '/m.pdf'), 'error');
do $$
begin
  perform public.tlog('a plain member cannot read requests', (select count(*) from public.join_requests) = 0);
end $$;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('a person reads only his own request', (select count(*) from public.join_requests) = 1);
end $$;
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('the admin reads all requests', (select count(*) from public.join_requests) = 2);
end $$;

-- the page switched off closes the door
select public.expect('the admin switches the page off', $q$update public.trees set public_page = false where id = public.u(900)$q$, 'rows=1');
select public.as_user(public.u(107), 'g1@t.test');
select public.expect('page off: no new requests',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(510), public.u(900), 'Late', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(107)::text || '/late.pdf'), 'error');
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin switches the page on again', $q$update public.trees set public_page = true where id = public.u(900)$q$, 'rows=1');
select public.as_user(public.u(107), 'g1@t.test');
select public.expect('page on again: the same request is accepted',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(510), public.u(900), 'Late', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(107)::text || '/late.pdf'), 'rows=1');

-- ---------- deciding ----------
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('a member cannot decide', $q$select public.decide_join_request(public.u(500), true, 'ok')$q$, 'error');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('the person cannot decide his own request', $q$select public.decide_join_request(public.u(500), true, 'ok')$q$, 'error');
select public.expect('the document path cannot be forgotten while open', $q$select public.forget_join_doc(public.u(500))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...it is still there (the request is open)', (select doc_path from public.join_requests where id = public.u(500)) is not null);
end $$;

select public.as_user(public.u(101), 'a1@t.test');
do $$
declare p text;
begin
  p := public.decide_join_request(public.u(500), true, 'welcome');
  perform public.tlog('the admin approves and gets the document path back', p = public.u(105)::text || '/' || public.u(500)::text || '.pdf');
  perform public.tlog('...the person is now a reader of the tree', (select role from public.tree_members where tree_id = public.u(900) and user_id = public.u(105)) = 'viewer');
  perform public.tlog('...the request records who and when', (select status = 'approved' and decided_by = public.u(101) and decided_at is not null and decision_note = 'welcome' from public.join_requests where id = public.u(500)));
end $$;
select public.expect('a request cannot be decided twice', $q$select public.decide_join_request(public.u(500), false, 'no')$q$, 'error');
select public.expect('the admin forgets the document path', $q$select public.forget_join_doc(public.u(500))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...it is cleared', (select doc_path from public.join_requests where id = public.u(500)) is null);
end $$;

-- the second request: rejected
do $$
declare id2 uuid := (select id from public.join_requests where user_id = public.u(106));
begin
  perform public.decide_join_request(id2, false, 'cannot verify');
  perform public.tlog('rejecting adds nobody', (select count(*) from public.tree_members where user_id = public.u(106)) = 0);
  perform public.tlog('...and keeps the note', (select decision_note from public.join_requests where id = id2) = 'cannot verify');
end $$;

-- ---------- the person withdraws / the daily limit ----------
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('after a rejection the person may ask again',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(520), public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(106)::text || '/r3.pdf'), 'rows=1');
select public.expect('...and withdraws it', $q$select public.cancel_join_request(public.u(520))$q$, 'rows=1');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('nobody withdraws another person''s request', $q$select public.cancel_join_request(public.u(520))$q$, 'error');
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('a third request in a day is still accepted',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(521), public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(106)::text || '/r4.pdf'), 'rows=1');
select public.expect('...withdrawn again', $q$select public.cancel_join_request(public.u(521))$q$, 'rows=1');
select public.expect('a fourth request in a day is refused',
  format($q$insert into public.join_requests (id, tree_id, full_name, relation, phone, contact_email, doc_path)
     values (public.u(522), public.u(900), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', %L)$q$, public.u(106)::text || '/r5.pdf'), 'error');

-- =====================================================================
-- The document bucket
-- =====================================================================
reset role;
delete from public.join_requests where user_id = public.u(106);
insert into public.join_requests (id, tree_id, user_id, full_name, relation, phone, contact_email, doc_path)
values (public.u(530), public.u(900), public.u(106), 'Visitor Two', 'a relation text that is long enough', '+49 170 1234567', 'v@example.com', public.u(106)::text || '/doc.pdf');
set local role authenticated;
select public.as_user(public.u(106), 'f1@t.test');
select public.expect('a person uploads into his own folder',
  format($q$insert into storage.objects (bucket_id, name, owner) values ('join-docs', %L, public.u(106))$q$, public.u(106)::text || '/doc.pdf'), 'rows=1');
select public.expect('...not into another person''s folder',
  format($q$insert into storage.objects (bucket_id, name, owner) values ('join-docs', %L, public.u(106))$q$, public.u(105)::text || '/doc.pdf'), 'error');
do $$
begin
  perform public.tlog('the person reads his document', (select count(*) from storage.objects where bucket_id = 'join-docs') = 1);
end $$;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('another person cannot read it', (select count(*) from storage.objects where bucket_id = 'join-docs') = 0);
end $$;
select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('a plain member cannot read it', (select count(*) from storage.objects where bucket_id = 'join-docs') = 0);
end $$;
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('the admin reads the document of an open request', (select count(*) from storage.objects where bucket_id = 'join-docs') = 1);
end $$;
-- Supabase refuses DELETE statements on storage tables (only the Storage API may delete), so the delete
-- rule cannot be exercised from SQL: check that the policy is installed, it is used by the app through the API
do $$
begin
  perform public.tlog('the delete policy of the bucket is installed',
    exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'join_docs_delete'));
end $$;
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot upload to another bucket path outside any folder', $q$insert into storage.objects (bucket_id, name, owner) values ('join-docs', 'loose.pdf', public.u(105))$q$, 'error');

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
