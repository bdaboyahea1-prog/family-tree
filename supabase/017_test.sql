-- =====================================================================
-- Self-test for 017: the owner of a tree
-- Run in the SQL Editor AFTER 017_owner.sql. It creates fake data, tries it, then ROLLS
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

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text) to authenticated;

-- ---------- fake data ----------
-- users: 101 the owner (an admin), 102 a second admin, 103 a plain member, 105 a stranger
insert into auth.users (id, email) values
  (public.u(101), 'o1@t.test'), (public.u(102), 'a2@t.test'), (public.u(103), 'v1@t.test'), (public.u(105), 'e1@t.test');
-- the tree is made by 101 and no owner is written: the trigger fills it in
insert into public.trees (id, name, created_by) values (public.u(900), 'test tree', public.u(101));
insert into public.tree_members (tree_id, user_id, role, joined_at) values
  (public.u(900), public.u(101), 'admin',  '2020-01-01'),
  (public.u(900), public.u(102), 'admin',  '2021-01-01'),
  (public.u(900), public.u(103), 'viewer', '2022-01-01');

do $$
begin
  perform public.tlog('a new tree gets its owner from the trigger (the one who made it)', (select owner_id from public.trees where id = public.u(900)) = public.u(101));
end $$;

set local role authenticated;

-- =====================================================================
-- The second admin cannot touch the owner
-- =====================================================================
select public.as_user(public.u(102), 'a2@t.test');
select public.expect('another admin cannot lower the owner to editor', $q$update public.tree_members set role = 'editor' where tree_id = public.u(900) and user_id = public.u(101)$q$, 'error');
select public.expect('...nor to reader', $q$update public.tree_members set role = 'viewer' where tree_id = public.u(900) and user_id = public.u(101)$q$, 'error');
select public.expect('another admin cannot remove the owner', $q$delete from public.tree_members where tree_id = public.u(900) and user_id = public.u(101)$q$, 'error');
select public.expect('another admin cannot write the owner of the tree', $q$update public.trees set owner_id = public.u(102) where id = public.u(900)$q$, 'error');
select public.expect('another admin cannot hand the tree over to themselves', $q$select public.transfer_ownership(public.u(900), public.u(102))$q$, 'error');
-- ... and everything else an admin could do is still allowed
select public.expect('the second admin still changes the role of an ordinary member', $q$update public.tree_members set role = 'editor' where tree_id = public.u(900) and user_id = public.u(103)$q$, 'rows=1');
select public.expect('...and back', $q$update public.tree_members set role = 'viewer' where tree_id = public.u(900) and user_id = public.u(103)$q$, 'rows=1');
select public.expect('the second admin still renames the tree', $q$update public.trees set name = 'renamed' where id = public.u(900)$q$, 'rows=1');
do $$
declare v uuid;
begin
  v := public.create_tree('the second admin''s own tree');
  perform public.tlog('a tree made through create_tree is owned by whoever made it', (select owner_id from public.trees where id = v) = public.u(102));
end $$;

-- =====================================================================
-- The owner: protected even from themselves
-- =====================================================================
select public.as_user(public.u(101), 'o1@t.test');
select public.expect('the owner cannot lower their own role', $q$update public.tree_members set role = 'editor' where tree_id = public.u(900) and user_id = public.u(101)$q$, 'error');
select public.expect('the owner cannot leave the tree (hand it over first)', $q$delete from public.tree_members where tree_id = public.u(900) and user_id = public.u(101)$q$, 'error');
select public.expect('the owner cannot write the owner of the tree directly', $q$update public.trees set owner_id = public.u(102) where id = public.u(900)$q$, 'error');
select public.expect('the owner cannot hand the tree to a reader', $q$select public.transfer_ownership(public.u(900), public.u(103))$q$, 'error');
select public.expect('...nor to a stranger', $q$select public.transfer_ownership(public.u(900), public.u(105))$q$, 'error');
select public.expect('the owner still removes an ordinary member', $q$delete from public.tree_members where tree_id = public.u(900) and user_id = public.u(103)$q$, 'rows=1');

-- a reader cannot take the tree
select public.as_user(public.u(103), 'v1@t.test');
select public.expect('a reader cannot take the tree', $q$select public.transfer_ownership(public.u(900), public.u(103))$q$, 'error');

-- =====================================================================
-- Handing the tree over
-- =====================================================================
select public.as_user(public.u(101), 'o1@t.test');
select public.expect('the owner hands the tree to the second admin', $q$select public.transfer_ownership(public.u(900), public.u(102))$q$, 'rows=1');
do $$
begin
  perform public.tlog('...and the new owner is written', (select owner_id from public.trees where id = public.u(900)) = public.u(102));
end $$;

select public.as_user(public.u(102), 'a2@t.test');
select public.expect('the new owner cannot lower their own role', $q$update public.tree_members set role = 'editor' where tree_id = public.u(900) and user_id = public.u(102)$q$, 'error');
select public.expect('the former owner is now an ordinary admin: the new owner can lower them', $q$update public.tree_members set role = 'editor' where tree_id = public.u(900) and user_id = public.u(101)$q$, 'rows=1');
select public.as_user(public.u(101), 'o1@t.test');
select public.expect('...and as an editor they cannot touch the new owner (nothing changes)', $q$update public.tree_members set role = 'viewer' where tree_id = public.u(900) and user_id = public.u(102)$q$, 'rows=0');
select public.expect('...nor take the tree back', $q$select public.transfer_ownership(public.u(900), public.u(101))$q$, 'error');

select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot hand over a tree they know nothing of', $q$select public.transfer_ownership(public.u(900), public.u(105))$q$, 'error');

-- =====================================================================
-- The owner of the trees that already exist (the update of the migration, run again on made-up trees)
-- =====================================================================
reset role;
insert into public.trees (id, name, created_by) values (public.u(901), 'old tree A', public.u(102)), (public.u(902), 'old tree B', public.u(105));
insert into public.tree_members (tree_id, user_id, role, joined_at) values
  (public.u(901), public.u(102), 'admin',  '2021-01-01'),
  (public.u(901), public.u(103), 'admin',  '2020-01-01'),
  (public.u(902), public.u(102), 'admin',  '2021-06-01'),
  (public.u(902), public.u(103), 'admin',  '2020-06-01');
update public.trees set owner_id = null where id in (public.u(901), public.u(902));

-- the very statement of 017_owner.sql
update public.trees t
   set owner_id = coalesce(
         (select m.user_id from public.tree_members m
           where m.tree_id = t.id and m.user_id = t.created_by and m.role = 'admin'),
         (select m.user_id from public.tree_members m
           where m.tree_id = t.id and m.role = 'admin'
           order by m.joined_at, m.user_id limit 1))
 where t.owner_id is null;

do $$
begin
  perform public.tlog('an existing tree: the owner is the one who made it, when they are still an admin (even if another admin joined earlier)', (select owner_id from public.trees where id = public.u(901)) = public.u(102));
  perform public.tlog('an existing tree whose maker is not a member: the admin who joined first', (select owner_id from public.trees where id = public.u(902)) = public.u(103));
end $$;

-- =====================================================================
-- Deleting a whole tree still works (its members, the owner included, go with it)
-- =====================================================================
select public.expect('the whole tree can still be deleted (by the database owner)', $q$delete from public.trees where id = public.u(901)$q$, 'rows=1');

do $$
declare
  r text := coalesce((select string_agg(line, E'\n' order by n) from public.t_results), '(no results)');
  fails int := (select count(*) from public.t_results where line like 'FAIL%');
  passes int := (select count(*) from public.t_results where line like 'PASS%');
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
