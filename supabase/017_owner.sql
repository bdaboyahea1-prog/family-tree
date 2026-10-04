-- =====================================================================
-- 017: the OWNER of a tree, above every admin (run after 016, once)
--
--  * trees.owner_id: who owns the tree. Nobody can remove the owner from the tree or lower their role:
--    not another admin, and not the owner by accident either (they hand the tree over first, see below).
--  * Trees that exist now: the owner is the person who made the tree if they are still an admin of it,
--    otherwise the admin who joined first. CHECK WHO IT IS after running (the last query of this file).
--  * New trees: the owner is the person who creates the tree (a trigger fills it in).
--  * transfer_ownership(tree, new_owner): only the owner; the new owner has to be an admin of the tree.
--  * The other admins keep every right they have today over everybody except the owner.
-- =====================================================================

alter table public.trees
  add column owner_id uuid references auth.users (id) on delete set null;

-- the owner of the trees that exist: who made it (if still an admin), else the admin who joined first
update public.trees t
   set owner_id = coalesce(
         (select m.user_id from public.tree_members m
           where m.tree_id = t.id and m.user_id = t.created_by and m.role = 'admin'),
         (select m.user_id from public.tree_members m
           where m.tree_id = t.id and m.role = 'admin'
           order by m.joined_at, m.user_id limit 1))
 where t.owner_id is null;

-- a new tree: its owner is whoever creates it
create function public.set_tree_owner() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.owner_id := coalesce(new.owner_id, new.created_by, auth.uid());
  return new;
end;
$$;

create trigger trees_set_owner before insert on public.trees
  for each row execute function public.set_tree_owner();

-- the owner stays: no removal, no lowering of the role (not even by themselves). When the whole tree is
-- deleted its members go with it: the tree row is already gone at that moment, so that is allowed.
create function public.protect_owner() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.user_id is not distinct from (select owner_id from public.trees where id = old.tree_id) then
    if tg_op = 'DELETE' then
      if exists (select 1 from public.trees where id = old.tree_id) then
        raise exception 'The owner of a tree cannot be removed';
      end if;
      return old;
    elsif new.role is distinct from 'admin' then
      raise exception 'The owner of a tree cannot be demoted';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger tree_members_protect_owner before update or delete on public.tree_members
  for each row execute function public.protect_owner();

-- hand the tree over: only the owner, and only to an admin of the same tree
create function public.transfer_ownership(p_tree uuid, p_new_owner uuid) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.trees where id = p_tree and owner_id = auth.uid()) then
    raise exception 'only the owner can hand the tree over';
  end if;
  if not exists (select 1 from public.tree_members where tree_id = p_tree and user_id = p_new_owner and role = 'admin') then
    raise exception 'the new owner must be an admin of the tree';
  end if;
  update public.trees set owner_id = p_new_owner where id = p_tree;
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
revoke all on function public.set_tree_owner() from public, anon, authenticated;
revoke all on function public.protect_owner() from public, anon, authenticated;

-- (no UPDATE privilege on owner_id is granted: it only changes through transfer_ownership)

-- ---- CHECK: who is the owner of each tree now? It must be YOU. ----
select t.name as tree, coalesce(u.email, '(none)') as owner_email, t.owner_id
  from public.trees t
  left join auth.users u on u.id = t.owner_id;
