-- ---------------------------------------------------------------------------
-- 0018_device_list.sql — drop device binding, show real sessions instead
--
-- FOLLOWUPS #6, decided 2026-08-16. Accounts were bound to a browser
-- fingerprint, which made one account permanently one device: the fingerprint
-- hashes user-agent, screen dimensions, a canvas render and hardwareConcurrency,
-- and between a laptop and a phone at least four of those differ. Not "might
-- drift" — impossible by construction.
--
-- The replacement is ordinary sessions plus a list the account holder can
-- review and revoke, which is what every other messenger does.
--
-- WHY NOT A DEVICES TABLE OF OUR OWN. The obvious shape is `account_devices`,
-- written by /api/auth/login. It would be a *description* of sessions rather
-- than the sessions themselves, and the two would drift the moment anything
-- created a session without going through that route. Worse, revoking a row in
-- our table would revoke nothing: the browser talks to PostgREST directly
-- through the shim, so a session is only really dead when GoTrue says it is.
-- auth.sessions is the actual state, so this reads and writes that.
--
-- WHAT REVOKING DOES AND DOES NOT DO. Deleting the session invalidates its
-- refresh token, so that device cannot mint a new access token and is locked out
-- once its current one expires — by default within the hour. It does NOT kill
-- the access token already in that browser's hands, because a JWT is valid
-- until it expires by definition and nothing can recall it. "Signed out within
-- the hour" is the honest promise. Anything stronger needs a revocation check
-- on every request, which is a different and much more expensive design.
-- ---------------------------------------------------------------------------

-- The fingerprint column is now meaningless data about people's browsers, so it
-- goes rather than lingering as a field nothing reads. account_secrets keeps
-- doing its real job: the recovery password hash, which is now the ONLY way
-- back into an account whose password is lost.
alter table public.account_secrets
  drop column if exists device_fingerprint_hash;

-- ---------------------------------------------------------------------------
-- Reading your own sessions.
--
-- SECURITY DEFINER because auth.sessions is not readable by `authenticated` and
-- should not become so — it holds every user's sessions. The function is the
-- narrow window: it filters to auth.uid() and returns nothing else.
--
-- Columns are pulled through to_jsonb rather than named directly. auth.sessions
-- is GoTrue's table, not ours: `user_agent` and `ip` arrived in a later version
-- than `id`/`created_at`, and a migration that names a column GoTrue has not
-- shipped yet fails outright. `to_jsonb(s) ->> 'user_agent'` yields NULL for a
-- column that is not there, so this degrades to a less detailed list instead of
-- refusing to install.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_devices()
returns table (
  id           uuid,
  created_at   timestamptz,
  last_seen_at timestamptz,
  user_agent   text,
  ip           text,
  is_current   boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    s.id,
    s.created_at,
    -- refreshed_at moves every time the device renews its token, which is a
    -- better "last seen" than updated_at. Falls back where it is absent.
    coalesce(
      (to_jsonb(s) ->> 'refreshed_at')::timestamptz,
      s.updated_at,
      s.created_at
    ) as last_seen_at,
    to_jsonb(s) ->> 'user_agent' as user_agent,
    to_jsonb(s) ->> 'ip'         as ip,
    -- The JWT carries the id of the session it was minted for, so the caller's
    -- own row can be marked rather than guessed at. Without this the list has
    -- no way to stop someone revoking the device they are holding.
    (s.id::text = (auth.jwt() ->> 'session_id')) as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
  order by last_seen_at desc;
$$;

revoke all on function public.list_my_devices() from public, anon;
grant execute on function public.list_my_devices() to authenticated;

-- ---------------------------------------------------------------------------
-- Revoking one.
--
-- The ownership test is inside the function, not left to the caller: this runs
-- as definer, so a missing `user_id = auth.uid()` here would let any signed-in
-- account delete any session in the system by id.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_my_device(target_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  removed int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- Refusing to revoke the current session is a product decision, not a
  -- limitation: "sign out this device" already exists on the Settings screen
  -- and clears the cookie properly. Doing it from here would leave the page
  -- holding a dead session with no idea it had happened.
  if target_id::text = (auth.jwt() ->> 'session_id') then
    raise exception 'use Log out to end the session you are using';
  end if;

  delete from auth.sessions
   where id = target_id
     and user_id = auth.uid();

  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.revoke_my_device(uuid) from public, anon;
grant execute on function public.revoke_my_device(uuid) to authenticated;

notify pgrst, 'reload schema';
