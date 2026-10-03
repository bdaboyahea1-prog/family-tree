-- =====================================================================
-- Self-test for 011: asking to join without an account
-- Run in the SQL Editor AFTER 011_join_without_account.sql. It creates fake data, tries the rules,
-- then ROLLS EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- Every line should start with PASS. Lines starting with INFO are diagnostics.
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated, anon;
grant usage on sequence public.t_results_n_seq to authenticated, anon;

-- values remembered between steps (the codes the visitor was given)
create table public.t_ctx (k text primary key, v text);
alter table public.t_ctx disable row level security;
grant all on public.t_ctx to authenticated, anon;

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

-- a visitor from this network address sends the form (the address is what the daily limit looks at)
create function public.submit(p_ip text, p_email text, p_ext text default 'pdf', p_hp text default '') returns jsonb
language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  return public.submit_join_request(public.u(900), 'Visitor ' || p_email, 'I am the grandson of Root, my father is KidOne',
    'DE', 'Berlin', '+49 170 1234567', p_email, p_ext, p_hp);
end $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text), public.submit(text, text, text, text) to authenticated, anon;

-- ---------- fake data ----------
-- users: 101 admin, 103 a member, 105 a signed-in stranger, 108 the person who will be accepted
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(103), 'c1@t.test'), (public.u(105), 'e1@t.test'), (public.u(108), 'applicant@example.com');
insert into public.trees (id, name) values (public.u(900), 'Test family');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(103), 'viewer');
insert into public.persons (id, tree_id, first_name, gender) values (public.u(1), public.u(900), 'Root', 'male');

-- =====================================================================
-- A visitor sends the form
-- =====================================================================
set local role anon;
select public.expect('page off: the form is refused', $q$select public.submit('10.0.0.1', 'applicant@example.com')$q$, 'error');

reset role;
update public.trees set public_page = true where id = public.u(900);
set local role anon;

select public.expect('a visitor cannot read the requests', $q$select count(*) from public.join_requests$q$, 'error');
select public.expect('a visitor cannot write the requests directly',
  $q$insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path) values (public.u(900), 'x', 'a relation text long enough', '+49 170 1234567', 'x@example.com', 'req/x.pdf')$q$, 'error');

do $$
declare r jsonb := public.submit('10.0.0.1', 'Applicant@Example.com');
begin
  insert into public.t_ctx values ('id', r ->> 'id'), ('code', r ->> 'code'), ('path', r ->> 'path');
  perform public.tlog('page on: the form is accepted and gives an id, a secret code and a path',
    (r ->> 'id') is not null and (r ->> 'code') ~ '^[0-9a-f]{32}$' and (r ->> 'path') = 'req/' || (r ->> 'id') || '.pdf');
end $$;

select public.expect('a draft cannot be confirmed before the document is uploaded',
  $q$select public.confirm_join_doc((select v::uuid from public.t_ctx where k = 'id'), (select v from public.t_ctx where k = 'code'))$q$, 'error');

-- the upload goes to the exact path of the draft, once
select public.expect('a visitor cannot upload a file to a path of his own choosing',
  $q$insert into storage.objects (bucket_id, name) values ('join-docs', 'req/anything.pdf')$q$, 'error');
select public.expect('...nor outside the bucket folder', $q$insert into storage.objects (bucket_id, name) values ('join-docs', 'loose.pdf')$q$, 'error');
select public.expect('the visitor uploads the document to the path he was given',
  $q$insert into storage.objects (bucket_id, name) select 'join-docs', v from public.t_ctx where k = 'path'$q$, 'rows=1');
select public.expect('...a second file at the same path is refused',
  $q$insert into storage.objects (bucket_id, name) select 'join-docs', v from public.t_ctx where k = 'path'$q$, 'error');
do $$
begin
  perform public.tlog('a visitor cannot read the documents, not even his own', (select count(*) from storage.objects where bucket_id = 'join-docs') = 0);
end $$;

select public.expect('the wrong code cannot confirm',
  $q$select public.confirm_join_doc((select v::uuid from public.t_ctx where k = 'id'), repeat('0', 32))$q$, 'error');
select public.expect('the right code confirms: the request is opened to the admin',
  $q$select public.confirm_join_doc((select v::uuid from public.t_ctx where k = 'id'), (select v from public.t_ctx where k = 'code'))$q$, 'rows=1');
select public.expect('after that nothing more can be uploaded for it',
  $q$insert into storage.objects (bucket_id, name) values ('join-docs', 'req/' || (select v from public.t_ctx where k = 'id') || '.png')$q$, 'error');

