import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { validateUsername, jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

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

  // This endpoint answers "does this account exist?" for anyone who asks, which
  // is unavoidable for a live availability check at signup. Limiting it stops
  // that becoming a way to enumerate the whole user list. Generous enough that
  // someone typing a name in the signup box never notices.
  const rl = check(`username:${clientKey(request)}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

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
