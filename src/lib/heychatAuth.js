'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { generateDeviceFingerprint } from './deviceFingerprint';

/**
 * Same exported functions and signatures as the Base44 version, so no component
 * that imports from here needed to change. What happens underneath is different:
 *
 *   before: the browser hashed the password (SHA-256 + one hardcoded app-wide
 *           salt), fetched the account row, and compared hashes in JavaScript.
 *           Anyone could read every hash, and the comparison was skippable.
 *
 *   now:    credentials are POSTed over TLS to a route handler, verified by
 *           Supabase Auth with bcrypt, and the browser receives an httpOnly
 *           session cookie. No hashing happens in this file at all.
 */

const SESSION_KEY = 'heychat_session';

/* -------------------------------------------------------------------------
 * Session cache
 *
 * IMPORTANT: this localStorage entry is now only a UI convenience. Components
 * like Landing.jsx and ChatView.jsx read `getSession().id` synchronously during
 * render, so something has to answer without awaiting. It is a *cache of who is
 * signed in*, not a credential.
 *
 * Editing it in devtools gains an attacker nothing: the real session is the
 * signed JWT in an httpOnly cookie, and Postgres RLS checks that JWT — not this
 * — on every single query. Under the old build, faking this object was enough
 * to become another user.
 * ---------------------------------------------------------------------- */

function cacheSession(account) {
  if (typeof window === 'undefined' || !account) return;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      id: account.id,
      username: account.username,
      language: account.language || 'en',
    })
  );
}

export function setSession(account) {
  cacheSession(account);
}

export function getSession() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
  // Drop the memoized account too, so a sign-out never leaves the previous
  // user's profile readable from the cache below.
  invalidateCurrentAccount();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    throw new Error(payload?.error || 'Something went wrong. Please try again.');
  }

  return payload;
}

/* ------------------------------------------------------------------ auth */

export async function checkUsernameAvailability(username) {
  const { available } = await postJson('/api/auth/username-available', { username });
  return available;
}

export async function register({
  username,
  password,
  display_name,
  avatar,
  recovery_password,
}) {
  const { account } = await postJson('/api/auth/register', {
    username,
    password,
    display_name,
    avatar,
    recovery_password,
    device_fingerprint: await generateDeviceFingerprint(),
  });

  invalidateCurrentAccount();
  cacheSession(account);
  return account;
}

export async function login({ username, password }) {
  const { account } = await postJson('/api/auth/login', {
    username,
    password,
    device_fingerprint: await generateDeviceFingerprint(),
  });

  invalidateCurrentAccount();
  cacheSession(account);
  return account;
}

export async function logout() {
  try {
    await postJson('/api/auth/logout');
  } catch {
    // Clearing local state matters more than a clean server response.
  }
  clearSession();
}

/* -------------------------------------------------------------------------
 * getCurrentAccount() is called by AuthContext, ConversationList, Profile and
 * Settings — several of them on every render pass. Two things made that
 * expensive:
 *
 *   1. `auth.getUser()` is a network round-trip to /auth/v1/user every call.
 *      `auth.getSession()` reads the already-validated session locally. We only
 *      need the user id here to build a query, and RLS re-checks the JWT
 *      server-side on that query anyway, so the local read is sufficient — the
 *      browser cannot gain anything by lying to itself about its own id.
 *
 *   2. Concurrent callers each issued their own `accounts` SELECT.
 *
 * Measured on /home with one conversation: 10 Supabase requests before,
 * including 4 identical account fetches. The in-flight promise share plus a
 * short TTL collapses the duplicates without changing any component.
 * ---------------------------------------------------------------------- */

const ACCOUNT_TTL_MS = 5000;
let accountCache = { at: 0, value: null };
let accountInFlight = null;

/** Drops the memoized account so the next read re-fetches (after a write). */
export function invalidateCurrentAccount() {
  accountCache = { at: 0, value: null };
  accountInFlight = null;
}

