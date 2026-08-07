'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client.
 *
 * Uses the ANON key, which is public by design — it grants no privileges on its
 * own. Every request it makes carries the signed-in user's JWT, and Postgres
 * evaluates the RLS policies in 0002_rls.sql against `auth.uid()` from that JWT.
 * A tampered-with browser can call anything it likes; the database is what says
 * no. This is the core difference from the old build, where the browser decided.
 *
 * Session lives in cookies (not localStorage) so that route handlers and any
 * future server components see the same session.
 */
let browserClient;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return browserClient;
}
