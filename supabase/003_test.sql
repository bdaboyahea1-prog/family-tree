-- =====================================================================
-- Self-test for 003_branch_levels_and_email_invites.sql
--
-- Run it in the Supabase SQL Editor AFTER the migration.
-- It creates fake users and a fake tree, tries to break the rules as each user,
-- and then ROLLS EVERYTHING BACK: nothing stays in your database.
-- The red "error" at the end is on purpose (it cancels the test data and shows
-- the report). Every line of the report should start with PASS.
-- =====================================================================

begin;

-- ---------- helpers (rolled back with everything else) ----------
create function public.tlog(p_name text, p_ok boolean) returns void
language plpgsql as $$
begin
  perform set_config('ft.res',
    coalesce(current_setting('ft.res', true), '') || case when p_ok then 'PASS  ' else 'FAIL  ' end || p_name || E'\n', true);
end $$;

-- runs a statement as the current role; returns 'rows=N' or 'error'
create function public.try_sql(p_sql text) returns text
language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'rows=' || n;
exception when others then
  return 'error';
end $$;

-- small ids:  u(3) = 00000000-0000-0000-0000-000000000003
create function public.u(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- pretend to be a signed-in user with this e-mail
create function public.as_user(p_id uuid, p_email text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.u(int),
  public.as_user(uuid, text) to authenticated;

-- ---------- fake data ----------
-- users: 101 admin, 102 branch reader (direct grant), 103 invitee of S, 104 invitee of X (by 103), 105 invitee of O
insert into auth.users (id, email) values
  (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(103), 'i1@t.test'),
  (public.u(104), 'j1@t.test'), (public.u(105), 'k1@t.test');

insert into public.trees (id, name) values (public.u(900), 'test tree');
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'),
  (public.u(900), public.u(102), 'viewer');

-- G(1) -> S(2) -> X(3) -> Y(4) ; X -> D(7) daughter ; G -> O(5) ; W(6) = wife of S
insert into public.persons (id, tree_id, first_name, gender, father_id) values
  (public.u(1), public.u(900), 'G', 'male',   null),
  (public.u(2), public.u(900), 'S', 'male',   public.u(1)),
  (public.u(3), public.u(900), 'X', 'male',   public.u(2)),
  (public.u(4), public.u(900), 'Y', 'male',   public.u(3)),
  (public.u(5), public.u(900), 'O', 'male',   public.u(1)),
  (public.u(7), public.u(900), 'D', 'female', public.u(3));
insert into public.persons (id, tree_id, first_name, gender) values (public.u(6), public.u(900), 'W', 'female');
insert into public.marriages (tree_id, person_a, person_b) values (public.u(900), public.u(2), public.u(6));

-- 102 holds add+edit+delete on S (no "grant")
insert into public.branch_grants (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
values (public.u(900), public.u(102), public.u(2), true, true, true, false, public.u(101));

-- =====================================================================
-- 102: branch reader with add+edit+delete on S
-- =====================================================================
set local role authenticated;
select public.as_user(public.u(102), 'b1@t.test');

select public.tlog('102 edits below the head (X)',            public.try_sql($q$update public.persons set first_name='X2' where id = public.u(3)$q$) = 'rows=1');
select public.tlog('102 cannot edit the head card (S)',       public.try_sql($q$update public.persons set first_name='h' where id = public.u(2)$q$) = 'rows=0');
select public.tlog('102 cannot edit above the head (G)',      public.try_sql($q$update public.persons set first_name='h' where id = public.u(1)$q$) = 'rows=0');
select public.tlog('102 cannot edit another branch (O)',      public.try_sql($q$update public.persons set first_name='h' where id = public.u(5)$q$) = 'rows=0');
select public.tlog('102 cannot edit the head''s wife (W)',    public.try_sql($q$update public.persons set first_name='h' where id = public.u(6)$q$) = 'rows=0');
select public.tlog('102 adds a child under the head',         public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'N1', 'male', public.u(2))$q$) = 'rows=1');
select public.tlog('102 cannot add a child under G',          public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'N2', 'male', public.u(1))$q$) = 'error');
select public.tlog('102 cannot add a child under O',          public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'N3', 'male', public.u(5))$q$) = 'error');
select public.tlog('102 adds a wife for a descendant',        public.try_sql($q$insert into public.persons (id, tree_id, first_name, gender) values (public.u(10), public.u(900), 'NW', 'female')$q$) = 'rows=1');
select public.tlog('102 records that marriage',               public.try_sql($q$insert into public.marriages (tree_id, person_a, person_b) values (public.u(900), public.u(3), public.u(10))$q$) = 'rows=1');
select public.tlog('102 cannot add a wife to the head',       public.try_sql($q$insert into public.marriages (tree_id, person_a, person_b) values (public.u(900), public.u(2), public.u(10))$q$) = 'error');
select public.tlog('102 cannot delete someone with children (X)', public.try_sql($q$delete from public.persons where id = public.u(3)$q$) = 'rows=0');
select public.tlog('102 deletes a leaf (Y)',                  public.try_sql($q$delete from public.persons where id = public.u(4)$q$) = 'rows=1');
select public.tlog('102 cannot delete the head (S)',          public.try_sql($q$delete from public.persons where id = public.u(2)$q$) = 'rows=0');
select public.tlog('102 cannot move X under another branch',  public.try_sql($q$update public.persons set father_id = public.u(5) where id = public.u(3)$q$) = 'error');
select public.tlog('102 cannot detach D from the tree',       public.try_sql($q$update public.persons set father_id = null where id = public.u(7)$q$) = 'error');
select public.tlog('102 cannot forge created_by',             public.try_sql($q$update public.persons set created_by = public.u(102) where id = public.u(3)$q$) = 'error');
select public.tlog('102 cannot write grants directly',        public.try_sql($q$insert into public.branch_grants (tree_id, user_id, person_id) values (public.u(900), public.u(102), public.u(5))$q$) = 'error');
select public.tlog('102 cannot edit own grant directly',      public.try_sql($q$update public.branch_grants set can_grant = true$q$) = 'error');
select public.tlog('102 (no "grant" right) cannot invite to a branch',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(3), 'x@t.test', true, false, false, false)$q$) = 'error');
select public.tlog('102 cannot create whole-tree invites',    public.try_sql($q$select public.create_invite(public.u(900), 'x@t.test', 'editor')$q$) = 'error');
select public.tlog('102 cannot grant rights to others',       public.try_sql($q$select public.grant_branch(public.u(900), public.u(102), public.u(3), true, false, false, false)$q$) = 'error');

