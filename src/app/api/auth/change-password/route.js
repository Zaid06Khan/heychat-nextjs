import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveAuthEmail, validatePassword, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/change-password
 *
 * Requires a live session AND the current password. Supabase would let a signed-in
 * user change their password without re-entering the old one; we re-verify anyway
 * so that a stolen session cookie can't be used to lock the real owner out.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { current_password, new_password } = body ?? {};

  const passwordError = validatePassword(new_password, 'New password');
  if (passwordError) return jsonError(passwordError);

  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData?.user) return jsonError('Not signed in.', 401);

  const { data: account } = await supabase
    .from('accounts')
    .select('username, auth_email')
    .eq('id', userData.user.id)
    .single();

  if (!account) return jsonError('Account not found.', 404);

  const admin = getSupabaseAdminClient();

  // Re-verify the current password, against the stored auth address rather than
  // one rebuilt from the username — the two stop matching the moment a username
  // changes, and this is a re-authentication, so a mismatch would read as
  // "wrong password" to somebody who typed the right one.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: account.auth_email || (await resolveAuthEmail(admin, account.username)),
    password: current_password ?? '',
  });

  if (verifyError) return jsonError('Current password is incorrect.', 403);

  const { error: updateError } = await admin.auth.admin.updateUserById(
    userData.user.id,
    { password: new_password }
  );

  if (updateError) return jsonError(updateError.message, 400);

  return Response.json({ ok: true });
}
