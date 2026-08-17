'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Things waiting for an answer: contact requests, and group invitations.
 *
 * The same tiny-store shape as `unread.js` and for the same reason — the nav
 * and the Contacts screen both need the number and neither owns the other. See
 * that file for why this is not context.
 *
 * DIFFERENT FROM `unread.js` IN ONE WAY: that count is a by-product of a query
 * ConversationList already makes, so it costs nothing. This one has no such
 * host, so it fetches. Two cheap queries, refreshed when something plausibly
 * changed rather than on a timer.
 */

let count = 0;
const subscribers = new Set();

function publish(next) {
  const value = Number(next) || 0;
  if (value === count) return;
  count = value;
  for (const fn of subscribers) fn(value);
}

export function usePendingCount() {
  const [value, setValue] = useState(count);
  useEffect(() => {
    setValue(count);
    subscribers.add(setValue);
    return () => subscribers.delete(setValue);
  }, []);
  return value;
}

/**
 * Recount and publish.
 *
 * Contact requests are a plain table read — RLS already limits it to rows you
 * are part of, and `head: true` means Postgres counts without sending any rows.
 *
 * Group invitations go through the RPC, because the invitee is by definition
 * not a member of the conversation yet (0019). It fails soft: a tree without
 * that migration should show contact requests rather than nothing.
 */
export async function refreshPending(accountId) {
  if (!accountId) return;
  const supabase = getSupabaseBrowserClient();

  const [{ count: requests }, invites] = await Promise.all([
    supabase
      .from('contact_requests')
      .select('id', { count: 'exact', head: true })
      .eq('to_account_id', accountId)
      .eq('status', 'pending'),
    supabase.rpc('my_group_invites').then((r) => r.data || []).catch(() => []),
  ]);

  publish((requests || 0) + invites.length);
}
