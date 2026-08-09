-- ---------------------------------------------------------------------------
-- 0007_drop_earnings.sql — remove the watch-and-earn feature entirely
--
-- The rewarded-ad model is abandoned, not paused. FOLLOWUPS.md #2 laid out why
-- and nothing about it got better on inspection: rewarded video pays roughly
-- $10-30 per thousand completed views in the US and often under $2 per thousand
-- in South and South-East Asia, while the app paid $0.05 per ad and $1.00 per
-- game play -- a loss on every single impression in every market. On top of
-- that, nothing proved the activity ever happened, there was no payout
-- mechanism implemented at all, and paying strangers real money from free,
-- instant, anonymous accounts is precisely the shape of bulk-account fraud that
-- ad networks ban for rather than merely withhold payment on.
--
-- So this drops the feature rather than leaving dormant tables behind. Dormant
-- tables are not free: `earnings` still granted every authenticated client
-- SELECT, `credit_earning()` remained callable by anyone signed in, and both
-- would have gone on being carried through every future migration and security
-- review as things needing an explanation.
--
-- This migration is DESTRUCTIVE and deliberately not reversible. It deletes the
-- accrued balances along with the tables. That is the intended outcome -- there
-- was never a payout path, so no balance was ever a liability that could be
-- settled. If you want the numbers for the record, dump them before running:
--
--     \copy (select * from public.earnings) to 'earnings-backup.csv' csv header
--
-- Unlike 0001-0006 this file IS idempotent (`if exists` throughout), so it is
-- safe to re-run and safe to apply to a database that never had 0005.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Functions first
--
-- Both are dropped before the tables they read, so the drops below don't have
-- to reason about dependency order.
-- ---------------------------------------------------------------------------

drop function if exists public.credit_earning(earning_activity);
drop function if exists public.list_earn_rewards();

-- ---------------------------------------------------------------------------
-- 2. Tables
--
-- Policies, grants, indexes and the updated_date trigger all belong to the
-- tables and go with them; there is nothing to revoke separately.
-- ---------------------------------------------------------------------------

drop table if exists public.earn_rewards;
drop table if exists public.earnings;

-- ---------------------------------------------------------------------------
-- 3. Enums
--
-- Only reachable from the two tables above, so they drop cleanly now. Left
-- behind they would be permanent clutter in the type list -- Postgres keeps
-- unreferenced enums forever and never warns about them.
-- ---------------------------------------------------------------------------

drop type if exists earning_status;
drop type if exists earning_activity;
