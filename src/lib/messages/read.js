'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Reading a thread. The other half of `send.js`.
 *
 * Replaces `base44.entities.Message.filter`, and the ordering is the load-
 * bearing part: NEWEST first with a limit, then reversed by the caller. Sorting
 * ascending with the same limit takes the OLDEST rows, so a conversation past
 * the limit shows the first messages ever sent and nothing since — which is
 * exactly the bug a 220-message fixture found here.
 */
export async function getRecentMessages(conversationId, limit = 200) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}
