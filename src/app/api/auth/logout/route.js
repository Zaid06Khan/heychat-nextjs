import { getSupabaseRouteClient, getSupabaseCookieClient } from '@/lib/supabase/server';

/** POST /api/auth/logout — ends the session and marks the user offline. */
export async function POST() {
  const supabase = await getSupabaseRouteClient();

  const { data } = await supabase.auth.getUser();

  if (data?.user) {
    await supabase
      .from('accounts')
      .update({ is_online: false, last_seen: new Date().toISOString() })
      .eq('id', data.user.id);
  }

  // Whichever way they authenticated.
  await supabase.auth.signOut().catch(() => {});

  // AND THE COOKIE, ALWAYS. `signOut()` clears the storage its own client was
  // built on, so a caller holding a bearer token would revoke the token and
  // leave the cookie working — logging out and staying signed in. Harmless when
  // there is no cookie session; there is simply nothing to clear.
  const cookieClient = await getSupabaseCookieClient();
  await cookieClient.auth.signOut().catch(() => {});

  return Response.json({ ok: true });
}
