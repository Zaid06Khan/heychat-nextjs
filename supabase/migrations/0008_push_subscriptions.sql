-- ---------------------------------------------------------------------------
-- 0008_push_subscriptions.sql — storage for Web Push endpoints
--
-- Closes the gap FOLLOWUPS.md called "close to disqualifying": until now you
-- found out about a message when you next happened to open the app.
--
-- A push subscription is a CAPABILITY, not a preference. The endpoint URL plus
-- the p256dh/auth key pair is everything needed to deliver an encrypted
-- notification to that specific browser on that specific device. Anyone holding
-- a row here can push to that device until the subscription is revoked.
--
-- So this table is server-only, in the same shape as earn_rewards was: RLS on
-- with NO policy for `authenticated`, and the GRANT withheld as well. There is
-- no "read your own subscriptions" policy because nothing needs one — a browser
-- asking "am I subscribed?" gets a truthful answer from its own service worker
-- via pushManager.getSubscription(), without the database being involved. Every
-- write goes through /api/push/subscribe and /api/push/unsubscribe, which act
-- on the caller's session.
--
-- One row per browser per device, NOT one per account: the same account signed
-- in on a phone and a laptop is two subscriptions and should get both.
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,

  -- The push service's delivery URL. Globally unique by construction, and the
  -- natural key: a browser that re-subscribes without changing endpoint must
  -- update the existing row rather than accumulate duplicates, or one message
  -- would produce N identical notifications.
  endpoint     text not null unique,

  -- Client-generated keys the push payload is encrypted to. The server cannot
  -- read a notification it has already sent, only compose new ones.
  p256dh       text not null,
  auth         text not null,

  -- Purely so a user could be shown "Chrome on Windows" in a device list one
  -- day. Not used for anything today and not trusted for anything ever.
  user_agent   text,

  -- Push services return 404/410 for a subscription that is permanently dead.
  -- When that happens the row is deleted outright, so this counter only tracks
  -- soft failures (timeouts, 5xx) to make a stuck endpoint visible.
  failure_count   integer not null default 0,
  last_success_at timestamptz,

  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

-- The hot path: "who should I notify about this message" resolves to a
-- participant list, then one lookup per participant.
create index if not exists push_subscriptions_account_idx
  on public.push_subscriptions (account_id);

-- Reuses the trigger function 0001_schema.sql already defines for every other
-- table, so updated_date means the same thing here as everywhere else.
drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_date();

-- ---------------------------------------------------------------------------
-- Access: service role only.
--
-- Belt and braces, deliberately. Enabling RLS without adding a policy denies
-- everything to `authenticated` on its own; revoking the grant means the
-- request is refused before any policy is even consulted. Either alone would
-- do. Both means a future migration that adds a well-meaning "users can see
-- their own subscriptions" policy still cannot leak the keys without someone
-- also noticing the missing grant.
-- ---------------------------------------------------------------------------

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
