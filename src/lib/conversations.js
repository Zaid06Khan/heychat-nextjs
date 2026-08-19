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

/**
 * Every direct conversation this account is in.
 *
 * `participant_ids` is a Postgres array, so membership is containment rather
 * than equality — the shim inferred that from the column name at runtime, which
 * is precisely the kind of guessing this migration removes.
 */
export async function getDirectConversations(accountId) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('type', 'direct')
    .contains('participant_ids', [accountId]);

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * The direct conversation with one person, creating it only if there is none.
 *
 * Callers used to fetch every direct conversation and scan it in the browser.
 * The scan is still here because `participant_ids` is an array with no unique
 * constraint across pairs, so "the one with exactly these two" is not something
 * PostgREST can ask for — but it is now in one place rather than three.
 */
export async function getOrCreateDirectConversation(myAccountId, otherAccountId) {
  const supabase = getSupabaseBrowserClient();

  const mine = await getDirectConversations(myAccountId);
  const existing = mine.find((c) => (c.participant_ids || []).includes(otherAccountId));
  if (existing) return existing;

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      type: 'direct',
      participant_ids: [myAccountId, otherAccountId],
      disappearing_timer: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Create a conversation row directly. Groups, and the accept-request path. */
export async function createConversation(fields) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('conversations')
    .insert(fields)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** One conversation by id. */
export async function getConversation(id) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Every conversation this account is in, newest-updated first.
 *
 * The ordering is `updated_date` and that is NOT the order the list shows —
 * ConversationList re-sorts by last message once it has them, because nothing
 * bumps a conversation row when a message arrives. This ordering only decides
 * which 50 rows come back, which is why it is still here.
 */
export async function getMyConversations(accountId, limit = 50) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .contains('participant_ids', [accountId])
    .order('updated_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Set the disappearing-message timer.
 *
 * The only column `authenticated` may UPDATE on `conversations` — 0015 narrowed
 * the grant to this one, because RLS cannot express "this column but not that
 * one" and everything else (name, cover, membership, admin) goes through a
 * SECURITY DEFINER function instead.
 */
export async function updateDisappearingTimer(conversationId, seconds) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('conversations')
    .update({ disappearing_timer: seconds })
    .eq('id', conversationId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
