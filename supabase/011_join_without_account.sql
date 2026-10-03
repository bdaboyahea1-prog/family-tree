-- =====================================================================
-- 011: ask to join WITHOUT an account (replaces the account-first design of 010)
-- (run after 010, once)
--
-- THE FLOW
--   1. A visitor fills the form on the public page. No account. submit_join_request() saves the request
--      as a "draft", and returns a secret tracking code and the path where ONE document may be uploaded.
--   2. The visitor uploads the document straight to the private bucket "join-docs". The bucket accepts
--      an upload only for the exact path of a fresh draft (so nobody can fill the storage with files).
--   3. confirm_join_doc() checks that the file is there and turns the draft into a "pending" request.
--   4. The tree admin sees it in the inbox. Approving creates an INVITATION tied to the e-mail written in
--      the form (the same single-use invitation as always); refusing keeps the reason.
--   5. The visitor opens the site, types the tracking code (the browser also remembers it) and
--      join_status() tells them: pending / refused (with the reason) / approved, with the invitation
--      link to create the account. The document is deleted after the decision.
--
-- WHO CAN DO WHAT
--   * Visitors (not signed in) can only call submit_join_request, confirm_join_doc and join_status.
--     They cannot read or write the tables.
--   * Only the tree admin reads requests and documents, and decides.
--   * Limits: 5 requests a day from one network address, 3 a day for one e-mail, one open request per
--     e-mail, 30 an hour in total, nothing for someone who is already a member, documents of at most 5 MB
--     (images and PDF), and a hidden form field that robots fill. These are speed bumps, not walls: a
--     determined person can vary the address and the e-mail, which is why the admin decides every request.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) take away what 010 built for the account-first flow
-- ---------------------------------------------------------------------

drop policy join_requests_insert on public.join_requests;
drop policy join_requests_select on public.join_requests;
drop trigger join_requests_limit on public.join_requests;
drop function public.limit_join_requests();
drop function public.cancel_join_request(uuid);
drop function public.join_open(uuid);
drop function public.decide_join_request(uuid, boolean, text);
drop index public.join_requests_one_pending;
drop policy join_docs_insert on storage.objects;
drop policy join_docs_read   on storage.objects;
drop policy join_docs_delete on storage.objects;
revoke insert on public.join_requests from authenticated;


-- ---------------------------------------------------------------------
-- 1) The table: a request no longer belongs to an account
-- ---------------------------------------------------------------------

alter table public.join_requests
  alter column user_id drop not null,
  alter column user_id drop default,
  add column track_code   text not null default replace(gen_random_uuid()::text, '-', ''),
  add column doc_uploaded boolean not null default false,
  add column invite_code  text,
  add column client_hash  text;

alter table public.join_requests drop constraint join_requests_status_check;
alter table public.join_requests
  add constraint join_requests_status_check check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled'));
alter table public.join_requests alter column status set default 'draft';

create unique index join_requests_track on public.join_requests (track_code);
create unique index join_requests_one_pending on public.join_requests (tree_id, lower(contact_email)) where status = 'pending';
create index on public.join_requests (client_hash, created_at);

-- only the tree admin reads requests
create policy join_requests_select on public.join_requests for select to authenticated
  using (public.tree_role(tree_id) = 'admin');


-- ---------------------------------------------------------------------
-- 2) What a visitor may call
-- ---------------------------------------------------------------------

-- A short fingerprint of the visitor's network address (for the daily limit only; the address itself is not stored).
create function public.client_hash()
returns text
language sql stable
set search_path = public
as $$
  select md5('family-tree:' || coalesce(
    split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1), ''))
$$;
revoke all on function public.client_hash() from public, anon, authenticated;

