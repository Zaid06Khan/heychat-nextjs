-- 0026 — stop deriving the GoTrue identity from the username.
--
-- Supabase Auth keys users by email and this app has none, so every account got
-- a synthetic address built from its username: `<username>@<domain>`. Login
-- re-derived that address to find the user. Which means the username was not
-- just a display name — it WAS the primary key of the auth record, and renaming
-- one would have made the account unreachable by password and by recovery
-- phrase alike, because neither is what the lookup uses. FOLLOWUPS §7.
--
-- Storing the address turns that derivation into a lookup. A username can then
-- change freely: `accounts.username` moves, `accounts.auth_email` does not, and
-- GoTrue never notices.
--
-- THE BACKFILL COMES FROM auth.users, NOT FROM A FORMULA. Re-deriving it here
-- would bake in this file's idea of the domain — and the domain is configurable
-- (HEYCHAT_SYNTHETIC_EMAIL_DOMAIN), lowercasing has changed shape before, and a
-- single mismatched row is an account nobody can ever log into again. Copying
-- what GoTrue actually holds is correct no matter what produced it.

alter table public.accounts
  add column if not exists auth_email citext;

update public.accounts a
   set auth_email = u.email
  from auth.users u
 where u.id = a.id
   and a.auth_email is null;

-- Two accounts sharing one auth identity would mean one of them can never be
-- signed into. Partial, because legacy rows with no matching auth user (there
-- should be none) must not block the index.
create unique index if not exists accounts_auth_email_key
  on public.accounts (auth_email)
  where auth_email is not null;

comment on column public.accounts.auth_email is
  'The address this account''s GoTrue user is keyed by. Opaque and never shown. '
  'Set once at registration and never rewritten — changing a username must not '
  'touch it, which is the entire point of the column existing.';
