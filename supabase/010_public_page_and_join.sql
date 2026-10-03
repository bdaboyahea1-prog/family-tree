-- =====================================================================
-- 010: the public page + requests to join the family
-- (run after 009, once)
--
-- THE PUBLIC PAGE (open to everyone on the internet, signed in or not)
--   * Off until the tree admin switches it on (trees.public_page).
--   * public_teaser() is the ONLY thing a stranger can read. It returns, for the tree on the page:
--     the tree name, how many people it has (just a number), the top ancestor and the people directly
--     under him (name, gender, years). Nothing else leaves the database: no places, photos, contact
--     details, notes, and nobody from the lower generations.
--   * Living people are left out unless the admin allows them (trees.public_show_living). Years are
--     given only for deceased people.
--
-- JOIN REQUESTS (a signed-in person who is not a member of the tree)
--   * join_requests: name, relation to the family, where they live, phone, contact e-mail and the path
--     of ONE proof document (an ID or an official paper) in the private bucket "join-docs".
--   * Only the person and the tree admin can read a request or its document. The admin decides with
--     decide_join_request(): approving adds the person as a reader of the tree. After the decision the
--     page deletes the document from storage (and calls forget_join_doc()).
--   * Limits: one open request per person and tree, 3 requests per day, documents of at most 5 MB
--     (images and PDF).
-- =====================================================================

alter table public.trees
  add column public_page        boolean not null default false,
  add column public_show_living boolean not null default false;

-- who may change them is decided by the existing trees_update policy: admins only
grant update (public_page, public_show_living) on public.trees to authenticated;


-- ---------------------------------------------------------------------
-- 1) The public teaser
-- ---------------------------------------------------------------------

-- One person as the public may see them, or NULL when they must stay hidden (a living person while
-- living people are not allowed on the page).
create function public.teaser_card(p public.persons, p_show_living boolean)
returns jsonb
language sql immutable
set search_path = public
as $$
  select case
    when not p.is_deceased and not p_show_living then null
    else jsonb_build_object(
      'name', btrim(concat_ws(' ', p.first_name, p.last_name)),
      'gender', p.gender,
      'birth_year', case when p.is_deceased then nullif(substring(p.birth_date from '[0-9]{4}'), '')::int end,
      'death_year', case when p.is_deceased then nullif(substring(p.death_date from '[0-9]{4}'), '')::int end,
      'deceased', p.is_deceased
    )
  end
$$;
revoke all on function public.teaser_card(public.persons, boolean) from public, anon, authenticated;

create function public.public_teaser()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  t        record;
  r        public.persons%rowtype;
  v_total  int;
  v_root   jsonb;
  v_kids   jsonb := '[]'::jsonb;
  v_hidden int := 0;
  v_n      int := 0;
  c        public.persons%rowtype;
  v_card   jsonb;
begin
  select id, name, public_show_living into t
  from public.trees where public_page order by created_at limit 1;
  if not found then
    return null;
  end if;

  select count(*) into v_total from public.persons where tree_id = t.id;

  -- the top ancestor: the person without parents who has the biggest line below him
  with recursive up (id, root) as (
    select p.id, p.id from public.persons p
    where p.tree_id = t.id and p.father_id is null and p.mother_id is null
    union all
    select c2.id, up.root
    from public.persons c2 join up on coalesce(c2.father_id, c2.mother_id) = up.id
    where c2.tree_id = t.id
  ),
  best as (
    select u.root from up u join public.persons p on p.id = u.root
    group by u.root, p.gender, p.created_at
    having count(*) > 1
    order by count(*) desc, (p.gender = 'male') desc, p.created_at
    limit 1
  )
  select p.* into r from public.persons p join best b on b.root = p.id;

  if r.id is not null then
    v_root := public.teaser_card(r, t.public_show_living);
    -- the first row: the people directly under him (a hidden top ancestor hides his row as well)
    for c in
      select * from public.persons
      where tree_id = t.id and coalesce(father_id, mother_id) = r.id
      order by nullif(substring(birth_date from '[0-9]{4}'), '')::int nulls last, created_at
    loop
      v_card := case when v_root is null then null else public.teaser_card(c, t.public_show_living) end;
      if v_card is null then
        v_hidden := v_hidden + 1;
      elsif v_n < 24 then
        v_kids := v_kids || jsonb_build_array(v_card);
        v_n := v_n + 1;
      else
        v_hidden := v_hidden + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'tree_id', t.id,
    'tree_name', t.name,
    'people_count', v_total,
    'root', v_root,
    'children', v_kids,
    'hidden_children', v_hidden
  );
end;
$$;

