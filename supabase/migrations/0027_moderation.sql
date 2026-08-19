-- 0027 — make a report something that can be acted on.
--
-- `reports` has existed since 0001 and rows have been written to it the whole
-- time. Nothing ever read them: there was no queue, no admin anywhere (every
-- account is `role = 'user'`, so `is_admin()` has never returned true for
-- anyone), and no way to do anything to an account even if someone had looked.
-- Reporting was a button that filed paperwork into a drawer nobody opens.
--
-- Both app stores expect a review process for user-generated content, and this
-- is the missing half of it.

-- ---------------------------------------------------------------------------
-- Suspension
-- ---------------------------------------------------------------------------
-- A moment rather than a boolean, so "when were they suspended" is answerable
-- without a second table, and un-suspending is setting it back to null.

alter table public.accounts
  add column if not exists suspended_at timestamptz;

alter table public.accounts
  add column if not exists suspended_reason text;

comment on column public.accounts.suspended_at is
  'Set by an admin. The login route refuses a session for a suspended account, '
  'and suspending also revokes existing refresh tokens — the access token '
  'already issued stays valid until it expires, which is the usual hour.';

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
-- Pending reports, newest first, is the only query the moderation screen makes.

create index if not exists reports_status_created_idx
  on public.reports (status, created_date desc);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
-- WHO DID WHAT, kept separately from the report itself. A report's `status`
-- says where it ended up; this says how it got there and who decided. Deleting
-- a report must not erase the record of the decision, hence `on delete set
-- null` rather than a cascade.

create table if not exists public.moderation_actions (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid references public.reports(id) on delete set null,
  moderator_id  uuid not null references public.accounts(id) on delete cascade,
  subject_id    uuid references public.accounts(id) on delete set null,
  action        text not null check (action in ('dismissed', 'reviewed', 'suspended', 'unsuspended')),
  note          text,
  created_date  timestamptz not null default now()
);

create index if not exists moderation_actions_subject_idx
  on public.moderation_actions (subject_id, created_date desc);

alter table public.moderation_actions enable row level security;

-- Admins only, in both directions. There is no reason for the person who was
-- reported — or who reported them — to read the moderator's notes.
drop policy if exists moderation_actions_select_admin on public.moderation_actions;
create policy moderation_actions_select_admin on public.moderation_actions
  for select to authenticated
  using (public.is_admin());

drop policy if exists moderation_actions_insert_admin on public.moderation_actions;
create policy moderation_actions_insert_admin on public.moderation_actions
  for insert to authenticated
  with check (public.is_admin() and moderator_id = auth.uid());

-- The service role bypasses RLS but NOT grants. Three migrations in a row
-- forgot this and the one that mattered made both suites read "migration not
-- applied" and silently skip their assertions.
grant select, insert on public.moderation_actions to authenticated;
grant all on public.moderation_actions to service_role;
