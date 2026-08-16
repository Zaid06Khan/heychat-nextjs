-- ---------------------------------------------------------------------------
-- 0017_reactions_realtime.sql — put reactions on the realtime feed
--
-- 0012 created `message_reactions` but never added it to the `supabase_realtime`
-- publication, so nothing was ever broadcast for it. FOLLOWUPS #11 recorded the
-- symptom — "reactions are not in the realtime feed; they arrive when the thread
-- reloads for some other reason" — and it is this line's absence.
--
-- Worth being explicit about the failure mode, because it is a quiet one: a
-- client can `.on('postgres_changes', { table: 'message_reactions' })` and
-- `.subscribe()` perfectly happily against a table that is not published. The
-- channel joins, no error is raised, and no event ever arrives. The code looks
-- correct and does nothing.
--
-- NO `replica identity full` HERE, unlike `messages` in 0002. Replica identity
-- decides what a DELETE event carries, and the default is the primary key —
-- which for this table is (message_id, account_id, emoji). The client needs
-- message_id to know whether a removed reaction belongs to a message on screen,
-- and message_id is in that key already. FULL would put every column of every
-- delete into the WAL to tell us nothing more.
-- ---------------------------------------------------------------------------

do $$
begin
  -- Guarded so these migrations still run on a plain Postgres instance (CI, a
  -- local container) where Supabase's realtime publication does not exist.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Idempotent: adding a table that is already published raises
    -- "relation is already member of publication".
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'message_reactions'
    ) then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
