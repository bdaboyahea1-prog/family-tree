-- =====================================================================
-- 015: the look of the tree: a default for everybody, and one's own choices (run after 014, once)
--
--  * trees.default_look: the look the tree ADMIN chose for everybody (a small JSON object: the shape of the tree,
--    the look of the cards, the colours …). Every member can read it (it is part of the tree); only the tree
--    admin can change it (the same rule as renaming the tree).
--  * profiles.look: what one member chose for themselves only. Only that person can change it. It follows the
--    person to any device they sign in from.
--  A key a member never touched follows the default, so a new default reaches everybody who did not choose for
--  themselves. The front-end (js/look.js) keeps only the known keys with allowed values; the database only checks
--  that it is an object and that it is small.
-- =====================================================================

alter table public.trees
  add column default_look jsonb
  check (default_look is null or (jsonb_typeof(default_look) = 'object' and pg_column_size(default_look) <= 2000));

alter table public.profiles
  add column look jsonb
  check (look is null or (jsonb_typeof(look) = 'object' and pg_column_size(look) <= 2000));

-- the column-level UPDATE privileges must list the new columns; the row rules stay as they were
-- (trees_update: the admin of that tree; profiles_update: the owner of the row)
grant update (default_look) on public.trees to authenticated;
grant update (look) on public.profiles to authenticated;
