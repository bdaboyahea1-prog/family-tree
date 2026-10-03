-- =====================================================================
-- Self-test for 013: an invitation link that is not tied to an e-mail
-- Run in the SQL Editor AFTER 013_open_invites.sql. It creates fake data, tries it, then ROLLS
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

create function public.ctx(p_k text) returns text language sql stable as $$ select v from public.t_ctx where k = p_k $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text), public.ctx(text) to authenticated, anon;

insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'),
  (public.u(102), 'm1@t.test'),
  (public.u(103), 'new1@example.com'),
  (public.u(104), 'new2@example.com'),
  (public.u(105), 'e1@t.test'),
  (public.u(106), 'bound@example.com');
insert into public.trees (id, name) values (public.u(900), 'Test family');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer');

-- ---------------------------------------------------------------------
-- A) who may make a link
-- ---------------------------------------------------------------------
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');

do $$
declare
  c1 text := public.create_open_invite(public.u(900), '  Brother in Germany  ');
  c2 text := public.create_open_invite(public.u(900), repeat('x', 300));
  c3 text := public.create_open_invite(public.u(900));
begin
  perform public.tlog('the admin makes a link: a 16-character code', c1 ~ '^[0-9a-f]{16}$');
  insert into public.t_ctx values ('open1', c1), ('open_long', c2), ('open_none', c3);
  perform public.tlog('...with no e-mail, open, a reader of the whole tree, once, made by the admin, label trimmed',
    (select email is null and any_email and role = 'viewer' and branch_person_id is null and max_uses = 1 and uses = 0 and enabled
            and created_by = public.u(101) and label = 'Brother in Germany'
       from public.tree_invites where code = c1));
  perform public.tlog('a very long label is cut to 100 characters', (select char_length(label) = 100 from public.tree_invites where code = c2));
  perform public.tlog('no label is stored as NULL', (select label is null from public.tree_invites where code = c3));
end $$;

select public.as_user(public.u(102), 'm1@t.test');
select public.expect('a plain member cannot make a link', $q$select public.create_open_invite(public.u(900), 'x')$q$, 'error');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot make a link', $q$select public.create_open_invite(public.u(900), 'x')$q$, 'error');
reset role;
set local role anon;
select public.expect('a visitor cannot make a link', $q$select public.create_open_invite(public.u(900), 'x')$q$, 'error');
reset role;

-- the limit: 30 unused links at a time
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  for i in 1..27 loop
    perform public.create_open_invite(public.u(900), 'bulk ' || i);
  end loop;
end $$;
select public.expect('the 31st unused link is refused', $q$select public.create_open_invite(public.u(900), 'one too many')$q$, 'error');

-- ---------------------------------------------------------------------
-- B) using a link
-- ---------------------------------------------------------------------
select public.as_user(public.u(102), 'm1@t.test');
select public.expect('somebody who is already a member is told so', $q$select public.join_tree(public.ctx('open_long'))$q$, 'error');
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('...and the link is NOT used up by that',
    (select enabled and uses = 0 and used_by is null from public.tree_invites where code = public.ctx('open_long')));
end $$;

select public.as_user(public.u(103), 'new1@example.com');
select public.expect('the first person opens the link with their own e-mail and enters', $q$select public.join_tree(public.ctx('open1'))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...as a reader of that tree', (select role = 'viewer' from public.tree_members where tree_id = public.u(900) and user_id = public.u(103)));
end $$;
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  perform public.tlog('...the admin sees who used it, and the link is closed',
    (select used_by = public.u(103) and uses = 1 and not enabled from public.tree_invites where code = public.ctx('open1')));
end $$;
select public.as_user(public.u(104), 'new2@example.com');
select public.expect('a second person cannot use the same link', $q$select public.join_tree(public.ctx('open1'))$q$, 'error');
select public.expect('another link works with another e-mail', $q$select public.join_tree(public.ctx('open_long'))$q$, 'rows=1');

-- ---------------------------------------------------------------------
-- C) cancelling, and what nobody can edit
-- ---------------------------------------------------------------------
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin cannot turn an invitation into an open one by editing it', $q$update public.tree_invites set any_email = true where code = public.ctx('open_none')$q$, 'error');
select public.expect('...nor change the role of a link', $q$update public.tree_invites set role = 'editor' where code = public.ctx('open_none')$q$, 'error');
select public.expect('...nor put an e-mail on it', $q$update public.tree_invites set email = 'x@example.com' where code = public.ctx('open_none')$q$, 'error');
select public.expect('...but can cancel it', $q$update public.tree_invites set enabled = false where code = public.ctx('open_none')$q$, 'rows=1');
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a cancelled link no longer opens the tree', $q$select public.join_tree(public.ctx('open_none'))$q$, 'error');
select public.expect('a code that does not exist opens nothing', $q$select public.join_tree('0000000000000000')$q$, 'error');

-- ---------------------------------------------------------------------
-- D) invitations tied to an e-mail still work as before
-- ---------------------------------------------------------------------
select public.as_user(public.u(101), 'a1@t.test');
do $$
begin
  insert into public.t_ctx values ('bound', public.create_invite(public.u(900), 'bound@example.com', 'viewer'));
end $$;
select public.as_user(public.u(105), 'e1@t.test');
select public.expect('an e-mail invitation still refuses another e-mail', $q$select public.join_tree(public.ctx('bound'))$q$, 'error');
select public.as_user(public.u(106), 'bound@example.com');
select public.expect('...and accepts its own', $q$select public.join_tree(public.ctx('bound'))$q$, 'rows=1');

-- ---------------------------------------------------------------------
-- E) the shape rules of the table itself (checked as the database owner)
-- ---------------------------------------------------------------------
reset role;
select public.expect('no e-mail and not an open link: refused', $q$insert into public.tree_invites (tree_id, role, email) values (public.u(900), 'viewer', null)$q$, 'error');
select public.expect('an open link for an editor: refused', $q$insert into public.tree_invites (tree_id, role, email, any_email) values (public.u(900), 'editor', null, true)$q$, 'error');
select public.expect('an open link that also has an e-mail: refused', $q$insert into public.tree_invites (tree_id, role, email, any_email) values (public.u(900), 'viewer', 'x@example.com', true)$q$, 'error');
select public.expect('an open link usable twice: refused', $q$insert into public.tree_invites (tree_id, role, email, any_email, max_uses) values (public.u(900), 'viewer', null, true, 2)$q$, 'error');
select public.expect('an open link for one person is accepted by the table', $q$insert into public.tree_invites (tree_id, role, email, any_email) values (public.u(900), 'viewer', null, true)$q$, 'rows=1');

do $$
declare
  r text := coalesce((select string_agg(line, E'\n' order by n) from public.t_results), '(no results)');
  fails int := (select count(*) from public.t_results where line like 'FAIL%');
  passes int := (select count(*) from public.t_results where line like 'PASS%');
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
