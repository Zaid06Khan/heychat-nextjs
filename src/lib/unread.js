'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Mark messages read.
 *
 * This MUST be the RPC. A recipient cannot reach `read_by` with a table update:
 * `messages_update_sender` is `using (sender_id = auth.uid())`, so an UPDATE
 * from anyone but the author matches zero rows — and PostgREST answers that
 * with 200 and an empty array, not an error. ChatView did exactly that from
 * 0001 until the unread badge made it visible, which is the whole reason read
 * receipts never worked: the write silently hit nothing, every time, for
 * everyone. 0002 says so in a comment above the policy; the client just didn't
 * follow it.
 *
 * `mark_message_read` is SECURITY DEFINER, checks conversation membership, and
 * appends only the caller — so it cannot double as a way to rewrite the text.
 *
 * Fired in parallel rather than in sequence. It is still one call per unread
 * message (FOLLOWUPS #11), but N round trips at once beats N one after another.
 */
export async function markRead(messageIds) {
  if (!messageIds.length) return;
  const supabase = getSupabaseBrowserClient();
  await Promise.all(
    messageIds.map((id) => supabase.rpc('mark_message_read', { message_id: id }))
  );
}

/**
 * The total unread count, shared between the conversation list and the nav.
 *
 * A deliberately tiny store rather than context or a state library, for one
 * structural reason: `ConversationList` is mounted TWICE on /home — once in
 * AppLayout's sidebar (`hidden md:flex`) and once inside `Home` itself
 * (`md:hidden`) — and `BottomNav` is mounted twice for the same reason. CSS
 * decides which of each you see. Prop-drilling a total between them would mean
 * threading it through `Home`, which renders one of the pair and neither of the
 * other.
 *
 * So the list publishes and the nav subscribes. Both list instances publish the
 * same number, which is harmless: `set` ignores a value that hasn't changed, so
 * the duplicate is a no-op rather than a second render.
 *
 * No fetching happens here. The count is a by-product of a query
 * ConversationList already makes, so the badge costs nothing extra.
 */

let total = 0;
const subscribers = new Set();

export function setUnreadTotal(next) {
  const value = Number(next) || 0;
  if (value === total) return;
  total = value;
  for (const fn of subscribers) fn(value);
}

export function useUnreadTotal() {
  const [value, setValue] = useState(total);
  useEffect(() => {
    // Re-sync on mount: the list may have published before this subscribed.
    setValue(total);
    subscribers.add(setValue);
    return () => subscribers.delete(setValue);
  }, []);
  return value;
}
