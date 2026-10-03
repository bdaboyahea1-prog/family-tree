-- =====================================================================
-- Self-test for 012: a request to join without a document, a city, a phone or an e-mail
-- Run in the SQL Editor AFTER 012_optional_fields.sql. It creates fake data, tries it, then ROLLS
-- EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated, anon;
grant usage on sequence public.t_results_n_seq to authenticated, anon;

create table public.t_ctx (k text primary key, v text);
alter table public.t_ctx disable row level security;
grant all on public.t_ctx to authenticated, anon;

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

-- a visitor sends the form from the network address p_ip. '' means: left empty.
-- (the name of the request is 'Visitor <ip>', so that a request can be found again)
create function public.submit3(p_ip text, p_email text, p_phone text, p_ext text, p_city text) returns jsonb
language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  return public.submit_join_request(public.u(900), 'Visitor ' || p_ip, 'I am the grandson of Root, my father is KidOne',
    'DE', p_city, p_phone, p_email, p_ext, '');
end $$;

-- the id of the request sent from p_ip (read as the database owner)
create function public.req_of(p_ip text) returns public.join_requests
language sql stable as $$ select r from public.join_requests r where full_name = 'Visitor ' || p_ip order by created_at limit 1 $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text), public.submit3(text, text, text, text, text), public.req_of(text) to authenticated, anon;

insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'),
  (public.u(102), 'm1@t.test'),
  (public.u(103), 'laila@example.com');
insert into public.trees (id, name, public_page) values (public.u(900), 'Test family', true);
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer');

-- ---------------------------------------------------------------------
-- A) the form
-- ---------------------------------------------------------------------
set local role anon;

do $$
declare r jsonb := public.submit3('10.1.0.1', 'nodoc@example.com', '+49 170 1234567', '', '');
begin
  perform public.tlog('no document, no city: the form is accepted', (r ->> 'code') ~ '^[0-9a-f]{32}$');
  perform public.tlog('...and there is no upload path to give', (r ->> 'path') is null);
  perform public.tlog('...the request is open to the admin at once (pending)', public.join_status(r ->> 'code') ->> 'status' = 'pending');
  insert into public.t_ctx values ('nodoc_code', r ->> 'code');
end $$;
do $$
begin
  perform public.tlog('a null document is the same as none', (public.submit3('10.1.0.2', 'nodoc2@example.com', '+49 170 1234567', null, 'Berlin') ->> 'path') is null);
  perform public.tlog('with a document the old way still works (a path is given)',
    (public.submit3('10.1.0.3', 'doc@example.com', '+49 170 1234567', 'pdf', 'Berlin') ->> 'path') like 'req/%.pdf');
end $$;
select public.expect('a document type that is not allowed is still refused', $q$select public.submit3('10.1.0.4', 'zip@example.com', '+49 170 1234567', 'zip', 'Berlin')$q$, 'error');
select public.expect('a second open request for the same e-mail is still refused', $q$select public.submit3('10.1.0.5', 'nodoc@example.com', '+49 170 1234567', '', '')$q$, 'error');

-- neither a phone nor an e-mail
do $$
declare r jsonb := public.submit3('10.1.0.6', '', '', '', '');
begin
  perform public.tlog('no phone and no e-mail: the form is accepted', (r ->> 'code') ~ '^[0-9a-f]{32}$');
  perform public.tlog('...and it is open to the admin (pending)', public.join_status(r ->> 'code') ->> 'status' = 'pending');
  perform public.tlog('...nothing is asked of it yet (no e-mail needed while pending)', (public.join_status(r ->> 'code') ->> 'needs_email')::boolean = false);
  insert into public.t_ctx values ('nc_code', r ->> 'code');
end $$;
do $$
declare
  a jsonb := public.submit3('10.1.0.7', 'onlymail@example.com', '', '', 'Berlin');
  b jsonb := public.submit3('10.1.0.8', '', '+49 170 7654321', '', '');
  c jsonb := public.submit3('10.1.0.9', '   ', '   ', '', '');
begin
  perform public.tlog('an e-mail without a phone is fine', (a ->> 'code') ~ '^[0-9a-f]{32}$');
  perform public.tlog('a phone without an e-mail is fine', (b ->> 'code') ~ '^[0-9a-f]{32}$');
  perform public.tlog('spaces only count as nothing', (c ->> 'code') ~ '^[0-9a-f]{32}$');
  insert into public.t_ctx values ('mail_only_code', a ->> 'code'), ('phone_only_code', b ->> 'code');