do $$
declare s jsonb := public.join_status((select v from public.t_ctx where k = 'code'));
begin
  perform public.tlog('the secret code shows the request as pending', s ->> 'status' = 'pending' and s ->> 'full_name' like 'Visitor%');
  perform public.tlog('...with no invitation yet', s -> 'invite_code' = 'null'::jsonb and (s ->> 'registered')::boolean = false);
  perform public.tlog('a made-up code shows nothing', public.join_status(repeat('a', 32)) is null);
  perform public.tlog('...and so does a code of the wrong shape', public.join_status('x'' or 1=1 --') is null and public.join_status(null) is null);
end $$;

-- ---------- the limits ----------
select public.expect('a second request while one is open for the e-mail is refused', $q$select public.submit('10.0.0.2', 'applicant@example.com')$q$, 'error');
select public.expect('a member of the tree cannot ask again', $q$select public.submit('10.0.0.3', 'c1@t.test')$q$, 'error');
select public.expect('a document type that is not allowed is refused', $q$select public.submit('10.0.0.4', 'zip@example.com', 'zip')$q$, 'error');
select public.expect('a bad e-mail is refused', $q$select public.submit('10.0.0.5', 'nope')$q$, 'error');

reset role;
do $$
begin
  perform set_config('t.before', (select count(*) from public.join_requests)::text, false);
end $$;
set local role anon;
select public.expect('a robot that fills the hidden field is answered as if it worked', $q$select public.submit('10.0.0.6', 'robot@example.com', 'pdf', 'http://spam.example')$q$, 'rows=1');
reset role;
do $$
begin
  perform public.tlog('...and nothing is kept', (select count(*) from public.join_requests)::text = current_setting('t.before'));
end $$;
set local role anon;

-- the same e-mail three times a day (drafts do not block each other), the fourth is refused
select public.expect('the same e-mail: form 1', $q$select public.submit('10.0.1.1', 'again@example.com')$q$, 'rows=1');
select public.expect('...form 2', $q$select public.submit('10.0.1.2', 'again@example.com')$q$, 'rows=1');
select public.expect('...form 3', $q$select public.submit('10.0.1.3', 'again@example.com')$q$, 'rows=1');
select public.expect('...form 4 is refused (3 a day for one e-mail)', $q$select public.submit('10.0.1.4', 'again@example.com')$q$, 'error');

-- one network address: five a day
select public.expect('one address: form 1', $q$select public.submit('10.0.2.2', 'ip1@example.com')$q$, 'rows=1');
select public.expect('one address: form 2', $q$select public.submit('10.0.2.2', 'ip2@example.com')$q$, 'rows=1');
select public.expect('one address: form 3', $q$select public.submit('10.0.2.2', 'ip3@example.com')$q$, 'rows=1');
select public.expect('one address: form 4', $q$select public.submit('10.0.2.2', 'ip4@example.com')$q$, 'rows=1');
select public.expect('one address: form 5', $q$select public.submit('10.0.2.2', 'ip5@example.com')$q$, 'rows=1');
select public.expect('one address: form 6 is refused', $q$select public.submit('10.0.2.2', 'ip6@example.com')$q$, 'error');

-- =====================================================================
-- The admin decides
-- =====================================================================
reset role;
set local role authenticated;
select public.as_user(public.u(105), 'e1@t.test');
do $$
begin
  perform public.tlog('a signed-in stranger sees no requests', (select count(*) from public.join_requests) = 0);
end $$;
select public.expect('...cannot decide', $q$select public.decide_join_request((select v::uuid from public.t_ctx where k = 'id'), true, 'ok')$q$, 'error');
select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('a plain member sees no requests', (select count(*) from public.join_requests) = 0);
end $$;
select public.expect('...cannot decide', $q$select public.decide_join_request((select v::uuid from public.t_ctx where k = 'id'), true, 'ok')$q$, 'error');

select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('the admin sees the requests', (select count(*) from public.join_requests where status = 'pending') = 1);
end $$;
select public.expect('the admin reads the document',
  $q$select 1 from storage.objects where bucket_id = 'join-docs' and name = (select v from public.t_ctx where k = 'path') having count(*) = 1$q$, 'rows=1');
select public.expect('...a draft whose document never came is not opened to him as pending',
  $q$select 1 from public.join_requests where status = 'draft' and doc_uploaded$q$, 'rows=0');

do $$
declare d jsonb;
begin
  d := public.decide_join_request((select v::uuid from public.t_ctx where k = 'id'), true, 'welcome');
  insert into public.t_ctx values ('invite', d ->> 'invite_code');
  perform public.tlog('approving gives back the document path and an invitation code', d ->> 'doc_path' = (select v from public.t_ctx where k = 'path') and (d ->> 'invite_code') ~ '^[0-9a-f]{16}$');
  perform public.tlog('...the invitation is for the e-mail of the form, as a reader, single use',
    (select email = 'applicant@example.com' and role = 'viewer' and enabled and max_uses = 1 and uses = 0 and tree_id = public.u(900) from public.tree_invites where code = d ->> 'invite_code'));
  perform public.tlog('...the request records who decided', (select status = 'approved' and decided_by = public.u(101) and invite_code = d ->> 'invite_code' from public.join_requests where id = (select v::uuid from public.t_ctx where k = 'id')));
