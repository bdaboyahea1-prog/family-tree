-- =====================================================================
-- 004: current residence (country + city) + undo (revert any change, including deletions)
--      + private photo storage            (run after 003, once)
--
-- RESIDENCE
--   persons.residence_country  ISO code ("SY"); the page shows the Arabic name
--   persons.residence_city     free text ("دمشق")
--   (birth_place stays as it was: where the person was born.)
--   Two fields instead of one free text so people can be grouped and searched by country / city.
--
-- UNDO
--   Every web request is one database transaction, so every row written by the
--   change log in that transaction shares a `txid`. Reverting a change reverts the
--   whole group (for a deletion: the person, the marriages that went with them and
--   the children that were detached), newest first.
--   It is refused when something changed since, so later work is never overwritten:
--   undo the newer changes first. Only admins can revert. A revert is logged too,
--   so it can be undone as well.
--
-- PHOTOS
--   A PRIVATE bucket "photos". Files live under  <tree_id>/<person_id>/<random>.jpg
--   * any member of the tree can look at them (through short-lived signed links)
--   * only someone allowed to EDIT that person's card can upload / replace / delete
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) Residence
-- ---------------------------------------------------------------------

alter table public.persons
  add column residence_country text check (residence_country is null or residence_country ~ '^[A-Z]{2}$'),
  add column residence_city    text check (residence_city is null or char_length(residence_city) <= 100);
create index on public.persons (tree_id, residence_country);

-- the column-level UPDATE privileges from 002 must list the new columns
grant update (residence_country, residence_city) on public.persons to authenticated;


-- ---------------------------------------------------------------------
-- 1) Change groups
-- ---------------------------------------------------------------------

alter table public.change_log add column txid bigint default txid_current();
create index on public.change_log (tree_id, txid);


-- ---------------------------------------------------------------------
-- 2) Revert
-- ---------------------------------------------------------------------

-- authorship columns of a restored row must still point to a real user
create function public.revert_clean(p_old jsonb)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when p_old is null then null else
    p_old
      || jsonb_build_object('created_by', (select u.id from auth.users u where u.id = nullif(p_old ->> 'created_by', '')::uuid))
      || jsonb_build_object('updated_by', null)
  end;
$$;
revoke all on function public.revert_clean(jsonb) from public, anon, authenticated;

-- Reverts the whole group that contains change p_log_id. Returns how many rows were undone.
--
-- The order of the log rows inside one group is NOT relied upon (cascades and triggers may log
-- in any order). The group is undone in phases that keep every foreign key valid:
--   B  bring back deleted people (parents before children)
--   C  restore the old values of edited rows
--   D  bring back deleted marriages
--   A  remove what the group created (marriages first, then people)
create function public.revert_change(p_tree uuid, p_log_id bigint)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_anchor   public.change_log%rowtype;
  r          public.change_log%rowtype;
  cur        jsonb;
  n          int := 0;
  strip      text[] := array['updated_at', 'updated_by'];
  v_todo     bigint[];
  v_left     bigint[];
  v_id       bigint;
  v_progress boolean;
