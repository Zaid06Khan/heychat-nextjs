-- ---------------------------------------------------------------------------
-- 0022_recovery_password_status.sql — let an account find out whether it has a
-- way back in
--
-- `account_secrets` has RLS enabled and ZERO policies, so no client can read it.
-- That is correct and stays: it holds the bcrypt hash that is the only thing
-- standing between a forgotten password and a lost account.
--
-- But `Settings.jsx` has been reading `account.recovery_password_hash` off the
-- `accounts` row, where that column has never existed — it is on
-- `account_secrets`. So the value was always `undefined`, and the screen has
-- always told everyone "Set recovery password / Required to reset your password
-- if you forget it", including people who set one months ago. The dialog got
-- `hasRecoveryPassword={false}` for the same reason.
--
-- One boolean is enough to fix that, and one boolean is all this exposes. It
-- says whether a hash exists for the caller, never anything about its value, and
-- only ever about the caller — auth.uid() is not a parameter, so there is no id
-- to guess.
--
-- WHY NOT A COLUMN ON `accounts`. A denormalised `has_recovery_password` flag
-- would have to be kept in step by /api/auth/register and
-- /api/auth/recovery-password, and the failure mode of it drifting is telling
-- someone they have a way back in when they do not. Deriving it cannot drift.
-- ---------------------------------------------------------------------------

create or replace function public.have_recovery_password()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_secrets s
    where s.account_id = auth.uid()
      and s.recovery_password_hash is not null
  );
$$;

revoke all on function public.have_recovery_password() from public, anon;
grant execute on function public.have_recovery_password() to authenticated;

notify pgrst, 'reload schema';
