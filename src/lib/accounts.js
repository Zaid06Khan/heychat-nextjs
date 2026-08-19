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
 * Turns what somebody typed into a pattern PostgREST can be trusted with.
 *
 * `or=(username.ilike.…,display_name.ilike.…)` is ONE query-string parameter
 * that PostgREST parses itself, so characters with meaning in that grammar have
 * to go: a comma ends the filter early and a bracket closes the group, either
 * of which silently changes the query rather than failing. `%` and `*` are
 * removed for a different reason — typing one should not quietly match every
 * account in the table.
 *
 * `_` IS LEFT ALONE, AND IT IS A SINGLE-CHARACTER WILDCARD. Escaping it as
 * `\_` does nothing here: measured against this project, `%test\_%` and
 * `%test_%` both return `testbuddy`, `Testerbot` and `Test456` — the backslash
 * is not honoured, so an "escape" would be a comment claiming something untrue.
 * The effect is that searching `pw_a` also matches `pwXa`. For a search box
 * that returns a superset, which is a good deal better than the alternative
 * shape of this bug.
 */
function likePattern(term) {
  const cleaned = String(term || '').trim().replace(/[,()%*\\]/g, '');
  return cleaned ? `%${cleaned}%` : '';
}

/**
 * Find people by username or display name.
 *
 * THIS REPLACES A REAL BUG. It used to fetch a page of accounts and filter that
 * page in the browser, so search only ever saw the first 20 rows the database
 * happened to return — past twenty accounts, most people simply could not be
 * found by typing their name, and the screen said "No users found" rather than
 * admitting it had looked at a fraction of the table.
 *
 * @param {string} term
 * @param {{ limit?: number, excludeIds?: string[] }} options
 */
export async function searchAccounts(term, { limit = 20, excludeIds = [] } = {}) {
  const pattern = likePattern(term);
  if (!pattern) return [];

  let query = client()
    .from('accounts')
    .select('*')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(limit);

  // Yourself, and anyone already in the group. Excluded in the query rather
  // than after it, so the limit is spent on results the caller can use — the
  // browser-side version could return a page that was entirely filtered away.
  const exclude = excludeIds.filter(Boolean);
  if (exclude.length > 0) {
    query = query.not('id', 'in', `(${exclude.join(',')})`);
  }

  return unwrap(await query) || [];
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
