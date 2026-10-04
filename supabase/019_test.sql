-- =====================================================================
-- Self-test for 019: the backup door (token + backup_export)
-- Run in the SQL Editor AFTER 019_backup.sql. It creates fake data, tries it, then ROLLS
-- EVERYTHING BACK (the red "error" at the end is the report and is expected).
-- =====================================================================

begin;

create table public.t_results (n serial primary key, line text not null);
alter table public.t_results disable row level security;
grant all on public.t_results to authenticated, anon;
grant usage on sequence public.t_results_n_seq to authenticated, anon;

create table public.t_tok (t text);
alter table public.t_tok disable row level security;
grant all on public.t_tok to authenticated, anon;

create function public.tlog(p_name text, p_ok boolean) returns void
language sql as $$ insert into public.t_results (line) values (case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end || p_name) $$;

create function public.try_sql(p_sql text) returns text
language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'rows=' || n;
exception when others then
  return 'error: ' || sqlerrm;
end $$;

create function public.expect(p_name text, p_sql text, p_expected text) returns void
language plpgsql as $$
declare got text := public.try_sql(p_sql);
begin
  if (p_expected = 'error' and got like 'error%') or got = p_expected then
    insert into public.t_results (line) values ('PASS  ' || p_name);
  else
    insert into public.t_results (line) values ('FAIL  ' || p_name || '   [wanted ' || p_expected || ', got ' || got || ']');
  end if;
end $$;