create function public.submit_join_request(
  p_tree uuid, p_full_name text, p_relation text, p_country text, p_city text,
  p_phone text, p_email text, p_doc_ext text, p_hp text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_code  text := replace(gen_random_uuid()::text, '-', '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash  text := public.client_hash();
  v_path  text := 'req/' || v_id::text || '.' || coalesce(p_doc_ext, 'pdf');
begin
  -- a robot filled the hidden field: answer as if it worked, and keep nothing
  if btrim(coalesce(p_hp, '')) <> '' then
    return jsonb_build_object('id', v_id, 'code', v_code, 'path', v_path);
  end if;

  if not exists (select 1 from public.trees t where t.id = p_tree and t.public_page) then
    raise exception 'join requests are closed' using errcode = '42501';
  end if;
  -- a circuit breaker: never more than 30 requests an hour in total (keeps the inbox and the storage safe)
  if (select count(*) from public.join_requests where created_at > now() - make_interval(hours => 1)) >= 30 then
    raise exception 'too many join requests' using errcode = '42501';
  end if;
  if p_doc_ext is null or p_doc_ext not in ('jpg', 'png', 'webp', 'pdf') then
    raise exception 'invalid document type';
  end if;
  if (select count(*) from public.join_requests
       where client_hash = v_hash and created_at > now() - make_interval(days => 1)) >= 5
     or (select count(*) from public.join_requests
          where lower(contact_email) = v_email and created_at > now() - make_interval(days => 1)) >= 3 then
    raise exception 'too many join requests' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users u join public.tree_members m on m.user_id = u.id
              where lower(u.email) = v_email and m.tree_id = p_tree) then
    raise exception 'already a member';
  end if;
  if exists (select 1 from public.join_requests
              where tree_id = p_tree and lower(contact_email) = v_email and status = 'pending') then
    raise exception 'request already open';
  end if;

  insert into public.join_requests
    (id, tree_id, user_id, full_name, relation, residence_country, residence_city, phone, contact_email,
     doc_path, status, track_code, client_hash)
  values
    (v_id, p_tree, null, btrim(p_full_name), btrim(p_relation), nullif(btrim(p_country), ''), nullif(btrim(p_city), ''),
     btrim(p_phone), v_email, v_path, 'draft', v_code, v_hash);

  return jsonb_build_object('id', v_id, 'code', v_code, 'path', v_path);
end;
$$;

-- The document was uploaded: check it is really there and open the request to the admin.
create function public.confirm_join_doc(p_id uuid, p_code text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r public.join_requests%rowtype;
begin
  select * into r from public.join_requests
   where id = p_id and track_code = p_code and status = 'draft' for update;
  if not found then
    raise exception 'request not found';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'join-docs' and o.name = r.doc_path) then
    raise exception 'document missing';
  end if;
  update public.join_requests set doc_uploaded = true, status = 'pending' where id = p_id;
end;
$$;

-- Where is my request? Only whoever holds the secret code can ask. The invitation link is given only
-- while it can still be used.
create function public.join_status(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r      public.join_requests%rowtype;
  inv    public.tree_invites%rowtype;
  v_link text;
  v_done boolean := false;
begin
  if p_code is null or p_code !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into r from public.join_requests where track_code = p_code;
  if not found then
    return null;
  end if;
  if r.status = 'approved' and r.invite_code is not null then
    select * into inv from public.tree_invites where code = r.invite_code;
    if found then
      v_done := inv.uses >= inv.max_uses;
      if inv.enabled and not v_done then
        v_link := inv.code;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'status', r.status, 'full_name', r.full_name, 'contact_email', r.contact_email,
    'created_at', r.created_at, 'decision_note', r.decision_note,
    'invite_code', v_link, 'registered', v_done
  );
end;
$$;

revoke all on function public.submit_join_request(uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.confirm_join_doc(uuid, text) from public;
revoke all on function public.join_status(text) from public;
grant execute on function public.submit_join_request(uuid, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.confirm_join_doc(uuid, text) to anon, authenticated;
grant execute on function public.join_status(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) What the admin does
-- ---------------------------------------------------------------------

-- Approving creates the invitation for the e-mail of the form (single use, reader role).
-- Returns { doc_path, invite_code } so that the page can delete the document and show the link.
create function public.decide_join_request(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        public.join_requests%rowtype;
  v_invite text;
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
    v_invite := public.create_invite(r.tree_id, r.contact_email, 'viewer');
  end if;
  update public.join_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = (select auth.uid()), decided_at = now(), invite_code = v_invite,
         decision_note = nullif(btrim(left(coalesce(p_note, ''), 500)), '')
   where id = p_id;
  return jsonb_build_object('doc_path', r.doc_path, 'invite_code', v_invite);
end;
$$;

-- After the document was deleted from storage: forget its path (the admin, once decided).
create or replace function public.forget_join_doc(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.join_requests r set doc_path = null
   where r.id = p_id and r.status in ('approved', 'rejected', 'cancelled')
     and public.tree_role(r.tree_id) = 'admin';
end;
$$;

revoke all on function public.decide_join_request(uuid, boolean, text) from public, anon;
grant execute on function public.decide_join_request(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4) The bucket: visitors may upload only the one file of a fresh draft; only the admin reads / deletes
-- ---------------------------------------------------------------------

create function public.join_upload_allowed(p_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.join_requests r
    where r.doc_path = p_name and r.status = 'draft' and not r.doc_uploaded
      and r.created_at > now() - make_interval(hours => 1)
  );
$$;
revoke all on function public.join_upload_allowed(text) from public;
grant execute on function public.join_upload_allowed(text) to anon, authenticated;

create policy join_docs_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'join-docs' and public.join_upload_allowed(name));

create policy join_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'join-docs' and public.can_see_join_doc(name));

create policy join_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'join-docs' and public.can_see_join_doc(name));
