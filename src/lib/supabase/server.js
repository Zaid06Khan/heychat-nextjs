import { cookies, headers } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Request-scoped Supabase client for route handlers.
 *
 * Anon key + the caller's session cookie, so it is subject to exactly the same
 * RLS as the browser. Use this whenever a route handler should act *as the
 * signed-in user*. Reach for the admin client only when an operation genuinely
 * has to bypass RLS (creating an auth user, reading account_secrets).
 */
/**
 * @param {Request} [request] — pass it on any route that SIGNS SOMEONE IN.
 *
 * GoTrue records the User-Agent and IP of whatever asked it to create a session,
 * and on a sign-in that happens here, not in the browser. So every session
 * created through /api/auth/login was stamped `user_agent: node` with the
 * server's address — which made the device list added in 0018 useless, because
 * every device looked identical. Forwarding the caller's headers puts the real
 * browser back on the row.
 *
 * Only sign-in routes need it. Everywhere else the headers change nothing, and
 * the argument is optional so the other callers did not have to move.
 */
export async function getSupabaseRouteClient(request) {
  const forwarded = {};
  if (request) {
    const ua = request.headers.get('user-agent');
    // Trusted only as a label, never as identity — it is whatever the client
    // says it is, and it is displayed back to that same account and nobody else.
    if (ua) forwarded['User-Agent'] = ua;
    const ip =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
    if (ip) forwarded['X-Forwarded-For'] = ip;
  }

  /**
   * A BEARER TOKEN WINS OVER THE COOKIE, and the native app is why.
   *
   * Bundled into the app the client runs from `capacitor://localhost`, so a
   * cookie scoped to the deployed origin is third-party — and WKWebView blocks
   * those outright. It is not a setting that can be loosened, so the token has
   * to travel in a header instead.
   *
   * NO ROUTE HANDLER CHANGED FOR THIS. The token is read from `headers()`
   * rather than from an argument, so all fourteen callers keep working
   * untouched — and `auth.getUser()` with no argument resolves the bearer on a
   * client configured this way, which is what made that possible. Measured
   * before it was relied on, not assumed.
   *
   * ADDITIVE: with no bearer this falls through to the cookie exactly as
   * before, because the web app still signs in that way.
   *
   * An empty `Bearer ` is treated as ABSENT rather than as a failed login. It
   * means a client built the header wrong, and falling through lets the cookie
   * answer instead of turning a client bug into a sign-out.
   */
  const requestHeaders = await headers();
  const authorization = requestHeaders.get('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (bearer) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: { headers: { ...forwarded, Authorization: `Bearer ${bearer}` } },
        // Nothing to persist and nothing to refresh: this client lives for one
        // request. Left on, it would try to write a session into whatever
        // storage it could find on the server.
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  }

  return getSupabaseCookieClient(request);
}

/**
 * The cookie-backed client, specifically — never the bearer one.
 *
 * SIGNING OUT IS WHY THIS IS SEPARATE. `auth.signOut()` clears whatever storage
 * its client was built on, so on a bearer client it revokes the token and
 * leaves the cookie untouched. A web user who logged out would stay signed in,
 * silently, because their cookie still worked. `/api/auth/logout` and
 * `/api/auth/delete-account` therefore clear the cookie through THIS client
 * regardless of how the caller authenticated.
 */
export async function getSupabaseCookieClient(request) {
  const forwarded = {};
  if (request) {
    const ua = request.headers.get('user-agent');
    if (ua) forwarded['User-Agent'] = ua;
    const ip =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
    if (ip) forwarded['X-Forwarded-For'] = ip;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: forwarded },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

/** Returns the authenticated account id, or null. Never trusts a request body. */
export async function getAuthedUserId() {
  const supabase = await getSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
