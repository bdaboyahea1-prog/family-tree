-- =====================================================================
-- 007: access requests, error reports, comments, and "no strangers creating trees"
-- (run after 006, once)
--
--  * Nobody joins without an invitation (unchanged). From now on only someone who is already an
--    admin of a tree (or the very first user of an empty installation) can create a tree, so a
--    stranger who signs up has an account and nothing else.
--  * ACCESS REQUESTS: a reader of the tree can ask for rights (add / edit / delete) on the branch
--    under a card. The tree admin, or a reader holding "grant" above that card, approves (with the
--    rights they choose, never more than they may hand out) or rejects. Approval creates the same
--    branch grant as before.
--  * ERROR REPORTS: any member can report wrong information on a card. The report goes to the admin,
--    the editors and whoever may edit that card; they mark it resolved.
--  * COMMENTS: any member can write on a card; every member of the tree can read them. You delete
--    your own; the admin deletes any.
--  Everything is enforced by Row Level Security and SECURITY DEFINER functions.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Who may create a tree
-- ---------------------------------------------------------------------

create function public.can_create_tree()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (
       not exists (select 1 from public.trees)                     -- first setup
       or exists (select 1 from public.tree_members where user_id = auth.uid() and role = 'admin')
     );
$$;

create or replace function public.create_tree(p_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_create_tree() then
    raise exception 'not allowed to create trees';
  end if;
  if (select count(*) from public.trees where created_by = auth.uid()) >= 3 then
    raise exception 'tree limit reached';
  end if;

  insert into public.trees (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into v_id;

  insert into public.tree_members (tree_id, user_id, role)
  values (v_id, auth.uid(), 'admin');

  return v_id;
end;
$$;

revoke all on function public.can_create_tree() from public, anon;
grant execute on function public.can_create_tree() to authenticated;


-- ---------------------------------------------------------------------
-- 2) Access requests
-- ---------------------------------------------------------------------

create table public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  tree_id       uuid not null,
  person_id     uuid not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  can_add       boolean not null default false,
  can_edit      boolean not null default false,
  can_delete    boolean not null default false,
  message       text check (char_length(message) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  check (can_add or can_edit or can_delete),
  foreign key (person_id, tree_id) references public.persons (id, tree_id) on delete cascade,
  foreign key (tree_id, user_id) references public.tree_members (tree_id, user_id) on delete cascade
);
create index on public.access_requests (tree_id, status);
-- one open request per person and card
create unique index access_requests_one_pending on public.access_requests (user_id, person_id) where status = 'pending';

alter table public.access_requests enable row level security;

-- the requester sees his own; whoever may hand out rights on that card (admin, or a reader holding
-- "grant" above it) sees the requests for it
create policy requests_select on public.access_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_delegate(tree_id, person_id, false, false, false, false)
  );
grant select on public.access_requests to authenticated;

