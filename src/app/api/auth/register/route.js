import bcrypt from 'bcryptjs';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import {
  usernameToEmail,
  validateUsername,
  validatePassword,
  jsonError,
} from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';

/**
 * POST /api/auth/register
 *
 * The password arrives over TLS in the request body and is handed straight to
 * Supabase Auth, which bcrypts it. It is never hashed in the browser, never
 * stored in a table this app can read, and never logged.
 *
 * The old flow did the opposite: SHA-256 in the browser with one hardcoded
 * app-wide salt, written into a world-readable column.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const {
    username,
    password,
    display_name,
    avatar,
    recovery_password,
  } = body ?? {};

  // Accounts here are free, instant and anonymous, and the app pays money. That
  // combination is what bulk-account fraud looks for. This will not stop a
  // determined farm on its own, but it makes scripted signups slow enough to be
  // visible rather than free.
  //
  // Kept deliberately loose. Large numbers of real users share one address
  // behind carrier-grade NAT — common on mobile networks, and especially so in
  // the regions this app is aimed at — so a tight per-address cap locks out
  // legitimate people before it inconveniences an attacker. Tighten this only
  // alongside a signal better than an IP.
  //
  // Also note the e2e smoke test registers three users per run.
  const rl = check(`register:${clientKey(request)}`, 20, 60 * 60 * 1000);
  if (!rl.ok) {
    return tooManyRequests(rl.retryAfter, 'Too many accounts created from here. Try again later.');
  }

  const usernameError = validateUsername(username);
  if (usernameError) return jsonError(usernameError);

  const passwordError = validatePassword(password);
  if (passwordError) return jsonError(passwordError);

  if (recovery_password) {
    const recoveryError = validatePassword(recovery_password, 'Recovery password');
    if (recoveryError) return jsonError(recoveryError);
  }

  const cleanUsername = username.trim();
  const admin = getSupabaseAdminClient();

  // Cheap pre-check for a friendly message. The unique index on
  // accounts.username is what actually guarantees uniqueness under a race.
  const { data: taken } = await admin
    .from('accounts')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (taken) return jsonError('Username is already taken.', 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToEmail(cleanUsername),
    password,
    email_confirm: true, // synthetic address; there is nothing to confirm
    user_metadata: { username: cleanUsername },
  });

  if (createError || !created?.user) {
    return jsonError(createError?.message || 'Could not create account.', 400);
  }

  const userId = created.user.id;

  const { error: accountError } = await admin.from('accounts').insert({
    id: userId,
    username: cleanUsername,
    display_name: display_name || cleanUsername,
    avatar: avatar || '',
    bio: '',
    is_online: true,
    last_seen: new Date().toISOString(),
  });

  if (accountError) {
    // Don't leave an orphaned auth user behind if the profile insert fails.
    await admin.auth.admin.deleteUser(userId);
    const conflict = accountError.code === '23505';
    return jsonError(
      conflict ? 'Username is already taken.' : 'Could not create account.',
      conflict ? 409 : 400
    );
  }

  // `device_fingerprint_hash` used to be written here too. Device binding was
  // removed on 2026-08-16 (FOLLOWUPS #6) and 0018 drops the column; the
  // recovery password is now the only thing this table holds, and the only way
  // back into an account whose password is lost.
  await admin.from('account_secrets').insert({
    account_id: userId,
    recovery_password_hash: recovery_password
      ? await bcrypt.hash(recovery_password, 12)
      : null,
  });

  // Sign in immediately so the browser leaves with a real session cookie.
  const supabase = await getSupabaseRouteClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(cleanUsername),
    password,
  });

  if (signInError) {
    return jsonError('Account created, but sign-in failed. Please log in.', 500);
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', userId)
    .single();

  return Response.json({ account });
}
