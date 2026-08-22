'use client';

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client.
 *
 * Uses the ANON key, which is public by design — it grants no privileges on its
 * own. Every request it makes carries the signed-in user's JWT, and Postgres
 * evaluates the RLS policies in 0002_rls.sql against `auth.uid()` from that JWT.
 * A tampered-with browser can call anything it likes; the database is what says
 * no. This is the core difference from the old build, where the browser decided.
 *
 * WHERE THE SESSION LIVES DEPENDS ON WHERE THE APP IS RUNNING.
 *
 * On the web it stays in cookies, exactly as before. `/api/auth/login` signs in
 * server-side and writes the cookie there, so the browser has a session the
 * moment the response lands and nothing else has to happen. That path is proven
 * and there is no reason to disturb it.
 *
 * Bundled into the native app there is no usable cookie: the client runs from
 * `capacitor://localhost` and a cookie scoped to the deployed origin is
 * third-party, which WKWebView blocks outright. So the session goes to
 * localStorage and travels as a bearer token instead — see `lib/api.js`. Login
 * has to hand the tokens back in the response body for that to work, which is
 * what `want_session` on `/api/auth/login` is for.
 *
 * NOT A SECURITY DOWNGRADE EITHER WAY. The `@supabase/ssr` cookie is written by
 * JavaScript and readable by it — it is not httpOnly and never was, because the
 * browser client has to read it. Cookies are kept on the web because they work,
 * not because they hide anything localStorage would expose.
 */

/**
 * Is this the bundled app rather than a browser tab?
 *
 * The build flag is checked first so a mobile bundle is correct before any
 * Capacitor JavaScript has run; the runtime check covers a bundle built without
 * it. Both are cheap and getting this wrong is silent — the session would be
 * written somewhere the requests never read.
 */
function isNativeShell() {
  if (process.env.NEXT_PUBLIC_CLIENT_TARGET === 'native') return true;
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

let browserClient;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    browserClient = isNativeShell()
      ? createClient(url, anon, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // There is no OAuth redirect to read a session out of in a native
            // shell, and leaving it on makes the client parse every URL it is
            // handed at startup.
            detectSessionInUrl: false,
          },
        })
      : createBrowserClient(url, anon);
  }
  return browserClient;
}
