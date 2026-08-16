-- ---------------------------------------------------------------------------
-- 0020_edit_history.sql — an edit window, and a record of what changed
--
-- FOLLOWUPS #11: editing had no time limit and kept no history, so a two-year-old
-- message could be silently rewritten and only an "edited" marker would show,
-- with no record of what it said before. For a chat people use to agree things,
-- that is a real gap.
--
-- THE POINT OF THIS MIGRATION IS THE GRANT, NOT THE TABLE. A history table and a
-- window enforced in an RPC are worth nothing while the client can still
-- `update messages set content = ...` directly, which `messages_update_sender`
-- plus a blanket UPDATE grant allowed. RLS is row-level and cannot say "this
-- column but not that one", so the fix is the same one 0015 used on
-- `conversations`: take the UPDATE grant away entirely and route every legitimate
-- write through a SECURITY DEFINER function where the rules are written down.
--
-- After this, `authenticated` cannot UPDATE `messages` at all. The three things
-- that legitimately change a message each have a function: mark_message_read()
-- from 0002, and edit_message() and delete_message_for_everyone() below.
-- `messages_update_sender` is left in place deliberately — with no grant it is
-- unreachable, but if a grant is ever restored by accident the policy is still
-- there to catch it.
-- ---------------------------------------------------------------------------

-- Fifteen minutes. Long enough to fix a typo or a wrong number, short enough
-- that the message someone replied to is still the message they replied to.
-- It matches WhatsApp; Telegram allows 48 hours and Slack forever, and both of
-- those make the reply above an edit potentially nonsense.
create or replace function public.message_edit_window()
returns interval language sql immutable as $$ select interval '15 minutes' $$;

create table if not exists public.message_edits (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  -- What the message said BEFORE this edit. Nullable because a message can be
  -- edited from empty (an attachment gaining a caption).
  previous_content text,
  edited_at    timestamptz not null default now(),
  edited_by    uuid not null references public.accounts(id) on delete cascade
);

create index if not exists message_edits_message_idx
  on public.message_edits (message_id, edited_at);

alter table public.message_edits enable row level security;

-- Anyone who can read the message can read what it used to say. That is the
-- whole purpose: the people who saw the original are the people entitled to
-- know it changed. is_message_member() is 0012's helper, already SECURITY
-- DEFINER, so this does not recurse into messages' own policy.
drop policy if exists message_edits_select_member on public.message_edits;
create policy message_edits_select_member on public.message_edits
  for select to authenticated
  using (public.is_message_member(message_id));

-- No INSERT policy: history is written by edit_message() and nothing else. A
-- client that could write here could forge what a message used to say, which is
-- worse than having no history at all.
grant select on public.message_edits to authenticated;

-- ---------------------------------------------------------------------------
-- Editing.
-- ---------------------------------------------------------------------------

create or replace function public.edit_message(msg_id uuid, new_content text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_msg    public.messages%rowtype;
  v_row    public.messages%rowtype;
begin
  if v_caller is null then
    raise exception 'not signed in';
  end if;

  select * into v_msg from public.messages where id = msg_id for update;
  if v_msg.id is null then
    raise exception 'no such message';
  end if;

  if v_msg.sender_id <> v_caller then
    raise exception 'you can only edit your own messages';
  end if;

  if v_msg.deleted_at is not null then
    raise exception 'that message was deleted';
  end if;

  -- Deliberately measured from created_date, not from the last edit. Otherwise
  -- editing every fourteen minutes keeps the window open forever, which is the
  -- same as having no window.
  if now() - v_msg.created_date > public.message_edit_window() then
    raise exception 'messages can only be edited for % after sending',
      public.message_edit_window();
  end if;

  if v_msg.message_type <> 'text' then
    raise exception 'only text messages can be edited';
  end if;

  -- Nothing changed: not an error, and not worth a history row either.
  if coalesce(v_msg.content, '') = coalesce(new_content, '') then
    return v_msg;
  end if;

  insert into public.message_edits (message_id, previous_content, edited_by)
  values (msg_id, v_msg.content, v_caller);

  update public.messages
     set content = new_content, edited_at = now()
   where id = msg_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting for everyone.
--
-- Unchanged in behaviour from the client-side update it replaces: the tombstone
-- AND the body, because "deleted" that leaves the text underneath is not
-- deleted. It moves here only because the UPDATE grant is going away.
--
-- The history goes with it. Keeping prior versions of a message its author has
-- deleted for everyone would make "delete" mean "hide the current version",
-- which is exactly the thing 0012 refused to ship.
-- ---------------------------------------------------------------------------

create or replace function public.delete_message_for_everyone(msg_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_msg    public.messages%rowtype;
  v_row    public.messages%rowtype;
begin
  if v_caller is null then
    raise exception 'not signed in';
  end if;

  select * into v_msg from public.messages where id = msg_id for update;
  if v_msg.id is null then
    raise exception 'no such message';
  end if;

  if v_msg.sender_id <> v_caller then
    raise exception 'you can only delete your own messages';
  end if;

  if v_msg.deleted_at is not null then
    return v_msg;
  end if;

  delete from public.message_edits where message_id = msg_id;

  -- The 0012 trigger that queues the attachment for removal from storage fires
  -- on this UPDATE exactly as it did on the client-side one.
  update public.messages
     set deleted_at = now(), content = null, media_url = null
   where id = msg_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE ENFORCEMENT. Everything above is advisory until this line.
-- ---------------------------------------------------------------------------

revoke update on public.messages from authenticated;

notify pgrst, 'reload schema';