end $$;
select public.expect('an e-mail that is not an e-mail is refused', $q$select public.submit3('10.1.0.10', 'nope', '', '', '')$q$, 'error');
select public.expect('a phone that is not a phone is refused', $q$select public.submit3('10.1.0.11', '', 'abc', '', '')$q$, 'error');

-- the limits still hold for a request that has no e-mail: five a day from one address
do $$
begin
  for i in 1..5 loop
    perform public.submit3('10.1.0.20', '', '', '', '');
  end loop;
end $$;
select public.expect('the sixth request of the day from one address is refused (also without an e-mail)', $q$select public.submit3('10.1.0.20', '', '', '', '')$q$, 'error');

reset role;
do $$
begin
  perform public.tlog('stored: the first one has no document path and no city and is pending',
    (select doc_path is null and residence_city is null and status = 'pending' from public.req_of('10.1.0.1')));
  perform public.tlog('stored: the one with a document waits as a draft', (select status = 'draft' and doc_path like 'req/%' from public.req_of('10.1.0.3')));
  perform public.tlog('stored: no phone and no e-mail are real NULLs, not empty text',
    (select phone is null and contact_email is null from public.req_of('10.1.0.6')));
  perform public.tlog('stored: spaces became NULL too', (select phone is null and contact_email is null from public.req_of('10.1.0.9')));
  perform public.tlog('stored: the e-mail is kept in small letters', (select contact_email = 'onlymail@example.com' from public.req_of('10.1.0.7')));
end $$;

-- ---------------------------------------------------------------------
-- B) the admin decides
-- ---------------------------------------------------------------------
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
do $$
declare
  d1 jsonb := public.decide_join_request((public.req_of('10.1.0.1')).id, true, 'welcome');
  d2 jsonb := public.decide_join_request((public.req_of('10.1.0.6')).id, true, null);
begin
  perform public.tlog('approving a request with an e-mail: no document to delete and an invitation is made', (d1 ->> 'doc_path') is null and (d1 ->> 'invite_code') ~ '^[0-9a-f]{16}$');
  perform public.tlog('approving a request WITHOUT an e-mail works and makes no invitation yet', (d2 ->> 'doc_path') is null and (d2 ->> 'invite_code') is null);
  perform public.decide_join_request((public.req_of('10.1.0.7')).id, false, 'not clear');
  perform public.tlog('the request without contact is now approved', (select status = 'approved' and invite_code is null from public.join_requests where id = (public.req_of('10.1.0.6')).id));
end $$;
reset role;
set local role anon;
select public.expect('a visitor cannot decide a request', $q$select public.decide_join_request((public.req_of('10.1.0.8')).id, true, 'x')$q$, 'error');

-- ---------------------------------------------------------------------
-- C) approved without an e-mail: the person writes one with the tracking code
-- ---------------------------------------------------------------------
do $$
declare
  s jsonb := public.join_status((select v from public.t_ctx where k = 'nc_code'));
  w jsonb := public.join_status((select v from public.t_ctx where k = 'nodoc_code'));
begin
  perform public.tlog('the page of the person without contact says: approved, an e-mail is needed',
    s ->> 'status' = 'approved' and (s ->> 'needs_email')::boolean and (s ->> 'invite_code') is null and not (s ->> 'claimed')::boolean);
  perform public.tlog('...while the one who gave an e-mail gets the invitation at once and is not asked',
    w ->> 'status' = 'approved' and not (w ->> 'needs_email')::boolean and (w ->> 'invite_code') ~ '^[0-9a-f]{16}$');
end $$;

select public.expect('a wrong tracking code claims nothing', $q$select public.claim_join_invite(repeat('0', 32), 'x@example.com')$q$, 'error');
select public.expect('a tracking code that is not a code claims nothing', $q$select public.claim_join_invite('abc', 'x@example.com')$q$, 'error');
select public.expect('an e-mail that is not an e-mail is refused', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'nc_code'), 'nope')$q$, 'error');
select public.expect('a request still waiting cannot claim', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'phone_only_code'), 'x@example.com')$q$, 'error');
select public.expect('a refused request cannot claim', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'mail_only_code'), 'x@example.com')$q$, 'error');
select public.expect('a request that has its own e-mail cannot be redirected to another one', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'nodoc_code'), 'x@example.com')$q$, 'error');
select public.expect('someone who is already a member cannot take an invitation', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'nc_code'), 'm1@t.test')$q$, 'error');

