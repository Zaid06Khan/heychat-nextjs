import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. BYPASSES ALL RLS.
 *
 * The `server-only` import above makes the build fail if this file is ever
 * pulled into a client bundle, so the service-role key cannot leak into the
 * browser by accident.
 *
 * Only four things need it:
 *   1. creating the auth user during registration
 *   2. reading/writing public.account_secrets (recovery hash, device hash)
 *   3. checking username availability before a session exists
 *   4. resetting a password for someone who is, by definition, not signed in
 *
 * If you find yourself using it anywhere else, that is a sign a policy is
 * missing — fix the policy instead.
 */
export function getSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.local.example to .env.local and fill it in.'
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
