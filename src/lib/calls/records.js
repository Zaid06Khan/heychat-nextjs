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

/**
 * Write down how a call ended.
 *
 * NO MIGRATION NEEDED, and that is not a compromise — the shape was already
 * there. `started_at` is null until media actually flows, so a row with
 * `status = 'ended'` and no `started_at` IS a call that never connected. A
 * missed call and an answered one differ by that column alone.
 *
 * ONLY THE CALLER WRITES IT. Both ends know the outcome, and both writing would
 * put the same call in the conversation twice. The initiator is the one that
 * always knows — a declined call never reaches the other side's UI at all.
 */
export async function recordCallOutcome({
  conversationId,
  initiatedBy,
  participantIds,
  connectedAt = null,
  video = false,
}) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from('calls').insert({
    conversation_id: conversationId,
    initiated_by: initiatedBy,
    participant_ids: participantIds || [],
    status: 'ended',
    started_at: connectedAt ? new Date(connectedAt).toISOString() : null,
    ended_at: new Date().toISOString(),
    // `calls` has no column for this and adding one needs a migration. The
    // conversation type already tells you whether video was possible, and
    // "missed call" reads the same either way, so it is not worth one.
  });

  // A call that happened is worth more than a record of it. Never throws.
  if (error) console.error('[calls] could not record outcome:', error.message);
}

/**
 * Calls in a conversation, newest last, for the thread to show alongside
 * messages. Limited for the same reason messages are.
 */
export async function getCallsForConversation(conversationId, limit = 50) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('calls')
    .select('id, initiated_by, started_at, ended_at, created_date')
    .eq('conversation_id', conversationId)
    .order('created_date', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse();
}
