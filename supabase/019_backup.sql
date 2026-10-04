-- =====================================================================
-- 019: a read-only backup door for the daily backup to Google Drive (run after 018, once)
--
--  * A "backup token" is a long secret made by the database owner in the SQL Editor (make_backup_token).
--    Only its hash is stored, so a copy of the table reveals nothing. A token is tied to ONE tree.
--  * backup_export(token) returns that tree as one JSON document, and nothing else: it cannot write, and it
--    gives no access to anything but the data of that tree. A wrong token is refused.
--  * The document has the same shape as the program's own «نسخة احتياطية JSON» (format / version / persons /
--    marriages), so the program can import it back, plus the extra tables under "extra".
--  * Not included: invitation codes, requests to join (their documents and contacts), the change log, the
--    photos (they live in the private storage).
--  * To stop using a token: delete its row (delete from public.backup_tokens where label = '...').
-- =====================================================================

create table public.backup_tokens (
  token_hash   bytea primary key,                       -- sha256 of the token (the token itself is never kept)
  tree_id      uuid not null references public.trees (id) on delete cascade,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- nobody reaches this table through the API
alter table public.backup_tokens enable row level security;
revoke all on public.backup_tokens from public, anon, authenticated;

-- Make a token for a tree. The token is shown ONCE (here, as the result): copy it at once.
-- Only the database owner (the SQL Editor) may call it.
create function public.make_backup_token(p_tree uuid, p_label text default null) returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not exists (select 1 from public.trees where id = p_tree) then
    raise exception 'no such tree';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); -- 64 hex letters, from the strong random source
  insert into public.backup_tokens (token_hash, tree_id, label)
  values (sha256(convert_to(v_token, 'UTF8')), p_tree, p_label);
  return v_token;
end;
$$;

revoke all on function public.make_backup_token(uuid, text) from public, anon, authenticated;

-- The backup: one JSON document for the tree of the token.
create function public.backup_export(p_token text) returns jsonb
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
      'tree', (select jsonb_build_object('name', t.name, 'about', t.about, 'female_card_mode', t.female_card_mode, 'default_look', t.default_look, 'created_at', t.created_at)
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

revoke all on function public.backup_export(text) from public;
grant execute on function public.backup_export(text) to anon, authenticated;
