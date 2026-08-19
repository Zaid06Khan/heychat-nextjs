'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Contact requests, without the shim.
 *
 * Replaces `base44.entities.ContactRequest.*`. One fact shapes nearly every
 * function here: `contact_requests` has `unique (from_account_id,
 * to_account_id)`, so there is AT MOST ONE ROW PER PAIR for all time. A request
 * is not a log of attempts — it is a single row whose status moves.
 *
 * That is why withdrawing deletes rather than marking cancelled, and why
 * re-requesting after a decline updates the existing row instead of inserting a
 * second one. Both are load-bearing: any row left behind blocks that pair
 * forever, and the failed insert surfaces somewhere the user cannot see.
 *
 * RLS (`contact_requests_select_party` and friends) already limits every one of
 * these to rows you are a party to, so none of them filter by "mine" defensively.
 */

function client() {
  return getSupabaseBrowserClient();
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

const SELECT = '*';

/** Requests this account has sent, optionally narrowed to one status. */
export async function getSentRequests(accountId, status = null) {
  let q = client().from('contact_requests').select(SELECT).eq('from_account_id', accountId);
  if (status) q = q.eq('status', status);
  return unwrap(await q) || [];
}

/** Requests this account has received, optionally narrowed to one status. */
export async function getReceivedRequests(accountId, status = null) {
  let q = client().from('contact_requests').select(SELECT).eq('to_account_id', accountId);
  if (status) q = q.eq('status', status);
  return unwrap(await q) || [];
}

/** The single row between two people, in one direction. Null if there is none. */
export async function getRequestBetween(fromId, toId) {
  return unwrap(
    await client()
      .from('contact_requests')
      .select(SELECT)
      .eq('from_account_id', fromId)
      .eq('to_account_id', toId)
      .maybeSingle()
  );
}

/**
 * Ask to be someone's contact, or ask again.
 *
 * Reuses the existing row when there is one, because the unique constraint
 * means an insert would fail — and a previous decline would otherwise lock you
 * out of ever asking again, silently. Returns `'already-contacts'` when the
 * pair is already accepted so the caller can say so instead of pretending to
 * send something.
 */
export async function sendContactRequest({ fromId, toId, toUsername }) {
  const existing = await getRequestBetween(fromId, toId);

  if (existing) {
    if (existing.status === 'accepted') return 'already-contacts';
    unwrap(
      await client()
        .from('contact_requests')
        .update({ status: 'pending' })
        .eq('id', existing.id)
        .select()
        .single()
    );
    return 'pending';
  }

  unwrap(
    await client()
      .from('contact_requests')
      .insert({
        from_account_id: fromId,
        to_account_id: toId,
        to_username: toUsername,
        status: 'pending',
      })
      .select()
      .single()
  );
  return 'pending';
}

/** Answer a request you received. */
export async function setRequestStatus(requestId, status) {
  return unwrap(
    await client()
      .from('contact_requests')
      .update({ status })
      .eq('id', requestId)
      .select()
      .single()
  );
}

/**
 * Withdraw a request you sent.
 *
 * Deletes rather than marking cancelled, for the unique-constraint reason at
 * the top of this file.
 */
export async function withdrawRequest(requestId) {
  const { error } = await client().from('contact_requests').delete().eq('id', requestId);
  if (error) throw new Error(error.message);
}

/** Everyone this account is actually contacts with, as a Set of account ids. */
export async function getContactIds(accountId) {
  const [sent, received] = await Promise.all([
    getSentRequests(accountId, 'accepted'),
    getReceivedRequests(accountId, 'accepted'),
  ]);
  return new Set([
    ...sent.map((r) => r.to_account_id),
    ...received.map((r) => r.from_account_id),
  ]);
}
