-- ---------------------------------------------------------------------------
-- 0024_group_invites_realtime.sql — put group invitations on the live feed
--
-- 0019 created `group_invites` and, exactly like 0012 did with
-- `message_reactions`, never added it to the `supabase_realtime` publication.
-- So the Contacts badge added on 2026-08-17 updates the moment a contact
-- request arrives and does nothing at all for a group invitation until the next
-- navigation.
--
-- Worth restating the failure mode, because this is the second time it has
-- caught this project: **subscribing to an unpublished table succeeds.** The
-- channel joins, no error is raised, and no event ever arrives — so the client
-- looks correct and simply never fires.
--
-- NO `replica identity full`. Replica identity decides what a DELETE carries,
-- and the default is the primary key — `group_invites.id`. The badge only needs
-- to know that something changed in order to recount; it never reads columns off
-- the payload. FULL would write every column of every delete into the WAL to
-- tell us nothing we use.
-- ---------------------------------------------------------------------------

do $$
begin
  -- Guarded so these migrations still run on a plain Postgres instance (CI, a
  -- local container) where Supabase's realtime publication does not exist.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'group_invites'
    ) then
      alter publication supabase_realtime add table public.group_invites;
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
