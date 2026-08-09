import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { toStorageKey, MEDIA_BUCKET } from '@/lib/media/keys';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

/**
 * POST /api/media/sign
 *
 * The only way to read anything out of the `media` bucket. Since 0006 the
 * bucket is private with no read policy, so clients cannot fetch objects
 * directly at all.
 *
 * Two kinds of request, deliberately separate because they answer to different
 * rules:
 *
 *   { messageId }  an attachment. Allowed if the caller can read that message.
 *   { key }        an avatar or group cover. Allowed to any signed-in user, but
 *                  only if the key is actually referenced as one.
 *
 * The attachment check is the interesting one. Rather than re-deriving who is
 * in a conversation, it reads the message through the caller's own session, so
 * the RLS policy on `messages` decides — the same policy the e2e suite already
 * proves keeps non-participants out. One boundary, tested once.
 *
 * Signing itself uses the service role, because with no read policy nothing
 * else can.
 */

const TTL_SECONDS = 60 * 60;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return jsonError('Not signed in.', 401);

  // Guessing keys should not be cheap, even though a guess would have to match
  // a real object AND survive the ownership checks below.
  const rl = check(`sign:${userData.user.id}:${clientKey(request)}`, 240, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { messageId, key: rawKey } = body ?? {};

  let key = null;

  if (messageId) {
    // RLS decides. A non-participant gets no row, and therefore no URL.
    const { data: message } = await supabase
      .from('messages')
      .select('media_url')
      .eq('id', messageId)
      .maybeSingle();

    if (!message) return jsonError('Not found.', 404);
    key = toStorageKey(message.media_url);
  } else if (rawKey) {
    const candidate = toStorageKey(rawKey);
    if (!candidate) return jsonError('Invalid key.');

    // Without this, "any signed-in user may sign any key" would hand every
    // attachment to anyone who guessed one — the hole this migration closes.
    // A key only qualifies here if it is genuinely somebody's avatar or a
    // group's cover image.
    const [{ data: asAvatar }, { data: asCover }] = await Promise.all([
      supabase.from('accounts').select('id').or(`avatar.eq.${candidate},avatar.like.%/${candidate}`).limit(1).maybeSingle(),
      supabase.from('conversations').select('id').or(`cover_image.eq.${candidate},cover_image.like.%/${candidate}`).limit(1).maybeSingle(),
    ]);

    if (!asAvatar && !asCover) return jsonError('Not found.', 404);
    key = candidate;
  } else {
    return jsonError('Provide messageId or key.');
  }

  if (!key) return jsonError('Not found.', 404);

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(key, TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return jsonError('Could not prepare that file.', 502);
  }

  return Response.json({ url: data.signedUrl, expiresIn: TTL_SECONDS });
}