begin
  if public.tree_role(p_tree) is distinct from 'admin' then
    raise exception 'admins only';
  end if;

  select * into v_anchor from public.change_log where id = p_log_id and tree_id = p_tree;
  if not found then
    raise exception 'change not found';
  end if;

  -- ---- B: deleted persons come back; a person whose parent is also coming back waits for it
  v_todo := array(
    select id from public.change_log
    where tree_id = p_tree and table_name = 'persons' and action = 'DELETE'
      and case when v_anchor.txid is null then id = v_anchor.id else txid = v_anchor.txid end
    order by id
  );
  while coalesce(array_length(v_todo, 1), 0) > 0 loop
    v_left := '{}';
    v_progress := false;
    foreach v_id in array v_todo loop
      select * into r from public.change_log where id = v_id;
      if exists (select 1 from public.persons where id = r.record_id) then
        raise exception 'changed since: this person exists again';
      end if;
      begin
        insert into public.persons select * from jsonb_populate_record(null::public.persons, public.revert_clean(r.old_data));
        n := n + 1;
        v_progress := true;
      exception when foreign_key_violation then
        v_left := v_left || v_id;   -- a parent is not back yet: try again next round
      end;
    end loop;
    if not v_progress then
      raise exception 'changed since: a parent of a deleted person no longer exists';
    end if;
    v_todo := v_left;
  end loop;

  -- ---- C: edited rows get their old values back (only if nothing touched them since)
  for r in
    select * from public.change_log
    where tree_id = p_tree and action = 'UPDATE'
      and case when v_anchor.txid is null then id = v_anchor.id else txid = v_anchor.txid end
    order by id desc
  loop
    if r.table_name = 'persons' then
      select jsonb_strip_nulls(to_jsonb(x) - strip) into cur from public.persons x where x.id = r.record_id;
      if cur is null or cur is distinct from jsonb_strip_nulls(r.new_data - strip) then
        raise exception 'changed since: newer changes exist, undo them first';
      end if;
      update public.persons p set
        first_name = o.first_name, last_name = o.last_name, gender = o.gender,
        father_id = o.father_id, mother_id = o.mother_id,
        birth_date = o.birth_date, birth_place = o.birth_place,
        is_deceased = o.is_deceased, death_date = o.death_date,
        photo_url = o.photo_url, notes = o.notes,
        residence_country = o.residence_country, residence_city = o.residence_city
      from jsonb_populate_record(null::public.persons, r.old_data) o
      where p.id = r.record_id;
    else
      select jsonb_strip_nulls(to_jsonb(x) - strip) into cur from public.marriages x where x.id = r.record_id;
      if cur is null or cur is distinct from jsonb_strip_nulls(r.new_data - strip) then
        raise exception 'changed since: newer changes exist, undo them first';
      end if;
      update public.marriages m set
        person_a = o.person_a, person_b = o.person_b,
        marriage_date = o.marriage_date, status = o.status
      from jsonb_populate_record(null::public.marriages, r.old_data) o
      where m.id = r.record_id;
    end if;
    n := n + 1;
  end loop;

  -- ---- D: deleted marriages come back (both people exist again by now)
  for r in
    select * from public.change_log
    where tree_id = p_tree and table_name = 'marriages' and action = 'DELETE'
      and case when v_anchor.txid is null then id = v_anchor.id else txid = v_anchor.txid end
    order by id desc
  loop
    if exists (select 1 from public.marriages where id = r.record_id) then
      raise exception 'changed since: this marriage exists again';
    end if;
    insert into public.marriages select * from jsonb_populate_record(null::public.marriages, public.revert_clean(r.old_data));
    n := n + 1;
  end loop;

  -- ---- A: what the group created is removed, marriages first, newest first
  for r in
    select * from public.change_log
    where tree_id = p_tree and action = 'INSERT'
      and case when v_anchor.txid is null then id = v_anchor.id else txid = v_anchor.txid end
    order by (table_name = 'marriages') desc, id desc
  loop
    if r.table_name = 'marriages' then
      select jsonb_strip_nulls(to_jsonb(x) - strip) into cur from public.marriages x where x.id = r.record_id;
      if cur is null or cur is distinct from jsonb_strip_nulls(r.new_data - strip) then
        raise exception 'changed since: newer changes exist, undo them first';
      end if;
      delete from public.marriages where id = r.record_id;
    else
      select jsonb_strip_nulls(to_jsonb(x) - strip) into cur from public.persons x where x.id = r.record_id;
      if cur is null or cur is distinct from jsonb_strip_nulls(r.new_data - strip) then
        raise exception 'changed since: newer changes exist, undo them first';
      end if;
      if exists (select 1 from public.persons where father_id = r.record_id or mother_id = r.record_id)
         or exists (select 1 from public.marriages where person_a = r.record_id or person_b = r.record_id) then
        raise exception 'changed since: people or marriages were attached to this person, undo them first';
      end if;
      delete from public.persons where id = r.record_id;
    end if;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.revert_change(uuid, bigint) from public, anon;
grant execute on function public.revert_change(uuid, bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 3) Photos: private bucket + policies
-- ---------------------------------------------------------------------

-- text -> uuid, or NULL when it is not a valid uuid (never raises)
create function public.try_uuid(p text)
returns uuid
language plpgsql immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- May the current user change the photo of this person (= edit that card)?
create function public.can_edit_photo(p_tree uuid, p_person uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select public.can_write_person(x.tree_id, x.id, x.father_id, x.mother_id, x.created_by, 'edit')
     from public.persons x
     where x.id = p_person and x.tree_id = p_tree),
    false);
$$;

revoke all on function public.try_uuid(text)             from public, anon;
revoke all on function public.can_edit_photo(uuid, uuid) from public, anon;
grant execute on function public.try_uuid(text)             to authenticated;
grant execute on function public.can_edit_photo(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 524288,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.tree_role(public.try_uuid((storage.foldername(name))[1])) is not null
  );

create policy photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and public.can_edit_photo(
          public.try_uuid((storage.foldername(name))[1]),
          public.try_uuid((storage.foldername(name))[2]))
  );

create policy photos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'photos'
    and public.can_edit_photo(
          public.try_uuid((storage.foldername(name))[1]),
          public.try_uuid((storage.foldername(name))[2]))
  )
  with check (
    bucket_id = 'photos'
    and public.can_edit_photo(
          public.try_uuid((storage.foldername(name))[1]),
          public.try_uuid((storage.foldername(name))[2]))
  );

create policy photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and public.can_edit_photo(
          public.try_uuid((storage.foldername(name))[1]),
          public.try_uuid((storage.foldername(name))[2]))
  );
