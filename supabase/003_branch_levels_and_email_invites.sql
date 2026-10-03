-- =====================================================================
-- 003: permission LEVELS per branch + invitations tied to ONE email address
-- (run after 002_branch_permissions.sql, once)
--
--  * Every invitation is for a specific e-mail address. There are no open links:
--    the link only works for a signed-in user whose e-mail matches, and it is
--    used up after the first successful redemption.
--  * A branch invitation carries the rights the person will get on that card's
--    branch:  add  /  edit  /  delete  /  grant (hand out rights below them).
--  * A user holding "grant" on a branch may invite people and give rights on the
--    branches BELOW theirs, never more than they hold and never on their own head
--    card or above it.
--  * The branch head's own card and everything above it stay untouchable for them.
--
-- Everything is enforced by Row Level Security / SECURITY DEFINER functions.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------

alter table public.branch_grants
  add column can_add    boolean not null default true,
  add column can_edit   boolean not null default true,
  add column can_delete boolean not null default true,
  add column can_grant  boolean not null default false;

alter table public.tree_invites
  add column branch_person_id uuid,
  add column email            text check (email is null or char_length(email) <= 254),
  add column can_add          boolean not null default true,
  add column can_edit         boolean not null default true,
  add column can_delete       boolean not null default false,
  add column can_grant        boolean not null default false,
  add column max_uses         int not null default 1 check (max_uses > 0),
  add column uses             int not null default 0,
  add column used_by          uuid references auth.users (id) on delete set null,
  add constraint tree_invites_branch_fk
    foreign key (branch_person_id, tree_id) references public.persons (id, tree_id) on delete cascade;

-- Old open links (no e-mail) are removed, and no new one can ever be created.
delete from public.tree_invites where email is null;
alter table public.tree_invites
  add constraint tree_invites_email_required check (email is not null);


-- ---------------------------------------------------------------------
-- 2) Remove what 002 created and this file replaces
-- ---------------------------------------------------------------------

drop policy persons_insert   on public.persons;
drop policy persons_update   on public.persons;
drop policy persons_delete   on public.persons;
drop policy marriages_insert on public.marriages;
drop policy marriages_update on public.marriages;
drop policy marriages_delete on public.marriages;
drop policy grants_select    on public.branch_grants;
drop policy grants_insert    on public.branch_grants;
drop policy grants_delete    on public.branch_grants;
drop policy invites_select   on public.tree_invites;
drop policy invites_update   on public.tree_invites;
drop policy invites_delete   on public.tree_invites;

drop function public.can_write_person(uuid, uuid, uuid, uuid, uuid);
drop function public.can_write_marriage(uuid, uuid, uuid);
drop function public.married_in_scope(uuid, uuid);
drop function public.in_my_branch(uuid, uuid);
drop function public.under_my_grant(uuid, uuid);
drop function public.has_grants(uuid);
drop function public.create_invite(uuid, text);


-- ---------------------------------------------------------------------
-- 3) Scope helpers. p_flag is one of 'add' | 'edit' | 'delete' | 'grant'
-- ---------------------------------------------------------------------

-- Does the current user hold this right on at least one branch of the tree?
create function public.has_grants(p_tree uuid, p_flag text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.branch_grants g
    where g.tree_id = p_tree and g.user_id = (select auth.uid())
      and case p_flag when 'add' then g.can_add when 'edit' then g.can_edit
                      when 'delete' then g.can_delete when 'grant' then g.can_grant else false end
  );
$$;

