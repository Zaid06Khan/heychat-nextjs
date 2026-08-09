import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

/**
 * POST /api/push/subscribe
 *
 * Records the browser's push subscription against the caller's account.
 *
 * The write uses the service role because push_subscriptions has no policy and
 * no grant for `authenticated` (0008) — the endpoint plus keys are a capability
 * to push to someone's device, so no client is allowed near the table. The
 * account it is filed under is taken from the session cookie and never from the
 * request body, so a caller cannot subscribe on somebody else's behalf.
 *
 * Called on every app start, not just when the user first opts in. Push
 * subscriptions expire and rotate on the push service's schedule, and a device
 * whose subscription silently lapsed is a device that stops getting messages
 * without anyone noticing. Re-asserting is cheap and idempotent.
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

  const rl = check(`push-sub:${userData.user.id}:${clientKey(request)}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { endpoint, keys } = body ?? {};
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;

  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return jsonError('A push endpoint is required.');
  }
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) {
    return jsonError('Subscription keys are required.');
  }
  // Endpoints are URLs from a handful of push services and run to a few hundred
  // characters. Anything far beyond that is not a subscription.
  if (endpoint.length > 2048 || p256dh.length > 256 || auth.length > 256) {
    return jsonError('Subscription is malformed.');
  }

  const admin = getSupabaseAdminClient();

  // `endpoint` is unique, so this is an upsert on the natural key rather than
  // on id. Two things depend on that: the same browser re-subscribing updates
  // its row instead of adding a second one (which would deliver every message
  // twice), and an endpoint that moves between accounts — one device, two users
  // over time — follows the person who most recently signed in on it.
  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      {
        account_id: userData.user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: (request.headers.get('user-agent') || '').slice(0, 400) || null,
        failure_count: 0,
      },
      { onConflict: 'endpoint' }
    );

  if (error) return jsonError('Could not save that subscription.', 502);

  return Response.json({ ok: true });
}
