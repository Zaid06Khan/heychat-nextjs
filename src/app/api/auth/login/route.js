import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveAuthEmail, jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

/**
 * POST /api/auth/login
 *
 * Password verification happens inside Supabase Auth (bcrypt compare), not in
 * JavaScript we control and definitely not in the browser. A wrong username and
 * a wrong password produce the same message and take a similar amount of time,
 * so this endpoint can't be used to enumerate who has an account.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { username, password } = body ?? {};

  if (!username || !password) {
    return jsonError('Username and password are required.');
  }

  // Two limits, because they stop different things. Per-address caps how fast
  // one attacker can work; per-username stops a botnet spread across many
  // addresses all grinding the same account.
  const ip = clientKey(request);
  const name = String(username).trim().toLowerCase();

  const byIp = check(`login:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!byIp.ok) return tooManyRequests(byIp.retryAfter);

  const byUser = check(`login:user:${name}`, 5, 15 * 60 * 1000);
  if (!byUser.ok) return tooManyRequests(byUser.retryAfter);

  // Passing `request` so GoTrue stamps the session with the BROWSER's
  // user-agent rather than the server's — see getSupabaseRouteClient.
  const supabase = await getSupabaseRouteClient(request);

  // LOOKED UP, NOT DERIVED. The username used to BE the auth record's key, so
  // renaming one would have locked the account out permanently — see §7 and
  // 0026. This resolves to whatever GoTrue actually holds, and deliberately
  // returns a derived address for an unknown name rather than stopping early,
  // so the enumeration defence above still holds: same message, same work.
  const authEmail = await resolveAuthEmail(getSupabaseAdminClient(), username);

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });

  if (signInError || !signIn?.user) {
    return jsonError('Incorrect username or password.', 401);
  }

  const userId = signIn.user.id;

  // DEVICE BINDING WAS REMOVED HERE on 2026-08-16, deliberately.
  //
  // Logging in used to require a browser fingerprint matching the one stored at
  // signup — user-agent, screen dimensions, a canvas render, timezone,
  // hardwareConcurrency. Between a laptop and a phone at least four of those
  // differ, always, so an account created on one could never be used on the
  // other. Not "might drift": impossible by construction, and undocumented
  // anywhere a user would see it.
  //
  // What it bought was small. The value was computed by the client and sent in
  // the request, so it was a weak shared secret rather than proof of anything —
  // its only protection was that the stored copy lived in a table clients
  // cannot read. What it cost was a messenger that could not be used on a
  // second device, and a permanent lockout on a browser update, a GPU driver
  // update or a new monitor, with the recovery password as the only way back
  // and no email to fall back on.
  //
  // See FOLLOWUPS #6. The replacement is ordinary sessions plus a device list
  // the account holder can review and revoke.

  await supabase
    .from('accounts')
    .update({ is_online: true, last_seen: new Date().toISOString() })
    .eq('id', userId);

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', userId)
    .single();

  return Response.json({ account });
}
