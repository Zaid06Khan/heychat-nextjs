import bcrypt from 'bcryptjs';

import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { validatePassword, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/recovery-password — set or replace the caller's recovery password.
 *
 * Because there is no email on file, this phrase is the only way back into an
 * account after a forgotten password. It is bcrypt-hashed and stored in
 * account_secrets, which has RLS enabled and zero policies — no client can read
 * it, only server code holding the service-role key.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { recovery_password } = body ?? {};

  const passwordError = validatePassword(recovery_password, 'Recovery password');
  if (passwordError) return jsonError(passwordError);

  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData?.user) return jsonError('Not signed in.', 401);

  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('account_secrets').upsert(
    {
      account_id: userData.user.id,
      recovery_password_hash: await bcrypt.hash(recovery_password, 12),
    },
    { onConflict: 'account_id' }
  );

  if (error) return jsonError('Could not save recovery password.', 500);

  return Response.json({ ok: true });
}
