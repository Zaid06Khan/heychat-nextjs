'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * "Delete chat", and contacts.
 *
 * Deleting a chat hides it for you (0023). It does not touch the other person's
 * copy — a direct conversation belongs to both of you and neither of you owns
 * it, which is why the RLS policy that used to let either party destroy the row
 * outright was narrowed in the same migration.
 */

/**
 * Hides a conversation from this account, from now.
 *
 * `hidden_at` is a moment, not a flag, so a chat that gets a new message comes
 * back carrying only what arrived afterwards. Deleting the same chat twice moves
 * the line forward rather than failing, which is what upsert gives here.
 */
export async function hideConversation(conversationId, accountId) {
  const { error } = await getSupabaseBrowserClient()
    .from('conversation_hides')
    .upsert(
      { conversation_id: conversationId, account_id: accountId, hidden_at: new Date().toISOString() },
      { onConflict: 'conversation_id,account_id' }
    );

  if (error) throw new Error(error.message);
}

/**
 * When each conversation was hidden, for the ones that were.
 *
 * Returns a Map of conversation_id -> Date. Degrades to empty rather than
 * throwing: a tree carrying this code without 0023 should show every
 * conversation, which is the old behaviour, not an error screen.
 *
 * @returns {Promise<Map<string, Date>>}
 */
export async function getConversationHides() {
  const { data, error } = await getSupabaseBrowserClient()
    .from('conversation_hides')
    .select('conversation_id, hidden_at');

  if (error) return new Map();
  return new Map((data || []).map((r) => [r.conversation_id, new Date(r.hidden_at)]));
}

/**
 * Unfriend: removes the accepted contact link, in whichever direction it was
 * made.
 *
 * Deliberately narrow. It does NOT delete the conversation — the messages you
 * exchanged are still yours, and "Delete chat" is the separate control for
 * that. It does NOT block them either; blocking is its own thing and turning
 * "remove from my contacts" into it would be a surprise.
 *
 * They can send a new request afterwards, which is the point of removing rather
 * than blocking.
 */
export async function removeContact(myAccountId, otherAccountId) {
  const supabase = getSupabaseBrowserClient();

  // The row exists in one direction or the other depending on who asked, and
  // RLS lets either party delete a row they are part of. `or` covers both
  // without needing to know which way round it was.
  const { error } = await supabase
    .from('contact_requests')
    .delete()
    .or(
      `and(from_account_id.eq.${myAccountId},to_account_id.eq.${otherAccountId}),` +
      `and(from_account_id.eq.${otherAccountId},to_account_id.eq.${myAccountId})`
    );

  if (error) throw new Error(error.message);
}
