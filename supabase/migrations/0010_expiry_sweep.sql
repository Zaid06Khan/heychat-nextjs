-- ---------------------------------------------------------------------------
-- 0010_expiry_sweep.sql — disappearing messages stop depending on someone
--                         having the app open
--
-- FOLLOWUPS #5. `cleanupExpiredMessages()` ran in the browser on app start, so
-- a message set to vanish after 30 seconds vanished 30 seconds after the next
-- time somebody happened to open HeyChat. That was never a security hole — the
-- RLS policy allowed only the deletion of *already-expired* messages — but
-- "disappearing" that waits for an audience is not the feature people think
-- they are getting.
--
-- THE STORAGE PROBLEM, which is the reason this file is longer than it looks
-- like it should be. Deleting a row from `messages` does not delete its
-- attachment. The bytes live in Supabase Storage, and the only reliable way to
-- remove them is the Storage API — a `delete from storage.objects` leaves the
-- underlying object behind. Postgres cannot call that API without pg_net and a
-- service-role key stored in the database, which is a worse thing to have than
-- the problem it solves.
--
-- So the work is split, and each half does the part it can actually do:
--
--   here          delete expired rows, and RECORD their storage keys in
--                 `expired_media` for something with credentials to collect.
--   /api/cron/sweep-media
--                 drains that queue through the Storage API, then deletes the
--                 queue rows.
--
-- The queue is the honest bit: an attachment whose message is gone is
-- unreachable through the app immediately (no message row, no RLS grant, no
-- signed URL), and stops existing shortly afterwards.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The queue
--
-- Server-only, like push_subscriptions: nothing in the browser has any business
-- reading a list of storage keys, and a key is exactly the input
-- /api/media/sign is designed to be careful about.
-- ---------------------------------------------------------------------------

create table if not exists public.expired_media (
  id           uuid primary key default gen_random_uuid(),

  -- Storage key, not a URL. Pre-0006 rows hold absolute public URLs; the sweep
  -- normalises them on the way in so the collector never has to care.
  storage_key  text not null unique,

  queued_at    timestamptz not null default now(),

  -- Lets a key that the Storage API keeps refusing be spotted instead of
  -- silently retried forever.
  attempts     integer not null default 0,
  last_error   text
);

create index if not exists expired_media_queued_idx on public.expired_media (queued_at);

alter table public.expired_media enable row level security;
revoke all on public.expired_media from anon, authenticated;
grant select, insert, update, delete on public.expired_media to service_role;

-- ---------------------------------------------------------------------------
-- 2. The sweep
--
-- SECURITY DEFINER so it runs as the table owner and is not subject to RLS —
-- there is no session user when pg_cron runs it, so `auth.uid()` is null and
-- every policy on `messages` would refuse. search_path is pinned for the usual
-- reason: a SECURITY DEFINER function with a caller-controlled path is a
-- privilege escalation waiting to happen.
--
-- Returns the number of messages deleted so a run can be checked by hand.
-- ---------------------------------------------------------------------------

create or replace function public.delete_expired_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with expired as (
    delete from public.messages
    where expiry_at is not null
      and expiry_at <= now()
    returning media_url
  ),
  normalised as (
    select
      -- Normalise both shapes `media_url` can hold. Post-0006 rows store a bare
      -- storage key; rows written before it store an absolute public URL, and
      -- the key is everything after '/object/public/media/'. Mirrors
      -- toStorageKey() in src/lib/media/keys.js — if that changes, change this.
      case
        when media_url like '%/object/public/media/%'
          then split_part(media_url, '/object/public/media/', 2)
        else media_url
      end as storage_key
    from expired
  ),
  queued as (
    insert into public.expired_media (storage_key)
    select distinct storage_key
    from normalised
    where storage_key is not null and storage_key <> ''
    -- Two messages can legitimately reference one object, and a key already
    -- waiting to be collected does not need queueing twice.
    on conflict (storage_key) do nothing
    returning 1
  )
  -- `queued` is deliberately not referenced. A data-modifying CTE runs exactly
  -- once and to completion whether or not the primary query reads its output,
  -- which lets the count below report deleted MESSAGES rather than queued keys
  -- — the two differ whenever a message had no attachment, which is most of
  -- them.
  select count(*) into v_deleted from normalised;

  return v_deleted;
end;
$$;

-- Only the scheduler and the server should be able to run this. It deletes
-- rows across every conversation in the database.
revoke all on function public.delete_expired_messages() from public, anon, authenticated;
grant execute on function public.delete_expired_messages() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Schedule it
--
-- Wrapped so this migration still succeeds where pg_cron is unavailable — it
-- needs enabling once per project (Dashboard -> Database -> Extensions) and is
-- not present on every plan. Without it the function still exists and can be
-- driven from outside; you just do not get the every-five-minutes part.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;

  -- cron.schedule() upserts by name in recent versions and errors on a
  -- duplicate in older ones. Unscheduling first makes this file re-runnable
  -- either way.
  perform cron.unschedule('heychat-expire-messages')
  where exists (select 1 from cron.job where jobname = 'heychat-expire-messages');

  perform cron.schedule(
    'heychat-expire-messages',
    '*/5 * * * *',
    $cron$select public.delete_expired_messages()$cron$
  );

  raise notice 'pg_cron scheduled: heychat-expire-messages every 5 minutes';
exception when others then
  raise warning 'Could not schedule the expiry sweep (%). Enable pg_cron, or call public.delete_expired_messages() from an external scheduler.', sqlerrm;
end;
$$;
