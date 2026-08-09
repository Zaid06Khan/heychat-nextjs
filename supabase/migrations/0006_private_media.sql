-- ---------------------------------------------------------------------------
-- 0006_private_media.sql — attachments stop being readable by anyone with a link
--
-- 0003_storage.sql created the `media` bucket PUBLIC, matching what Base44's
-- UploadFile did: uploads returned a plain URL that was written straight into
-- messages.media_url. Uploads were gated -- signed in, own folder, 25 MB -- but
-- READS were not gated at all. Anyone holding or guessing an object URL could
-- fetch it without an account, without being in the conversation, without ever
-- having logged in. For an app whose front page says "private", that was the
-- loudest remaining contradiction.
--
-- "The URL contains a UUID so nobody will guess it" is not access control. URLs
-- leak: through browser history, referrer headers, shared screenshots, chat
-- logs, proxies and backups.
--
-- After this migration the bucket is private and there is NO read policy at
-- all. Clients cannot read objects directly under any circumstances. Every read
-- goes through /api/media/sign, which checks the caller is entitled to that
-- specific object and then mints a short-lived signed URL using the service
-- role. For attachments "entitled" means: can you read the message that
-- references it -- which the existing RLS on `messages` already answers
-- correctly, so this reuses a boundary that is already tested rather than
-- inventing a second one.
--
-- The write policies from 0003 are unchanged and still apply.
-- ---------------------------------------------------------------------------

update storage.buckets set public = false where id = 'media';

-- The whole point. Without this, everything above is decoration.
drop policy if exists media_read_public on storage.objects;

-- Deliberately no replacement SELECT policy. A policy such as "any signed-in
-- user may read" would still let any account fetch any other conversation's
-- attachments by key, which is barely better than public. Signed URLs are
-- validated by the storage service independently of RLS, so the sign route can
-- still do its job with no read policy present.
