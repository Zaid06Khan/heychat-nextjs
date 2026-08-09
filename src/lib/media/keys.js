export const MEDIA_BUCKET = 'media';

/**
 * `media_url` holds two shapes, and will for as long as any pre-0006 row exists:
 *
 *   new  `<user-id>/<uuid>.<ext>`                        a storage key
 *   old  `https://<ref>.supabase.co/storage/v1/object/public/media/<key>`
 *
 * The old rows were written when the bucket was public and the upload helper
 * returned an absolute URL. Rather than rewrite them, both are normalised to a
 * key here — a signed URL is minted from the key either way, so old attachments
 * keep working and become private at the same time.
 *
 * Returns null for anything that is neither, including empty values and URLs
 * pointing somewhere other than this bucket.
 */
export function toStorageKey(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const v = value.trim();

  if (!v.startsWith('http://') && !v.startsWith('https://')) {
    // Already a key. Reject anything trying to climb out of the bucket.
    if (v.includes('..')) return null;
    return v.replace(/^\/+/, '');
  }

  let path;
  try {
    path = new URL(v).pathname;
  } catch {
    return null;
  }

  // Matches both /object/public/media/<key> and /object/sign/media/<key>.
  const marker = `/${MEDIA_BUCKET}/`;
  const i = path.indexOf(marker);
  if (i === -1) return null;

  const key = decodeURIComponent(path.slice(i + marker.length));
  if (!key || key.includes('..')) return null;
  return key;
}
