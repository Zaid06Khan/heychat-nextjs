-- ---------------------------------------------------------------------------
-- 0014_unread_counts.sql — count what you haven't read
--
-- `messages.read_by` has been written on every message since 0001 and never
-- once read back. Nothing in the app told you a conversation had something new
-- in it: no badge, no bold, no count. You found out by opening each one.
--
-- Counting client-side is not an option. It would mean fetching every message
-- of every conversation just to count the unread ones — the N+1 that
-- 0011_conversation_list.sql exists to have removed. So: one function, one
-- round trip, counts done by Postgres.
--
-- SECURITY INVOKER, stated because it is load-bearing rather than incidental
-- (same reasoning as 0011). As an invoker function the messages_select_member
-- policy applies, so a caller can only count rows they could have selected
-- themselves. As `definer` this would happily report the unread count of any
-- conversation whose id someone guessed — a small leak, but a real one:
-- message volume in a conversation you are not part of.
-- ---------------------------------------------------------------------------

create or replace function public.unread_counts(conv_ids uuid[])
returns table (conversation_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint
  from public.messages m
  where m.conversation_id = any (conv_ids)
    -- Your own messages are never unread to you.
    and m.sender_id <> auth.uid()
    and not (auth.uid() = any (m.read_by))
    -- A tombstone is not something to chase. Counting deleted messages would
    -- leave a badge pointing at "This message was deleted".
    and m.deleted_at is null
    -- Expired messages are swept on a schedule (0010), so a row can outlive its
    -- expiry by a few minutes. Excluding them here stops a badge advertising a
    -- message that has already vanished from the thread.
    and (m.expiry_at is null or m.expiry_at > now())
  group by m.conversation_id;
$$;

revoke all on function public.unread_counts(uuid[]) from public, anon;
grant execute on function public.unread_counts(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Supporting index.
--
-- The filter is (conversation_id, sender_id) with an array membership test on
-- read_by. The array test cannot be indexed usefully here — `NOT (x = ANY(...))`
-- is not a searchable operator — but narrowing to "this conversation, not from
-- me, not deleted" first leaves few enough rows that it does not matter.
--
-- Partial on deleted_at because tombstones are permanently uncountable and
-- there is no reason to carry them in the index.
-- ---------------------------------------------------------------------------

create index if not exists messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where deleted_at is null;

-- Make the new function visible to the API immediately. See
-- scripts/reload-api-cache.sql for why this is needed and not automatic.
notify pgrst, 'reload schema';
