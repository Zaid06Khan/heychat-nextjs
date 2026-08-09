-- ---------------------------------------------------------------------------
-- 0009_notification_prefs.sql — mute a conversation, and hide previews
--
-- 0008 shipped notifications with exactly one control: a device-level on/off
-- switch. That leaves the most common request in any messenger unanswerable —
-- "this one group is too loud" — with the only remedy being to turn every
-- notification off for every conversation.
--
-- Two independent settings here, deliberately not merged into one:
--
--   conversation_mutes         per (person, conversation).  Stop buzzing me
--                              about THIS chat.
--   accounts.hide_notification_preview
--                              per person.  Still buzz me, but don't put the
--                              message text on my lock screen.
--
-- Both are enforced in /api/push/notify, server-side, before anything is sent.
-- Filtering previews in the service worker instead would mean the text had
-- already travelled to the device, which is not what "hide" means to anyone
-- who asks for it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Per-conversation mute
--
-- Unlike push_subscriptions this IS client-readable and client-writable, for
-- the caller's own rows only. It holds no capability -- a mute row is a
-- preference, not a key -- and the UI needs to render the muted state on every
-- conversation in the list, which would otherwise need a route handler round
-- trip per screen.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_mutes (
  account_id      uuid not null references public.accounts(id)      on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  -- NULL means muted until explicitly unmuted. A timestamp means "mute for 8
  -- hours" and expires on its own, which is the option people actually reach
  -- for. Storing an absolute instant rather than a duration means nothing has
  -- to run on a schedule to expire it -- the read is simply `> now()`.
  muted_until     timestamptz,

  created_date    timestamptz not null default now(),

  -- One mute per person per conversation. Muting twice is not a thing, and the
  -- composite key lets the "mute" action be a plain upsert.
  primary key (account_id, conversation_id)
);

-- The notify path asks "of these recipients, who has muted this conversation?"
-- The primary key leads with account_id, so it cannot serve that; this can.
create index if not exists conversation_mutes_conversation_idx
  on public.conversation_mutes (conversation_id, account_id);

alter table public.conversation_mutes enable row level security;

-- Your own rows, all four verbs. `auth.uid() = account_id` in WITH CHECK as
-- well as USING, or a caller could insert a mute on someone else's behalf and
-- silence their notifications for them.
drop policy if exists conversation_mutes_select_own on public.conversation_mutes;
create policy conversation_mutes_select_own on public.conversation_mutes
  for select to authenticated
  using (auth.uid() = account_id);

drop policy if exists conversation_mutes_insert_own on public.conversation_mutes;
create policy conversation_mutes_insert_own on public.conversation_mutes
  for insert to authenticated
  with check (auth.uid() = account_id and public.is_conversation_member(conversation_id));

drop policy if exists conversation_mutes_update_own on public.conversation_mutes;
create policy conversation_mutes_update_own on public.conversation_mutes
  for update to authenticated
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

drop policy if exists conversation_mutes_delete_own on public.conversation_mutes;
create policy conversation_mutes_delete_own on public.conversation_mutes
  for delete to authenticated
  using (auth.uid() = account_id);

grant select, insert, update, delete on public.conversation_mutes to authenticated;
grant select, insert, update, delete on public.conversation_mutes to service_role;

-- ---------------------------------------------------------------------------
-- 2. Hide message previews
--
-- Lives on `accounts` rather than in its own table because it is one boolean
-- per person and `accounts` already carries the other display preferences
-- (online_status_visibility, group_add_permission). It is readable by every
-- signed-in user, like everything else on that table -- knowing that someone
-- hides their previews reveals nothing about them.
--
-- Defaults to false: previews on. Turning them off by default would be a
-- privacy posture the product has not earned, given the server can already read
-- every message body (FOLLOWUPS #3).
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column if not exists hide_notification_preview boolean not null default false;