-- =====================================================================
-- 101: admin creates e-mail invitations
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');

select public.tlog('admin: invalid e-mail is refused',       public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(2), 'not-an-email', true, false, false, false)$q$) = 'error');
select public.tlog('admin: empty e-mail is refused',         public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(2), '', true, false, false, false)$q$) = 'error');
select public.tlog('admin: an invite with no rights is refused', public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(2), 'i1@t.test', false, false, false, false)$q$) = 'error');
select public.tlog('admin: whole-tree invite needs an e-mail', public.try_sql($q$select public.create_invite(public.u(900), '', 'viewer')$q$) = 'error');
select public.tlog('admin: whole-tree invite by e-mail',     public.try_sql($q$select public.create_invite(public.u(900), 'Someone@T.test ', 'viewer')$q$) = 'rows=1');

do $$
begin
  -- 103 gets S with add+edit+grant (no delete); 105 gets O with add only
  perform set_config('ft.c103', public.create_branch_invite(public.u(900), public.u(2), ' I1@T.test ', true, true, false, true), true);
  perform set_config('ft.c105', public.create_branch_invite(public.u(900), public.u(5), 'k1@t.test', true, false, false, false), true);
  perform public.tlog('admin: creates branch invites', current_setting('ft.c103', true) is not null and current_setting('ft.c105', true) is not null);
end $$;

