-- ---------------------------------------------------------------------------
-- 0011_conversation_list.sql — one query for the conversation list
--
-- FOLLOWUPS #8, the measurable part. Rendering /home did this:
--
--   1 query   the caller's conversations
--   N queries the other participant's account, one per direct conversation
--   N queries the last message, one per conversation
--
-- so a user with fifteen conversations paid thirty-one round trips to draw one
-- screen, every time any message anywhere changed.
--
-- The account lookups collapse into a single `in` filter on the client. The
-- last-message lookup cannot: "the newest row per group" is `distinct on` in
-- Postgres, and PostgREST has no way to express it. Hence this function.
--
-- SECURITY INVOKER — the default, stated here because it is load-bearing rather
-- than incidental. This function must NOT be `security definer`: running it as
-- the owner would bypass RLS on `messages` and hand back the last message of
-- any conversation whose id the caller could guess. As an invoker function the
-- existing messages_select policy applies unchanged, so a caller sees exactly
-- the rows they could have selected themselves — one boundary, already tested.
-- ---------------------------------------------------------------------------

create or replace function public.last_messages_for_conversations(conv_ids uuid[])
returns table (
  conversation_id uuid,
  id              uuid,
  sender_id       uuid,
  content         text,
  media_url       text,
  message_type    message_type,
  created_date    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  -- `distinct on (conversation_id)` keeps the first row of each group, and the
  -- ORDER BY decides which one that is: conversation_id first because
  -- `distinct on` requires it to lead, then newest first within the group.
  select distinct on (m.conversation_id)
    m.conversation_id,
    m.id,
    m.sender_id,
    m.content,
    m.media_url,
    m.message_type,
    m.created_date
  from public.messages m
  where m.conversation_id = any (conv_ids)
    -- Expired messages are deleted on a schedule (0010), not instantly, so a
    -- row can outlive its expiry by a few minutes. Excluding it here stops a
    -- message that has visibly disappeared from the thread reappearing as the
    -- preview line in the sidebar.
    and (m.expiry_at is null or m.expiry_at > now())
  order by m.conversation_id, m.created_date desc;
$$;

revoke all on function public.last_messages_for_conversations(uuid[]) from public, anon;
grant execute on function public.last_messages_for_conversations(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Supporting index.
--
-- `messages_conversation_idx` from 0001 is (conversation_id, created_date)
-- ASCENDING, which serves "the thread, oldest first" — the ChatView query. This
-- one wants the newest per conversation, and a DESC index lets that be a
-- backwards scan of one entry per group rather than a sort.
-- ---------------------------------------------------------------------------

create index if not exists messages_conversation_recent_idx
  on public.messages (conversation_id, created_date desc);
