import bcrypt from 'bcryptjs';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import {
  newAuthEmail,
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

  // REQUIRED, as of 2026-08-16. It used to be `if (recovery_password)` — the
  // registration form marked both fields required and the route did not, so the
  // guarantee was a UI convention and anything posting here directly skipped it.
  //
  // That was a loose end while device binding existed, because
  // /api/auth/device let you reset from the machine you signed up on. Removing
  // binding (FOLLOWUPS #6) removed that route too, and there is no email on
  // file. So this phrase is now the ONLY way back into an account whose password
  // is forgotten, and an account created without one is unrecoverable — not
  // "hard to recover", gone. That is not a thing to leave to whether the caller
  // happened to use the form.
  //
  // Absent and too-short get different messages. `validatePassword` would
  // answer "Recovery password must be at least 8 characters" to someone who
  // sent none at all, which reads as a formatting complaint about something
  // they never provided.
  if (!recovery_password) {
    return jsonError(
      'A recovery password is required. There is no email on your account, so it is the only way back in if you forget your password.'
    );
  }
  const recoveryError = validatePassword(recovery_password, 'Recovery password');
  if (recoveryError) return jsonError(recoveryError);

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

  // A RANDOM ADDRESS, NOT ONE BUILT FROM THE NAME. This is what lets a username
  // change later be a single-column update instead of a rewrite of the auth
  // record — and it keeps the chosen name out of the auth table entirely.
  // Uniqueness of usernames is still guaranteed by the unique index on
  // accounts.username, which is what the failure path below cleans up after.
  const authEmail = newAuthEmail();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
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
    // Written in the same insert as the username, so an account can never exist
    // without the address needed to sign into it.
    auth_email: authEmail,
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
  // No longer conditional: the validation above guarantees a recovery password
  // reached us, so a null hash here would mean an unrecoverable account created
  // by a code path that thinks it succeeded.
  await admin.from('account_secrets').insert({
    account_id: userId,
    recovery_password_hash: await bcrypt.hash(recovery_password, 12),
  });

  // Sign in immediately so the browser leaves with a real session cookie.
  // Same as the login route: the sign-in below creates the session, so the
  // caller's headers have to reach GoTrue or the device list says "node".
  const supabase = await getSupabaseRouteClient(request);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });

  if (signInError) {
    // SAY WHY. This used to return the message alone, and the underlying reason
    // was thrown away — which during a key rotation meant "sign-in failed" was
    // the only signal for a misconfigured key, twice, and the cause had to be
    // inferred from which half of the route got further. The account genuinely
    // exists at this point, so the user's instruction is unchanged; `reason` is
    // for whoever is looking at why.
    console.error('[register] sign-in after create failed:', signInError.message);
    return Response.json(
      {
        error: 'Account created, but sign-in failed. Please log in.',
        reason: signInError.message || null,
      },
      { status: 500 }
    );
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', userId)
    .single();

  return Response.json({ account });
}
