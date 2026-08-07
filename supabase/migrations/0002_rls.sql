-- Row Level Security for HeyChat.
--
-- What was wrong with the Base44 rules this replaces:
--   * Account.read was `null` (open) — anyone could list every account row,
--     including password_hash and recovery_password_hash.
--   * Every other rule was `created_by_id = {{user.id}}`, which referenced
--     Base44's auth user. The app ran with requiresAuth:false and used its own
--     `Account` table, so that identity was never populated in a meaningful way
--     and the rules did not describe the app's actual ownership model.
--
-- The rules below are enforced by Postgres against `auth.uid()` — the id of the
-- genuinely authenticated user, taken from a signed JWT the browser cannot forge.

-- ---------------------------------------------------------------------------
-- Helper functions.
--
-- These are SECURITY DEFINER on purpose: they read tables that themselves have
-- RLS, and a policy that queries an RLS-protected table from inside another
-- policy will recurse. SECURITY DEFINER runs the lookup as the table owner,
-- bypassing RLS for that one narrow question ("is this user in this
-- conversation?"), which breaks the cycle.
-- `search_path` is pinned so the function can't be hijacked by a caller-set path.
-- ---------------------------------------------------------------------------

create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = conv_id
      and auth.uid() = any (c.participant_ids)
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.accounts a
    where a.id = auth.uid()
      and a.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;

-- Readable by any signed-in user. This is intentional: contact search, group
-- member lists and country suggestions all need to look up other people.
-- It is only safe because this table now holds no credentials.
-- Anonymous visitors get nothing.
create policy accounts_select_authenticated on public.accounts
  for select to authenticated
  using (true);

-- Rows are created by the registration route handler (service role), not by
-- the browser, so there is no INSERT policy for `authenticated` at all.

create policy accounts_update_self on public.accounts
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy accounts_update_admin on public.accounts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy accounts_delete_self on public.accounts
  for delete to authenticated
  using (id = auth.uid() or public.is_admin());

-- Stop a user from promoting themselves to admin via a plain profile update.
-- RLS can gate the row but not an individual column, so a trigger does it.
create or replace function public.protect_account_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role may only be changed by an admin';
  end if;
  return new;
end;
$$;

create trigger accounts_protect_role
  before update on public.accounts
  for each row execute function public.protect_account_role();

-- ---------------------------------------------------------------------------
-- account_secrets — RLS on, and deliberately zero policies.
-- No policy means no row is ever visible or writable to `anon`/`authenticated`.
-- The service-role key bypasses RLS, so only server code reaches this table.
-- ---------------------------------------------------------------------------

alter table public.account_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;

create policy conversations_select_member on public.conversations
  for select to authenticated
  using (auth.uid() = any (participant_ids));

-- You may only create a conversation you are actually in.
create policy conversations_insert_member on public.conversations
  for insert to authenticated
  with check (auth.uid() = any (participant_ids));

create policy conversations_update_member on public.conversations
  for update to authenticated
  using (auth.uid() = any (participant_ids))
  with check (auth.uid() = any (participant_ids));

-- Only the group creator can delete a group; either party can delete a direct chat.
create policy conversations_delete_owner on public.conversations
  for delete to authenticated
  using (
    (type = 'group'  and admin_id = auth.uid())
    or (type = 'direct' and auth.uid() = any (participant_ids))
  );

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;

create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- You can only send as yourself, and only into a conversation you belong to.
create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

-- Editing a message is restricted to its author. Recipients marking a message
-- read do NOT go through here — they call mark_message_read() below, so that
-- "mark as read" can't be used as a back door to rewrite someone else's text.
create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- Authors delete their own messages; the disappearing-message sweep deletes
-- any expired message in a conversation you're part of.
create policy messages_delete_sender on public.messages
  for delete to authenticated
  using (
    sender_id = auth.uid()
    or (expiry_at is not null and expiry_at <= now()
        and public.is_conversation_member(conversation_id))
  );

-- Append-only read receipt. Adds the caller to read_by and nothing else.
create or replace function public.mark_message_read(message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  select conversation_id into conv_id from public.messages where id = message_id;
  if conv_id is null then
    return;
  end if;
  if not public.is_conversation_member(conv_id) then
    raise exception 'not a member of this conversation';
  end if;

  update public.messages
     set read_by = array_append(read_by, auth.uid())
   where id = message_id
     and not (auth.uid() = any (read_by));
end;
$$;

revoke all on function public.mark_message_read(uuid) from public;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- contact_requests
-- ---------------------------------------------------------------------------

alter table public.contact_requests enable row level security;

create policy contact_requests_select_party on public.contact_requests
  for select to authenticated
  using (from_account_id = auth.uid() or to_account_id = auth.uid());

create policy contact_requests_insert_sender on public.contact_requests
  for insert to authenticated
  with check (from_account_id = auth.uid());

-- The recipient accepts/declines; the sender may withdraw. Both are updates,
-- and either party is allowed — but only on a row they are part of.
create policy contact_requests_update_party on public.contact_requests
  for update to authenticated
  using (from_account_id = auth.uid() or to_account_id = auth.uid())
  with check (from_account_id = auth.uid() or to_account_id = auth.uid());

create policy contact_requests_delete_party on public.contact_requests
  for delete to authenticated
  using (from_account_id = auth.uid() or to_account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- calls  (rows only — there is still no working call transport; see FOLLOWUPS.md)
-- ---------------------------------------------------------------------------

alter table public.calls enable row level security;

create policy calls_select_participant on public.calls
  for select to authenticated
  using (auth.uid() = any (participant_ids) or initiated_by = auth.uid());

create policy calls_insert_participant on public.calls
  for insert to authenticated
  with check (
    initiated_by = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

create policy calls_update_participant on public.calls
  for update to authenticated
  using (auth.uid() = any (participant_ids) or initiated_by = auth.uid())
  with check (auth.uid() = any (participant_ids) or initiated_by = auth.uid());

create policy calls_delete_initiator on public.calls
  for delete to authenticated
  using (initiated_by = auth.uid());

-- ---------------------------------------------------------------------------
-- earnings
--
-- SCOPE NOTE: crediting is out of scope for this pass. These policies stop a
-- user from reading or forging *other people's* balances, which the old rules
-- allowed. They do NOT stop a user inserting their own fake earnings — the
-- amount is still whatever the browser says. Fixing that needs server-verified
-- ad callbacks. See FOLLOWUPS.md.
-- ---------------------------------------------------------------------------

alter table public.earnings enable row level security;

create policy earnings_select_own on public.earnings
  for select to authenticated
  using (account_id = auth.uid() or public.is_admin());

create policy earnings_insert_own on public.earnings
  for insert to authenticated
  with check (account_id = auth.uid());

create policy earnings_update_admin on public.earnings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy earnings_delete_admin on public.earnings
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------

alter table public.reports enable row level security;

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

create policy reports_update_admin on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy reports_delete_admin on public.reports
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Realtime — the shim's .subscribe() listens on these tables.
-- Realtime respects RLS, so a client is only pushed rows it could have selected.
-- ---------------------------------------------------------------------------

-- By default a DELETE event carries only the primary key of the removed row.
-- ChatView's subscriber filters on `event.data?.conversation_id`, so without the
-- full old row a deletion (an expiring message) would never trigger a refresh.
alter table public.messages replica identity full;

-- Guarded so these migrations also run on a plain Postgres instance (CI, a local
-- container) where Supabase's realtime publication doesn't exist.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
    alter publication supabase_realtime add table public.conversations;
    alter publication supabase_realtime add table public.contact_requests;
    alter publication supabase_realtime add table public.calls;
  end if;
end
$$;
