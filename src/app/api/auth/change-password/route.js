import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { usernameToEmail, validatePassword, jsonError } from '@/lib/auth/shared';

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
    .select('username')
    .eq('id', userData.user.id)
    .single();

  if (!account) return jsonError('Account not found.', 404);

  // Re-verify the current password.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(account.username),
    password: current_password ?? '',
  });

  if (verifyError) return jsonError('Current password is incorrect.', 403);

  const admin = getSupabaseAdminClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(
    userData.user.id,
    { password: new_password }
  );

  if (updateError) return jsonError(updateError.message, 400);

  return Response.json({ ok: true });
}
