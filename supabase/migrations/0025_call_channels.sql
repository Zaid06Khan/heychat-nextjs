-- ---------------------------------------------------------------------------
-- 0025_call_channels.sql — authorise the call-signalling channels
--
-- Calls are peer-to-peer: once connected, the audio goes directly between the
-- two browsers and never touches this database or our server. What has to be
-- exchanged first is the connection description — an SDP offer, an answer, and
-- a handful of ICE candidates — and that is what these channels carry.
--
-- No table, for the same reason 0013 has none. A candidate is worthless the
-- moment the connection is up, and an SDP describes a session that no longer
-- exists a minute later. Storing either would be writing rows to be ignored.
--
-- WHY THIS MATTERS MORE THAN TYPING DID. A public channel here is not a small
-- leak. Anyone holding the anon key who knew a conversation's UUID could inject
-- an SDP offer and make someone's phone ring, or answer a call intended for
-- somebody else and be connected to live microphone audio. So the client opens
-- `call:<conversation_id>` with `private: true`, and the policies below apply
-- the same rule as everything else in this codebase: you must be in the
-- conversation. `is_conversation_member()` decides, so there is one answer to
-- that question rather than two that can drift.
--
-- Note what this does NOT protect. Both parties are conversation members by
-- construction, so these policies stop outsiders and nothing else. The media
-- itself is protected by WebRTC — DTLS-SRTP is mandatory, so a 1:1 call is
-- end-to-end encrypted whether or not the messages ever are. See
-- docs/E2E-ENCRYPTION.md.
--
-- Depends on Supabase Realtime Authorization, exactly as 0013 does. If it is
-- off or these policies are missing, private channels fail closed and calls
-- stop connecting; they never fall back to public.
-- ---------------------------------------------------------------------------

-- Extracts the conversation id from a `call:<uuid>` topic.
--
-- Mirrors typing_topic_conversation() deliberately, including the exception
-- handler: a policy that RAISES rather than returning false takes the whole
-- subscription down, so a malformed topic has to be a quiet false.
create or replace function public.call_topic_conversation(topic text)
returns uuid
language plpgsql
immutable
as $$
begin
  if topic is null or topic not like 'call:%' then
    return null;
  end if;
  return substring(topic from 6)::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.call_topic_conversation(text) to authenticated;

-- Receiving: you may listen for ringing in a conversation you are part of.
drop policy if exists calamuse_call_receive on realtime.messages;
create policy calamuse_call_receive on realtime.messages
  for select to authenticated
  using (
    public.is_conversation_member(
      public.call_topic_conversation(realtime.topic())
    )
  );

-- Sending: you may ring, answer, or hang up only in a conversation you are in.
drop policy if exists calamuse_call_send on realtime.messages;
create policy calamuse_call_send on realtime.messages
  for insert to authenticated
  with check (
    public.is_conversation_member(
      public.call_topic_conversation(realtime.topic())
    )
  );

notify pgrst, 'reload schema';
