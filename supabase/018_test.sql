-- =====================================================================
-- Self-test for 018: the family chat room
-- Run in the SQL Editor AFTER 018_chat.sql. It creates fake data, tries it, then ROLLS
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
-- users: 101 admin (the owner), 102 reader, 103 reader, 104 reader (for the speed test), 105 stranger
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'c1@t.test'), (public.u(104), 'd1@t.test'), (public.u(105), 'e1@t.test');
insert into public.trees (id, name, created_by) values (public.u(900), 'test tree', public.u(101));
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer'),
  (public.u(900), public.u(103), 'viewer'),
  (public.u(900), public.u(104), 'viewer');
-- a second tree, with its own member, to prove the rooms are separate
insert into public.trees (id, name, created_by) values (public.u(901), 'other tree', public.u(105));
insert into public.tree_members (tree_id, user_id, role) values (public.u(901), public.u(105), 'admin');

set local role authenticated;

-- =====================================================================
-- Writing: every member, as themselves
-- =====================================================================
select public.as_user(public.u(102), 'b1@t.test');
select public.expect('a reader writes a message', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), 'السلام عليكم')$q$, 'rows=1');
do $$
begin
  perform public.tlog('the message is written as the one who sent it (user_id filled in)', (select user_id from public.tree_messages where body = 'السلام عليكم') = public.u(102));
end $$;
select public.expect('a message of exactly 1000 letters is accepted', format($q$insert into public.tree_messages (tree_id, body) values (public.u(900), %L)$q$, repeat('أ', 1000)), 'rows=1');
select public.expect('a message of 1001 letters is refused', format($q$insert into public.tree_messages (tree_id, body) values (public.u(900), %L)$q$, repeat('أ', 1001)), 'error');
select public.expect('an empty message is refused', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), '')$q$, 'error');
select public.expect('a message of only spaces is refused', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), E'  \n  ')$q$, 'error');
select public.expect('nobody writes in the name of somebody else', $q$insert into public.tree_messages (tree_id, user_id, body) values (public.u(900), public.u(103), 'مزيّفة')$q$, 'error');
select public.expect('nobody writes in a tree they are not a member of', $q$insert into public.tree_messages (tree_id, body) values (public.u(901), 'من خارج الغرفة')$q$, 'error');

select public.as_user(public.u(101), 'a1@t.test');
select public.expect('the admin writes too', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), 'أهلًا بكم')$q$, 'rows=1');

select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot write in this room', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), 'اقتحام')$q$, 'error');
select public.expect('...and cannot read it (nothing comes back)', $q$select * from public.tree_messages where tree_id = public.u(900)$q$, 'rows=0');
select public.expect('...but reads the messages of their own tree (none yet)', $q$select * from public.tree_messages where tree_id = public.u(901)$q$, 'rows=0');

-- =====================================================================
-- Reading: all the members see all the messages
-- =====================================================================
select public.as_user(public.u(103), 'c1@t.test');
do $$
begin
  perform public.tlog('another reader sees all three messages of the room', (select count(*) from public.tree_messages where tree_id = public.u(900)) = 3);
end $$;

-- =====================================================================
-- Deleting: one's own, or any one for an admin; no editing at all
-- =====================================================================
select public.expect('a reader cannot delete the message of somebody else (nothing changes)', $q$delete from public.tree_messages where body = 'السلام عليكم'$q$, 'rows=0');
select public.expect('a message cannot be edited', $q$update public.tree_messages set body = 'عُدّلت' where body = 'السلام عليكم'$q$, 'error');

select public.as_user(public.u(102), 'b1@t.test');
select public.expect('the author deletes their own message', $q$delete from public.tree_messages where body = 'السلام عليكم'$q$, 'rows=1');

select public.as_user(public.u(101), 'a1@t.test');
select public.expect('an admin deletes the message of a reader', format($q$delete from public.tree_messages where body = %L$q$, repeat('أ', 1000)), 'rows=1');

select public.as_user(public.u(105), 'e1@t.test');
select public.expect('a stranger cannot delete anything of this room (nothing changes)', $q$delete from public.tree_messages where tree_id = public.u(900)$q$, 'rows=0');

-- =====================================================================
-- The speed bump: 10 messages a minute
-- =====================================================================
select public.as_user(public.u(104), 'd1@t.test');
do $$
declare i int;
begin
  for i in 1..10 loop
    insert into public.tree_messages (tree_id, body) values (public.u(900), 'رسالة ' || i);
  end loop;
  perform public.tlog('ten messages in a minute are accepted', (select count(*) from public.tree_messages where user_id = public.u(104)) = 10);
end $$;
select public.expect('the eleventh in the same minute is refused', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), 'الحادية عشرة')$q$, 'error');
select public.as_user(public.u(103), 'c1@t.test');
select public.expect('...while somebody else can still write', $q$insert into public.tree_messages (tree_id, body) values (public.u(900), 'أنا أكتب')$q$, 'rows=1');

-- =====================================================================
-- When people leave, and when the tree goes
-- =====================================================================
reset role;
select public.expect('an author who is no longer a user: their messages stay', $q$delete from auth.users where id = public.u(104)$q$, 'rows=1');
do $$
begin
  perform public.tlog('...with an empty author', (select count(*) from public.tree_messages where user_id is null and body like 'رسالة %') = 10);
end $$;
select public.expect('deleting the tree takes its messages with it', $q$delete from public.trees where id = public.u(900)$q$, 'rows=1');
do $$
begin
  perform public.tlog('...none of them is left', (select count(*) from public.tree_messages where tree_id = public.u(900)) = 0);
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
