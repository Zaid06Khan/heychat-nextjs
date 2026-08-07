import bcrypt from 'bcryptjs';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { validatePassword, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/recover — reset a password using the recovery phrase.
 *
 * Runs without a session (the whole point is that the user is locked out), so
 * every check has to happen here. The bcrypt compare is done unconditionally
 * against a dummy hash when the account doesn't exist, so response timing
 * doesn't reveal whether a username is registered.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1Y2t.KZKMOfDNbxvJDMrfIYkKDcbEEq';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { username, recovery_password, new_password } = body ?? {};

  const passwordError = validatePassword(new_password, 'New password');
  if (passwordError) return jsonError(passwordError);

  if (!username || !recovery_password) {
    return jsonError('Username and recovery password are required.');
  }

  const admin = getSupabaseAdminClient();

  const { data: account } = await admin
    .from('accounts')
    .select('id')
    .eq('username', String(username).trim())
    .maybeSingle();

  const { data: secrets } = account
    ? await admin
        .from('account_secrets')
        .select('recovery_password_hash')
        .eq('account_id', account.id)
        .maybeSingle()
    : { data: null };

  const matches = await bcrypt.compare(
    recovery_password,
    secrets?.recovery_password_hash || DUMMY_HASH
  );

  if (!account || !secrets?.recovery_password_hash || !matches) {
    return jsonError('Recovery password is incorrect.', 403);
  }

  const { error } = await admin.auth.admin.updateUserById(account.id, {
    password: new_password,
  });

  if (error) return jsonError('Could not reset password.', 500);

  return Response.json({ ok: true });
}
