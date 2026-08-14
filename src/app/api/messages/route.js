import { after } from 'next/server';

import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';
import { notifyForMessage } from '@/lib/push/notifyForMessage';

/**
 * POST /api/messages  { conversation_id, message_type, content?, media_url?,
 *                      reply_to_id? }
 *
 * Sending a message. The first screen operation to leave the compatibility shim
 * (FOLLOWUPS #8), and it moved for a specific reason rather than on principle.
 *
 * WHAT THIS FIXES. Messages used to be inserted by the browser, and the push
 * notification was a *second* request the sender's tab had to survive to make.
 * Close the tab, lose the network, background the phone in the wrong half-second
 * and the message arrived silently — no error anywhere, because from the
 * database's point of view nothing had gone wrong. Sending and notifying are one
 * request now, so the only way to get the row without the notification is for
 * this process to die between them.
 *
 * WHY after() AND NOT await. Web Push means one HTTPS request per device to
 * FCM/Mozilla/Apple, and none of that should sit between the user pressing send
 * and the composer clearing. `after()` runs the send once the response is on the
 * wire but still inside this invocation, so it is the server's problem and not
 * the tab's. The recipient sees the message through the realtime subscription
 * either way; this only decides whether their phone lights up.
 *
 * WHAT THE CALLER DOES NOT GET TO DECIDE. The insert goes through the caller's
 * own session, so `messages_insert_member` still decides whether they may write
 * into this conversation at all — the boundary is the one that was already
 * there and already tested, not a second one written here that could drift from
 * it. On top of that, four fields are taken away from the client entirely:
 *
 *   - `sender_id` is the session's account. RLS enforces this too; setting it
 *     here means a spoofed body is ignored rather than rejected.
 *   - `read_by` starts as the sender alone.
 *   - `expiry_at` is derived from the conversation's disappearing timer. This
 *     one is a real fix: the browser used to compute it, so anything posting
 *     directly could send a permanent message into a disappearing conversation.
 *   - `created_date` is the database's.
 */

const MESSAGE_TYPES = new Set(['text', 'image', 'video', 'file', 'voice']);

// Long enough for anything anyone types, short enough that the table cannot be
// used as free blob storage. The column is unbounded `text`.
const CONTENT_MAX = 8000;

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

  // Fast enough that nobody in a real conversation will ever see it, low enough
  // that a script cannot fill someone's thread — or, through the notify step,
  // their lock screen — as fast as the network allows. Before this route there
  // was no send limit at all.
  const rl = check(`messages:${senderId}:${clientKey(request)}`, 60, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const {
    conversation_id: conversationId,
    message_type: messageType = 'text',
    content = '',
    media_url: mediaUrl = '',
    reply_to_id: replyToId = null,
  } = body ?? {};

  if (typeof conversationId !== 'string' || !conversationId) {
    return jsonError('A conversation_id is required.');
  }
  if (!MESSAGE_TYPES.has(messageType)) {
    return jsonError('Unknown message type.');
  }
  if (typeof content !== 'string' || typeof mediaUrl !== 'string') {
    return jsonError('Invalid message body.');
  }
  if (content.length > CONTENT_MAX) {
    return jsonError('That message is too long.');
  }
  // A text message with nothing in it is a stray submit, not a message. Every
  // other type carries its payload in media_url instead.
  if (messageType === 'text' && !content.trim()) {
    return jsonError('A message needs some content.');
  }
  if (messageType !== 'text' && !mediaUrl) {
    return jsonError('That message type needs an attachment.');
  }
  if (replyToId !== null && typeof replyToId !== 'string') {
    return jsonError('Invalid reply target.');
  }

  // Read through the caller's session: a non-member gets nothing back and the
  // request stops here, before the insert would have failed anyway. Doing it
  // first is what makes the timer below trustworthy.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, type, name, participant_ids, disappearing_timer')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conversation) return jsonError('Not found.', 404);

  // Replying across conversations would put a quote in a thread whose readers
  // cannot see the original — and `quoteFor()` would render it as "unavailable"
  // rather than refusing it. Checked through the caller's session, so a guessed
  // id from a conversation they are not in reads as absent.
  if (replyToId) {
    const { data: parent } = await supabase
      .from('messages')
      .select('id')
      .eq('id', replyToId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (!parent) return jsonError('That message is not in this conversation.');
  }

  const timer = Number(conversation.disappearing_timer) || 0;
  const expiryAt = timer > 0 ? new Date(Date.now() + timer * 1000).toISOString() : null;

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      media_url: mediaUrl,
      message_type: messageType,
      expiry_at: expiryAt,
      read_by: [senderId],
      reply_to_id: replyToId,
    })
    .select()
    .single();

  if (error || !message) {
    // The likely cause is `messages_insert_member` refusing a non-member, which
    // the conversation read above should already have caught. Surfacing the
    // Postgres message keeps an RLS rejection legible instead of generic.
    return jsonError(error?.message || 'Could not send that message.', 400);
  }

  // Failing to notify must never look like a failed send — the message is in
  // the database and visible by the time this runs. It is logged and dropped.
  after(async () => {
    try {
      await notifyForMessage({ message, conversation, senderId });
    } catch (err) {
      console.error('[messages] notification failed', err);
    }
  });

  return Response.json({ ok: true, message });
}
