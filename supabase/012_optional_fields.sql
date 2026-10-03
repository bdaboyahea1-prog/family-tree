-- =====================================================================
-- 012: the document, the city, the phone and the e-mail are optional in a request to join
-- (run after 011, once)
--
-- WITHOUT A DOCUMENT the request is opened to the admin at once ("pending"); with one it is still a
-- draft until the file is uploaded and confirmed (as in 011).
-- WITHOUT A PHONE AND WITHOUT AN E-MAIL the visitor follows the request with the secret tracking code
-- only. Approving such a request cannot create an invitation (an invitation belongs to an e-mail), so:
--   * the tracking page shows "approved" and asks for the e-mail the person wants to register with;
--   * claim_join_invite(code, e-mail) then creates the single-use invitation for that e-mail. Only the
--     holder of the secret code can do this, and only after the admin approved.
--   * until the invitation is used the person may correct the e-mail (the old invitation is disabled).
-- Everything else stays as it was: the limits, the hidden field, the single upload path.
-- =====================================================================

alter table public.join_requests
  alter column phone drop not null,
  alter column contact_email drop not null,
  add column invite_claimed boolean not null default false;   -- the e-mail of the invitation was typed by the person

-- ---------------------------------------------------------------------
-- 1) The form
-- ---------------------------------------------------------------------

create or replace function public.submit_join_request(
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
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_hash  text := public.client_hash();
  v_ext   text := nullif(btrim(coalesce(p_doc_ext, '')), '');
  v_path  text := case when nullif(btrim(coalesce(p_doc_ext, '')), '') is null then null
                       else 'req/' || v_id::text || '.' || btrim(p_doc_ext) end;
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
  if v_ext is not null and v_ext not in ('jpg', 'png', 'webp', 'pdf') then
    raise exception 'invalid document type';
  end if;
  if (select count(*) from public.join_requests
       where client_hash = v_hash and created_at > now() - make_interval(days => 1)) >= 5 then
    raise exception 'too many join requests' using errcode = '42501';
  end if;
  if v_email is not null then
    if (select count(*) from public.join_requests
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
  end if;

  insert into public.join_requests
    (id, tree_id, user_id, full_name, relation, residence_country, residence_city, phone, contact_email,
     doc_path, status, track_code, client_hash)
  values
    (v_id, p_tree, null, btrim(p_full_name), btrim(p_relation), nullif(btrim(p_country), ''), nullif(btrim(p_city), ''),
     v_phone, v_email, v_path,
     case when v_path is null then 'pending' else 'draft' end,   -- without a document there is nothing to wait for
     v_code, v_hash);

  return jsonb_build_object('id', v_id, 'code', v_code, 'path', v_path);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Where is my request? (adds: needs_email, claimed)
-- ---------------------------------------------------------------------

create or replace function public.join_status(p_code text)
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
    'invite_code', v_link, 'registered', v_done,
    'needs_email', r.status = 'approved' and r.contact_email is null and r.invite_code is null,
    'claimed', r.invite_claimed
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3) The admin decides: an invitation is created now only when the request has an e-mail
-- ---------------------------------------------------------------------

create or replace function public.decide_join_request(p_id uuid, p_approve boolean, p_note text default null)
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
  if p_approve and r.contact_email is not null then
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

-- ---------------------------------------------------------------------
-- 4) Approved without an e-mail: the person types the e-mail to register with
-- ---------------------------------------------------------------------

create function public.claim_join_invite(p_code text, p_email text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  r        public.join_requests%rowtype;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_invite text;
begin
  if p_code is null or p_code !~ '^[0-9a-f]{32}$' then
    raise exception 'request not found';
  end if;
  select * into r from public.join_requests where track_code = p_code for update;
  if not found or r.status <> 'approved' then
    raise exception 'request not found';
  end if;
  -- only a request that has no e-mail of its own, or one whose e-mail was typed here and is not used yet
  if r.contact_email is not null and not r.invite_claimed then
    raise exception 'request not found';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email';
  end if;
  if r.invite_code is not null then
    if exists (select 1 from public.tree_invites where code = r.invite_code and uses >= max_uses) then
      raise exception 'invite already used';
    end if;
    update public.tree_invites set enabled = false where code = r.invite_code;   -- the one for the wrong e-mail
  end if;
  if exists (select 1 from auth.users u join public.tree_members m on m.user_id = u.id
              where lower(u.email) = v_email and m.tree_id = r.tree_id) then
    raise exception 'already a member';
  end if;
  insert into public.tree_invites (tree_id, role, email, created_by)
  values (r.tree_id, 'viewer', public.norm_email(v_email), r.decided_by)
  returning code into v_invite;
  update public.join_requests
     set invite_code = v_invite, contact_email = v_email, invite_claimed = true
   where id = r.id;
  return v_invite;
end;
$$;

revoke all on function public.claim_join_invite(text, text) from public;
grant execute on function public.claim_join_invite(text, text) to anon, authenticated;
