'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Replies, reactions, edit and delete.
 *
 * Straight to Supabase rather than through the Base44 shim — none of these were
 * Base44 entities, and adding them to `TABLES` would grow the thing FOLLOWUPS #8
 * is trying to shrink. See 0012_message_interactions.sql.
 */

/** The picker set. Six is enough to be useful and few enough to fit one row. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * Reactions for a batch of messages, in one query.
 *
 * @returns {Promise<Map<string, Array<{emoji: string, account_id: string}>>>}
 */
export async function getReactions(messageIds = []) {
  if (messageIds.length === 0) return new Map();

  const { data, error } = await getSupabaseBrowserClient()
    .from('message_reactions')
    .select('message_id, account_id, emoji')
    .in('message_id', messageIds);

  if (error) return new Map();

  const byMessage = new Map();
  for (const row of data || []) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
    byMessage.get(row.message_id).push({ emoji: row.emoji, account_id: row.account_id });
  }
  return byMessage;
}

/**
 * Adds the reaction, or removes it if this person already reacted with it.
 *
 * The composite primary key is (message_id, account_id, emoji), so "have I
 * already reacted with this?" is answered by the caller's own copy of the list
 * rather than by a round trip.
 *
 * @param {boolean} alreadyReacted
 */
export async function toggleReaction(messageId, accountId, emoji, alreadyReacted) {
  const supabase = getSupabaseBrowserClient();

  if (alreadyReacted) {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('account_id', accountId)
      .eq('emoji', emoji);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: messageId, account_id: accountId, emoji });

  // A duplicate means someone double-tapped and the row is already there —
  // which is the state they wanted, so it is not an error worth surfacing.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}

/** Collapses a reaction list into [{emoji, count, mine}] for rendering. */
export function summariseReactions(reactions = [], myAccountId) {
  const counts = new Map();
  for (const r of reactions) {
    const entry = counts.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (r.account_id === myAccountId) entry.mine = true;
    counts.set(r.emoji, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export async function editMessage(messageId, content) {
  const { error } = await getSupabaseBrowserClient()
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', messageId);

  if (error) throw new Error(error.message);
}

/**
 * Delete for everyone.
 *
 * Clears the body as well as setting the tombstone, so this is a real deletion
 * rather than a hidden row — participants can still SELECT the message, and
 * leaving `content` populated would mean "deleted" only ever described what the
 * UI chose to draw. The attachment is queued for removal from storage by a
 * trigger (0012); it is not left dangling.
 *
 * message_type is left alone: an image whose body is gone should still render
 * as a deleted-message tombstone, and rewriting the type would lose the fact
 * that something was there.
 */
export async function deleteMessageForEveryone(messageId) {
  const { error } = await getSupabaseBrowserClient()
    .from('messages')
    .update({
      deleted_at: new Date().toISOString(),
      content: null,
      media_url: null,
    })
    .eq('id', messageId);

  if (error) throw new Error(error.message);
}

/**
 * Delete for me.
 *
 * The other half of the pair, and deliberately not the same mechanism. This
 * writes a row to `message_hides` (0016) saying *you* do not want to see this
 * message; the message itself is untouched and everyone else's copy is exactly
 * as it was. Anyone else's message can be hidden, including one you could not
 * delete for everyone.
 *
 * Be clear about what this is not: the body still exists and the server can
 * still read it. It is a view preference. "Delete for everyone" remains the
 * only one that destroys anything.
 */
export async function hideMessageForMe(messageId, accountId) {
  const { error } = await getSupabaseBrowserClient()
    .from('message_hides')
    .insert({ message_id: messageId, account_id: accountId });

  // Hiding something already hidden is the state the caller wanted, so a
  // duplicate is not worth surfacing — same reasoning as a double-tapped
  // reaction.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}

/**
 * Which of these messages has the caller hidden?
 *
 * Degrades to "none" rather than throwing. Migrations here are applied by hand
 * (see README), so a tree that has this code but not 0016 is a real state, and
 * in it the honest behaviour is the old one: every message visible. Failing
 * loudly would instead take out the whole thread view over a feature nobody had
 * used yet. `hideMessageForMe` does NOT swallow its error, so the action still
 * reports plainly if the table is missing.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getHiddenMessageIds(messageIds = []) {
  if (messageIds.length === 0) return new Set();

  const { data, error } = await getSupabaseBrowserClient()
    .from('message_hides')
    .select('message_id')
    .in('message_id', messageIds);

  if (error) return new Set();
  return new Set((data || []).map((r) => r.message_id));
}
