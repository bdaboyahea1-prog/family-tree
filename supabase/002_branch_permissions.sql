-- =====================================================================
-- Branch permissions  (run AFTER schema.sql; safe to run once)
--
-- Idea: a member with the role 'viewer' can be granted a person ("branch head").
-- The user may then add / edit / delete everyone BELOW that person, but never the
-- head's own card, the head's wives, anything above the head, or any other branch.
--
-- "Below" follows the chart (patrilineal):
--   * a child hangs under the father; under the mother only when the father is unknown;
--   * a person is in a branch when any ancestor on that line is a granted person;
--   * married-in people (no parents recorded) count as belonging to the branch when they
--     are the spouse of someone in the branch, or were created by this user;
--   * a branch user may delete a person only if nobody hangs under them
--     (delete from the leaves up, so a whole family is never detached by accident).
--
-- Everything is enforced by Row Level Security, not by the web page.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Grants table
-- ---------------------------------------------------------------------

create table public.branch_grants (
  tree_id    uuid not null,
  user_id    uuid not null,
  person_id  uuid not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, person_id),
  -- the grantee must be a member; removing the member removes the grants
  foreign key (tree_id, user_id) references public.tree_members (tree_id, user_id) on delete cascade,
  -- the branch head must be a person of the same tree; deleting them removes the grants
  foreign key (person_id, tree_id) references public.persons (id, tree_id) on delete cascade
);
create index on public.branch_grants (tree_id);
create index on public.branch_grants (person_id);

alter table public.branch_grants enable row level security;

create policy grants_select on public.branch_grants for select to authenticated
  using (user_id = (select auth.uid()) or public.tree_role(tree_id) = 'admin');
create policy grants_insert on public.branch_grants for insert to authenticated
  with check (public.tree_role(tree_id) = 'admin' and created_by = (select auth.uid()));
create policy grants_delete on public.branch_grants for delete to authenticated
  using (public.tree_role(tree_id) = 'admin');

grant select, insert, delete on public.branch_grants to authenticated;


-- ---------------------------------------------------------------------
-- 2) Helper functions (SECURITY DEFINER so they can read every row)
-- ---------------------------------------------------------------------

-- Does the current user hold at least one branch grant in this tree?
create or replace function public.has_grants(p_tree uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.branch_grants
    where tree_id = p_tree and user_id = (select auth.uid())
  );
$$;

-- Walk up the chart starting at p_start (inclusive): is it, or is it below, a granted person?
create or replace function public.under_my_grant(p_tree uuid, p_start uuid)
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
  );
$$;

-- Is this person STRICTLY below a granted person (the granted person itself does not count)?
create or replace function public.in_my_branch(p_tree uuid, p_person uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.under_my_grant(
    p_tree,
    (select coalesce(father_id, mother_id) from public.persons where id = p_person and tree_id = p_tree)
  );
$$;

-- A person with no recorded parents (married in) who belongs to the branch:
-- created by me, or the spouse of someone in my branch.
create or replace function public.married_in_scope(p_tree uuid, p_person uuid)
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
        x.created_by = (select auth.uid())
        or exists (
          select 1 from public.marriages m
          where m.tree_id = p_tree
            and ((m.person_a = x.id and public.in_my_branch(p_tree, m.person_b))
              or (m.person_b = x.id and public.in_my_branch(p_tree, m.person_a)))
        )
      )
  );
$$;