select public.tlog('admin cannot redeem someone else''s invite',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c103'))) = 'error');

-- =====================================================================
-- 105: invited for O (add only). Also tries 103's invite and gets refused.
-- =====================================================================
select public.as_user(public.u(105), 'k1@t.test');

select public.tlog('105 cannot use an invite made for another e-mail',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c103'))) = 'error');
select public.tlog('105 cannot guess a wrong code',           public.try_sql($q$select public.join_tree('0000000000000000')$q$) = 'error');
select public.tlog('105 redeems his own invite',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c105'))) = 'rows=1');
select public.tlog('105 cannot redeem it twice (single use)',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c105'))) = 'error');
select public.tlog('105 adds a child under O (add right)',    public.try_sql($q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(20), public.u(900), 'K1', 'male', public.u(5))$q$) = 'rows=1');
select public.tlog('105 cannot edit that child (no edit right)', public.try_sql($q$update public.persons set first_name='z' where id = public.u(20)$q$) = 'rows=0');
select public.tlog('105 cannot delete it (no delete right)',  public.try_sql($q$delete from public.persons where id = public.u(20)$q$) = 'rows=0');
select public.tlog('105 cannot edit O itself',                public.try_sql($q$update public.persons set first_name='z' where id = public.u(5)$q$) = 'rows=0');
select public.tlog('105 cannot add under S (another branch)', public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'K2', 'male', public.u(2))$q$) = 'error');
select public.tlog('105 (no "grant") cannot invite',          public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(20), 'q@t.test', true, false, false, false)$q$) = 'error');
do $$
declare n int;
begin
  select count(*) into n from public.tree_members where user_id = public.u(105) and role = 'viewer';
  perform public.tlog('105 became a reader of the tree', n = 1);
  select count(*) into n from public.persons;
  perform public.tlog('105 can read the whole tree (' || n || ' persons)', n >= 8);
end $$;

-- =====================================================================
-- 103: invited for S with add+edit+grant (delegate)
-- =====================================================================
select public.as_user(public.u(103), 'i1@t.test');

select public.tlog('103 redeems the invite (e-mail typed with other casing)',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c103'))) = 'rows=1');
select public.tlog('103 edits below the head (X)',            public.try_sql($q$update public.persons set first_name='X3' where id = public.u(3)$q$) = 'rows=1');
select public.tlog('103 adds a child under X',                public.try_sql($q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(30), public.u(900), 'I1', 'male', public.u(3))$q$) = 'rows=1');
select public.tlog('103 cannot delete (no delete right)',     public.try_sql($q$delete from public.persons where id = public.u(30)$q$) = 'rows=0');
select public.tlog('103 cannot edit the head card (S)',       public.try_sql($q$update public.persons set first_name='h' where id = public.u(2)$q$) = 'rows=0');
select public.tlog('103 cannot edit above (G)',               public.try_sql($q$update public.persons set first_name='h' where id = public.u(1)$q$) = 'rows=0');
select public.tlog('103 cannot edit another branch (O)',      public.try_sql($q$update public.persons set first_name='h' where id = public.u(5)$q$) = 'rows=0');

-- delegation
select public.tlog('103 cannot invite onto his own head card (S)',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(2), 'j1@t.test', true, false, false, false)$q$) = 'error');
select public.tlog('103 cannot invite above his branch (G)',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(1), 'j1@t.test', true, false, false, false)$q$) = 'error');
select public.tlog('103 cannot invite into another branch (O)',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(5), 'j1@t.test', true, false, false, false)$q$) = 'error');
select public.tlog('103 cannot pass on a right he does not hold (delete)',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(3), 'j1@t.test', true, false, true, false)$q$) = 'error');
select public.tlog('103 cannot create whole-tree invites',
  public.try_sql($q$select public.create_invite(public.u(900), 'j1@t.test', 'editor')$q$) = 'error');
do $$
begin
  perform set_config('ft.c104', public.create_branch_invite(public.u(900), public.u(3), 'j1@t.test', true, false, false, false), true);
  perform public.tlog('103 invites j1 onto X with add only', current_setting('ft.c104', true) is not null);
end $$;
select public.tlog('103 may pass on add+edit+grant below him',
  public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(3), 'm1@t.test', true, true, false, true)$q$) = 'rows=1');
select public.tlog('103 cannot hand out rights to a member on another branch',
  public.try_sql($q$select public.grant_branch(public.u(900), public.u(102), public.u(5), true, false, false, false)$q$) = 'error');

