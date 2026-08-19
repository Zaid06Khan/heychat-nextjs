'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The `calls` table: a record that a call happened.
 *
 * Replaces `base44.entities.Call.create`. It records nothing else — no
 * duration, no outcome, and nothing in the thread — so there is no missed-call
 * history anywhere. See FOLLOWUPS §1.
 *
 * NOT the call transport. That is `lib/calls/controller.js`; this is only the
 * row.
 */
export async function createCallRecord({ conversationId, initiatedBy, participantIds }) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('calls')
    .insert({
      conversation_id: conversationId,
      initiated_by: initiatedBy,
      participant_ids: participantIds,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
