import 'server-only';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { sendPushToAccounts } from '@/lib/push/server';

/**
 * Turns one stored message into the notifications it should produce.
 *
 * This used to be the body of POST /api/push/notify, which existed because
 * messages were written straight from the browser: the sender's tab inserted a
 * row and then made a second request asking for the notification. Most of that
 * route was defensive machinery — is this id real, are you allowed to see it,
 * are you actually its sender, is it fresh enough not to be a replay — and all
 * of it existed to compensate for the caller naming a message it did not
 * necessarily send.
 *
 * POST /api/messages inserts the row itself, so the caller cannot name anything.
 * The checks are gone because the question they answered can no longer be asked.
 * What survives is the part that was always the real work: deciding who among
 * the participants should be disturbed, and with how much detail.
 *
 * CALLERS MUST HAVE ESTABLISHED MEMBERSHIP ALREADY. Both arguments are rows the
 * route read or wrote through the caller's own session, so RLS has already had
 * its say. This function does not re-check, and it uses the service role — pass
 * it a conversation the caller has no business in and it will happily notify
 * that conversation.
 *
 * @param {object} message      the freshly inserted row
 * @param {object} conversation id, type, name, participant_ids
 * @param {string} senderId
 * @returns {Promise<{ sent: number, failed: number, pruned: number, reason?: string }>}
 */

const PREVIEW_MAX = 120;

function previewFor(message) {
  if (message.message_type === 'image') return '📷 Photo';
  if (message.message_type === 'video') return '🎥 Video';
  if (message.message_type === 'voice') return '🎤 Voice message';
  if (message.message_type === 'file') return '📎 Attachment';

  const text = (message.content || '').trim();
  if (!text) return 'New message';
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

export async function notifyForMessage({ message, conversation, senderId }) {
  const empty = { sent: 0, failed: 0, pruned: 0 };

  const recipients = (conversation.participant_ids || []).filter((id) => id && id !== senderId);
  if (recipients.length === 0) return { ...empty, reason: 'no-recipients' };

  const admin = getSupabaseAdminClient();

  // The sender's own display name, and the recipients' preferences, in one round
  // trip. `accounts` is readable by any signed-in user anyway, so nothing is
  // exposed here that the sender could not already read — the service role is
  // used only so this does not depend on anyone's visibility rules.
  const [{ data: accounts }, { data: mutes }] = await Promise.all([
    admin
      .from('accounts')
      .select('id, username, display_name, blocked_account_ids, hide_notification_preview')
      .in('id', [senderId, ...recipients]),
    admin
      .from('conversation_mutes')
      .select('account_id, muted_until')
      .eq('conversation_id', conversation.id)
      .in('account_id', recipients),
  ]);

  const sender = accounts?.find((a) => a.id === senderId);
  const senderName = sender?.display_name || sender?.username || 'Someone';

  // A mute row with a NULL muted_until is indefinite; a timestamp expires on its
  // own. Evaluated here rather than in the query so the two cases read as one
  // rule instead of an `or` clause nobody can parse six months from now.
  const mutedIds = new Set(
    (mutes || [])
      .filter((m) => !m.muted_until || new Date(m.muted_until) > new Date())
      .map((m) => m.account_id)
  );

  // Blocking someone should stop their messages reaching you on the lock screen,
  // not just in the app. Without this, a blocked user still gets to make your
  // phone buzz, which is most of what blocking is meant to prevent.
  const allowed = recipients.filter((id) => {
    const account = accounts?.find((a) => a.id === id);
    if (account?.blocked_account_ids?.includes(senderId)) return false;
    return !mutedIds.has(id);
  });

  if (allowed.length === 0) return { ...empty, reason: 'no-recipients' };

  const isGroup = conversation.type === 'group';
  const title = isGroup ? conversation.name || 'Group' : senderName;
  const preview = previewFor(message);

  // Previews are a per-person choice, so the payload differs per recipient and
  // this cannot be one broadcast. Two groups at most, and the common case is a
  // single send — everyone keeps the default.
  const groups = [
    { ids: allowed.filter((id) => !accounts?.find((a) => a.id === id)?.hide_notification_preview), hidden: false },
    { ids: allowed.filter((id) => accounts?.find((a) => a.id === id)?.hide_notification_preview), hidden: true },
  ].filter((g) => g.ids.length > 0);

  const totals = { ...empty };

  for (const group of groups) {
    // When previews are hidden the message text never leaves this server. The
    // title is kept — knowing *that* something arrived is the entire point, and
    // for a direct chat the sender's name is already implied by the app icon.
    const body = group.hidden
      ? 'New message'
      : isGroup
        ? `${senderName}: ${preview}`
        : preview;

    const result = await sendPushToAccounts(group.ids, {
      title: group.hidden ? 'HeyChat' : title,
      body,
      conversationId: conversation.id,
      url: `/chat/${conversation.id}`,
      timestamp: new Date(message.created_date).getTime(),
    });

    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.pruned += result.pruned;
  }

  return totals;
}
