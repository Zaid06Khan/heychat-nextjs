-- Table privileges.
--
-- Postgres access control has two independent layers and you need BOTH:
--
--   1. GRANT  — "may this role touch this table at all?"
--   2. RLS    — "which rows, of the ones it may touch?"
--
-- 0002_rls.sql only wrote layer 2. Without layer 1 every request failed with
-- `42501 permission denied for table accounts` before any policy was consulted.
--
-- Note that "admin" in this app is a *row value* (accounts.role = 'admin'), not
-- a Postgres role — admin users still connect as `authenticated`. So the
-- admin-only actions (updating earnings, resolving reports) must be granted to
-- `authenticated` here, and it is the `is_admin()` check in the policy that
-- actually restricts them.

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- authenticated
-- ---------------------------------------------------------------------------

grant select, update, delete on public.accounts to authenticated;
-- deliberately NO insert on accounts: rows are created only by the registration
-- route handler using the service role, and there is no INSERT policy for
-- authenticated. Adding the grant would be misleading, not permissive.

grant select, insert, update, delete on public.conversations    to authenticated;
grant select, insert, update, delete on public.messages         to authenticated;
grant select, insert, update, delete on public.contact_requests to authenticated;
grant select, insert, update, delete on public.calls            to authenticated;
grant select, insert, update, delete on public.earnings         to authenticated;
grant select, insert, update, delete on public.reports          to authenticated;

grant execute on function public.is_admin()                     to authenticated;
grant execute on function public.is_conversation_member(uuid)   to authenticated;
grant execute on function public.mark_message_read(uuid)        to authenticated;

-- ---------------------------------------------------------------------------
-- anon — intentionally nothing.
--
-- Signed-out visitors only ever hit /api/auth/*, which runs server-side. No
-- table grant means an unauthenticated PostgREST request is refused at layer 1,
-- before RLS is even reached.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- service_role — bypasses RLS, but still needs grants.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.accounts         to service_role;
grant select, insert, update, delete on public.conversations    to service_role;
grant select, insert, update, delete on public.messages         to service_role;
grant select, insert, update, delete on public.contact_requests to service_role;
grant select, insert, update, delete on public.calls            to service_role;
grant select, insert, update, delete on public.earnings         to service_role;
grant select, insert, update, delete on public.reports          to service_role;

-- account_secrets: service_role ONLY. Never granted to anon or authenticated,
-- so the recovery-password and device-fingerprint hashes are unreachable from
-- the browser at layer 1 as well as layer 2.
grant select, insert, update, delete on public.account_secrets to service_role;
