-- =====================================================================
-- Family Tree — Supabase schema (PostgreSQL 15+)
--
-- Run once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- The editor runs the script as one transaction, so if anything fails
-- nothing is applied and you can fix the error and run it again.
--
-- Model
--   * A user signs in (Google / email) and gets a row in `profiles`.
--   * A `tree` has members with a role: admin | editor | viewer.
--   * Admins create invite links (`tree_invites`); opening one calls
--     join_tree(code) which adds the caller with the invite's role.
--   * `persons` hold father_id / mother_id, so several wives and their
--     children are represented naturally. `marriages` links spouses.
--   * Every insert/update/delete on persons & marriages is written to
--     `change_log` (who / when / old + new values) so mistakes can be
--     traced and reverted.
--   * Row Level Security enforces all of the above inside the database.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table public.trees (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.tree_members (
  tree_id   uuid not null references public.trees (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null check (role in ('admin', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);
create index on public.tree_members (user_id);

create table public.tree_invites (
  code       text primary key
             default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  tree_id    uuid not null references public.trees (id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  enabled    boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.tree_invites (tree_id);

create table public.persons (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.trees (id) on delete cascade,
  first_name  text not null check (char_length(first_name) between 1 and 100),
  last_name   text check (char_length(last_name) <= 100),  -- family / tribe / nickname
  gender      text not null check (gender in ('male', 'female')),
  father_id   uuid,
  mother_id   uuid,
  birth_date  text check (char_length(birth_date) <= 40),  -- free text: '1950', '1950-03-12', 'حوالي 1950'
  birth_place text check (char_length(birth_place) <= 100),
  is_deceased boolean not null default false,
  death_date  text check (char_length(death_date) <= 40),
  photo_url   text check (char_length(photo_url) <= 500),
  notes       text check (char_length(notes) <= 2000),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),

  unique (id, tree_id),
  -- parents must live in the same tree; deleting a parent only clears the link
  constraint persons_father_fk foreign key (father_id, tree_id)
    references public.persons (id, tree_id) on delete set null (father_id),
  constraint persons_mother_fk foreign key (mother_id, tree_id)
    references public.persons (id, tree_id) on delete set null (mother_id),
  check (father_id is distinct from id and mother_id is distinct from id)
);
create index on public.persons (tree_id);
create index on public.persons (father_id);
create index on public.persons (mother_id);

create table public.marriages (
  id            uuid primary key default gen_random_uuid(),
  tree_id       uuid not null references public.trees (id) on delete cascade,
  person_a      uuid not null,
  person_b      uuid not null,
  marriage_date text check (char_length(marriage_date) <= 40),
  status        text not null default 'married'
                check (status in ('married', 'divorced', 'widowed')),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),

  unique (person_a, person_b),
  check (person_a < person_b),  -- pair is stored ordered (see trigger below)
  foreign key (person_a, tree_id) references public.persons (id, tree_id) on delete cascade,
  foreign key (person_b, tree_id) references public.persons (id, tree_id) on delete cascade
);
create index on public.marriages (tree_id);
create index on public.marriages (person_a);
create index on public.marriages (person_b);

-- No FK on tree_id on purpose: log rows written while a tree is being
-- cascade-deleted must not fail.
create table public.change_log (
  id         bigint generated always as identity primary key,
  tree_id    uuid not null,
  user_id    uuid,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id  uuid not null,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index on public.change_log (tree_id, id desc);


-- ---------------------------------------------------------------------
-- 2) Helper + trigger functions
-- ---------------------------------------------------------------------

-- Role of the current user in a tree (NULL if not a member).
-- SECURITY DEFINER so policies can call it without recursing into RLS.
create or replace function public.tree_role(p_tree uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select role
  from public.tree_members
  where tree_id = p_tree and user_id = (select auth.uid());
$$;

-- New auth user -> profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp updated_at / updated_by and forbid moving a row to another tree.
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.tree_id is distinct from old.tree_id then
    raise exception 'tree_id cannot be changed';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Keep a marriage pair ordered so (a,b) and (b,a) are the same row.
create or replace function public.order_marriage_pair()
returns trigger
language plpgsql
as $$
declare
  tmp uuid;
begin
  if new.person_a > new.person_b then
    tmp := new.person_a;
    new.person_a := new.person_b;
    new.person_b := tmp;
  end if;
  return new;
end;
$$;

-- Audit trail.
create or replace function public.log_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.change_log (tree_id, user_id, action, table_name, record_id, old_data)
    values (old.tree_id, auth.uid(), tg_op, tg_table_name, old.id, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    -- ignore no-op updates (only the audit stamps changed)
    if (to_jsonb(new) - 'updated_at' - 'updated_by')
       = (to_jsonb(old) - 'updated_at' - 'updated_by') then
      return new;
    end if;
    insert into public.change_log (tree_id, user_id, action, table_name, record_id, old_data, new_data)
    values (new.tree_id, auth.uid(), tg_op, tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.change_log (tree_id, user_id, action, table_name, record_id, new_data)
    values (new.tree_id, auth.uid(), tg_op, tg_table_name, new.id, to_jsonb(new));
    return new;
  end if;
end;
$$;

-- A tree can never be left without an admin.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  demoting boolean;
begin
  if old.role <> 'admin' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    demoting := true;
  else
    demoting := new.role <> 'admin';
  end if;

  if demoting
     and exists (select 1 from public.trees where id = old.tree_id)
     and not exists (
       select 1 from public.tree_members
       where tree_id = old.tree_id and role = 'admin' and user_id <> old.user_id
     )
  then
    raise exception 'A tree must keep at least one admin';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger persons_touch   before insert or update on public.persons
  for each row execute function public.touch_row();
create trigger persons_log     after insert or update or delete on public.persons
  for each row execute function public.log_change();

create trigger marriages_order before insert or update on public.marriages
  for each row execute function public.order_marriage_pair();
create trigger marriages_touch before insert or update on public.marriages
  for each row execute function public.touch_row();
create trigger marriages_log   after insert or update or delete on public.marriages
  for each row execute function public.log_change();

create trigger tree_members_protect before update or delete on public.tree_members
  for each row execute function public.protect_last_admin();


-- ---------------------------------------------------------------------
-- 3) Functions the web page calls (RPC)
-- ---------------------------------------------------------------------

-- Create a tree and become its admin. Capped to stop abuse.
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

-- Admin creates an invite link code. Role: 'editor' (default) or 'viewer'.
create or replace function public.create_invite(p_tree uuid, p_role text default 'editor')
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

  insert into public.tree_invites (tree_id, role, created_by)
  values (p_tree, p_role, auth.uid())
  returning code into v_code;

  return v_code;
end;
$$;

-- Anyone signed in can redeem an invite code. Existing members keep their role.
create or replace function public.join_tree(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_inv public.tree_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_inv
  from public.tree_invites
  where code = trim(p_code) and enabled;

  if not found then
    raise exception 'invalid or disabled invite';
  end if;

  insert into public.tree_members (tree_id, user_id, role)
  values (v_inv.tree_id, auth.uid(), v_inv.role)
  on conflict (tree_id, user_id) do nothing;

  return v_inv.tree_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.trees        enable row level security;
alter table public.tree_members enable row level security;
alter table public.tree_invites enable row level security;
alter table public.persons      enable row level security;
alter table public.marriages    enable row level security;
alter table public.change_log   enable row level security;

-- profiles: myself + people who share a tree with me
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.tree_members a
      join public.tree_members b on b.tree_id = a.tree_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- trees: members read, admins rename. Creation only through create_tree().
create policy trees_select on public.trees for select to authenticated
  using (public.tree_role(id) is not null);
create policy trees_update on public.trees for update to authenticated
  using (public.tree_role(id) = 'admin')
  with check (public.tree_role(id) = 'admin');

-- tree_members: members see each other; admins change roles / remove; anyone can leave.
-- Joining only through join_tree().
create policy members_select on public.tree_members for select to authenticated
  using (public.tree_role(tree_id) is not null);
create policy members_update on public.tree_members for update to authenticated
  using (public.tree_role(tree_id) = 'admin')
  with check (public.tree_role(tree_id) = 'admin');
create policy members_delete on public.tree_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.tree_role(tree_id) = 'admin');

-- tree_invites: admins only (list / disable / delete). Creation only through create_invite().
create policy invites_select on public.tree_invites for select to authenticated
  using (public.tree_role(tree_id) = 'admin');
create policy invites_update on public.tree_invites for update to authenticated
  using (public.tree_role(tree_id) = 'admin')
  with check (public.tree_role(tree_id) = 'admin');
create policy invites_delete on public.tree_invites for delete to authenticated
  using (public.tree_role(tree_id) = 'admin');

-- persons: members read; admin/editor add + edit; admin deletes anything,
-- an editor may delete only what they added themselves.
create policy persons_select on public.persons for select to authenticated
  using (public.tree_role(tree_id) is not null);
create policy persons_insert on public.persons for insert to authenticated
  with check (
    public.tree_role(tree_id) in ('admin', 'editor')
    and created_by = (select auth.uid())
  );
create policy persons_update on public.persons for update to authenticated
  using (public.tree_role(tree_id) in ('admin', 'editor'))
  with check (public.tree_role(tree_id) in ('admin', 'editor'));
create policy persons_delete on public.persons for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
  );

-- marriages: same rules as persons
create policy marriages_select on public.marriages for select to authenticated
  using (public.tree_role(tree_id) is not null);
create policy marriages_insert on public.marriages for insert to authenticated
  with check (
    public.tree_role(tree_id) in ('admin', 'editor')
    and created_by = (select auth.uid())
  );
create policy marriages_update on public.marriages for update to authenticated
  using (public.tree_role(tree_id) in ('admin', 'editor'))
  with check (public.tree_role(tree_id) in ('admin', 'editor'));
create policy marriages_delete on public.marriages for delete to authenticated
  using (
    public.tree_role(tree_id) = 'admin'
    or (public.tree_role(tree_id) = 'editor' and created_by = (select auth.uid()))
  );

-- change_log: members can read; nobody writes directly (triggers only)
create policy change_log_select on public.change_log for select to authenticated
  using (public.tree_role(tree_id) is not null);


-- ---------------------------------------------------------------------
-- 5) Privileges (explicit, because new tables are NOT auto-exposed)
--    `anon` (not signed in) gets nothing at all.
-- ---------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, update (display_name, avatar_url) on public.profiles to authenticated;
grant select, update (name)                     on public.trees to authenticated;
grant select, update (role), delete             on public.tree_members to authenticated;
grant select, update (enabled), delete          on public.tree_invites to authenticated;
grant select, insert, update, delete            on public.persons to authenticated;
grant select, insert, update, delete            on public.marriages to authenticated;
grant select                                    on public.change_log to authenticated;

-- Callable from the web page when signed in
revoke all on function public.tree_role(uuid)              from public, anon;
revoke all on function public.create_tree(text)            from public, anon;
revoke all on function public.create_invite(uuid, text)    from public, anon;
revoke all on function public.join_tree(text)              from public, anon;
grant execute on function public.tree_role(uuid)           to authenticated;
grant execute on function public.create_tree(text)         to authenticated;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.join_tree(text)           to authenticated;

-- Trigger functions are never called directly
revoke all on function public.handle_new_user()    from public, anon, authenticated;
revoke all on function public.touch_row()          from public, anon, authenticated;
revoke all on function public.order_marriage_pair() from public, anon, authenticated;
revoke all on function public.log_change()         from public, anon, authenticated;
revoke all on function public.protect_last_admin() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6) Realtime: other people's edits appear live without refreshing
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.persons, public.marriages;
