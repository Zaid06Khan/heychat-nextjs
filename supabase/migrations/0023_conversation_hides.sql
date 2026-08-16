-- ---------------------------------------------------------------------------
-- 0023_conversation_hides.sql — "delete chat", and closing the version of it
-- that was already possible
--
-- THE POLICY THIS REPLACES WAS A LOADED GUN. `conversations_delete_owner` from
-- 0002 reads:
--
--     (type = 'group'  and admin_id = auth.uid())
--     or (type = 'direct' and auth.uid() = any (participant_ids))
--
-- so EITHER party to a direct chat could DELETE the conversation row — and
-- `messages.conversation_id` is `on delete cascade`, so that destroys every
-- message in it for BOTH people, permanently, with no tombstone and nothing to
-- recover from. Nobody has hit it because no screen offers it. Adding a "Delete
-- chat" button wired to the obvious thing would have shipped exactly that.
--
-- The direct clause is dropped. A direct conversation is now deleted by nobody:
-- both parties have a copy and neither owns it. Group deletion stays with the
-- admin, and `group_leave()` still deletes a group when the last member goes.
--
-- WHAT "DELETE CHAT" DOES INSTEAD is hide it for the person who asked, which is
-- the same shape as `message_hides` (0016) and for the same reason: your view is
-- yours, and the other person's copy is not yours to destroy.
--
-- A TIMESTAMP, NOT A FLAG. Hiding records *when*, so a conversation that gets a
-- new message comes back carrying only what arrived after the hide — the thread
-- you deleted stays deleted, and the reply you were sent is not lost. A boolean
-- would force a choice between resurrecting the whole history and swallowing new
-- messages, and both are wrong.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_hides (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  hidden_at       timestamptz not null default now(),
  primary key (conversation_id, account_id)
);

create index if not exists conversation_hides_account_idx
  on public.conversation_hides (account_id);

alter table public.conversation_hides enable row level security;

drop policy if exists conversation_hides_select_own on public.conversation_hides;
create policy conversation_hides_select_own on public.conversation_hides
  for select to authenticated
  using (account_id = auth.uid());

-- Only your own, and only for a conversation you are actually in — otherwise the
-- table accepts rows keyed by other people's conversation ids.
drop policy if exists conversation_hides_write_own on public.conversation_hides;
create policy conversation_hides_write_own on public.conversation_hides
  for insert to authenticated
  with check (
    account_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

-- Deleting the same chat twice moves the line forward rather than failing.
drop policy if exists conversation_hides_update_own on public.conversation_hides;
create policy conversation_hides_update_own on public.conversation_hides
  for update to authenticated
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

drop policy if exists conversation_hides_delete_own on public.conversation_hides;
create policy conversation_hides_delete_own on public.conversation_hides
  for delete to authenticated
  using (account_id = auth.uid());

grant select, insert, update, delete on public.conversation_hides to authenticated;
grant select, insert, update, delete on public.conversation_hides to service_role;

-- ---------------------------------------------------------------------------
-- The destructive delete, narrowed.
-- ---------------------------------------------------------------------------

drop policy if exists conversations_delete_owner on public.conversations;
create policy conversations_delete_owner on public.conversations
  for delete to authenticated
  using (type = 'group' and admin_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The two list RPCs have to respect the line, or a "deleted" chat announces
-- itself from the sidebar preview and the unread badge — the same mistake 0016
-- avoided for hidden messages.
--
-- Both stay SECURITY INVOKER (0011 and 0014 explain why), which is also what
-- makes auth.uid() here the caller.
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
    and (m.expiry_at is null or m.expiry_at > now())
    and not exists (
      select 1 from public.message_hides h
      where h.message_id = m.id and h.account_id = auth.uid()
    )
    and not exists (
      select 1 from public.conversation_hides ch
      where ch.conversation_id = m.conversation_id
        and ch.account_id = auth.uid()
        and m.created_date <= ch.hidden_at
    )
  order by m.conversation_id, m.created_date desc;
$$;

revoke all on function public.last_messages_for_conversations(uuid[]) from public, anon;
grant execute on function public.last_messages_for_conversations(uuid[]) to authenticated, service_role;

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
    and m.sender_id <> auth.uid()
    and not (auth.uid() = any (m.read_by))
    and m.deleted_at is null
    and (m.expiry_at is null or m.expiry_at > now())
    and not exists (
      select 1 from public.message_hides h
      where h.message_id = m.id and h.account_id = auth.uid()
    )
    and not exists (
      select 1 from public.conversation_hides ch
      where ch.conversation_id = m.conversation_id
        and ch.account_id = auth.uid()
        and m.created_date <= ch.hidden_at
    )
  group by m.conversation_id;
$$;

revoke all on function public.unread_counts(uuid[]) from public, anon;
grant execute on function public.unread_counts(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
