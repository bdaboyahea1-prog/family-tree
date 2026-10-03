-- =====================================================================
-- 016: the names on the public page are written like the cards: first name + father + family
-- (run after 015, once)
--
-- The public page shows the top ancestor and the people directly under him. Until now a person was written
-- as "first name + family" ("علي هرموش"). Now a child of the top ancestor is written with the father's name
-- between them ("علي خالد هرموش"), the way the cards of the tree are written. Rules, the same as on the cards:
--   * a person with no father on record (the top ancestor himself) stays "first name + family";
--   * the father's name is not repeated when it is already at the end of the first name; a son with the same
--     name as his father keeps both;
--   * the tree admin's default look can turn this off for everybody (trees.default_look -> "tripleName": false).
-- Nothing else changes: the same people are shown, the same living people stay hidden, no extra data is given.
-- The page asks the database every time it opens (and again while it stays open), so a change in the tree
-- reaches the public page by itself.
-- =====================================================================

drop function public.teaser_card(public.persons, boolean);

-- p_father: the first name of the father to write between the first name and the family (NULL: none)
create function public.teaser_card(p public.persons, p_show_living boolean, p_father text default null)
returns jsonb
language sql immutable
set search_path = public
as $$
  select case
    when not p.is_deceased and not p_show_living then null
    else jsonb_build_object(
      'name', btrim(regexp_replace(concat_ws(' ',
          p.first_name,
          case
            when nullif(btrim(p_father), '') is null then null
            -- the first name already ends with the father's name ("عبد الرحمن يحيى"): do not write it twice
            when lower(btrim(p.first_name)) <> lower(btrim(p_father))
             and right(lower(btrim(p.first_name)), char_length(btrim(p_father)) + 1) = ' ' || lower(btrim(p_father)) then null
            else btrim(p_father)
          end,
          p.last_name), '\s+', ' ', 'g')),
      'gender', p.gender,
      'birth_year', case when p.is_deceased then nullif(substring(p.birth_date from '[0-9]{4}'), '')::int end,
      'death_year', case when p.is_deceased then nullif(substring(p.death_date from '[0-9]{4}'), '')::int end,
      'deceased', p.is_deceased
    )
  end
$$;
revoke all on function public.teaser_card(public.persons, boolean, text) from public, anon, authenticated;

create or replace function public.public_teaser()
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
  v_triple boolean;
begin
  select id, name, public_show_living, default_look into t
  from public.trees where public_page order by created_at limit 1;
  if not found then
    return null;
  end if;
  -- written with the father's name unless the admin turned it off in the default look
  v_triple := coalesce(t.default_look -> 'tripleName' = 'true'::jsonb, true);

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
      v_card := case
        when v_root is null then null
        else public.teaser_card(c, t.public_show_living, case when v_triple and c.father_id = r.id then r.first_name end)
      end;
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