create function public.u(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

create function public.as_user(p_id uuid, p_email text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

grant execute on function public.tlog(text, boolean), public.try_sql(text), public.expect(text, text, text),
  public.u(int), public.as_user(uuid, text) to authenticated, anon;

-- ---------- fake data ----------
insert into auth.users (id, email) values (public.u(101), 'a1@t.test'), (public.u(102), 'b1@t.test'), (public.u(105), 'e1@t.test');
update public.profiles set display_name = 'Owner' where id = public.u(101);
insert into public.trees (id, name, created_by) values (public.u(900), 'test tree', public.u(101)), (public.u(901), 'other tree', public.u(105));
insert into public.tree_members (tree_id, user_id, role) values
  (public.u(900), public.u(101), 'admin'), (public.u(900), public.u(102), 'viewer'), (public.u(901), public.u(105), 'admin');
insert into public.persons (id, tree_id, first_name, gender) values
  (public.u(1), public.u(900), 'جد', 'male'), (public.u(2), public.u(900), 'جدة', 'female'), (public.u(3), public.u(901), 'غريب', 'male');
insert into public.persons (id, tree_id, first_name, gender, father_id) values (public.u(4), public.u(900), 'ابن', 'male', public.u(1));
insert into public.marriages (tree_id, person_a, person_b) values (public.u(900), public.u(1), public.u(2));
insert into public.card_comments (tree_id, person_id, user_id, body) values (public.u(900), public.u(1), public.u(102), 'تعليق');
insert into public.tree_messages (tree_id, user_id, body) values (public.u(900), public.u(102), 'رسالة'), (public.u(901), public.u(105), 'رسالة الشجرة الأخرى');
insert into public.tree_invites (code, tree_id, role, email, created_by) values ('SECRETINVITECODE1', public.u(900), 'viewer', 'invited@t.test', public.u(101));

-- ---------- the token: made by the database owner ----------
insert into public.t_tok select public.make_backup_token(public.u(900), 'test');
do $$
begin
  perform public.tlog('a token is 64 letters', (select char_length(t) from public.t_tok) = 64);
  perform public.tlog('only a hash of it is kept (32 bytes), not the token', (select octet_length(token_hash) from public.backup_tokens) = 32);
end $$;

-- ---------- nobody else can make one, or look at the table ----------
set local role authenticated;
select public.as_user(public.u(101), 'a1@t.test');
select public.expect('an admin cannot make a token through the API', $q$select public.make_backup_token(public.u(900), 'x')$q$, 'error');
select public.expect('...and cannot read the tokens table', $q$select * from public.backup_tokens$q$, 'error');
reset role;
set local role anon;
select public.expect('a visitor cannot make a token', $q$select public.make_backup_token(public.u(900), 'x')$q$, 'error');
select public.expect('...and cannot read the tokens table', $q$select * from public.backup_tokens$q$, 'error');

-- ---------- the backup, asked as a visitor (the Apps Script has only the public key) ----------
select public.expect('a wrong token is refused', $q$select public.backup_export('not-the-token')$q$, 'error');
select public.expect('an empty token is refused', $q$select public.backup_export('')$q$, 'error');
select public.expect('no token at all is refused', $q$select public.backup_export(null)$q$, 'error');

do $$
declare j jsonb := public.backup_export((select t from public.t_tok));
begin
  perform public.tlog('the right token gives the backup', j is not null);
  perform public.tlog('...in the format of the program''s own backup (format + version)', j ->> 'format' = 'family-tree-export' and (j ->> 'version')::int = 1);
  perform public.tlog('...with the name of the tree', j ->> 'treeName' = 'test tree');
  perform public.tlog('...with the three persons of THIS tree (not the other tree''s)', jsonb_array_length(j -> 'persons') = 3);
  perform public.tlog('...none of them belongs to the other tree', not (j -> 'persons')::text like '%غريب%');
  perform public.tlog('...with the marriage', jsonb_array_length(j -> 'marriages') = 1);
  perform public.tlog('...the persons carry what the importer reads (id, names, gender, father_id)', (j -> 'persons' -> 0) ?& array['id', 'first_name', 'gender', 'father_id']);
  perform public.tlog('...the marriages carry person_a, person_b and status', (j -> 'marriages' -> 0) ?& array['person_a', 'person_b', 'status']);
  perform public.tlog('...no tree_id / created_by in the rows', not ((j -> 'persons' -> 0) ? 'tree_id') and not ((j -> 'persons' -> 0) ? 'created_by'));
  perform public.tlog('...the settings of the tree (name, about, rule of the women''s cards, public page, default look)', (j #> '{extra,tree}') ?& array['name', 'about', 'female_card_mode', 'public_page', 'public_show_living', 'default_look']);
  perform public.tlog('...the comments of the tree', jsonb_array_length(j #> '{extra,comments}') = 1);
  perform public.tlog('...the messages of THIS tree only', jsonb_array_length(j #> '{extra,messages}') = 1 and not (j #> '{extra,messages}')::text like '%الأخرى%');
  perform public.tlog('...the members with their names, and no e-mail addresses', jsonb_array_length(j #> '{extra,members}') = 2 and not (j #> '{extra,members}')::text like '%@%');
  perform public.tlog('...no invitation codes or invited e-mail addresses anywhere', not j::text like '%SECRETINVITECODE1%' and not j::text like '%invited@t.test%' and not (j ? 'invites'));
end $$;

reset role;
do $$
begin
  perform public.tlog('the use of the token is noted', (select last_used_at from public.backup_tokens) is not null);
end $$;

-- ---------- a token of one tree gives nothing of another ----------
insert into public.t_tok select public.make_backup_token(public.u(901), 'other');
do $$
declare j jsonb := public.backup_export((select t from public.t_tok order by ctid desc limit 1));
begin
  perform public.tlog('the token of the other tree gives the other tree only', j ->> 'treeName' = 'other tree' and jsonb_array_length(j -> 'persons') = 1 and not j::text like '%جد%');
end $$;

-- ---------- taking a token away stops the backup; deleting the tree takes its tokens ----------
delete from public.backup_tokens where label = 'test';
set local role anon;
select public.expect('a token that was deleted is refused', format($q$select public.backup_export(%L)$q$, (select t from public.t_tok order by ctid limit 1)), 'error');
reset role;
select public.expect('deleting a tree takes its tokens with it', $q$delete from public.trees where id = public.u(901)$q$, 'rows=1');
do $$
begin
  perform public.tlog('...none is left', (select count(*) from public.backup_tokens) = 0);
end $$;

do $$
declare
  r text := coalesce((select string_agg(line, E'\n' order by n) from public.t_results), '(no results)');
  fails int := (select count(*) from public.t_results where line like 'FAIL%');
  passes int := (select count(*) from public.t_results where line like 'PASS%');
begin
  raise exception E'\n===== TEST REPORT: % passed, % failed =====\n%\n(this error is expected: it cancels the test data)', passes, fails, r;
end $$;

rollback;
