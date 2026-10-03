-- =====================================================================
-- 013: an invitation link that is not tied to an e-mail address (run after 012, once)
--
-- The admin makes a link for ONE person he chooses (and sends it himself). It is the same as accepting a
-- request to join, except that the admin starts it:
--   * it works ONCE: the first person who opens it and creates an account (with their OWN e-mail, which
--     the sign-up form always asks for) enters the tree; after that the link is dead;
--   * the new member is a READER of the whole tree (the admin can change the role later in "المشاركة");
--   * only an admin can make one, and at most 30 unused ones at a time;
--   * somebody who is already a member of the tree does not use the link up: they are told so;
--   * the admin gives it a label ("لمن؟") to tell links apart, and sees who used which.
-- Invitations tied to an e-mail (and the branch invitations) work exactly as before.
-- Honest limit: whoever holds the link first can use it. Send it privately to the person meant.
-- =====================================================================

alter table public.tree_invites
  add column any_email boolean not null default false,
  add column label     text check (label is null or char_length(label) <= 100);

-- 003 forbade invitations without an e-mail. Now: an e-mail, or an explicit open link of one fixed shape.
alter table public.tree_invites drop constraint tree_invites_email_required;
alter table public.tree_invites
  add constraint tree_invites_email_or_open check (email is not null or any_email),
  add constraint tree_invites_open_shape check (
    not any_email or (email is null and role = 'viewer' and branch_person_id is null and max_uses = 1)
  );
-- (authenticated users can update only the "enabled" column of this table, so nobody can turn an
--  e-mail invitation into an open link by editing it)

-- ---------------------------------------------------------------------
-- 1) Make a link (admin)
-- ---------------------------------------------------------------------

create function public.create_open_invite(p_tree uuid, p_label text default null)
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
  if (select count(*) from public.tree_invites
       where tree_id = p_tree and any_email and enabled and uses < max_uses) >= 30 then
    raise exception 'too many open invitations';
  end if;
  insert into public.tree_invites (tree_id, role, email, any_email, label, created_by)
  values (p_tree, 'viewer', null, true, nullif(btrim(left(coalesce(p_label, ''), 100)), ''), auth.uid())
  returning code into v_code;
  return v_code;
end;
$$;

revoke all on function public.create_open_invite(uuid, text) from public, anon;
grant execute on function public.create_open_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Redeem (replaces 003): an open link accepts any e-mail, once
-- ---------------------------------------------------------------------

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

  if v_inv.any_email then
    -- an open link: do not burn it on somebody who is in the tree already
    if exists (select 1 from public.tree_members where tree_id = v_inv.tree_id and user_id = auth.uid()) then
      raise exception 'already a member';
    end if;
  elsif v_inv.email is null or v_inv.email <> v_email then
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
