-- ---------------------------------------------------------------------------
-- 0016_message_hides.sql — "delete for me"
--
-- Until now the only delete was "delete for everyone" (0012): it nulls the body
-- and tombstones the row for every participant. There was no way to get a
-- message out of your own view without taking it out of theirs too, which is
-- the wrong tool for most of the reasons people actually want a message gone —
-- clearing your own clutter, or removing something you would rather not scroll
-- past, without announcing that to the other person.
--
-- WHY A TABLE AND NOT A COLUMN. The obvious shape is `hidden_by uuid[]` on
-- `messages`, mirroring `read_by`. It is the wrong shape here for the same
-- reason `read_by` needed `mark_message_read()`: `messages_update_sender` only
-- lets the AUTHOR update a message, so a recipient hiding someone else's
-- message would need either a widened UPDATE policy — which is exactly the hole
-- 0015 spent a migration closing on `conversations` — or another SECURITY
-- DEFINER function. A separate table needs neither. The row is the caller's own
-- and ordinary RLS on `account_id = auth.uid()` says everything.
--
-- IT IS NOT PRIVACY. Hiding is a view preference, not a deletion: the row is
-- untouched and the server can still read it. Anyone treating this as "gone"
-- would be wrong, which is why the UI names the two actions differently and
-- why "delete for everyone" stays the destructive one.
-- ---------------------------------------------------------------------------

create table if not exists public.message_hides (
  message_id   uuid not null references public.messages(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  created_date timestamptz not null default now(),
  primary key (message_id, account_id)
);

-- The read path is "give me the hides for these messages, for me", which the
-- primary key already serves. This one serves the cascade when an account is
-- deleted, which would otherwise be a sequential scan per account.
create index if not exists message_hides_account_idx
  on public.message_hides (account_id);

alter table public.message_hides enable row level security;

-- Your own hides, and only for messages you can actually see. The membership
-- test is not strictly required — hiding a message you cannot read changes
-- nothing you can observe — but without it the table would accept rows for
-- arbitrary message ids, which turns it into a place to store data keyed by
-- other people's identifiers.
drop policy if exists message_hides_select_own on public.message_hides;
create policy message_hides_select_own on public.message_hides
  for select to authenticated
  using (account_id = auth.uid());

drop policy if exists message_hides_insert_own on public.message_hides;
create policy message_hides_insert_own on public.message_hides
  for insert to authenticated
  with check (
    account_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

-- Undo. Nothing in the UI offers it yet, but a hide that cannot be lifted is a
-- one-way door on a view preference, and the policy costs one statement.
drop policy if exists message_hides_delete_own on public.message_hides;
create policy message_hides_delete_own on public.message_hides
  for delete to authenticated
  using (account_id = auth.uid());

grant select, insert, delete on public.message_hides to authenticated;

-- ---------------------------------------------------------------------------
-- The two list RPCs have to agree with the thread.
--
-- Without this, hiding the newest message in a conversation leaves it sitting
-- in the sidebar as the preview line, and still counted in the unread badge —
-- a message you have removed from your own view telling you about itself twice
-- from somewhere else. Both functions keep everything else they already did;
-- the only change is one NOT EXISTS.
--
-- Both stay SECURITY INVOKER for the reasons 0011 and 0014 give, and that also
-- makes `auth.uid()` here the caller, which is what the hide is keyed on.
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
  group by m.conversation_id;
$$;

revoke all on function public.unread_counts(uuid[]) from public, anon;
grant execute on function public.unread_counts(uuid[]) to authenticated, service_role;

-- Make the new table and the replaced functions visible to the API immediately.
-- See scripts/reload-api-cache.sql for why this is needed and not automatic.
notify pgrst, 'reload schema';
