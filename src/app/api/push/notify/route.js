import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';
import { sendPushToAccounts } from '@/lib/push/server';

/**
 * POST /api/push/notify  { messageId }
 *
 * Notifies the other people in a conversation that a message arrived.
 *
 * WHY THE CLIENT TRIGGERS THIS. The obvious design is a database trigger, so a
 * message can never be sent without a notification following it. That needs
 * pg_net plus a shared secret plus a way to test it, and messages are still
 * written straight from the browser through the compatibility shim (FOLLOWUPS
 * #8). So for now the sender's browser asks for the notification after its
 * message lands.
 *
 * The honest consequence: if the sender's tab dies between the insert and this
 * call, the message is delivered but silent. The recipient still sees it on
 * next open, exactly as before this feature existed — the failure mode is the
 * old behaviour, not a worse one. When message sending moves behind a real
 * route handler, this call belongs inside it and this route should go away.
 *
 * WHAT STOPS ABUSE. The caller supplies only an id, never a recipient list and
 * never any text:
 *
 *   1. The message is read through the CALLER'S OWN SESSION, so RLS decides
 *      whether they can see it at all. A stranger passing a guessed id gets
 *      nothing back and the request stops here.
 *   2. The caller must be the message's sender. Being able to read a message is
 *      not permission to make everyone else's phone buzz about it.
 *   3. Only messages under a minute old qualify, which makes replaying an old
 *      id to buzz someone repeatedly pointless.
 *   4. The notification text is composed here from the stored row. Nothing in
 *      the request body reaches the recipient's lock screen.
 *
 * RECIPIENT PREFERENCES are applied here too, for the same reason: server-side
 * is the only place they mean anything. A muted conversation is dropped before
 * a push is sent rather than hidden on arrival, and a recipient who has turned
 * previews off never has the message text sent to their device at all. See
 * 0009_notification_prefs.sql.
 */

// Long enough for a slow phone to finish an insert and make a second request,
// short enough that a captured id is worthless almost immediately.
const MAX_MESSAGE_AGE_MS = 60 * 1000;

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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return jsonError('Not signed in.', 401);

  const senderId = userData.user.id;

  // Generous enough for a fast conversation, low enough that a script cannot
  // turn one account into a notification firehose.
  const rl = check(`push-notify:${senderId}:${clientKey(request)}`, 120, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { messageId } = body ?? {};
  if (typeof messageId !== 'string' || !messageId) {
    return jsonError('A messageId is required.');
  }

  // Check 1: RLS decides visibility. A non-participant gets no row.
  const { data: message } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, content, message_type, created_date')
    .eq('id', messageId)
    .maybeSingle();

  if (!message) return jsonError('Not found.', 404);

  // Check 2: readers are not senders.
  if (message.sender_id !== senderId) return jsonError('Not found.', 404);

  // Check 3: freshness.
  const age = Date.now() - new Date(message.created_date).getTime();
  if (!Number.isFinite(age) || age > MAX_MESSAGE_AGE_MS) {
    return Response.json({ ok: true, sent: 0, reason: 'stale' });
  }

  // Also read through the caller's session — they are a participant, so RLS
  // allows it, and using the same boundary twice beats re-deriving membership.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, type, name, participant_ids')
    .eq('id', message.conversation_id)
    .maybeSingle();

  if (!conversation) return jsonError('Not found.', 404);

  const recipients = (conversation.participant_ids || []).filter((id) => id && id !== senderId);
  if (recipients.length === 0) return Response.json({ ok: true, sent: 0 });

  const admin = getSupabaseAdminClient();

  // The sender's own display name, and the recipients' block lists, in one
  // round trip. `accounts` is readable by any signed-in user anyway, so nothing
  // is being exposed here that the caller could not already read — the service
  // role is used only so this does not depend on the caller's visibility rules.
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

  // A mute row with a NULL muted_until is indefinite; a timestamp expires on
  // its own. Evaluated here rather than in the query so the two cases read as
  // one rule instead of an `or` clause nobody can parse six months from now.
  const mutedIds = new Set(
    (mutes || [])
      .filter((m) => !m.muted_until || new Date(m.muted_until) > new Date())
      .map((m) => m.account_id)
  );

  // Blocking someone should stop their messages reaching you on the lock
  // screen, not just in the app. Without this, a blocked user still gets to
  // make your phone buzz, which is most of what blocking is meant to prevent.
  const allowed = recipients.filter((id) => {
    const account = accounts?.find((a) => a.id === id);
    if (account?.blocked_account_ids?.includes(senderId)) return false;
    return !mutedIds.has(id);
  });

  if (allowed.length === 0) return Response.json({ ok: true, sent: 0, reason: 'no-recipients' });

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

  const totals = { sent: 0, failed: 0, pruned: 0 };

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

  return Response.json({ ok: true, ...totals });
}
