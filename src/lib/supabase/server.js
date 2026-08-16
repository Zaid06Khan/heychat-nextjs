import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

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
  const cookieStore = await cookies();

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
