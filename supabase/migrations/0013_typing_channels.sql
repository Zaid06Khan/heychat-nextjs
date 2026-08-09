-- ---------------------------------------------------------------------------
-- 0013_typing_channels.sql — authorise the typing-indicator channels
--
-- Typing indicators are broadcast, not rows: "X is typing" is true for about
-- three seconds and is worthless the moment after, so writing it to a table
-- would be a write per keystroke for data with no value at rest. There is
-- deliberately no table in this migration.
--
-- What there IS, is the authorisation the broadcast needs.
--
-- A Supabase Realtime channel is joinable by anyone holding the anon key who
-- knows the topic string. The topic here is `typing:<conversation_id>`, so on a
-- PUBLIC channel anyone who learned a conversation's UUID could watch when its
-- members were typing, and — worse — broadcast that someone else was. Neither
-- is catastrophic; both are avoidable.
--
-- So the client opens these channels with `private: true`, which routes
-- authorisation through RLS on `realtime.messages`, and the policies below say
-- what everything else in this codebase says: you must be in the conversation.
-- The same `is_conversation_member()` helper decides, so there is one answer to
-- that question and not two that can drift.
--
-- NOTE: this depends on Supabase Realtime Authorization. If these policies are
-- missing or the feature is off, private channels fail closed — typing
-- indicators stop appearing. They never fall back to public.
-- ---------------------------------------------------------------------------

-- Extracts the conversation id from a `typing:<uuid>` topic.
--
-- A separate function so the two policies below cannot disagree, and so a
-- malformed topic is one problem handled in one place: `typing:` followed by
-- something that is not a UUID must be rejected, not error. A policy that
-- raises rather than returning false takes the whole subscription down.
create or replace function public.typing_topic_conversation(topic text)
returns uuid
language plpgsql
immutable
as $$
begin
  if topic is null or topic not like 'typing:%' then
    return null;
  end if;
  return substring(topic from 8)::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.typing_topic_conversation(text) to authenticated;

-- Receiving. `realtime.topic()` is the channel being joined.
drop policy if exists heychat_typing_receive on realtime.messages;
create policy heychat_typing_receive on realtime.messages
  for select to authenticated
  using (
    public.is_conversation_member(
      public.typing_topic_conversation(realtime.topic())
    )
  );

-- Sending. Same rule: you may announce that you are typing only into a
-- conversation you are actually in.
drop policy if exists heychat_typing_send on realtime.messages;
create policy heychat_typing_send on realtime.messages
  for insert to authenticated
  with check (
    public.is_conversation_member(
      public.typing_topic_conversation(realtime.topic())
    )
  );