create function public.request_branch_access(
  p_tree uuid, p_person uuid, p_add boolean, p_edit boolean, p_delete boolean, p_message text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if public.tree_role(p_tree) is distinct from 'viewer' then
    raise exception 'only readers can request access';
  end if;
  if not (p_add or p_edit or p_delete) then
    raise exception 'choose at least one right';
  end if;
  if not exists (select 1 from public.persons where id = p_person and tree_id = p_tree) then
    raise exception 'person not found';
  end if;
  if (select count(*) from public.access_requests where user_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'too many pending requests';
  end if;

  insert into public.access_requests (tree_id, person_id, user_id, can_add, can_edit, can_delete, message)
  values (p_tree, p_person, auth.uid(), p_add, p_edit, p_delete, nullif(trim(coalesce(p_message, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Approve (with the rights the approver chooses) or reject. Approving creates the branch grant
-- through grant_branch(), which refuses anything the approver may not hand out.
create function public.decide_access_request(
  p_id uuid, p_approve boolean, p_add boolean, p_edit boolean, p_delete boolean, p_grant boolean,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r public.access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into r from public.access_requests where id = p_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'request already decided';
  end if;

  if p_approve then
    if not (p_add or p_edit or p_delete or p_grant) then
      raise exception 'choose at least one right';
    end if;
    perform public.grant_branch(r.tree_id, r.user_id, r.person_id, p_add, p_edit, p_delete, p_grant);
  elsif not public.can_delegate(r.tree_id, r.person_id, false, false, false, false) then
    raise exception 'not allowed to decide this request';
  end if;

  update public.access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
end;
$$;

create function public.cancel_access_request(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.access_requests
  set status = 'cancelled', decided_at = now()
  where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'nothing to cancel';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 3) Error reports
-- ---------------------------------------------------------------------

create table public.card_reports (
  id              uuid primary key default gen_random_uuid(),
  tree_id         uuid not null,
  person_id       uuid not null,
  user_id         uuid references public.profiles (id) on delete set null,
  message         text not null check (char_length(message) between 1 and 1000),
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_by     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text check (char_length(resolution_note) <= 500),
  foreign key (person_id, tree_id) references public.persons (id, tree_id) on delete cascade
);
create index on public.card_reports (tree_id, status);

alter table public.card_reports enable row level security;

-- reporter; admin / editors; anyone allowed to edit that card
create policy reports_select on public.card_reports for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.tree_role(tree_id) in ('admin', 'editor')
    or public.can_edit_photo(tree_id, person_id)
  );
grant select on public.card_reports to authenticated;

create function public.report_card_error(p_tree uuid, p_person uuid, p_message text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or public.tree_role(p_tree) is null then
    raise exception 'members only';
  end if;
  if not exists (select 1 from public.persons where id = p_person and tree_id = p_tree) then
    raise exception 'person not found';
  end if;
  if char_length(trim(coalesce(p_message, ''))) = 0 then
    raise exception 'write what is wrong';
  end if;
  if (select count(*) from public.card_reports where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many reports, try again later';
  end if;

  insert into public.card_reports (tree_id, person_id, user_id, message)
  values (p_tree, p_person, auth.uid(), trim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

-- mark a report resolved (or open again). Admin / editors / whoever may edit that card.
create function public.set_report_status(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r public.card_reports%rowtype;
begin
  if p_status not in ('open', 'resolved') then
    raise exception 'invalid status';
  end if;
  select * into r from public.card_reports where id = p_id;
  if not found then
    raise exception 'report not found';
  end if;
  if not (public.tree_role(r.tree_id) in ('admin', 'editor') or public.can_edit_photo(r.tree_id, r.person_id)) then
    raise exception 'not allowed to handle this report';
  end if;

  update public.card_reports
  set status = p_status,
      resolved_by = case when p_status = 'resolved' then auth.uid() end,
      resolved_at = case when p_status = 'resolved' then now() end,
      resolution_note = case when p_status = 'resolved' then nullif(trim(coalesce(p_note, '')), '') end
  where id = p_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Comments
-- ---------------------------------------------------------------------

create table public.card_comments (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null,
  person_id  uuid not null,
  user_id    uuid default auth.uid() references public.profiles (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (person_id, tree_id) references public.persons (id, tree_id) on delete cascade
);
create index on public.card_comments (tree_id, person_id, created_at);

alter table public.card_comments enable row level security;

create policy comments_select on public.card_comments for select to authenticated
  using (public.tree_role(tree_id) is not null);
create policy comments_insert on public.card_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and public.tree_role(tree_id) is not null);
create policy comments_delete on public.card_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.tree_role(tree_id) = 'admin');

grant select, insert, delete on public.card_comments to authenticated;

-- a little protection against flooding
create function public.comments_rate_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.card_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many comments, try again later';
  end if;
  return new;
end;
$$;
create trigger card_comments_rate before insert on public.card_comments
  for each row execute function public.comments_rate_limit();
revoke all on function public.comments_rate_limit() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5) Privileges
-- ---------------------------------------------------------------------

revoke all on function public.request_branch_access(uuid, uuid, boolean, boolean, boolean, text)                       from public, anon;
revoke all on function public.decide_access_request(uuid, boolean, boolean, boolean, boolean, boolean, text)           from public, anon;
revoke all on function public.cancel_access_request(uuid)                                                              from public, anon;
revoke all on function public.report_card_error(uuid, uuid, text)                                                      from public, anon;
revoke all on function public.set_report_status(uuid, text, text)                                                      from public, anon;
grant execute on function public.request_branch_access(uuid, uuid, boolean, boolean, boolean, text)                    to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, boolean, boolean, boolean, boolean, text)        to authenticated;
grant execute on function public.cancel_access_request(uuid)                                                           to authenticated;
grant execute on function public.report_card_error(uuid, uuid, text)                                                   to authenticated;
grant execute on function public.set_report_status(uuid, text, text)                                                   to authenticated;