revoke all on function public.public_teaser() from public;
grant execute on function public.public_teaser() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2) Join requests
-- ---------------------------------------------------------------------

create table public.join_requests (
  id                uuid primary key default gen_random_uuid(),
  tree_id           uuid not null references public.trees (id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name         text not null check (char_length(full_name) between 2 and 120),
  relation          text not null check (char_length(relation) between 5 and 1500),
  residence_country text check (residence_country is null or residence_country ~ '^[A-Z]{2}$'),
  residence_city    text check (residence_city is null or char_length(residence_city) <= 100),
  phone             text not null check (
    phone ~ '^\+?[0-9(][0-9 ()-]{3,24}$'
    and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 4 and 20
  ),
  contact_email     text not null check (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  doc_path          text check (doc_path is null or char_length(doc_path) <= 300),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by        uuid references auth.users (id) on delete set null,
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or char_length(decision_note) <= 500),
  created_at        timestamptz not null default now()
);
create index on public.join_requests (tree_id, status);
create unique index join_requests_one_pending on public.join_requests (tree_id, user_id) where status = 'pending';

-- 3 requests per person per day
create function public.limit_join_requests()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.join_requests
      where user_id = new.user_id and created_at > now() - make_interval(days => 1)) >= 3 then
    raise exception 'too many join requests' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_join_requests() from public, anon, authenticated;
create trigger join_requests_limit before insert on public.join_requests
  for each row execute function public.limit_join_requests();

-- May the current user ask to join this tree? The page must be on, and the user not a member yet.
create function public.join_open(p_tree uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.trees t where t.id = p_tree and t.public_page)
     and public.tree_role(p_tree) is null;
$$;
revoke all on function public.join_open(uuid) from public, anon;
grant execute on function public.join_open(uuid) to authenticated;

alter table public.join_requests enable row level security;

create policy join_requests_select on public.join_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.tree_role(tree_id) = 'admin');

-- the document must sit in the person's own folder of the bucket
create policy join_requests_insert on public.join_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.join_open(tree_id)
    and doc_path is not null
    and doc_path like (select auth.uid())::text || '/%'
  );

grant select, insert on public.join_requests to authenticated;

-- The admin decides. Returns the path of the document so that the page can delete it from storage.
create function public.decide_join_request(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  r public.join_requests%rowtype;
begin
  select * into r from public.join_requests where id = p_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if public.tree_role(r.tree_id) is distinct from 'admin' then
    raise exception 'admins only';
  end if;
  if r.status <> 'pending' then
    raise exception 'request already decided';
  end if;
  if p_approve then
    insert into public.tree_members (tree_id, user_id, role)
    values (r.tree_id, r.user_id, 'viewer')
    on conflict (tree_id, user_id) do nothing;
  end if;
  update public.join_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = (select auth.uid()), decided_at = now(),
         decision_note = nullif(btrim(left(coalesce(p_note, ''), 500)), '')
   where id = p_id;
  return r.doc_path;
end;
$$;

-- The person withdraws an open request. Returns the document path (to delete it from storage).
create function public.cancel_join_request(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  r public.join_requests%rowtype;
begin
  select * into r from public.join_requests
   where id = p_id and user_id = (select auth.uid()) and status = 'pending' for update;
  if not found then
    raise exception 'nothing to cancel';
  end if;
  update public.join_requests set status = 'cancelled' where id = p_id;
  return r.doc_path;
end;
$$;

-- After the document was deleted from storage: forget its path (the admin or the person, once decided).
create function public.forget_join_doc(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.join_requests r set doc_path = null
   where r.id = p_id and r.status <> 'pending'
     and (r.user_id = (select auth.uid()) or public.tree_role(r.tree_id) = 'admin');
end;
$$;

revoke all on function public.decide_join_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_join_request(uuid)                from public, anon;
revoke all on function public.forget_join_doc(uuid)                    from public, anon;
grant execute on function public.decide_join_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_join_request(uuid)                to authenticated;
grant execute on function public.forget_join_doc(uuid)                    to authenticated;


-- ---------------------------------------------------------------------
-- 3) The private bucket for the documents (images and PDF, 5 MB)
-- ---------------------------------------------------------------------

create function public.can_see_join_doc(p_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.join_requests r
    where r.doc_path = p_name and public.tree_role(r.tree_id) = 'admin'
  );
$$;
revoke all on function public.can_see_join_doc(text) from public, anon;
grant execute on function public.can_see_join_doc(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('join-docs', 'join-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

create policy join_docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'join-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy join_docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'join-docs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_see_join_doc(name))
  );

create policy join_docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'join-docs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_see_join_doc(name))
  );