export async function getCurrentAccount({ force = false } = {}) {
  if (!force && accountCache.value && Date.now() - accountCache.at < ACCOUNT_TTL_MS) {
    return accountCache.value;
  }
  if (accountInFlight) return accountInFlight;

  accountInFlight = (async () => {
    const supabase = getSupabaseBrowserClient();

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    if (!userId) {
      clearSession();
      accountCache = { at: 0, value: null };
      return null;
    }

    const { data: account, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !account) return null;

    cacheSession(account);
    accountCache = { at: Date.now(), value: account };
    return account;
  })();

  try {
    return await accountInFlight;
  } finally {
    accountInFlight = null;
  }
}

export async function verifyDevice(username) {
  await postJson('/api/auth/device', {
    username,
    device_fingerprint: await generateDeviceFingerprint(),
  });
  return true;
}

export async function resetPassword({ username, newPassword }) {
  await postJson('/api/auth/device', {
    username,
    device_fingerprint: await generateDeviceFingerprint(),
    new_password: newPassword,
  });
  return true;
}

export async function resetPasswordWithRecovery({
  username,
  recoveryPassword,
  newPassword,
}) {
  await postJson('/api/auth/recover', {
    username,
    recovery_password: recoveryPassword,
    new_password: newPassword,
  });
  return true;
}

export async function changePassword({ currentPassword, newPassword }) {
  await postJson('/api/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return true;
}

export async function setRecoveryPassword(recoveryPassword) {
  await postJson('/api/auth/recovery-password', {
    recovery_password: recoveryPassword,
  });
  return true;
}

export async function deleteAccount() {
  await postJson('/api/auth/delete-account');
  clearSession();
}

/* ------------------------------------------------------- app-level helpers */

/**
 * Country-based "Discover" suggestions.
 *
 * Unchanged in behaviour, but note that the filtering below is cosmetic, not
 * protective — the accounts table is readable by every signed-in user by design
 * (contact search needs it). Hiding opted-out users is a courtesy, not a
 * boundary. Making that a real boundary needs a server-side RPC; see FOLLOWUPS.md.
 */
export async function getSuggestions() {
  const supabase = getSupabaseBrowserClient();
  const session = getSession();
  if (!session) return [];

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', session.id)
    .single();

  if (!account?.country) return [];

  const { data: candidates } = await supabase
    .from('accounts')
    .select('*')
    .eq('country', account.country)
    .eq('opt_out_of_suggestions', false)
    .neq('id', session.id)
    .limit(100);

  // RLS already limits this to requests the caller is party to.
  const { data: requests } = await supabase
    .from('contact_requests')
    .select('from_account_id,to_account_id');

  const blocked = new Set(account.blocked_account_ids || []);
  const connected = new Set(
    (requests || []).flatMap((r) => [r.from_account_id, r.to_account_id])
  );

  const filtered = (candidates || []).filter(
    (c) => !blocked.has(c.id) && !connected.has(c.id)
  );

  return filtered.sort(() => Math.random() - 0.5).slice(0, 5);
}

/**
 * Sweep expired disappearing messages.
 *
 * Still a best-effort client sweep, same as before — it only runs while someone
 * has the app open. The messages_delete_sender policy permits it (any member may
 * delete an already-expired message in their conversation), so it is safe, but a
 * scheduled server job should own this. See FOLLOWUPS.md.
 */
export async function cleanupExpiredMessages() {
  const supabase = getSupabaseBrowserClient();
  const session = getSession();
  if (!session) return;

  try {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id')
      .contains('participant_ids', [session.id])
      .limit(50);

    if (!convs?.length) return;

    await supabase
      .from('messages')
      .delete()
      .in(
        'conversation_id',
        convs.map((c) => c.id)
      )
      .lt('expiry_at', new Date().toISOString());
  } catch (e) {
    console.error(e);
  }
}
