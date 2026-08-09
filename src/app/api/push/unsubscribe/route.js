import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

/**
 * POST /api/push/unsubscribe
 *
 * Turning notifications off. The browser drops its own subscription first; this
 * removes the server's copy so nothing is sent to an endpoint that no longer
 * exists.
 *
 * Scoped to the caller's own rows. Endpoints are unguessable in practice, but
 * "unguessable" is not an access rule — without the account_id filter, anyone
 * who came by an endpoint string could silence that device's notifications.
 */

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

  const rl = check(`push-unsub:${userData.user.id}:${clientKey(request)}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { endpoint, all } = body ?? {};
  const admin = getSupabaseAdminClient();

  // `all` is what logging out uses: the browser may not be able to produce its
  // endpoint any more, and leaving a stale row behind would keep pushing this
  // account's messages to a device someone else may now be using.
  let query = admin.from('push_subscriptions').delete().eq('account_id', userData.user.id);

  if (!all) {
    if (typeof endpoint !== 'string' || !endpoint) {
      return jsonError('A push endpoint is required.');
    }
    query = query.eq('endpoint', endpoint);
  }

  const { error } = await query;
  if (error) return jsonError('Could not remove that subscription.', 502);

  return Response.json({ ok: true });
}
