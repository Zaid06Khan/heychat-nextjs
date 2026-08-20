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
/**
 * React to a message, or change your reaction, or take it back.
 *
 * ONE REACTION PER PERSON PER MESSAGE. Picking a second emoji REPLACES the
 * first rather than adding to it — before this, one person could stack every
 * emoji in the picker onto a single message, which is not what a reaction is
 * and made the summary row meaningless. Tapping the one you already chose
 * removes it, which is the only way to have none.
 *
 * The delete-then-insert is not a transaction, and does not need to be: the
 * worst interleaving loses a reaction, and the fix is to tap again.
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

  // Whatever they had before, on this message, goes first.
  await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('account_id', accountId);

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

/**
 * Editing, through an RPC since 0020.
 *
 * It used to be a direct table update, which meant the edit window and the
 * history could not be enforced — anything with a session could rewrite its own
 * message forever, leaving only an "edited" marker and no record of what it had
 * said. `authenticated` now has no UPDATE grant on `messages` at all; this
 * function and `deleteMessageForEveryone` are the only ways in.
 *
 * The window is fifteen minutes from *sending*, not from the last edit, and the
 * server says so in the error — surfaced rather than swallowed, because "why
 * won't it save" needs an answer.
 */
export async function editMessage(messageId, content) {
  const { error } = await getSupabaseBrowserClient().rpc('edit_message', {
    msg_id: messageId,
    new_content: content,
  });

  if (error) throw new Error(error.message);
}

/**
 * Previous versions of a message, oldest first.
 *
 * Readable by anyone who can read the message — the people who saw the original
 * are the people entitled to know it changed. Returns empty rather than throwing
 * on error: a message edited before 0020 landed genuinely has no history, and
 * "no earlier version" is the honest thing to say about it.
 *
 * @returns {Promise<Array<{previous_content: string, edited_at: string}>>}
 */
export async function getEditHistory(messageId) {
  const { data, error } = await getSupabaseBrowserClient()
    .from('message_edits')
    .select('previous_content, edited_at')
    .eq('message_id', messageId)
    .order('edited_at', { ascending: true });

  if (error) return [];
  return data || [];
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
  const { error } = await getSupabaseBrowserClient().rpc(
    'delete_message_for_everyone',
    { msg_id: messageId }
  );

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
 * Fetches specific messages by id, for quotes that fall outside the thread.
 *
 * `ChatView` loads the newest 200 messages, so a reply to anything older had no
 * original to point at and rendered "original message unavailable" — technically
 * true of a deleted message and simply wrong for an old one. This resolves the
 * difference.
 *
 * RLS decides visibility, so an id from a conversation the caller is not in
 * comes back empty rather than leaking a preview. Tombstones are excluded here
 * rather than at the call site because a deleted original genuinely *is*
 * unavailable, which is the one case the old copy was right about.
 *
 * @returns {Promise<Map<string, object>>}
 */
export async function getMessagesByIds(ids = []) {
  if (ids.length === 0) return new Map();

  const { data, error } = await getSupabaseBrowserClient()
    .from('messages')
    .select('id, sender_id, content, message_type, deleted_at, expiry_at')
    .in('id', ids)
    .is('deleted_at', null);

  if (error) return new Map();
  return new Map((data || []).map((m) => [m.id, m]));
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
