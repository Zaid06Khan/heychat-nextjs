import 'server-only';

import { jsonError } from '@/lib/auth/shared';

/**
 * Is the caller an admin?
 *
 * READ FROM THE DATABASE, KEYED BY THE SESSION. Nothing about the request body
 * or the headers is consulted — the role comes from the `accounts` row whose id
 * is the session's user id, so there is nothing for a caller to assert.
 *
 * `accounts_protect_role` (0002) is what stops someone granting themselves the
 * role in the first place: a plain profile update that changes `role` raises
 * unless the caller is already an admin.
 *
 * This does not replace RLS. Every admin route still reads and writes through
 * the caller's own client where it can, so `is_admin()` in the policies is the
 * real boundary; this exists to return a clean 403 instead of an empty result
 * set, and to gate the few things that legitimately need the service role.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase route client
 * @returns {Promise<{ userId?: string, error?: Response }>}
 */
export async function requireAdmin(supabase) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { error: jsonError('Not signed in.', 401) };

  const { data: account } = await supabase
    .from('accounts')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (account?.role !== 'admin') {
    // Deliberately the same answer a non-existent route would give a stranger:
    // there is no reason to confirm that a moderation surface exists.
    return { error: jsonError('Not found.', 404) };
  }

  return { userId: userData.user.id };
}
