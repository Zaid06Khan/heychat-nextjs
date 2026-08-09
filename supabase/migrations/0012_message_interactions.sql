-- ---------------------------------------------------------------------------
-- 0012_message_interactions.sql — replies, reactions, edit and delete
--
-- The messages table has carried the same five meaningful columns since the
-- port: content, media_url, message_type, expiry_at, read_by. Everything people
-- expect a messenger to do beyond "send text" was absent.
--
-- Four additions, and one of them is not what it first appears:
--
--   reply_to_id   quote a message you are answering
--   edited_at     "edited" marker; the timestamp doubles as the flag
--   deleted_at    tombstone for delete-for-everyone
--   reactions     a separate table, because they are many-per-message
--
-- DELETE IS A REAL DELETE. `deleted_at` is not a visibility flag with the text
-- still sitting underneath it — the accompanying update also nulls `content`
-- and `media_url`, and a trigger queues the attachment for removal from
-- storage. A "deleted" message whose body is still in the database and still
-- selectable by every participant is not deleted, it is hidden, and shipping
-- the second while saying the first is how people get hurt.
--
-- No new UPDATE policy is needed for any of this: messages_update_sender from
-- 0002 already restricts editing to a message's author, which is exactly who
-- may edit or delete it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.messages
  -- ON DELETE SET NULL rather than CASCADE: deleting a message must not take
  -- the replies to it with it. The reply survives and renders as a quote of
  -- something no longer available, which is the truth.
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null,
  add column if not exists edited_at   timestamptz,
  add column if not exists deleted_at  timestamptz;

-- Partial: only replies have a reply_to_id, and only they need finding.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to_id) where reply_to_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Attachments of deleted messages follow the same path as expired ones
--
-- 0010 built a queue (`expired_media`) that /api/cron/sweep-media drains
-- through the Storage API, because Postgres cannot delete storage objects
-- itself. Delete-for-everyone has exactly the same problem, so it reuses
-- exactly the same queue rather than inventing a second mechanism.
-- ---------------------------------------------------------------------------

create or replace function public.queue_deleted_message_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only on the transition into deleted, and only when there was something to
  -- clean up. Firing on every update of an already-deleted row would requeue
  -- the same key indefinitely.
  if new.deleted_at is not null
     and old.deleted_at is null
     and old.media_url is not null
     and old.media_url <> '' then

    insert into public.expired_media (storage_key)
    values (
      -- Same normalisation as delete_expired_messages() in 0010: post-0006
      -- rows hold a bare key, older ones an absolute public URL.
      case
        when old.media_url like '%/object/public/media/%'
          then split_part(old.media_url, '/object/public/media/', 2)
        else old.media_url
      end
    )
    on conflict (storage_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_queue_deleted_media on public.messages;
create trigger messages_queue_deleted_media
  after update on public.messages
  for each row execute function public.queue_deleted_message_media();

-- ---------------------------------------------------------------------------
-- 3. Reactions
-- ---------------------------------------------------------------------------

-- Membership test for a MESSAGE rather than a conversation. Security definer
-- for the same reason is_conversation_member() is: a policy on
-- message_reactions that selected from messages would be subject to messages'
-- own RLS, and reasoning about two policies interacting is how recursive
-- policy bugs get written.
create or replace function public.is_message_member(msg_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = msg_id
      and auth.uid() = any (c.participant_ids)
  );
$$;

create table if not exists public.message_reactions (
  message_id   uuid not null references public.messages(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,

  -- An emoji, not free text. The length cap is generous because a single
  -- user-perceived emoji can be several code points once skin tone and
  -- zero-width joiners are involved — "👩‍🚀" is four. It is not a comment box.
  emoji        text not null check (char_length(emoji) between 1 and 16),

  created_date timestamptz not null default now(),

  -- One of each emoji per person per message. Reacting 👍 twice is not a
  -- thing; reacting 👍 and 🎉 is.
  primary key (message_id, account_id, emoji)
);

-- The read pattern is "all reactions for these messages", which the primary
-- key already serves by leading with message_id. No extra index.

alter table public.message_reactions enable row level security;

-- Anyone in the conversation sees the reactions, which is the point of them.
drop policy if exists message_reactions_select_member on public.message_reactions;
create policy message_reactions_select_member on public.message_reactions
  for select to authenticated
  using (public.is_message_member(message_id));

-- React as yourself, on a message you can actually see.
drop policy if exists message_reactions_insert_own on public.message_reactions;
create policy message_reactions_insert_own on public.message_reactions
  for insert to authenticated
  with check (account_id = auth.uid() and public.is_message_member(message_id));

-- Remove your own only. Deliberately no UPDATE policy: changing a reaction is
-- a delete and an insert, and that keeps "who reacted with what" append-only
-- per row rather than something that can be silently rewritten.
drop policy if exists message_reactions_delete_own on public.message_reactions;
create policy message_reactions_delete_own on public.message_reactions
  for delete to authenticated
  using (account_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, update, delete on public.message_reactions to service_role;
