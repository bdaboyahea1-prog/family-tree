-- =====================================================================
-- 018: the family chat room (run after 017, once)
--
--  * One room per tree: every member of the tree reads it and writes in it (readers too).
--  * Text only, up to 1000 letters a message. No editing: a message is written once, and deleted when needed.
--  * You delete your own messages; an admin of the tree (the owner is one) deletes any.
--  * A member can write at most 10 messages a minute (a speed bump against flooding).
--  * Messages stay when their author leaves the tree (the name is then shown as «عضو سابق»);
--    they go with the tree if the tree is deleted.
-- =====================================================================

create table public.tree_messages (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references public.trees (id) on delete cascade,
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  body       text not null check (char_length(body) <= 1000 and body ~ '\S'), -- not empty, not only spaces / new lines
  created_at timestamptz not null default now()
);

create index tree_messages_tree_time on public.tree_messages (tree_id, created_at desc);

alter table public.tree_messages enable row level security;

-- members of the tree read it, and write as themselves
create policy tm_select on public.tree_messages for select to authenticated
  using (public.tree_role(tree_id) is not null);
create policy tm_insert on public.tree_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.tree_role(tree_id) is not null);
-- the author deletes their own message; an admin deletes any
create policy tm_delete on public.tree_messages for delete to authenticated
  using (user_id = (select auth.uid()) or public.tree_role(tree_id) = 'admin');

grant select, insert, delete on public.tree_messages to authenticated;

-- at most 10 messages a minute from one person
create function public.limit_chat_rate() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.tree_messages
       where user_id = new.user_id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'too many messages, wait a minute';
  end if;
  return new;
end;
$$;

create trigger tree_messages_rate before insert on public.tree_messages
  for each row execute function public.limit_chat_rate();

revoke all on function public.limit_chat_rate() from public, anon, authenticated;

-- new messages reach open screens at once
alter publication supabase_realtime add table public.tree_messages;
