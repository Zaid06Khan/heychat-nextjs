'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Reads and writes against `accounts`, without the shim.
 *
 * These replace `base44.entities.Account.*`. The shim built a PostgREST query
 * from a Base44 filter dialect at runtime; these are the queries it would have
 * produced, written once and named after what they are for.
 *
 * RLS is the boundary, not this file. `accounts_select_authenticated` lets any
 * signed-in user read any account — contact search, group member lists and
 * country suggestions all need it — and `accounts_update_self` limits writes to
 * your own row. Nothing here re-checks either, deliberately: a second membership
 * rule written in JavaScript is only a thing that can drift from the one the
 * database enforces.
 */

function client() {
  return getSupabaseBrowserClient();
}

function unwrap({ data, error }) {
  // The Postgres message is the useful one. An RLS rejection reads as "new row
  // violates row-level security policy", which says far more than "failed".
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

/** One account by id. Throws if it does not exist. */
export async function getAccount(id) {
  return unwrap(await client().from('accounts').select('*').eq('id', id).single());
}

/**
 * Several accounts by id, in one round trip.
 *
 * The shim had no way to express this, so every caller looped `Account.get`
 * and paid one request per person. Returns a Map so callers can look up by id
 * without another pass, and silently omits ids that no longer resolve — a
 * deleted account should thin a list, not break it.
 *
 * @returns {Promise<Map<string, object>>}
 */
export async function getAccountsById(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = unwrap(await client().from('accounts').select('*').in('id', unique)) || [];
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * The account list contact search works from.
 *
 * NOTE, AND THIS IS NOT A TRANSLATION ARTEFACT: this fetches a page of accounts
 * and the caller filters it in the browser, which is exactly what the shim call
 * `Account.filter({}, null, 20)` did. It means search only ever sees these rows,
 * so somebody outside them cannot be found by typing their name. Preserved
 * as-is here because this pass is plumbing; see FOLLOWUPS §9 for the fix, which
 * is one `ilike` away.
 */
export async function listAccountsPage(limit = 20) {
  return unwrap(await client().from('accounts').select('*').limit(limit)) || [];
}

/** Every account whose id is in `ids`. Used by group member lists. */
export async function getAccountsIn(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return [];
  return unwrap(await client().from('accounts').select('*').in('id', unique)) || [];
}

/**
 * Update your own row.
 *
 * `accounts_update_self` is `using (id = auth.uid())`, so an attempt on someone
 * else's row matches zero rows — and PostgREST answers 200 with an empty array
 * rather than an error. `.select().single()` turns that silence into a throw,
 * which is the behaviour the shim had and the reason it is kept.
 */
export async function updateAccount(id, patch) {
  return unwrap(
    await client().from('accounts').update(patch).eq('id', id).select().single()
  );
}
