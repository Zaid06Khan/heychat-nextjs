import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { usernameToEmail, jsonError } from '@/lib/auth/shared';

/**
 * POST /api/auth/login
 *
 * Password verification happens inside Supabase Auth (bcrypt compare), not in
 * JavaScript we control and definitely not in the browser. A wrong username and
 * a wrong password produce the same message and take a similar amount of time,
 * so this endpoint can't be used to enumerate who has an account.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const { username, password, device_fingerprint } = body ?? {};

  if (!username || !password) {
    return jsonError('Username and password are required.');
  }

  const supabase = await getSupabaseRouteClient();

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(String(username).trim()),
    password,
  });

  if (signInError || !signIn?.user) {
    return jsonError('Incorrect username or password.', 401);
  }

  const userId = signIn.user.id;

  // Device binding, preserved from the original app. Note this is checked AFTER
  // the password, so it can't be used to probe which usernames exist.
  //
  // It is still a browser-supplied fingerprint, so it is a friction measure and
  // not a security boundary — and it locks people out for benign reasons like a
  // browser update. Revisiting it is a follow-up.
  const admin = getSupabaseAdminClient();
  const { data: secrets } = await admin
    .from('account_secrets')
    .select('device_fingerprint_hash')
    .eq('account_id', userId)
    .maybeSingle();

  const knownDevice = secrets?.device_fingerprint_hash;

  if (knownDevice && device_fingerprint && knownDevice !== device_fingerprint) {
    await supabase.auth.signOut();
    return jsonError(
      'Unrecognized device — access denied. For your security, HeyChat accounts are bound to the device they were created on.',
      403
    );
  }

  // First login from a client that reports a fingerprint when none was stored.
  if (!knownDevice && device_fingerprint) {
    await admin
      .from('account_secrets')
      .upsert(
        { account_id: userId, device_fingerprint_hash: device_fingerprint },
        { onConflict: 'account_id' }
      );
  }

  await supabase
    .from('accounts')
    .update({ is_online: true, last_seen: new Date().toISOString() })
    .eq('id', userId);

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', userId)
    .single();

  return Response.json({ account });
}
