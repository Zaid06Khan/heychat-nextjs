import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';
import { buildIceServers } from '@/lib/calls/turnCredentials';

/**
 * GET /api/calls/ice
 *
 * Where the browser should look for a route to the other person, and — when a
 * relay is configured — a short-lived credential to use it.
 *
 * WHY A ROUTE AND NOT AN ENVIRONMENT VARIABLE. `NEXT_PUBLIC_TURN_CREDENTIAL`
 * used to carry a fixed relay password into every browser bundle. A TURN relay
 * carries the media of a call, so that password is a licence to spend bandwidth,
 * published to anyone who opened devtools and revocable only by changing it for
 * everybody at once. The shared secret stays here now and the browser is handed
 * a credential that expires on its own. See `lib/calls/turnCredentials.js` for
 * the scheme coturn checks.
 *
 * SIGNED IN ONLY, AND THAT IS THE POINT. This endpoint mints something that
 * costs money to use. Left open it is a free relay for whoever finds it, and
 * the bill arrives without any way to tell who ran it up.
 *
 * NOT CACHEABLE. The credential is per-account and time-limited, so a shared
 * cache would hand one person's credential to the next caller and serve it past
 * its own expiry. The browser does its own caching in `lib/calls/ice.js`, where
 * it can see the TTL.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return jsonError('Not signed in.', 401);

  const accountId = userData.user.id;

  // Generous, because the browser caches for the credential's whole lifetime
  // and should normally ask once a session — but not unlimited, since minting
  // is an HMAC per request and this is the endpoint an attacker would grind to
  // build a stock of relay credentials before one is noticed.
  const rl = check(`ice:${accountId}:${clientKey(request)}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { iceServers, ttl, relay } = buildIceServers({
    urls: process.env.TURN_URLS,
    secret: process.env.TURN_STATIC_AUTH_SECRET,
    accountId,
  });

  return Response.json(
    { iceServers, ttl, relay },
    { headers: { 'Cache-Control': 'no-store, private' } }
  );
}
