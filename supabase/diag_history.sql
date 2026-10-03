-- READ ONLY: changes nothing. Shows why the history / deleted list may be empty.
-- Run it in the Supabase SQL Editor and send the result grid (screenshot or copy).
--   1-tree     every tree: how many people are in it now, how many log rows, how many of them are deletions
--   2-trigger  the triggers that write the log (they must exist and show "O" = enabled)
--   3-log      the last 40 log rows of all trees (newest first)
--   4-persons  how many people exist now, and the newest 15 (to see what is left)

select part, c1, c2, c3, c4
from (
  select '1-tree' as part, 0::numeric as ord,
         t.name as c1,
         t.id::text as c2,
         (select count(*) from public.persons p where p.tree_id = t.id)::text || ' people now' as c3,
         (select count(*) from public.change_log c where c.tree_id = t.id)::text || ' log rows, '
           || (select count(*) from public.change_log c where c.tree_id = t.id and c.action = 'DELETE')::text || ' deletions' as c4
  from public.trees t

  union all
  select '2-trigger', 0, tg.tgrelid::regclass::text, tg.tgname::text,
         case tg.tgenabled when 'O' then 'enabled (ok)' when 'D' then 'DISABLED' else tg.tgenabled::text end, ''
  from pg_trigger tg
  where tg.tgrelid in ('public.persons'::regclass, 'public.marriages'::regclass) and not tg.tgisinternal

  union all
  select '3-log', c.id, c.id::text, c.action || ' ' || c.table_name,
         coalesce(c.old_data ->> 'first_name', c.new_data ->> 'first_name', ''),
         c.created_at::text
  from (select * from public.change_log order by id desc limit 40) c

  union all
  select '4-persons', extract(epoch from p.created_at), p.first_name, coalesce(p.last_name, ''),
         p.gender, p.created_at::text
  from (select * from public.persons order by created_at desc limit 15) p
) x
order by part, ord desc, c1;
