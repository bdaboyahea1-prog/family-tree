-- =====================================================================
-- 009: what may be added under a woman's card
-- (run after 008, once)
--
-- Each tree has ONE rule for the cards of women, chosen by the tree admin (trees.female_card_mode):
--   'full'  a woman's card may hold sons / daughters like any man's card (they become cards in the tree)
--   'info'  no cards under a woman: her sons / daughters are written into an information table
--           (card_info) that is shown next to her card and never drawn as cards
--   'none'  nothing is added about the branch of a woman: no cards and no information rows
-- The default is 'full', so nothing changes until the admin picks another rule.
--
--  * Rows of card_info: members read them. Whoever may add children on that card writes them
--    (admin, editor, or a reader holding the "add" right on that card or above it), and only
--    while the tree is on 'info' and the card belongs to a woman.
--  * 'info' and 'none': a member who is not the admin cannot create a card that hangs under a
--    woman (a person with a mother but no father on record). A child with a recorded father is
--    unaffected: it hangs under the father. The admin is exempt (imports, undo).
--  * The information rows have no change-log entry and cannot be undone; deleting them is final.
-- =====================================================================

alter table public.trees
  add column female_card_mode text not null default 'full'
    check (female_card_mode in ('full', 'info', 'none'));

-- who may change it is decided by the existing trees_update policy: admins only
grant update (female_card_mode) on public.trees to authenticated;


-- ---------------------------------------------------------------------
-- 1) The information table
-- ---------------------------------------------------------------------

create table public.card_info (
  id                 uuid primary key default gen_random_uuid(),
  tree_id            uuid not null references public.trees (id) on delete cascade,
  person_id          uuid not null,                       -- the woman the row is about
  kind               text not null check (kind in ('son', 'daughter', 'spouse')),
  first_name         text not null check (char_length(first_name) between 1 and 100),
  last_name          text check (char_length(last_name) <= 100),
  birth_date         text check (char_length(birth_date) <= 40),
  death_date         text check (char_length(death_date) <= 40),
  is_deceased        boolean not null default false,
  birth_country      text check (birth_country is null or birth_country ~ '^[A-Z]{2}$'),
  birth_province     text check (birth_province is null or char_length(birth_province) <= 100),
  birth_city         text check (birth_city is null or char_length(birth_city) <= 100),
  birth_place        text check (birth_place is null or char_length(birth_place) <= 100),
  residence_country  text check (residence_country is null or residence_country ~ '^[A-Z]{2}$'),
  residence_province text check (residence_province is null or char_length(residence_province) <= 100),
  residence_city     text check (residence_city is null or char_length(residence_city) <= 100),
  phone              text check (
    phone is null
    or (phone ~ '^\+?[0-9(][0-9 ()-]{3,24}$'
        and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 4 and 20)
  ),
  email              text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  notes              text check (notes is null or char_length(notes) <= 2000),
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),

  -- the woman must be in the same tree; her information goes with her
  foreign key (person_id, tree_id) references public.persons (id, tree_id) on delete cascade
);
create index on public.card_info (tree_id, person_id);

create trigger card_info_touch before insert or update on public.card_info
  for each row execute function public.touch_row();


-- ---------------------------------------------------------------------
-- 2) Rules
-- ---------------------------------------------------------------------

-- May the current user write information rows about this card? The same people who may add a child on it.
create function public.can_manage_info(p_tree uuid, p_person uuid)
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
  if v_role is null or not public.has_grants(p_tree, 'add') then
    return false;
  end if;
  return public.under_my_grant(p_tree, p_person, 'add');
end;
$$;

-- New information rows are accepted only while the tree is on 'info', and only about a woman's card.
create function public.info_allowed(p_tree uuid, p_person uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.trees t where t.id = p_tree and t.female_card_mode = 'info')
     and exists (select 1 from public.persons p where p.id = p_person and p.tree_id = p_tree and p.gender = 'female');
$$;

alter table public.card_info enable row level security;

create policy card_info_select on public.card_info for select to authenticated
  using (public.tree_role(tree_id) is not null);

create policy card_info_insert on public.card_info for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_manage_info(tree_id, person_id)
    and public.info_allowed(tree_id, person_id)
  );

create policy card_info_update on public.card_info for update to authenticated
  using      (public.can_manage_info(tree_id, person_id))
  with check (public.can_manage_info(tree_id, person_id) and public.info_allowed(tree_id, person_id));

-- deleting is always allowed to those who manage the card (also after the rule changed)
create policy card_info_delete on public.card_info for delete to authenticated
  using (public.can_manage_info(tree_id, person_id));

grant select, insert, delete on public.card_info to authenticated;
grant update (kind, first_name, last_name, birth_date, death_date, is_deceased, birth_country, birth_province,
              birth_city, birth_place, residence_country, residence_province, residence_city, phone, email, notes)
  on public.card_info to authenticated;
revoke all on function public.can_manage_info(uuid, uuid) from public, anon;
revoke all on function public.info_allowed(uuid, uuid)    from public, anon;
grant execute on function public.can_manage_info(uuid, uuid), public.info_allowed(uuid, uuid) to authenticated;


-- A card that hangs under a woman (a person with a mother and no father on record) may only be created
-- by the admin when the tree is not on 'full'.
create function public.enforce_female_card_mode()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  if new.father_id is null and new.mother_id is not null then
    select female_card_mode into v_mode from public.trees where id = new.tree_id;
    if v_mode is distinct from 'full'
       and public.tree_role(new.tree_id) is distinct from 'admin'
       and exists (select 1 from public.persons m where m.id = new.mother_id and m.tree_id = new.tree_id and m.gender = 'female')
    then
      raise exception 'female cards cannot hold branches in this tree (rule: %)', v_mode using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_female_card_mode() from public, anon, authenticated;

create trigger persons_female_mode before insert on public.persons
  for each row execute function public.enforce_female_card_mode();
