-- HeyChat schema — converted from Base44/entities/*.jsonc
--
-- Design notes:
--   * Every Base44 entity becomes a table. Base44's implicit `id`, `created_date`
--     and `updated_date` fields are kept under the SAME names so the existing
--     React components (which read `record.created_date`) need no changes.
--   * `accounts.id` IS the Supabase auth user id. There is no separate identity:
--     passwords live in `auth.users` (bcrypt, server-side) and never touch this table.
--   * Base44's `created_by_id` is dropped. It referenced Base44's own auth user,
--     which this app never actually used, so it carried no meaning. Ownership is
--     now expressed by real columns (`sender_id`, `account_id`, `participant_ids`).

create extension if not exists "citext";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums (were `enum` constraints in the Base44 JSON schemas)
-- ---------------------------------------------------------------------------

create type account_role            as enum ('admin', 'user');
create type online_visibility       as enum ('everyone', 'contacts_only', 'nobody');
create type group_add_permission    as enum ('everyone', 'contacts_only');
create type app_language            as enum ('en','ru','es','pt','ar','ur','zh','ja','sw','ha');
create type conversation_type       as enum ('direct', 'group');
create type message_type            as enum ('text','image','video','file','voice');
create type contact_request_status  as enum ('pending','accepted','declined');
create type call_status             as enum ('ringing','active','ended');
create type earning_activity        as enum ('ad_watch','game_play','app_download');
create type earning_status          as enum ('credited','pending','paid_out');
create type report_reason           as enum ('spam','harassment','inappropriate_content','fake_account','threats','other');
create type report_status           as enum ('pending','reviewed','actioned','dismissed');

-- ---------------------------------------------------------------------------
-- accounts  (Base44: Account + User.role, merged)
-- ---------------------------------------------------------------------------

create table public.accounts (
  id                        uuid primary key references auth.users(id) on delete cascade,
  username                  citext not null unique
                              check (length(username) between 3 and 30
                                     and username ~ '^[a-zA-Z0-9_]+$'),
  role                      account_role not null default 'user',

  -- NOTE: `password_hash`, `recovery_password_hash` and `device_fingerprint_hash`
  -- from the Base44 schema are deliberately NOT here. This table has to stay
  -- readable by every signed-in user (username search, group member lists), so
  -- nothing secret may live in it. Passwords are in auth.users (bcrypt); the
  -- other two are in public.account_secrets, which no client can read at all.

  display_name              text,
  avatar                    text,
  bio                       text,
  country                   text not null default '',
  last_suggestion_refresh   timestamptz,
  online_status_visibility  online_visibility    not null default 'everyone',
  group_add_permission      group_add_permission not null default 'everyone',
  blocked_account_ids       uuid[] not null default '{}',
  is_online                 boolean not null default false,
  last_seen                 timestamptz,
  language                  app_language not null default 'en',
  opt_out_of_suggestions    boolean not null default false,

  created_date              timestamptz not null default now(),
  updated_date              timestamptz not null default now()
);

-- No separate username index: the UNIQUE constraint above already creates one.
create index accounts_country_idx on public.accounts (country) where opt_out_of_suggestions = false;

-- ---------------------------------------------------------------------------
-- account_secrets — never exposed to the browser.
-- Split out of `accounts` because RLS is row-level: any policy that lets a user
-- read another user's account row would also hand them that row's secrets.
-- Only the service-role key (server-side route handlers) can touch this table.
-- ---------------------------------------------------------------------------

create table public.account_secrets (
  account_id              uuid primary key references public.accounts(id) on delete cascade,
  recovery_password_hash  text,   -- bcrypt, written and compared only on the server
  device_fingerprint_hash text,
  created_date            timestamptz not null default now(),
  updated_date            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations  (Base44: Conversation)
-- ---------------------------------------------------------------------------

create table public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  type               conversation_type not null,
  participant_ids    uuid[] not null,
  name               text,
  cover_image        text,
  disappearing_timer integer not null default 0,
  admin_id           uuid references public.accounts(id) on delete set null,
  created_date       timestamptz not null default now(),
  updated_date       timestamptz not null default now(),

  constraint conversations_participants_not_empty check (array_length(participant_ids, 1) > 0)
);

-- GIN index so `participant_ids @> array[me]` membership lookups stay fast.
create index conversations_participants_idx on public.conversations using gin (participant_ids);

-- ---------------------------------------------------------------------------
-- messages  (Base44: Message)
-- ---------------------------------------------------------------------------

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.accounts(id) on delete cascade,
  content         text,
  media_url       text,
  message_type    message_type not null default 'text',
  expiry_at       timestamptz,
  read_by         uuid[] not null default '{}',
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_date);
create index messages_sender_idx       on public.messages (sender_id);
create index messages_expiry_idx       on public.messages (expiry_at) where expiry_at is not null;

-- ---------------------------------------------------------------------------
-- contact_requests  (Base44: ContactRequest)
-- ---------------------------------------------------------------------------

create table public.contact_requests (
  id              uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.accounts(id) on delete cascade,
  to_account_id   uuid not null references public.accounts(id) on delete cascade,
  to_username     citext,
  status          contact_request_status not null default 'pending',
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now(),

  constraint contact_requests_no_self check (from_account_id <> to_account_id),
  constraint contact_requests_unique_pair unique (from_account_id, to_account_id)
);

create index contact_requests_from_idx on public.contact_requests (from_account_id, status);
create index contact_requests_to_idx   on public.contact_requests (to_account_id, status);

-- ---------------------------------------------------------------------------
-- calls  (Base44: Call)  — schema only; signalling is a follow-up project
-- ---------------------------------------------------------------------------

create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  initiated_by    uuid not null references public.accounts(id) on delete cascade,
  participant_ids uuid[] not null default '{}',
  status          call_status not null default 'ringing',
  started_at      timestamptz,
  ended_at        timestamptz,
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

create index calls_conversation_idx on public.calls (conversation_id, created_date desc);

-- ---------------------------------------------------------------------------
-- earnings  (Base44: Earning) — amounts are still client-supplied; see FOLLOWUPS.md
-- ---------------------------------------------------------------------------

create table public.earnings (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  activity_type earning_activity not null,
  reward_amount numeric(12,2) not null,
  currency      text not null default 'USD',
  status        earning_status not null default 'credited',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index earnings_account_idx on public.earnings (account_id, created_date desc);

-- ---------------------------------------------------------------------------
-- reports  (Base44: Report)
-- ---------------------------------------------------------------------------

create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.accounts(id) on delete cascade,
  reported_id       uuid not null references public.accounts(id) on delete cascade,
  reported_username citext,
  reason            report_reason not null,
  description       text,
  status            report_status not null default 'pending',
  created_date      timestamptz not null default now(),
  updated_date      timestamptz not null default now()
);

create index reports_status_idx on public.reports (status, created_date desc);

-- ---------------------------------------------------------------------------
-- updated_date maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date = now();
  return new;
end;
$$;

create trigger accounts_touch         before update on public.accounts         for each row execute function public.touch_updated_date();
create trigger account_secrets_touch  before update on public.account_secrets  for each row execute function public.touch_updated_date();
create trigger conversations_touch    before update on public.conversations    for each row execute function public.touch_updated_date();
create trigger messages_touch         before update on public.messages         for each row execute function public.touch_updated_date();
create trigger contact_requests_touch before update on public.contact_requests for each row execute function public.touch_updated_date();
create trigger calls_touch            before update on public.calls            for each row execute function public.touch_updated_date();
create trigger earnings_touch         before update on public.earnings         for each row execute function public.touch_updated_date();
create trigger reports_touch          before update on public.reports          for each row execute function public.touch_updated_date();
