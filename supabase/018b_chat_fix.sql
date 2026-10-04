-- =====================================================================
-- 018b: the first 018_chat.sql accepted a message made only of new lines (it trimmed spaces, not line breaks).
-- Run this ONCE if you ran 018_chat.sql before this fix (the test 018_test.sql said: "a message of only spaces is refused" FAIL).
-- A new set-up that runs the corrected 018_chat.sql does not need it (running it anyway does no harm).
-- =====================================================================

alter table public.tree_messages drop constraint if exists tree_messages_body_check;
alter table public.tree_messages
  add constraint tree_messages_body_check check (char_length(body) <= 1000 and body ~ '\S');