-- =====================================================================
-- 104: invited by 103 for X (add only)
-- =====================================================================
select public.as_user(public.u(104), 'j1@t.test');

select public.tlog('104 redeems 103''s invite',
  public.try_sql(format($q$select public.join_tree(%L)$q$, current_setting('ft.c104'))) = 'rows=1');
select public.tlog('104 adds a child under X (add right)',    public.try_sql($q$insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(40), public.u(900), 'J1', 'male', public.u(3))$q$) = 'rows=1');
select public.tlog('104 cannot edit it (no edit right)',      public.try_sql($q$update public.persons set first_name='z' where id = public.u(40)$q$) = 'rows=0');
select public.tlog('104 cannot edit X itself',                public.try_sql($q$update public.persons set first_name='z' where id = public.u(3)$q$) = 'rows=0');
select public.tlog('104 cannot add under S (above his head)', public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'J2', 'male', public.u(2))$q$) = 'error');
select public.tlog('104 cannot invite (no grant right)',      public.try_sql($q$select public.create_branch_invite(public.u(900), public.u(40), 'w@t.test', true, false, false, false)$q$) = 'error');

-- =====================================================================
-- 103 again: manage what he gave
-- =====================================================================
select public.as_user(public.u(103), 'i1@t.test');

select public.tlog('103 cannot revoke a grant given by the admin',
  public.try_sql($q$select public.revoke_branch(public.u(900), public.u(102), public.u(2))$q$) = 'error');
select public.tlog('103 gives an existing reader (102) add rights on X',
  public.try_sql($q$select public.grant_branch(public.u(900), public.u(102), public.u(3), true, false, false, false)$q$) = 'rows=1');
select public.tlog('103 revokes what he gave (102 on X)',
  public.try_sql($q$select public.revoke_branch(public.u(900), public.u(102), public.u(3))$q$) = 'rows=1');
select public.tlog('103 revokes 104 (given through his invite)',
  public.try_sql($q$select public.revoke_branch(public.u(900), public.u(104), public.u(3))$q$) = 'rows=1');

select public.as_user(public.u(104), 'j1@t.test');
select public.tlog('104 lost his right after the revoke',    public.try_sql($q$insert into public.persons (tree_id, first_name, gender, father_id) values (public.u(900), 'J3', 'male', public.u(3))$q$) = 'error');

-- =====================================================================
-- 101: admin overrides
-- =====================================================================
select public.as_user(public.u(101), 'a1@t.test');

do $$
declare n int; m int;
begin
  select count(*) into n from public.tree_invites where email = 'i1@t.test' and enabled = false and uses = 1 and used_by = public.u(103);
  perform public.tlog('admin sees 103''s invite used up and closed', n = 1);
  select count(*) into m from public.tree_invites where email is null;
  perform public.tlog('no invite without an e-mail exists', m = 0);
  select count(*) into n from public.branch_grants;
  perform public.tlog('admin sees every grant (' || n || ')', n >= 3);
end $$;
select public.tlog('admin cannot insert an invite without e-mail',
  public.try_sql($q$insert into public.tree_invites (tree_id, role) values (public.u(900), 'viewer')$q$) = 'error');
select public.tlog('admin revokes 103',                       public.try_sql($q$select public.revoke_branch(public.u(900), public.u(103), public.u(2))$q$) = 'rows=1');
select public.tlog('admin grants 102 full rights on O',       public.try_sql($q$select public.grant_branch(public.u(900), public.u(102), public.u(5), true, true, true, true)$q$) = 'rows=1');

select public.as_user(public.u(103), 'i1@t.test');
select public.tlog('103 lost everything after the admin revoked him', public.try_sql($q$update public.persons set first_name='x' where id = public.u(3)$q$) = 'rows=0');

-- =====================================================================
-- report (raising the error cancels the whole transaction)
-- =====================================================================
reset role;
do $$
declare
  r text := coalesce(current_setting('ft.res', true), '(no results)');
  fails int := (length(r) - length(replace(r, 'FAIL', ''))) / 4;
  passes int := (length(r) - length(replace(r, 'PASS', ''))) / 4;
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
