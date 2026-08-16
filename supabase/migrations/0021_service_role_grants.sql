-- ---------------------------------------------------------------------------
-- 0021_service_role_grants.sql — the grants 0016, 0019 and 0020 forgot
--
-- Every table migration in this repo grants to `service_role` explicitly,
-- because service_role bypasses RLS but NOT grants — 0004 says so in a comment
-- and 0008, 0009 and 0012 all follow it. `account_secrets` is the one
-- deliberate exception, and it goes the other way: service_role ONLY.
--
-- 0016, 0019 and 0020 granted to `authenticated` and stopped there, so
-- message_hides, group_invites and message_edits were unreadable by the server
-- identity. Caught the moment the migrations were applied for real: a
-- verification pass got `permission denied for table message_hides` rather than
-- "does not exist", which is a different and much quieter kind of wrong.
--
-- public.schema_migrations has the same hole and it is the one that bites.
-- It is created by scripts/migrate.mjs, which revokes it from clients — correct
-- — but never granted it to service_role. Both test suites ask that table
-- whether a migration has been applied, using the service key, so every gated
-- assertion would have reported "not applied" against a database where the
-- migration had just run. Tests that quietly skip are worse than tests that
-- fail, because nobody investigates a pass.
--
-- Insert and update on the ledger are deliberately NOT granted: it is written
-- by the migration script, which connects as the database owner. Read access is
-- all anything else needs.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.message_hides  to service_role;
grant select, insert, update, delete on public.group_invites  to service_role;
grant select, insert, update, delete on public.message_edits  to service_role;

grant select on public.schema_migrations to service_role;

notify pgrst, 'reload schema';
