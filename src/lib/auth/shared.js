import 'server-only';

/**
 * Calamus3's product promise is "no phone number, no email, just a username".
 * Supabase Auth (GoTrue) keys users by email, so every account gets a synthetic,
 * non-routable address derived from the username. Nothing is ever sent to it,
 * and email confirmation is disabled.
 *
 * The username is the real identifier; this is purely GoTrue's primary key.
 * Because it's derived, renaming a username later means updating the auth user
 * too — see FOLLOWUPS.md.
 */
/**
 * STILL SAYS `heychat`, AND MUST. The app was renamed to Calamus3 on
 * 2026-08-16; this was not renamed with it, on purpose.
 *
 * Every account's GoTrue user is keyed by `<username>@<this domain>`, and the
 * login route looks the user up by re-deriving that address. Change the domain
 * and every existing account's derived address stops matching the one GoTrue
 * has — nobody can log in, and the accounts are not recoverable by password or
 * by recovery phrase, because neither is what the lookup uses.
 *
 * It is never displayed, never sent to, and not a real domain. The only way to
 * change it is to rewrite every auth user's email in the same transaction,
 * which is FOLLOWUPS §7's "cleaner fix" — store a stable random local-part at
 * signup so identity never depends on a name that can change. Worth doing
 * before the first username-change feature; not worth doing for cosmetics.
 */
export const SYNTHETIC_EMAIL_DOMAIN =
  process.env.HEYCHAT_SYNTHETIC_EMAIL_DOMAIN || 'accounts.heychat.invalid';

export function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

/** Mirrors the CHECK constraint on accounts.username so errors are friendly. */
export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return '3–30 characters, letters, numbers and underscores only.';
  }
  return null;
}

/**
 * Minimum viable password rule. Deliberately length-based rather than a
 * symbol/number checklist — length is what actually resists cracking, and
 * checklists push people toward "Password1!".
 */
export function validatePassword(password, label = 'Password') {
  if (typeof password !== 'string' || password.length < 8) {
    return `${label} must be at least 8 characters.`;
  }
  if (password.length > 200) {
    return `${label} is too long.`;
  }
  return null;
}

export function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status });
}
