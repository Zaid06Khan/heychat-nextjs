-- Storage bucket backing Core.UploadFile() — message attachments, voice notes,
-- avatars and group cover images.
--
-- The bucket is PUBLIC, which matches what Base44's UploadFile did: it returned
-- a plain URL that gets written into `messages.media_url` and rendered directly.
-- A private bucket would need signed URLs, and signed URLs expire — so every
-- media message older than the expiry would break. Making attachments private
-- is a real improvement but it is a design change, not a port. See FOLLOWUPS.md.
--
-- Uploads are still gated: only signed-in users can write, only into their own
-- folder, and only up to 25 MB.

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 26214400)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

create policy media_read_public on storage.objects
  for select
  using (bucket_id = 'media');

-- Object names are `<user-id>/<uuid>.<ext>`, so the first path segment is the
-- owner. A user can only write, replace or delete inside their own segment.
create policy media_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy media_update_own_folder on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy media_delete_own_folder on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
