import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { validateUsername, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/username-available
 *
 * Needed at signup, before any session exists. Returns only a boolean — it
 * never echoes back account details.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { username } = body ?? {};

  const usernameError = validateUsername(username);
  if (usernameError) {
    return Response.json({ available: false, reason: usernameError });
  }

  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from('accounts')
    .select('id')
    .eq('username', username.trim())
    .maybeSingle();

  return Response.json({ available: !data });
}