-- Walk up the chart from p_start (inclusive): is it, or is it below, a person on which
-- the current user holds this right?
create function public.under_my_grant(p_tree uuid, p_start uuid, p_flag text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  with recursive up (id, nxt) as (
    select p.id, coalesce(p.father_id, p.mother_id)
    from public.persons p
    where p.id = p_start and p.tree_id = p_tree
    union
    select p.id, coalesce(p.father_id, p.mother_id)
    from public.persons p
    join up on p.id = up.nxt
  )
  select exists (
    select 1
    from up
    join public.branch_grants g on g.person_id = up.id
    where g.user_id = (select auth.uid()) and g.tree_id = p_tree
      and case p_flag when 'add' then g.can_add when 'edit' then g.can_edit
                      when 'delete' then g.can_delete when 'grant' then g.can_grant else false end
  );
$$;

-- STRICTLY below such a person (the head itself is not "in" the branch).
create function public.in_my_branch(p_tree uuid, p_person uuid, p_flag text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.under_my_grant(
    p_tree,
    (select coalesce(father_id, mother_id) from public.persons where id = p_person and tree_id = p_tree),
    p_flag
  );
$$;

-- A married-in person (no parents recorded) who belongs to my branch: created by me,
-- or the spouse of someone in my branch.
create function public.married_in_scope(p_tree uuid, p_person uuid, p_flag text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.persons x
    where x.id = p_person and x.tree_id = p_tree
      and x.father_id is null and x.mother_id is null
      and (
        (x.created_by = (select auth.uid()) and public.has_grants(p_tree, p_flag))
        or exists (
          select 1 from public.marriages m
          where m.tree_id = p_tree
            and ((m.person_a = x.id and public.in_my_branch(p_tree, m.person_b, p_flag))
              or (m.person_b = x.id and public.in_my_branch(p_tree, m.person_a, p_flag)))
        )
      )
  );
$$;

-- May the current user write this person row with this right (existing values on
-- UPDATE/DELETE, proposed values on INSERT/UPDATE)?
create function public.can_write_person(
  p_tree uuid, p_id uuid, p_father uuid, p_mother uuid, p_created_by uuid, p_flag text
)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_role text := public.tree_role(p_tree);
  v_lp   uuid := coalesce(p_father, p_mother);   -- who the person hangs under
begin
  if v_role in ('admin', 'editor') then
    return true;
  end if;
  if v_role is null or not public.has_grants(p_tree, p_flag) then
    return false;
  end if;

  if v_lp is not null then
    return public.under_my_grant(p_tree, v_lp, p_flag) or public.married_in_scope(p_tree, v_lp, p_flag);
  end if;

  return p_created_by = (select auth.uid())
      or exists (
        select 1 from public.marriages m
        where m.tree_id = p_tree
          and ((m.person_a = p_id and public.in_my_branch(p_tree, m.person_b, p_flag))
            or (m.person_b = p_id and public.in_my_branch(p_tree, m.person_a, p_flag)))
      );
end;
$$;

create function public.can_write_marriage(p_tree uuid, p_a uuid, p_b uuid, p_flag text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_role text := public.tree_role(p_tree);
begin
  if v_role in ('admin', 'editor') then
    return true;
  end if;
  if v_role is null or not public.has_grants(p_tree, p_flag) then
    return false;
  end if;
  return public.in_my_branch(p_tree, p_a, p_flag) or public.in_my_branch(p_tree, p_b, p_flag);
end;
$$;

-- Can the current user hand out these rights on this person's branch?
--   admin  -> yes, anywhere.
--   reader -> only on persons STRICTLY below a card where they hold "grant", and each
--             right they pass on must be one they hold there.
create function public.can_delegate(
  p_tree uuid, p_person uuid, p_add boolean, p_edit boolean, p_delete boolean, p_grant boolean
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.tree_role(p_tree) = 'admin' then true
    when public.tree_role(p_tree) is distinct from 'viewer' then false
    else (
      with recursive up (id, nxt) as (
        select p.id, coalesce(p.father_id, p.mother_id)
        from public.persons p
        where p.tree_id = p_tree
          and p.id = (select coalesce(father_id, mother_id) from public.persons where id = p_person and tree_id = p_tree)
        union
        select p.id, coalesce(p.father_id, p.mother_id)
        from public.persons p
        join up on p.id = up.nxt
      ),
      cov as (
        select g.can_add, g.can_edit, g.can_delete, g.can_grant
        from up
        join public.branch_grants g on g.person_id = up.id
        where g.user_id = (select auth.uid()) and g.tree_id = p_tree and g.can_grant
      )
      select exists (select 1 from cov)
         and (not p_add    or exists (select 1 from cov where can_add))
         and (not p_edit   or exists (select 1 from cov where can_edit))
         and (not p_delete or exists (select 1 from cov where can_delete))
         and (not p_grant  or exists (select 1 from cov where can_grant))
    )
  end;
$$;

-- (person_has_children(uuid) already exists from 002 and is unchanged)


-- ---------------------------------------------------------------------
-- 4) Invitations: always for one e-mail address, single use
-- ---------------------------------------------------------------------

-- Lower-cases / trims and rejects things that are not an e-mail address.
create function public.norm_email(p_email text)
returns text
language plpgsql immutable
as $$
declare
  v text := lower(trim(coalesce(p_email, '')));
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v) > 254 then
    raise exception 'invalid email';
  end if;
  return v;
end;
$$;

-- Admin: invite an e-mail address to the whole tree as 'editor' or 'viewer'.
create function public.create_invite(p_tree uuid, p_email text, p_role text default 'viewer')
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if public.tree_role(p_tree) is distinct from 'admin' then
    raise exception 'admins only';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role';
  end if;

  insert into public.tree_invites (tree_id, role, email, created_by)
  values (p_tree, p_role, public.norm_email(p_email), auth.uid())
  returning code into v_code;
  return v_code;
end;
$$;

-- Invite an e-mail address as a reader who may edit the branch under p_person.
-- Admins can do this for any card; readers holding "grant" only for cards below theirs.
create function public.create_branch_invite(
  p_tree uuid, p_person uuid, p_email text,
  p_add boolean, p_edit boolean, p_delete boolean, p_grant boolean
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (p_add or p_edit or p_delete or p_grant) then
    raise exception 'choose at least one right';
  end if;
  if not public.can_delegate(p_tree, p_person, p_add, p_edit, p_delete, p_grant) then
    raise exception 'not allowed to grant these rights on this card';
  end if;

  insert into public.tree_invites
    (tree_id, role, email, branch_person_id, can_add, can_edit, can_delete, can_grant, created_by)
  values
    (p_tree, 'viewer', public.norm_email(p_email), p_person, p_add, p_edit, p_delete, p_grant, auth.uid())
  returning code into v_code;
  return v_code;
end;
$$;

-- Redeem an invitation. Works only for the e-mail it was issued to, once.
-- Existing members keep their role (never downgraded).
create or replace function public.join_tree(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_inv   public.tree_invites%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role  text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_inv
  from public.tree_invites
  where code = trim(p_code) and enabled and uses < max_uses
  for update;

  if not found then
    raise exception 'invalid or disabled invite';
  end if;
  if v_inv.email is null or v_inv.email <> v_email then
    raise exception 'invite is for another email';
  end if;

  insert into public.tree_members (tree_id, user_id, role)
  values (v_inv.tree_id, auth.uid(), v_inv.role)
  on conflict (tree_id, user_id) do nothing;

  select role into v_role from public.tree_members where tree_id = v_inv.tree_id and user_id = auth.uid();

  if v_inv.branch_person_id is not null and v_role = 'viewer' then
    insert into public.branch_grants
      (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
    values
      (v_inv.tree_id, auth.uid(), v_inv.branch_person_id,
       v_inv.can_add, v_inv.can_edit, v_inv.can_delete, v_inv.can_grant, v_inv.created_by)
    on conflict (user_id, person_id) do update set
      can_add    = public.branch_grants.can_add    or excluded.can_add,
      can_edit   = public.branch_grants.can_edit   or excluded.can_edit,
      can_delete = public.branch_grants.can_delete or excluded.can_delete,
      can_grant  = public.branch_grants.can_grant  or excluded.can_grant;
  end if;

  update public.tree_invites
  set uses = uses + 1, used_by = auth.uid(), enabled = (uses + 1 < max_uses)
  where code = v_inv.code;

  return v_inv.tree_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5) Grants for people who are already members
-- ---------------------------------------------------------------------

-- Give (or change) the rights of an existing reader on the branch under p_person.
create function public.grant_branch(
  p_tree uuid, p_user uuid, p_person uuid,
  p_add boolean, p_edit boolean, p_delete boolean, p_grant boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_existing public.branch_grants%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_delegate(p_tree, p_person, p_add, p_edit, p_delete, p_grant) then
    raise exception 'not allowed to grant these rights on this card';
  end if;
  if not exists (select 1 from public.tree_members where tree_id = p_tree and user_id = p_user and role = 'viewer') then
    raise exception 'the member must have the reader role';
  end if;

  select * into v_existing from public.branch_grants where user_id = p_user and person_id = p_person;
  if found and public.tree_role(p_tree) <> 'admin' and v_existing.created_by is distinct from auth.uid() then
    raise exception 'this grant was given by someone else';
  end if;

  insert into public.branch_grants
    (tree_id, user_id, person_id, can_add, can_edit, can_delete, can_grant, created_by)
  values
    (p_tree, p_user, p_person, p_add, p_edit, p_delete, p_grant, auth.uid())
  on conflict (user_id, person_id) do update set
    can_add = excluded.can_add, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_grant = excluded.can_grant;
end;
$$;

-- Take a grant back. Admins: any. Others: only grants they gave themselves.
create function public.revoke_branch(p_tree uuid, p_user uuid, p_person uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.branch_grants
  where tree_id = p_tree and user_id = p_user and person_id = p_person
    and (public.tree_role(p_tree) = 'admin' or created_by = (select auth.uid()));
  if not found then
    raise exception 'nothing to revoke, or not allowed';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 6) Policies
-- ---------------------------------------------------------------------

-- persons: insert = add, update = edit, delete = delete (+ only if nobody hangs under them)
create policy persons_insert on public.persons for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_write_person(tree_id, id, father_id, mother_id, created_by, 'add')
  );

create policy persons_update on public.persons for update to authenticated
  using      (public.can_write_person(tree_id, id, father_id, mother_id, created_by, 'edit'))
  with check (public.can_write_person(tree_id, id, father_id, mother_id, created_by, 'edit'));

create policy persons_delete on public.persons for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
    or (
      public.tree_role(tree_id) = 'viewer'
      and public.can_write_person(tree_id, id, father_id, mother_id, created_by, 'delete')
      and not public.person_has_children(id)
    )
  );

create policy marriages_insert on public.marriages for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_write_marriage(tree_id, person_a, person_b, 'add')
  );

create policy marriages_update on public.marriages for update to authenticated
  using      (public.can_write_marriage(tree_id, person_a, person_b, 'edit'))
  with check (public.can_write_marriage(tree_id, person_a, person_b, 'edit'));

create policy marriages_delete on public.marriages for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
    or (public.tree_role(tree_id) = 'viewer'
        and public.can_write_marriage(tree_id, person_a, person_b, 'delete'))
  );

-- grants: visible to the grantee, to whoever gave them, and to admins.
-- Written only through grant_branch / revoke_branch / join_tree.
create policy grants_select on public.branch_grants for select to authenticated
  using (
    user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or public.tree_role(tree_id) = 'admin'
  );
revoke insert, update, delete on public.branch_grants from authenticated;

-- invitations: visible / cancellable by admins and by whoever created them (while still a member)
create policy invites_select on public.tree_invites for select to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (created_by = (select auth.uid()) and public.tree_role(tree_id) is not null)
  );
