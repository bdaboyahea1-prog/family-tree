-- =====================================================================
-- 019b: the settings of the tree in the backup (run ONCE if you ran 019_backup.sql before this fix)
-- The backup already carried the name, the «about» text, the rule of the women's cards and the default look;
-- now it carries also the public page switches (public_page, public_show_living), so a restore can bring back all
-- the settings of the tree. Same function, replaced in place (its permissions stay as they were).
-- A new set-up that runs the corrected 019_backup.sql does not need this file (running it anyway does no harm).
-- =====================================================================

-- The backup: one JSON document for the tree of the token.
create or replace function public.backup_export(p_token text) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_hash bytea := sha256(convert_to(coalesce(p_token, ''), 'UTF8'));
  v_tree uuid;
begin
  select tree_id into v_tree from public.backup_tokens where token_hash = v_hash;
  if v_tree is null then
    raise exception 'invalid backup token';
  end if;
  update public.backup_tokens set last_used_at = now() where token_hash = v_hash;

  return jsonb_build_object(
    'format', 'family-tree-export',
    'version', 1,
    'exportedAt', now(),
    'treeName', (select name from public.trees where id = v_tree),
    'persons', coalesce((select jsonb_agg(to_jsonb(p) - 'tree_id' - 'created_by' - 'updated_by' order by p.created_at, p.id)
                           from public.persons p where p.tree_id = v_tree), '[]'::jsonb),
    'marriages', coalesce((select jsonb_agg(to_jsonb(m) - 'tree_id' - 'created_by' - 'updated_by' order by m.created_at, m.id)
                             from public.marriages m where m.tree_id = v_tree), '[]'::jsonb),
    'extra', jsonb_build_object(
      'tree', (select jsonb_build_object('name', t.name, 'about', t.about, 'female_card_mode', t.female_card_mode,
                                         'public_page', t.public_page, 'public_show_living', t.public_show_living,
                                         'default_look', t.default_look, 'created_at', t.created_at)
                 from public.trees t where t.id = v_tree),
      'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', tm.user_id, 'role', tm.role, 'joined_at', tm.joined_at, 'display_name', pr.display_name) order by tm.joined_at)
                             from public.tree_members tm left join public.profiles pr on pr.id = tm.user_id
                            where tm.tree_id = v_tree), '[]'::jsonb),
      'branch_grants', coalesce((select jsonb_agg(to_jsonb(g) - 'tree_id') from public.branch_grants g where g.tree_id = v_tree), '[]'::jsonb),
      'card_info', coalesce((select jsonb_agg(to_jsonb(c) - 'tree_id' order by c.created_at, c.id) from public.card_info c where c.tree_id = v_tree), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(to_jsonb(cc) - 'tree_id' order by cc.created_at, cc.id) from public.card_comments cc where cc.tree_id = v_tree), '[]'::jsonb),
      'messages', coalesce((select jsonb_agg(to_jsonb(ms) - 'tree_id' order by ms.created_at, ms.id) from public.tree_messages ms where ms.tree_id = v_tree), '[]'::jsonb)
    )
  );
end;
$$;

