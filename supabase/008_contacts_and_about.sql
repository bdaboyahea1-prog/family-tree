-- =====================================================================
-- 008: optional contact details on every card + the designer's note stored privately
-- (run after 007, once)
--
--  * persons.phone / persons.email: optional. A phone may hold digits, spaces, brackets and
--    hyphens (with an optional leading + or bracket) and 4 to 20 digits; an e-mail must look like one. Anyone who may edit
--    a card may write them (same rules as the rest of the card); every member of the tree
--    can read them (same as the rest of the card); a stranger sees nothing.
--  * trees.about: the "about the designer" note (name, a few lines, phone, e-mail) as JSON.
--    It lives here, not in the published web page, so it is shown to members only.
--    Only the tree admin can change it.
--  * The undo function also restores phone and e-mail.
-- =====================================================================

alter table public.persons
  add column phone text check (
    phone is null
    or (phone ~ '^\+?[0-9(][0-9 ()-]{3,24}$'
        and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 4 and 20)
  ),
  add column email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

-- the column-level UPDATE privileges must list the new columns
grant update (phone, email) on public.persons to authenticated;

alter table public.trees
  add column about jsonb check (about is null or pg_column_size(about) <= 4000);

-- who may change it is decided by the existing trees_update policy: admins only
grant update (about) on public.trees to authenticated;


-- ---------------------------------------------------------------------
-- undo: same function as 006, now also restoring phone and e-mail
-- ---------------------------------------------------------------------

-- authorship columns of a restored row must still point to a real user
create or replace function public.revert_clean(p_old jsonb)
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
create or replace function public.revert_change(p_tree uuid, p_log_id bigint)
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
        residence_country = o.residence_country, residence_province = o.residence_province, residence_city = o.residence_city,
        birth_country = o.birth_country, birth_province = o.birth_province, birth_city = o.birth_city,
        phone = o.phone, email = o.email
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