-- May the current user write this person row (existing values on UPDATE/DELETE,
-- proposed values on INSERT/UPDATE)?
create or replace function public.can_write_person(
  p_tree uuid, p_id uuid, p_father uuid, p_mother uuid, p_created_by uuid
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
  if v_role is null or not public.has_grants(p_tree) then
    return false;
  end if;

  if v_lp is not null then
    -- hangs under a granted person, someone below one, or a married-in spouse of the branch
    return public.under_my_grant(p_tree, v_lp) or public.married_in_scope(p_tree, v_lp);
  end if;

  -- no parents: a person I created, or a spouse of someone in my branch
  return p_created_by = (select auth.uid())
      or exists (
        select 1 from public.marriages m
        where m.tree_id = p_tree
          and ((m.person_a = p_id and public.in_my_branch(p_tree, m.person_b))
            or (m.person_b = p_id and public.in_my_branch(p_tree, m.person_a)))
      );
end;
$$;

-- A marriage may be written when at least one side is in my branch.
create or replace function public.can_write_marriage(p_tree uuid, p_a uuid, p_b uuid)
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
  if v_role is null or not public.has_grants(p_tree) then
    return false;
  end if;
  return public.in_my_branch(p_tree, p_a) or public.in_my_branch(p_tree, p_b);
end;
$$;

create or replace function public.person_has_children(p_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.persons where father_id = p_id or mother_id = p_id);
$$;

revoke all on function public.has_grants(uuid)                                   from public, anon;
revoke all on function public.under_my_grant(uuid, uuid)                         from public, anon;
revoke all on function public.in_my_branch(uuid, uuid)                           from public, anon;
revoke all on function public.married_in_scope(uuid, uuid)                       from public, anon;
revoke all on function public.can_write_person(uuid, uuid, uuid, uuid, uuid)     from public, anon;
revoke all on function public.can_write_marriage(uuid, uuid, uuid)               from public, anon;
revoke all on function public.person_has_children(uuid)                          from public, anon;
grant execute on function public.has_grants(uuid)                                to authenticated;
grant execute on function public.under_my_grant(uuid, uuid)                      to authenticated;
grant execute on function public.in_my_branch(uuid, uuid)                        to authenticated;
grant execute on function public.married_in_scope(uuid, uuid)                    to authenticated;
grant execute on function public.can_write_person(uuid, uuid, uuid, uuid, uuid)  to authenticated;
grant execute on function public.can_write_marriage(uuid, uuid, uuid)            to authenticated;
grant execute on function public.person_has_children(uuid)                       to authenticated;


-- ---------------------------------------------------------------------
-- 3) Replace the persons / marriages write policies
-- ---------------------------------------------------------------------

drop policy persons_insert  on public.persons;
drop policy persons_update  on public.persons;
drop policy persons_delete  on public.persons;
drop policy marriages_insert on public.marriages;
drop policy marriages_update on public.marriages;
drop policy marriages_delete on public.marriages;

create policy persons_insert on public.persons for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_write_person(tree_id, id, father_id, mother_id, created_by)
  );

create policy persons_update on public.persons for update to authenticated
  using      (public.can_write_person(tree_id, id, father_id, mother_id, created_by))
  with check (public.can_write_person(tree_id, id, father_id, mother_id, created_by));

create policy persons_delete on public.persons for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
    or (
      public.tree_role(tree_id) = 'viewer'
      and public.can_write_person(tree_id, id, father_id, mother_id, created_by)
      and not public.person_has_children(id)
    )
  );

create policy marriages_insert on public.marriages for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_write_marriage(tree_id, person_a, person_b)
  );

create policy marriages_update on public.marriages for update to authenticated
  using      (public.can_write_marriage(tree_id, person_a, person_b))
  with check (public.can_write_marriage(tree_id, person_a, person_b));

create policy marriages_delete on public.marriages for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
    or (public.tree_role(tree_id) = 'viewer' and public.can_write_marriage(tree_id, person_a, person_b))
  );


-- ---------------------------------------------------------------------
-- 4) Nobody can rewrite ownership / audit columns through the API
--    (so "created_by" cannot be forged to gain rights over someone else's row)
-- ---------------------------------------------------------------------

revoke update on public.persons   from authenticated;
revoke update on public.marriages from authenticated;

grant update (first_name, last_name, gender, father_id, mother_id, birth_date, birth_place,
              is_deceased, death_date, photo_url, notes)
  on public.persons to authenticated;
grant update (person_a, person_b, marriage_date, status)
  on public.marriages to authenticated;
