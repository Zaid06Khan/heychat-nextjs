'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Every call this app makes to its own API goes through here.
 *
 * TWO THINGS IT ADDS, both of them for the native app.
 *
 * 1. THE BEARER TOKEN. Bundled into the app the client runs from
 *    `capacitor://localhost`, so a cookie scoped to the deployed origin is
 *    third-party and WKWebView blocks it outright. The token has to travel in a
 *    header instead. Harmless on the web, where the cookie is sent too and the
 *    server simply prefers the header — the two name the same account.
 *
 * 2. THE ORIGIN. On the web the API is same-origin and `NEXT_PUBLIC_API_ORIGIN`
 *    is unset, so paths stay relative exactly as before. The bundled client sets
 *    it to the deployed origin, because from `capacitor://localhost` a relative
 *    `/api/...` would resolve to the app bundle and 404.
 *
 * ONE CHOKEPOINT ON PURPOSE. There are sixteen call sites; without this, adding
 * the header would mean editing all of them again for Half B, and any one that
 * was missed would fail only on a phone, only when signed in.
 */

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN || '';

/** Absolute when the client is bundled, relative on the web. */
export function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

/**
 * `fetch`, with the session attached.
 *
 * The token is read at call time rather than cached, because supabase-js
 * refreshes it in the background and a copy taken at startup goes stale after
 * an hour — which would look like being randomly signed out.
 *
 * `credentials: 'same-origin'` is deliberate and does the right thing in both
 * worlds: the cookie rides along on the web, and cross-origin from the app it
 * is not sent at all, which is the case the header exists for.
 */
export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Authorization')) {
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // No session, or storage unavailable. Signing in and registering both
      // reach the API before a session exists, so this is a normal path and
      // not an error — the request simply goes out unauthenticated.
    }
  }

  return fetch(apiUrl(path), {
    credentials: 'same-origin',
    ...options,
    headers,
  });
}

/**
 * POST JSON, throw the server's message on failure.
 *
 * Lifted out of `heychatAuth.js`, which had it privately, so the push client
 * and every other caller share one definition of what an API error looks like.
 */
export async function apiPost(path, body) {
  const res = await apiFetch(path, {
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
