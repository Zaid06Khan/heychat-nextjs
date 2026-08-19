-- 0028 — let the first admin exist.
--
-- `accounts_protect_role` (0002) refuses any change to `accounts.role` unless
-- `public.is_admin()`, and `is_admin()` is `exists (… where a.id = auth.uid()
-- and a.role = 'admin')`. The service role has no `auth.uid()`, so that is
-- false for it too — and with no admin in the table it is false for everyone.
--
-- WHICH MADE THE ROLE UNREACHABLE. Not "hard to grant": impossible. Every
-- account in this project is `role = 'user'`, the admin RLS policies written in
-- 0002 have never once evaluated true, and there was no way to change that from
-- inside the database or out. It stayed invisible for as long as nothing tried
-- to use the role, which was until 0027 gave it something to do.
--
-- The fix is to stop the trigger firing on a path that is already trusted. An
-- end-user session (auth.uid() is not null) still cannot touch the column —
-- which is the attack the trigger was written for, and the e2e suite asserts it
-- directly. A caller with no session reaching an UPDATE on `accounts` has
-- already had to be the service role, because the update policies are
-- `to authenticated`; anon is refused by RLS long before this runs.

create or replace function public.protect_account_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'role may only be changed by an admin';
  end if;
  return new;
end;
$$;

comment on function public.protect_account_role() is
  'Blocks a signed-in user from changing accounts.role. Deliberately does not '
  'fire when there is no auth.uid(): that is the service role or direct SQL, '
  'both of which already hold more power than this trigger could withhold, and '
  'it is the only way the first admin can be granted. See scripts/grant-admin.mjs.';