-- the first try has a typing mistake, the second is right
do $$
declare
  c1 text := public.claim_join_invite((select v from public.t_ctx where k = 'nc_code'), '  Typo@Example.com ');
  s1 jsonb := public.join_status((select v from public.t_ctx where k = 'nc_code'));
begin
  perform public.tlog('claiming gives an invitation code', c1 ~ '^[0-9a-f]{16}$');
  perform public.tlog('...the page now shows it, the e-mail in small letters, and "claimed"',
    s1 ->> 'invite_code' = c1 and s1 ->> 'contact_email' = 'typo@example.com' and (s1 ->> 'claimed')::boolean and not (s1 ->> 'needs_email')::boolean);
  insert into public.t_ctx values ('inv1', c1);
end $$;
do $$
declare
  c2 text := public.claim_join_invite((select v from public.t_ctx where k = 'nc_code'), 'laila@example.com');
  s2 jsonb := public.join_status((select v from public.t_ctx where k = 'nc_code'));
begin
  perform public.tlog('the e-mail can be corrected: a new invitation', c2 ~ '^[0-9a-f]{16}$' and c2 <> (select v from public.t_ctx where k = 'inv1'));
  perform public.tlog('...and the page shows the new one only', s2 ->> 'invite_code' = c2 and s2 ->> 'contact_email' = 'laila@example.com');
  insert into public.t_ctx values ('inv2', c2);
end $$;

reset role;
do $$
begin
  perform public.tlog('the invitation of the wrong e-mail was switched off',
    (select not enabled from public.tree_invites where code = (select v from public.t_ctx where k = 'inv1')));
  perform public.tlog('the new invitation is for the right e-mail, a reader, in this tree, made in the name of the deciding admin',
    (select enabled and email = 'laila@example.com' and role = 'viewer' and tree_id = public.u(900) and created_by = public.u(101) and max_uses = 1 and uses = 0
       from public.tree_invites where code = (select v from public.t_ctx where k = 'inv2')));
  perform public.tlog('the request keeps both facts', (select contact_email = 'laila@example.com' and invite_claimed and invite_code = (select v from public.t_ctx where k = 'inv2')
       from public.req_of('10.1.0.6')));
  perform public.tlog('the refused try for a member left the good invitation untouched',
    (select enabled from public.tree_invites where code = (select v from public.t_ctx where k = 'inv2')));
end $$;

-- ---------------------------------------------------------------------
-- D) the person registers
-- ---------------------------------------------------------------------
set local role authenticated;
select public.as_user(public.u(102), 'm1@t.test');
select public.expect('another e-mail cannot use the invitation', $q$select public.join_tree((select v from public.t_ctx where k = 'inv2'))$q$, 'error');
select public.as_user(public.u(103), 'laila@example.com');
select public.expect('the right e-mail opens the tree with it', $q$select public.join_tree((select v from public.t_ctx where k = 'inv2'))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...as a reader', (select role from public.tree_members where tree_id = public.u(900) and user_id = public.u(103)) = 'viewer');
end $$;

reset role;
set local role anon;
do $$
declare s jsonb := public.join_status((select v from public.t_ctx where k = 'nc_code'));
begin
  perform public.tlog('afterwards the page says registered and gives no link', (s ->> 'registered')::boolean and (s ->> 'invite_code') is null);
end $$;
select public.expect('and the e-mail can no longer be changed', $q$select public.claim_join_invite((select v from public.t_ctx where k = 'nc_code'), 'other@example.com')$q$, 'error');

-- ---------------------------------------------------------------------
-- E) what a visitor still cannot do
-- ---------------------------------------------------------------------
select public.expect('a visitor cannot read the requests', $q$select 1 from public.join_requests$q$, 'error');
select public.expect('a visitor cannot write to the table directly',
  $q$insert into public.join_requests (tree_id, full_name, relation) values (public.u(900), 'Direct', 'direct insert without the function')$q$, 'error');

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
