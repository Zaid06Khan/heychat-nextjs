'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Per-conversation mute.
 *
 * Talks to Supabase directly rather than through the Base44 shim: mutes were
 * never a Base44 entity, so adding one to `TABLES` would grow the thing
 * FOLLOWUPS #8 is trying to shrink. New surfaces go straight to the client.
 *
 * A row means muted. `muted_until` NULL means indefinitely; a timestamp expires
 * on its own, so nothing has to run on a schedule to clean it up. The server
 * applies the same rule independently in /api/push/notify — this module only
 * decides what the UI shows.
 */

/** A row is only actually muting if it hasn't expired. */
export function isMuteActive(row) {
  if (!row) return false;
  if (!row.muted_until) return true;
  return new Date(row.muted_until) > new Date();
}

export const MUTE_OPTIONS = [
  { label: 'For 8 hours', hours: 8 },
  { label: 'For 1 week', hours: 24 * 7 },
  { label: 'Until I turn it back on', hours: null },
];

/**
 * Mutes for several conversations at once.
 *
 * ConversationList needs the muted state of every row it renders, and doing
 * that one query per conversation would reintroduce exactly the N+1 that
 * FOLLOWUPS #8 complains about. RLS already scopes this to the caller, so no
 * account filter is needed here.
 *
 * @returns {Promise<Map<string, object>>} conversation_id -> mute row
 */
export async function getMutes(conversationIds = []) {
  if (conversationIds.length === 0) return new Map();

  const { data, error } = await getSupabaseBrowserClient()
    .from('conversation_mutes')
    .select('conversation_id, muted_until')
    .in('conversation_id', conversationIds);

  if (error) return new Map();
  return new Map((data || []).filter(isMuteActive).map((row) => [row.conversation_id, row]));
}

/** @returns {Promise<object|null>} the active mute row, or null */
export async function getMute(conversationId) {
  if (!conversationId) return null;

  const { data, error } = await getSupabaseBrowserClient()
    .from('conversation_mutes')
    .select('conversation_id, muted_until')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error || !isMuteActive(data)) return null;
  return data;
}

/**
 * @param {string} conversationId
 * @param {number|null} hours  null mutes indefinitely
 */
export async function muteConversation(accountId, conversationId, hours) {
  const muted_until = hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;

  // Upsert on the composite primary key, so re-muting an already-muted
  // conversation changes the expiry instead of failing on a duplicate.
  const { error } = await getSupabaseBrowserClient()
    .from('conversation_mutes')
    .upsert(
      { account_id: accountId, conversation_id: conversationId, muted_until },
      { onConflict: 'account_id,conversation_id' }
    );

  if (error) throw new Error(error.message);
  return { muted_until };
}

export async function unmuteConversation(conversationId) {
  // No account filter: the RLS delete policy is `auth.uid() = account_id`, so
  // this can only ever reach the caller's own row.
  const { error } = await getSupabaseBrowserClient()
    .from('conversation_mutes')
    .delete()
    .eq('conversation_id', conversationId);

  if (error) throw new Error(error.message);
}