end $$;
select public.expect('a request cannot be decided twice', $q$select public.decide_join_request((select v::uuid from public.t_ctx where k = 'id'), false, 'no')$q$, 'error');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger tries to make the database forget the document', $q$select public.forget_join_doc((select v::uuid from public.t_ctx where k = 'id'))$q$, 'rows=1');
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('...and it is still there (checked as the admin: a stranger cannot read requests)', (select doc_path from public.join_requests where id = (select v::uuid from public.t_ctx where k = 'id')) is not null);
end $$;
select public.expect('the admin deletes the document through the storage API (here: the policy exists)',
  $q$select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'join_docs_delete'$q$, 'rows=1');

reset role;
set local role anon;
do $$
declare s jsonb := public.join_status((select v from public.t_ctx where k = 'code'));
begin
  perform public.tlog('the visitor sees: approved, with the invitation to create the account', s ->> 'status' = 'approved' and s ->> 'invite_code' = (select v from public.t_ctx where k = 'invite'));
end $$;

-- the visitor creates the account with that e-mail and uses the invitation
reset role;
set local role authenticated;
select public.as_user(public.u(108), 'applicant@example.com');
select public.expect('the invitation opens the tree for that e-mail', $q$select public.join_tree((select v from public.t_ctx where k = 'invite'))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...as a reader', (select role from public.tree_members where tree_id = public.u(900) and user_id = public.u(108)) = 'viewer');
end $$;
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('...and nobody with another e-mail can use it', $q$select public.join_tree((select v from public.t_ctx where k = 'invite'))$q$, 'error');
reset role;
set local role anon;
do $$
declare s jsonb := public.join_status((select v from public.t_ctx where k = 'code'));
begin
  perform public.tlog('afterwards the status says registered and gives no link', (s ->> 'registered')::boolean and s -> 'invite_code' = 'null'::jsonb);
end $$;

-- ---------- a refusal ----------
reset role;
-- a second visitor whose document is there
select public.as_user(public.u(101), 'a1@t.test');
reset role;
do $$
declare r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.0.5.5')::text, true);
  r := public.submit_join_request(public.u(900), 'Second Visitor', 'a relation text that is long enough', 'DE', 'Berlin', '+49 170 1234567', 'second@example.com', 'pdf', '');
  insert into public.t_ctx values ('id2', r ->> 'id'), ('code2', r ->> 'code');
  insert into storage.objects (bucket_id, name) values ('join-docs', r ->> 'path');
  perform public.confirm_join_doc((r ->> 'id')::uuid, r ->> 'code');
end $$;
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
do $$
declare d jsonb;
begin
  d := public.decide_join_request((select v::uuid from public.t_ctx where k = 'id2'), false, 'cannot verify');
  perform public.tlog('refusing creates no invitation', d -> 'invite_code' = 'null'::jsonb and (select count(*) from public.tree_invites where email = 'second@example.com') = 0);
  perform public.tlog('...and keeps the reason', (select decision_note from public.join_requests where id = (select v::uuid from public.t_ctx where k = 'id2')) = 'cannot verify');
end $$;
select public.expect('the admin forgets the document path after the decision', $q$select public.forget_join_doc((select v::uuid from public.t_ctx where k = 'id2'))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...it is cleared', (select doc_path from public.join_requests where id = (select v::uuid from public.t_ctx where k = 'id2')) is null);
end $$;
reset role;
set local role anon;
do $$
declare s jsonb := public.join_status((select v from public.t_ctx where k = 'code2'));
begin
  perform public.tlog('the refused visitor sees the reason and no link', s ->> 'status' = 'rejected' and s ->> 'decision_note' = 'cannot verify' and s -> 'invite_code' = 'null'::jsonb);
end $$;

-- ---------- the hourly circuit breaker ----------
reset role;
insert into public.join_requests (tree_id, full_name, relation, phone, contact_email, doc_path, status, client_hash, created_at)
select public.u(900), 'Flood ' || g, 'a relation text that is long enough', '+49 170 1234567', 'flood' || g || '@example.com', 'req/flood' || g || '.pdf', 'draft', 'h' || g, now()
from generate_series(1, 30) g;
set local role anon;
select public.expect('more than 30 requests in an hour are refused for everybody', $q$select public.submit('10.9.9.9', 'late@example.com')$q$, 'error');

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
