-- ---------------------------------------------------------------------------
-- 0005_earnings.sql — stop the browser deciding what it gets paid
--
-- 0002_rls.sql scoped earnings so a user can only read and insert rows for
-- *themselves*, which closed the "credit someone else" hole. It deliberately
-- left the larger one open, and said so: the reward AMOUNT was still whatever
-- the browser sent. Earn.jsx called startActivity('game_play', 10, 1.00) in
-- client code, so anyone with devtools could insert a row for any figure they
-- liked and watch their balance go up.
--
-- This migration takes the decision away from the client entirely:
--
--   1. Clients lose INSERT on earnings, at both the GRANT and the policy layer.
--   2. Reward amounts move into a server-side table the client cannot read.
--   3. A SECURITY DEFINER function is the only way to credit, and it looks the
--      amount up itself rather than accepting one.
--
-- What this does NOT do: verify that the activity actually happened. Anyone
-- can still call the credit route in a loop. Fixing that needs signed
-- server-to-server callbacks from the ad network (AdMob SSV, ironSource,
-- AppLovin all support this) with a replay-proof nonce, which is a real
-- integration rather than a migration. See FOLLOWUPS.md §2 — which also flags
-- that the payout economics need a decision before any of this earns anything.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Reward configuration, server-side only
-- ---------------------------------------------------------------------------

create table if not exists public.earn_rewards (
  activity_type earning_activity primary key,
  reward_amount numeric(12,2)     not null check (reward_amount >= 0),
  duration_secs integer           not null check (duration_secs > 0),
  currency      text              not null default 'USD',
  enabled       boolean           not null default true,
  updated_date  timestamptz       not null default now()
);

-- Seeded with the figures the client was previously hardcoding, so behaviour
-- does not change in this migration. Change them here, not in the bundle.
insert into public.earn_rewards (activity_type, reward_amount, duration_secs)
values
  ('ad_watch',     0.05, 15),
  ('game_play',    1.00, 10),
  ('app_download', 0.50, 10)
on conflict (activity_type) do nothing;

alter table public.earn_rewards enable row level security;

-- No policy for `authenticated` on purpose. RLS with zero applicable policies
-- denies by default, so the browser cannot read the rate card even though the
-- route that uses it can.
revoke all on public.earn_rewards from anon, authenticated;
grant select, insert, update, delete on public.earn_rewards to service_role;

-- ---------------------------------------------------------------------------
-- 2. Revoke client INSERT on earnings
--
-- Both layers, because they answer different questions: GRANT decides whether
-- the role may touch the table at all, and is checked first; the policy decides
-- which rows. Dropping only the policy would still leave the privilege in
-- place for any future policy to accidentally re-open.
-- ---------------------------------------------------------------------------

drop policy if exists earnings_insert_own on public.earnings;

revoke insert on public.earnings from authenticated;

-- select stays: a user must still be able to read their own balance.
-- 0002_rls.sql's earnings_select_own policy is unchanged and still applies.

-- ---------------------------------------------------------------------------
-- 3. The only path to a credit
--
-- SECURITY DEFINER so it runs as the owner and can insert despite the revoke
-- above. It takes an activity type, never an amount.
--
-- search_path is pinned: without it, a caller could put a schema of their own
-- in front on the search path and have this function resolve `earn_rewards` to
-- a table they control. That is the standard SECURITY DEFINER footgun.
-- ---------------------------------------------------------------------------

create or replace function public.credit_earning(p_activity earning_activity)
returns public.earnings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reward public.earn_rewards%rowtype;
  v_row    public.earnings%rowtype;
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_reward
  from public.earn_rewards
  where activity_type = p_activity and enabled;

  if not found then
    raise exception 'unknown or disabled activity: %', p_activity
      using errcode = '22023';
  end if;

  insert into public.earnings (account_id, activity_type, reward_amount, currency, status)
  values (v_uid, p_activity, v_reward.reward_amount, v_reward.currency, 'credited')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.credit_earning(earning_activity) from public, anon;
grant execute on function public.credit_earning(earning_activity) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Read the rate card without exposing it
--
-- The client needs to render "$0.05 per ad" and know how long to run the timer,
-- but must not be trusted with those values on the way back in. This returns
-- them for display only; credit_earning ignores anything the client says.
-- ---------------------------------------------------------------------------

create or replace function public.list_earn_rewards()
returns table (activity_type earning_activity, reward_amount numeric, duration_secs integer, currency text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select activity_type, reward_amount, duration_secs, currency
  from public.earn_rewards
  where enabled
  order by activity_type;
$$;

revoke all on function public.list_earn_rewards() from public, anon;
grant execute on function public.list_earn_rewards() to authenticated, service_role;
