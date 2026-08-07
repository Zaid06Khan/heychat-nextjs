import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { validatePassword, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/device — the "reset from the original device" path.
 *
 * With `new_password`: verifies the fingerprint and resets the password.
 * Without it: verifies only (used to gate the reset form).
 *
 * The fingerprint moved server-side so the browser can no longer simply skip
 * the check. But be clear-eyed about what it is: a value the client computes
 * and sends. Its only real protection is that the stored hash is unreadable
 * (account_secrets has no RLS policies), which makes it a weak shared secret
 * rather than proof of anything. It is kept for behaviour parity with the
 * original app. Replacing it is a follow-up.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { username, device_fingerprint, new_password } = body ?? {};

  if (!username || !device_fingerprint) {
    return jsonError('Username and device fingerprint are required.');
  }

  if (new_password !== undefined) {
    const passwordError = validatePassword(new_password, 'New password');
    if (passwordError) return jsonError(passwordError);
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
        .select('device_fingerprint_hash')
        .eq('account_id', account.id)
        .maybeSingle()
    : { data: null };

  // Same message whether the account is missing or the device is wrong.
  if (!account || secrets?.device_fingerprint_hash !== device_fingerprint) {
    return jsonError(
      'Password reset is only available on the device used to create this account.',
      403
    );
  }

  if (new_password === undefined) {
    return Response.json({ ok: true });
  }

  const { error } = await admin.auth.admin.updateUserById(account.id, {
    password: new_password,
  });

  if (error) return jsonError('Could not reset password.', 500);

  return Response.json({ ok: true });
}
