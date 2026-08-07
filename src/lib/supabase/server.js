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
export async function getSupabaseRouteClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