create policy invites_update on public.tree_invites for update to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (created_by = (select auth.uid()) and public.tree_role(tree_id) is not null)
  )
  with check (
    public.tree_role(tree_id) = 'admin'
    or (created_by = (select auth.uid()) and public.tree_role(tree_id) is not null)
  );
create policy invites_delete on public.tree_invites for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (created_by = (select auth.uid()) and public.tree_role(tree_id) is not null)
  );


-- ---------------------------------------------------------------------
-- 7) Privileges
-- ---------------------------------------------------------------------

revoke all on function public.has_grants(uuid, text)                                        from public, anon;
revoke all on function public.under_my_grant(uuid, uuid, text)                              from public, anon;
revoke all on function public.in_my_branch(uuid, uuid, text)                                from public, anon;
revoke all on function public.married_in_scope(uuid, uuid, text)                            from public, anon;
revoke all on function public.can_write_person(uuid, uuid, uuid, uuid, uuid, text)          from public, anon;
revoke all on function public.can_write_marriage(uuid, uuid, uuid, text)                    from public, anon;
revoke all on function public.can_delegate(uuid, uuid, boolean, boolean, boolean, boolean)  from public, anon;
revoke all on function public.norm_email(text)                                              from public, anon;
revoke all on function public.create_invite(uuid, text, text)                               from public, anon;
revoke all on function public.create_branch_invite(uuid, uuid, text, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.grant_branch(uuid, uuid, uuid, boolean, boolean, boolean, boolean)         from public, anon;
revoke all on function public.revoke_branch(uuid, uuid, uuid)                               from public, anon;

grant execute on function public.has_grants(uuid, text)                                       to authenticated;
grant execute on function public.under_my_grant(uuid, uuid, text)                             to authenticated;
grant execute on function public.in_my_branch(uuid, uuid, text)                               to authenticated;
grant execute on function public.married_in_scope(uuid, uuid, text)                           to authenticated;
grant execute on function public.can_write_person(uuid, uuid, uuid, uuid, uuid, text)         to authenticated;
grant execute on function public.can_write_marriage(uuid, uuid, uuid, text)                   to authenticated;
grant execute on function public.can_delegate(uuid, uuid, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.norm_email(text)                                             to authenticated;
grant execute on function public.create_invite(uuid, text, text)                              to authenticated;
grant execute on function public.create_branch_invite(uuid, uuid, text, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.grant_branch(uuid, uuid, uuid, boolean, boolean, boolean, boolean)         to authenticated;
grant execute on function public.revoke_branch(uuid, uuid, uuid)                              to authenticated;
-- join_tree(text) and person_has_children(uuid) keep the privileges they already had
